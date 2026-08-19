/*
 * Where accounts and sessions actually live.
 *
 * The first seam of the SQLite retirement, and it is deliberately narrow: five
 * operations, all asynchronous, with two implementations behind them. Narrow
 * because the rest of the application still reads SQLite directly, and the way
 * to move a store that size is one surface at a time rather than all at once.
 *
 * Asynchronous even for SQLite, which is synchronous, because the interface has
 * to be the shape MariaDB can satisfy. A synchronous seam is one MariaDB can
 * never implement, and that — not the SQL — was what made the earlier
 * "store-shaped interface" idea a dead end.
 *
 * Identity crossing this boundary is a STRING, and for MariaDB it is the user's
 * `public_uuid` rather than its BIGINT id. That is what lets reflections carry
 * on living in SQLite, whose `conversations.userId` is TEXT, while accounts
 * move. The internal key never leaves the database, which is the rule the
 * schema was designed around anyway.
 */

import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { ACCOUNT_TYPES, type AccountCreationContext, type AccountType } from '@chat/shared';
import { SESSION_TTL_MS } from '../db.ts';
import { sha256Hex } from '../mysql/tokens.ts';
import { GUEST_NAME_ATTEMPTS, guestName, randomGuestBaseName } from './guest-names.ts';
import { verifyPassword as verifyArgon2 } from '../mysql/passwords.ts';
import type { MysqlPersistence } from '../mysql/persistence.ts';
import type {
  StoredAccount,
  StoredCreationContext,
  StoredInstallation,
  StoredInstallationInput,
  StoredSession,
} from '../store.ts';

export interface AuthUser {
  /** Stable, public, and safe to put in a cookie, a payload or a URL. */
  id: string;
  accountType: AccountType;
  /** Null for a guest, who has not given one. */
  email: string | null;
  /** Kept after registration: it is what this person has been called so far. */
  guestName: string | null;
  emailVerified: boolean;
  /**
   * When the account was made.
   *
   * Carried because the outward limits are tighter for an account's first day,
   * and an age that is never populated means every account is treated as new
   * forever — which is not a safe default, it is a broken one.
   */
  createdAt: string | null;
}

export interface AuthStore {
  findByEmail(email: string): Promise<AuthUser | null>;
  /**
   * Create an account, or claim the guest already making this request.
   *
   * `claimUserId` is the ordinary path once guests exist: the row is upgraded
   * where it stands, so every reflection written before this moment is still
   * pointed at by the same id afterwards. Nothing is copied and nothing moves.
   *
   * Null when the email is taken, so the caller answers 409 without a race --
   * and, when a guest is claiming, without having half-registered their row.
   */
  register(email: string, password: string, claimUserId?: string | null): Promise<AuthUser | null>;
  verify(email: string, password: string): Promise<AuthUser | null>;
  /**
   * Begin an interaction. Separate from recognising the browser.
   *
   * `installationId` records which browser established it, so signing out of
   * one device can be told apart from signing out of all of them, and so a
   * durable credential can be revoked alongside the session it created.
   */
  startSession(userId: string, options?: SessionOptions): Promise<string>;
  userForToken(token: string): Promise<AuthUser | null>;
  /** What a token was, so logging out can decide what else to revoke. */
  sessionForToken(token: string): Promise<StoredSessionInfo | null>;
  endSession(token: string): Promise<void>;
  /**
   * Durable recognition for this browser, and the credential that proves it.
   *
   * Returned exactly once: only the hash is kept, so this is the single
   * opportunity to put it in a cookie.
   */
  createInstallation(
    userId: string,
    context: InstallationContext,
    persistenceType: PersistenceType,
  ): Promise<{ installationId: string; credential: string }>;
  /** The account a presented credential belongs to, or nobody. */
  accountForInstallation(credential: string): Promise<{ user: AuthUser; installationId: string } | null>;
  /** Deliberate and destructive: this browser is no longer recognised. */
  revokeInstallation(installationId: string): Promise<void>;
  /**
   * A guest account, made because somebody asked for one.
   *
   * Returns the credential exactly once. It is never stored, only its hash is,
   * so this return value is the single opportunity to put it in a cookie.
   */
  createGuest(
    context: AccountCreationContext,
  ): Promise<{ user: AuthUser; installationId: string; credential: string }>;
  /** Move a guest's work into an account that already existed. */
  merge(fromUserId: string, intoUserId: string): Promise<number>;
  markEmailVerified(userId: string): Promise<void>;
}

