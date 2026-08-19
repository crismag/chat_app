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

import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { ACCOUNT_TYPES, type AccountCreationContext, type AccountType } from '@chat/shared';
import { SESSION_TTL_MS } from '../db.ts';
import { sha256Hex } from '../mysql/tokens.ts';
import { GUEST_NAME_ATTEMPTS, guestName, randomGuestBaseName } from './guest-names.ts';
import { verifyPassword as verifyArgon2 } from '../mysql/passwords.ts';
import type { MysqlPersistence } from '../mysql/persistence.ts';
import type { StoredAccount, StoredCreationContext } from '../store.ts';

export interface AuthUser {
  /** Stable, public, and safe to put in a cookie, a payload or a URL. */
  id: string;
  accountType: AccountType;
  /** Null for a guest, who has not given one. */
  email: string | null;
  /** Kept after registration: it is what this person has been called so far. */
  guestName: string | null;
  emailVerified: boolean;
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
  startSession(userId: string): Promise<string>;
  userForToken(token: string): Promise<AuthUser | null>;
  endSession(token: string): Promise<void>;
  /**
   * A guest account, made because somebody asked for one.
   *
   * Returns the credential exactly once. It is never stored, only its hash is,
   * so this return value is the single opportunity to put it in a cookie.
   */
  createGuest(context: AccountCreationContext): Promise<{ user: AuthUser; credential: string }>;
  /** The guest a credential names, or nobody. Never creates one. */
  guestForCredential(credential: string): Promise<AuthUser | null>;
  /** Move a guest's work into an account that already existed. */
  merge(fromUserId: string, intoUserId: string): Promise<number>;
  markEmailVerified(userId: string): Promise<void>;
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
 * The value that goes in the guest's cookie.
 *
 * 32 bytes from the system's random source, exactly as a session token is.
 * This is a bearer credential for everything that guest has written, so it is
 * held to the same standard -- not a UUID, and not derived from anything about
 * the request.
 */
export function newGuestCredential(): string {
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
      await this.db.setLocalCredentials(claiming.id, handle, password);
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

  async startSession(userId: string): Promise<string> {
    const user = await this.db.getUserByPublicUuid(userId);
    if (!user) throw new Error(`No account for ${userId}`);
    const { token } = await this.db.createSession(user.id, SESSION_TTL_MS);
    return token;
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

  async createGuest(context: AccountCreationContext): Promise<{ user: AuthUser; credential: string }> {
    for (let attempt = 0; attempt < GUEST_NAME_ATTEMPTS; attempt += 1) {
      const name = await allocateGuestName((base) => this.db.nextGuestNameSequence(base));
      const created = await this.db.createGuestUser(name, context).catch((error: unknown) => {
        /* The unique index fired; another attempt is cheaper than an error. */
        if (attempt === GUEST_NAME_ATTEMPTS - 1) throw error;
        return null;
      });
      if (!created) continue;
      const credential = newGuestCredential();
      await this.db.addAnonymousCredential({
        userId: created.id,
        tokenHash: sha256Hex(credential),
        platform: context.platform,
      });
      const user = await this.account(created.id, null);
      if (user) return { user, credential };
    }
    throw new Error('Could not allocate a guest name.');
  }

  async guestForCredential(credential: string): Promise<AuthUser | null> {
    const found = await this.db.findAnonymousCredential(sha256Hex(credential));
    if (!found) return null;
    await this.db.touchAnonymousCredential(found.id);
    return this.account(found.userId, null);
  }

  async merge(fromUserId: string, intoUserId: string): Promise<number> {
    const from = await this.db.getUserByPublicUuid(fromUserId);
    const into = await this.db.getUserByPublicUuid(intoUserId);
    if (!from || !into) return 0;
    await this.db.revokeAnonymousCredentials(from.id);
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
  guestCredentials: {
    create(input: { userId: string; tokenHash: string; platform: string }): string;
    findByTokenHash(tokenHash: string): { id: string; userId: string } | undefined;
    touch(id: string): void;
    revokeForUser(userId: string): void;
  };
  sessions: {
    get(token: string): { token: string; userId: string } | undefined;
    set(token: string, session: { token: string; userId: string }): unknown;
    delete(token: string): unknown;
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

  startSession(userId: string): Promise<string> {
    const token = randomUUID();
    this.store.sessions.set(token, { token, userId });
    return Promise.resolve(token);
  }

  userForToken(token: string): Promise<AuthUser | null> {
    const session = this.store.sessions.get(token);
    return Promise.resolve(session ? SqliteAuthStore.user(this.store.accounts.get(session.userId)) : null);
  }

  endSession(token: string): Promise<void> {
    this.store.sessions.delete(token);
    return Promise.resolve();
  }

  async createGuest(context: AccountCreationContext): Promise<{ user: AuthUser; credential: string }> {
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
    const credential = newGuestCredential();
    this.store.guestCredentials.create({
      userId: user.id,
      tokenHash: sha256Hex(credential),
      platform: context.platform,
    });
    return { user, credential };
  }

  guestForCredential(credential: string): Promise<AuthUser | null> {
    const found = this.store.guestCredentials.findByTokenHash(sha256Hex(credential));
    if (!found) return Promise.resolve(null);
    this.store.guestCredentials.touch(found.id);
    this.store.accounts.touch(found.userId);
    return Promise.resolve(SqliteAuthStore.user(this.store.accounts.get(found.userId)));
  }

  merge(fromUserId: string, intoUserId: string): Promise<number> {
    return Promise.resolve(this.store.accounts.merge(fromUserId, intoUserId));
  }

  markEmailVerified(userId: string): Promise<void> {
    this.store.accounts.setEmailVerified(userId);
    return Promise.resolve();
  }
}
