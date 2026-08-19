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

import { randomUUID } from 'node:crypto';
import { SESSION_TTL_MS } from '../db.ts';
import { verifyPassword as verifyArgon2 } from '../mysql/passwords.ts';
import type { MysqlPersistence } from '../mysql/persistence.ts';

export interface AuthUser {
  /** Stable, public, and safe to put in a cookie, a payload or a URL. */
  id: string;
  email: string;
}

export interface AuthStore {
  findByEmail(email: string): Promise<AuthUser | null>;
  /** Null when the email is taken, so the caller answers 409 without a race. */
  register(email: string, password: string): Promise<AuthUser | null>;
  verify(email: string, password: string): Promise<AuthUser | null>;
  startSession(userId: string): Promise<string>;
  userForToken(token: string): Promise<AuthUser | null>;
  endSession(token: string): Promise<void>;
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

  async findByEmail(email: string): Promise<AuthUser | null> {
    const handle = MysqlAuthStore.handle(email);
    const userId = await this.db.findUserIdByLocalUsername(handle);
    if (userId === null) return null;
    const user = await this.db.getUserById(userId);
    return user ? { id: user.publicUuid, email: handle } : null;
  }

  async register(email: string, password: string): Promise<AuthUser | null> {
    const handle = MysqlAuthStore.handle(email);
    if (await this.db.findUserIdByLocalUsername(handle)) return null;
    const created = await this.db.createUser();
    try {
      await this.db.setLocalCredentials(created.id, handle, password);
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
    return { id: created.publicUuid, email: handle };
  }

  async verify(email: string, password: string): Promise<AuthUser | null> {
    const handle = MysqlAuthStore.handle(email);
    const userId = await this.db.findUserIdByLocalUsername(handle);
    if (userId === null) return null;
    const stored = await this.db.getLocalCredentialHash(userId);
    if (!stored || !(await verifyArgon2(stored, password))) return null;
    const user = await this.db.getUserById(userId);
    return user ? { id: user.publicUuid, email: handle } : null;
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
    const user = await this.db.getUserById(session.userId);
    if (!user) return null;
    const handle = await this.db.getLocalUsername(session.userId);
    return handle ? { id: user.publicUuid, email: handle } : null;
  }

  async endSession(token: string): Promise<void> {
    const session = await this.db.findActiveSession(token);
    if (session) await this.db.revokeSession(session.id);
  }
}

/* ------------------------------------------------------------------- SQLite */

/**
 * The existing tables, behind the same interface.
 *
 * It stays until the rest of the application has moved, so a checkout with no
 * database still runs and the suite still passes without one.
 */
export interface SqliteAuthTables {
  users: {
    get(id: string): { id: string; email: string; passwordHash: string } | undefined;
    set(id: string, user: { id: string; email: string; passwordHash: string }): unknown;
  };
  usersByEmail: {
    has(email: string): boolean;
    get(email: string): string | undefined;
    set(email: string, id: string): unknown;
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

  private user(id: string): AuthUser | null {
    const found = this.store.users.get(id);
    return found ? { id: found.id, email: found.email } : null;
  }

  findByEmail(email: string): Promise<AuthUser | null> {
    const id = this.store.usersByEmail.get(email.trim().toLowerCase());
    return Promise.resolve(id ? this.user(id) : null);
  }

  register(email: string, password: string): Promise<AuthUser | null> {
    const handle = email.trim().toLowerCase();
    if (this.store.usersByEmail.has(handle)) return Promise.resolve(null);
    const user = { id: randomUUID(), email: handle, passwordHash: this.hash(password) };
    this.store.users.set(user.id, user);
    this.store.usersByEmail.set(handle, user.id);
    return Promise.resolve({ id: user.id, email: user.email });
  }

  verify(email: string, password: string): Promise<AuthUser | null> {
    const id = this.store.usersByEmail.get(email.trim().toLowerCase());
    const found = id ? this.store.users.get(id) : undefined;
    if (!found || !this.check(password, found.passwordHash)) return Promise.resolve(null);
    return Promise.resolve({ id: found.id, email: found.email });
  }

  startSession(userId: string): Promise<string> {
    const token = randomUUID();
    this.store.sessions.set(token, { token, userId });
    return Promise.resolve(token);
  }

  userForToken(token: string): Promise<AuthUser | null> {
    const session = this.store.sessions.get(token);
    return Promise.resolve(session ? this.user(session.userId) : null);
  }

  endSession(token: string): Promise<void> {
    this.store.sessions.delete(token);
    return Promise.resolve();
  }
}