export const SESSION_TYPES = {
  GUEST: 'GUEST',
  REGISTERED_TEMPORARY: 'REGISTERED_TEMPORARY',
  REGISTERED_PERSISTENT: 'REGISTERED_PERSISTENT',
} as const;

export type SessionType = (typeof SESSION_TYPES)[keyof typeof SESSION_TYPES];

/**
 * Why a browser is durably recognised at all.
 *
 * A guest's recognition is the account: without it there is no way back to
 * what they wrote. A registered user's is a convenience they asked for, and
 * its absence is the right answer on a shared computer -- which is why there
 * is no value here for "signed in temporarily". That state has no durable
 * credential rather than a short-lived one.
 */
export const PERSISTENCE_TYPES = {
  GUEST_PERSISTENT: 'GUEST_PERSISTENT',
  REGISTERED_PERSISTENT: 'REGISTERED_PERSISTENT',
} as const;

export type PersistenceType = (typeof PERSISTENCE_TYPES)[keyof typeof PERSISTENCE_TYPES];

export type SessionOptions = {
  installationId?: string | null;
  sessionType?: SessionType;
};

export type StoredSessionInfo = {
  userId: string;
  installationId: string | null;
  sessionType: string;
};

/** Coarse diagnostics, written once and never read to identify anybody. */
export type InstallationContext = {
  platform: string;
  deviceClass?: string | null;
  browserFamily?: string | null;
  osFamily?: string | null;
};

/**
 * The value a browser holds: an id and a secret, together.
 *
 * The id finds the row and the secret proves it. Sent as one string because
 * two cookies would be two things to lose separately, and split on the first
 * separator so a secret containing one is still read whole.
 */
export function encodeInstallationCredential(installationId: string, secret: string): string {
  return `${installationId}.${secret}`;
}

export function decodeInstallationCredential(
  value: string,
): { installationId: string; secret: string } | null {
  const separator = value.indexOf('.');
  if (separator <= 0 || separator === value.length - 1) return null;
  return { installationId: value.slice(0, separator), secret: value.slice(separator + 1) };
}

/**
 * Compare a presented secret with the stored hash without leaking timing.
 *
 * `timingSafeEqual` needs equal lengths, and both sides here are SHA-256 hex,
 * so a length mismatch means the stored value is not a hash this code wrote --
 * which is a no, not a comparison.
 */
export function credentialMatches(secret: string, storedHash: string): boolean {
  const presented = Buffer.from(sha256Hex(secret), 'utf8');
  const stored = Buffer.from(storedHash, 'utf8');
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}

/**
 * A name for a new guest: a base name from the vocabulary and the next number
 * for it. The sequence is what prevents collisions; the unique index behind it
 * is what makes that guarantee rather than an expectation, and the caller
 * retries if it ever fires.
 */
async function allocateGuestName(nextSequence: (baseName: string) => Promise<number>): Promise<string> {
  const base = randomGuestBaseName((limit) => randomInt(limit));
  return guestName(base, await nextSequence(base));
}

/**
 * The secret half of an installation credential.
 *
 * 32 bytes from the system's random source, exactly as a session token is.
 * This is a bearer credential for everything the account holds, so it is held
 * to the same standard -- not a UUID, and not derived from anything about the
 * request or the machine making it.
 */
export function newInstallationSecret(): string {
  return randomBytes(32).toString('base64url');
}

/* ------------------------------------------------------------------ MariaDB */

/**
 * Accounts in MariaDB: a `users` row, local credentials beside it, and a
 * session row holding a hash of the token rather than the token.
 *
 * Passwords are argon2id here, where the SQLite store used scrypt. They are
 * not interchangeable and nothing rehashes on the way across — this was
 * switched on while the production database held no accounts at all, which is
 * the only moment a credential change costs nothing.
 */
export class MysqlAuthStore implements AuthStore {
  private readonly db: MysqlPersistence;

  constructor(db: MysqlPersistence) {
    this.db = db;
  }

  /** Emails are the login handle; they are folded before they are stored. */
  private static handle(email: string): string {
    return email.trim().toLowerCase();
  }

  /** One shape for both kinds of account, assembled from the row. */
  private async account(userId: number, email?: string | null): Promise<AuthUser | null> {
    const user = await this.db.getUserById(userId);
    if (!user) return null;
    return {
      id: user.publicUuid,
      accountType: user.accountType,
      email: email === undefined ? await this.db.getLocalUsername(userId) : email,
      guestName: user.guestName,
      emailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt,
    };
  }

  async findByEmail(email: string): Promise<AuthUser | null> {
    const handle = MysqlAuthStore.handle(email);
    const userId = await this.db.findUserIdByLocalUsername(handle);
    if (userId === null) return null;
    return this.account(userId, handle);
  }

  async register(email: string, password: string, claimUserId?: string | null): Promise<AuthUser | null> {
    const handle = MysqlAuthStore.handle(email);
    if (await this.db.findUserIdByLocalUsername(handle)) return null;

    /*
     * A guest registering keeps their row. This is the whole product invariant
     * in one branch: credentials are attached to the account that already owns
     * the reflections, so nothing is moved and nothing can be lost on the way.
     */
    const claiming = claimUserId ? await this.db.getUserByPublicUuid(claimUserId) : null;
    if (claiming && claiming.accountType === ACCOUNT_TYPES.ANONYMOUS) {
      try {
        await this.db.setLocalCredentials(claiming.id, handle, password);
      } catch (error: unknown) {
        /*
         * Two registrations for one address, landing together. The unique key
         * decides it; the loser leaves the guest exactly as it was -- still a
         * guest, still owning everything it owned -- rather than half-claimed.
         */
        if (await this.db.findUserIdByLocalUsername(handle)) return null;
        throw error;
      }
      await this.db.markUserRegistered(claiming.id);
      return this.account(claiming.id, handle);
    }

    const created = await this.db.createUser();
    try {
      await this.db.setLocalCredentials(created.id, handle, password);
      await this.db.markUserRegistered(created.id);
    } catch (error: unknown) {
      /*
       * Two registrations for one address, landing together. The unique key on
       * the username is what decides it; the loser removes the empty user row
       * it had already made rather than leaving an account nobody can log in
       * to.
       */
      await this.db.deleteUserGraph(created.id).catch(() => undefined);
      if (await this.db.findUserIdByLocalUsername(handle)) return null;
      throw error;
    }
    return this.account(created.id, handle);
  }

  async verify(email: string, password: string): Promise<AuthUser | null> {
    const handle = MysqlAuthStore.handle(email);
    const userId = await this.db.findUserIdByLocalUsername(handle);
    if (userId === null) return null;
    const stored = await this.db.getLocalCredentialHash(userId);
    if (!stored || !(await verifyArgon2(stored, password))) return null;
    return this.account(userId, handle);
  }

  async startSession(userId: string, options: SessionOptions = {}): Promise<string> {
    const user = await this.db.getUserByPublicUuid(userId);
    if (!user) throw new Error(`No account for ${userId}`);
    const { token } = await this.db.createSession(user.id, SESSION_TTL_MS, {
      installationId: options.installationId ?? null,
      sessionType: options.sessionType ?? SESSION_TYPES.REGISTERED_TEMPORARY,
    });
    return token;
  }

  async sessionForToken(token: string): Promise<StoredSessionInfo | null> {
    const session = await this.db.findActiveSession(token);
    if (!session) return null;
    const user = await this.db.getUserById(session.userId);
    if (!user) return null;
    return {
      userId: user.publicUuid,
      installationId: session.installationId ?? null,
      sessionType: session.sessionType ?? SESSION_TYPES.REGISTERED_TEMPORARY,
    };
  }

  async createInstallation(
    userId: string,
    context: InstallationContext,
    persistenceType: PersistenceType,
  ): Promise<{ installationId: string; credential: string }> {
    const user = await this.db.getUserByPublicUuid(userId);
    if (!user) throw new Error(`No account for ${userId}`);
    const installationId = randomUUID();
    const secret = newInstallationSecret();
    await this.db.addInstallation({
      userId: user.id,
      installationId,
      credentialHash: sha256Hex(secret),
      persistenceType,
      ...context,
    });
    return { installationId, credential: encodeInstallationCredential(installationId, secret) };
  }

  async accountForInstallation(
    credential: string,
  ): Promise<{ user: AuthUser; installationId: string } | null> {
    const parts = decodeInstallationCredential(credential);
    if (!parts) return null;
    const found = await this.db.findInstallation(parts.installationId);
    if (!found || !credentialMatches(parts.secret, found.credentialHash)) return null;
    await this.db.touchInstallation(parts.installationId);
    const user = await this.account(found.userId);
    return user ? { user, installationId: parts.installationId } : null;
  }

  async revokeInstallation(installationId: string): Promise<void> {
    await this.db.revokeInstallation(installationId);
  }

  async userForToken(token: string): Promise<AuthUser | null> {
    const session = await this.db.findActiveSession(token);
    if (!session) return null;
    return this.account(session.userId);
  }

  async endSession(token: string): Promise<void> {
    const session = await this.db.findActiveSession(token);
    if (session) await this.db.revokeSession(session.id);
  }

  async createGuest(
    context: AccountCreationContext,
  ): Promise<{ user: AuthUser; installationId: string; credential: string }> {
    for (let attempt = 0; attempt < GUEST_NAME_ATTEMPTS; attempt += 1) {
      const name = await allocateGuestName((base) => this.db.nextGuestNameSequence(base));
      const created = await this.db.createGuestUser(name, context).catch((error: unknown) => {
        /* The unique index fired; another attempt is cheaper than an error. */
        if (attempt === GUEST_NAME_ATTEMPTS - 1) throw error;
        return null;
      });
      if (!created) continue;
      const user = await this.account(created.id, null);
      if (!user) continue;
      const { installationId, credential } = await this.createInstallation(
        user.id,
        { platform: context.platform, deviceClass: context.deviceClass },
        PERSISTENCE_TYPES.GUEST_PERSISTENT,
      );
      return { user, installationId, credential };
    }
    throw new Error('Could not allocate a guest name.');
  }

  async merge(fromUserId: string, intoUserId: string): Promise<number> {
    const from = await this.db.getUserByPublicUuid(fromUserId);
    const into = await this.db.getUserByPublicUuid(intoUserId);
    if (!from || !into) return 0;
    await this.db.revokeInstallationsForUser(from.id);
    await this.db.revokeSessionsForUser(from.id);
    await this.db.markUserMerged(from.id, into.id);
    /* Reflections still live in SQLite; the caller moves those. */
    return 0;
  }

  async markEmailVerified(userId: string): Promise<void> {
    const user = await this.db.getUserByPublicUuid(userId);
    if (user) await this.db.markEmailVerified(user.id);
  }
}

/* ------------------------------------------------------------------- SQLite */

/**
 * The existing tables, behind the same interface.
 *
 * It stays until the rest of the application has moved, so a checkout with no
 * database still runs and the suite still passes without one.
 */
/** The account tables, as both `SqliteStore` and `MemoryStore` provide them. */
export interface SqliteAuthTables {
  accounts: {
    get(id: string): StoredAccount | undefined;
    byEmail(email: string): StoredAccount | undefined;
    createRegistered(email: string, passwordHash: string): StoredAccount;
    createGuest(name: string, context: StoredCreationContext): StoredAccount;
    claim(id: string, email: string, passwordHash: string): StoredAccount | undefined;
    setEmailVerified(id: string): void;
    touch(id: string): void;
    merge(fromUserId: string, intoUserId: string): number;
    nextGuestSequence(baseName: string): number;
  };
  installations: {
    create(input: StoredInstallationInput): string;
    find(installationId: string): StoredInstallation | undefined;
    touch(installationId: string): void;
    revoke(installationId: string): void;
    revokeForUser(userId: string): void;
  };
  sessions: {
    get(token: string): StoredSession | undefined;
    set(token: string, session: StoredSession): unknown;
    revoke(token: string): void;
    revokeForUser(userId: string): void;
    revokeForInstallation(installationId: string): void;
  };
}

export class SqliteAuthStore implements AuthStore {
  private readonly store: SqliteAuthTables;
  private readonly hash: (password: string) => string;
  private readonly check: (password: string, stored: string) => boolean;

  constructor(
    store: SqliteAuthTables,
    hash: (password: string) => string,
    check: (password: string, stored: string) => boolean,
  ) {
    this.store = store;
    this.hash = hash;
    this.check = check;
  }

  private static user(found: StoredAccount | undefined): AuthUser | null {
    if (!found) return null;
    return {
      id: found.id,
      accountType: found.accountType,
      email: found.email,
      guestName: found.guestName,
      emailVerified: found.emailVerifiedAt !== null,
      createdAt: found.createdAt,
    };
  }

  findByEmail(email: string): Promise<AuthUser | null> {
    return Promise.resolve(SqliteAuthStore.user(this.store.accounts.byEmail(email.trim().toLowerCase())));
  }

  register(email: string, password: string, claimUserId?: string | null): Promise<AuthUser | null> {
    const handle = email.trim().toLowerCase();
    if (this.store.accounts.byEmail(handle)) return Promise.resolve(null);
    const hash = this.hash(password);
    /* A guest keeps their row, their id, and everything pointing at it. */
    const claimed = claimUserId ? this.store.accounts.claim(claimUserId, handle, hash) : undefined;
    return Promise.resolve(
      SqliteAuthStore.user(claimed ?? this.store.accounts.createRegistered(handle, hash)),
    );
  }

  verify(email: string, password: string): Promise<AuthUser | null> {
    const found = this.store.accounts.byEmail(email.trim().toLowerCase());
    if (!found?.passwordHash || !this.check(password, found.passwordHash)) return Promise.resolve(null);
    return Promise.resolve(SqliteAuthStore.user(found));
  }

  startSession(userId: string, options: SessionOptions = {}): Promise<string> {
    const token = randomUUID();
    this.store.sessions.set(token, {
      token,
      userId,
      installationId: options.installationId ?? null,
      sessionType: options.sessionType ?? SESSION_TYPES.REGISTERED_TEMPORARY,
    });
    return Promise.resolve(token);
  }

  sessionForToken(token: string): Promise<StoredSessionInfo | null> {
    const session = this.store.sessions.get(token);
    return Promise.resolve(
      session
        ? {
            userId: session.userId,
            installationId: session.installationId ?? null,
            sessionType: session.sessionType ?? SESSION_TYPES.REGISTERED_TEMPORARY,
          }
        : null,
    );
  }

  createInstallation(
    userId: string,
    context: InstallationContext,
    persistenceType: PersistenceType,
  ): Promise<{ installationId: string; credential: string }> {
    const installationId = randomUUID();
    const secret = newInstallationSecret();
    this.store.installations.create({
      userId,
      installationId,
      credentialHash: sha256Hex(secret),
      persistenceType,
      platform: context.platform,
      deviceClass: context.deviceClass ?? null,
      browserFamily: context.browserFamily ?? null,
      osFamily: context.osFamily ?? null,
    });
    return Promise.resolve({
      installationId,
      credential: encodeInstallationCredential(installationId, secret),
    });
  }

  accountForInstallation(
    credential: string,
  ): Promise<{ user: AuthUser; installationId: string } | null> {
    const parts = decodeInstallationCredential(credential);
    if (!parts) return Promise.resolve(null);
    const found = this.store.installations.find(parts.installationId);
    if (!found || !credentialMatches(parts.secret, found.credentialHash)) {
      return Promise.resolve(null);
    }
    this.store.installations.touch(parts.installationId);
    this.store.accounts.touch(found.userId);
    const user = SqliteAuthStore.user(this.store.accounts.get(found.userId));
    return Promise.resolve(user ? { user, installationId: parts.installationId } : null);
  }

  revokeInstallation(installationId: string): Promise<void> {
    this.store.installations.revoke(installationId);
    /* Its sessions go with it: recognition and interaction both end here. */
    this.store.sessions.revokeForInstallation(installationId);
    return Promise.resolve();
  }

  userForToken(token: string): Promise<AuthUser | null> {
    const session = this.store.sessions.get(token);
    return Promise.resolve(session ? SqliteAuthStore.user(this.store.accounts.get(session.userId)) : null);
  }

  /* Revoked, not forgotten: an old token stays distinguishable from a fake. */
  endSession(token: string): Promise<void> {
    this.store.sessions.revoke(token);
    return Promise.resolve();
  }

  async createGuest(
    context: AccountCreationContext,
  ): Promise<{ user: AuthUser; installationId: string; credential: string }> {
    let created: StoredAccount | undefined;
    for (let attempt = 0; attempt < GUEST_NAME_ATTEMPTS && !created; attempt += 1) {
      const name = await allocateGuestName((base) =>
        Promise.resolve(this.store.accounts.nextGuestSequence(base)),
      );
      try {
        created = this.store.accounts.createGuest(name, {
          creationMethod: context.creationMethod,
          creationSource: context.creationSource,
          platform: context.platform,
          deviceClass: context.deviceClass,
        });
      } catch (error: unknown) {
        /* The unique index fired; another attempt is cheaper than an error. */
        if (attempt === GUEST_NAME_ATTEMPTS - 1) throw error;
      }
    }
    const user = SqliteAuthStore.user(created);
    if (!user) throw new Error('Could not allocate a guest name.');
    const { installationId, credential } = await this.createInstallation(
      user.id,
      { platform: context.platform, deviceClass: context.deviceClass },
      PERSISTENCE_TYPES.GUEST_PERSISTENT,
    );
    return { user, installationId, credential };
  }

  /*
   * The guest account is retired here, so everything that could still act as
   * it goes: its installations, and the sessions they established. A cookie
   * left in that browser resolves to nobody rather than to an emptied account.
   */
  merge(fromUserId: string, intoUserId: string): Promise<number> {
    const moved = this.store.accounts.merge(fromUserId, intoUserId);
    this.store.sessions.revokeForUser(fromUserId);
    return Promise.resolve(moved);
  }

  markEmailVerified(userId: string): Promise<void> {
    this.store.accounts.setEmailVerified(userId);
    return Promise.resolve();
  }
}
