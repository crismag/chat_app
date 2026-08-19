/*
 * Accounts in MariaDB, against a real one.
 *
 * Skipped without MYSQL_* configured, like the other durable suites — a mock
 * would prove the seam calls the methods, not that registering, signing in and
 * signing out actually work against the schema.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readMysqlConfig } from '../mysql/config.ts';
import { migrate } from '../mysql/migrate.ts';
import { MysqlPersistence } from '../mysql/persistence.ts';
import { createMysqlPool, type MysqlPool } from '../mysql/pool.ts';
import { MysqlAuthStore } from './store.ts';
import { createApp } from '../app.ts';
import { MemoryStore } from '../store.ts';

const config = (() => {
  try {
    return readMysqlConfig();
  } catch {
    return null;
  }
})();

describe.skipIf(!config)('accounts in MariaDB', () => {
  let pool: MysqlPool;
  let db: MysqlPersistence;
  let auth: MysqlAuthStore;
  const made: string[] = [];

  beforeAll(async () => {
    if (!config) return;
    pool = createMysqlPool(config);
    await migrate(pool);
    db = new MysqlPersistence(pool);
    auth = new MysqlAuthStore(db);
  });

  afterAll(async () => {
    for (const uuid of made) {
      const user = await db.getUserByPublicUuid(uuid).catch(() => null);
      if (user) await db.deleteUserGraph(user.id).catch(() => undefined);
    }
    await pool?.end();
  });

  async function account(email: string, password = 'a-long-enough-password') {
    const user = await auth.register(email, password);
    if (user) made.push(user.id);
    return user;
  }

  it('registers, and hands back an identifier that is not the row id', async () => {
    const user = await account(`reg-${Date.now()}@example.com`);
    expect(user).not.toBeNull();
    /* A UUID, not a BIGINT: the internal key never leaves the database. */
    expect(user?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses a second account for one address', async () => {
    const email = `dup-${Date.now()}@example.com`;
    expect(await account(email)).not.toBeNull();
    expect(await auth.register(email, 'another-long-password')).toBeNull();
  });

  it('folds the address, so one person cannot hold two spellings of it', async () => {
    const email = `Fold-${Date.now()}@Example.COM`;
    const user = await account(email);
    expect(user?.email).toBe(email.toLowerCase());
    expect(await auth.register(email.toLowerCase(), 'x-long-password')).toBeNull();
    expect(await auth.findByEmail(email.toUpperCase())).not.toBeNull();
  });

  it('signs in with the right password and refuses the wrong one', async () => {
    const email = `login-${Date.now()}@example.com`;
    await account(email, 'the-correct-password');
    expect(await auth.verify(email, 'the-correct-password')).not.toBeNull();
    expect(await auth.verify(email, 'not-the-password')).toBeNull();
    expect(await auth.verify(`absent-${Date.now()}@example.com`, 'anything')).toBeNull();
  });

  it('issues a session that resolves back to the same account', async () => {
    const email = `sess-${Date.now()}@example.com`;
    const user = await account(email);
    const token = await auth.startSession(user!.id);
    const back = await auth.userForToken(token);
    expect(back?.id).toBe(user!.id);
    expect(back?.email).toBe(email.toLowerCase());
  });

  /* The token is a bearer credential; the row must not be able to give it up. */
  it('stores a hash of the session token, never the token', async () => {
    const user = await account(`hash-${Date.now()}@example.com`);
    const token = await auth.startSession(user!.id);
    const session = await db.findActiveSession(token);
    const stored = await db.sessionTokenHashStored(session!.id);
    expect(stored).not.toBe(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signing out ends that session and no other', async () => {
    const user = await account(`out-${Date.now()}@example.com`);
    const first = await auth.startSession(user!.id);
    const second = await auth.startSession(user!.id);

    await auth.endSession(first);
    expect(await auth.userForToken(first)).toBeNull();
    /* A second device stays signed in, which is what a session is for. */
    expect(await auth.userForToken(second)).not.toBeNull();
  });

  it('an unknown or empty token is nobody', async () => {
    expect(await auth.userForToken('')).toBeNull();
    expect(await auth.userForToken('not-a-real-token')).toBeNull();
  });
})

/*
 * The routes, not just the store.
 *
 * This is the whole point of the change: a real sign-in over HTTP, with the
 * account in MariaDB and the cookie doing what it does in a browser. Everything
 * else in the request still reads SQLite.
 */
describe.skipIf(!config)('signing in over HTTP, against MariaDB', () => {
  let pool: MysqlPool;
  let db: MysqlPersistence;
  let app: ReturnType<typeof createApp>;
  const made: string[] = [];

  beforeAll(async () => {
    if (!config) return;
    pool = createMysqlPool(config);
    await migrate(pool);
    db = new MysqlPersistence(pool);
    app = createApp(new MemoryStore(), {}, {}, new MysqlAuthStore(db));
  });

  afterAll(async () => {
    for (const uuid of made) {
      const user = await db.getUserByPublicUuid(uuid).catch(() => null);
      if (user) await db.deleteUserGraph(user.id).catch(() => undefined);
    }
    await pool?.end();
  });

  const post = (path: string, body: unknown, cookie?: string) =>
    app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });

  /** The cookie a browser would keep, taken off the response. */
  const sessionCookie = (response: Response) =>
    (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  it('registers, stays signed in, signs out, and signs back in', async () => {
    const email = `http-${Date.now()}@example.com`;
    const password = 'a-long-enough-password';

    const registered = await post('/api/auth/register', { email, password });
    expect(registered.status).toBe(201);
    const account = (await registered.json()) as { id: string; email: string };
    made.push(account.id);
    expect(account.email).toBe(email);

    /* The account is in MariaDB, not in the SQLite store handed to createApp. */
    expect(await db.getUserByPublicUuid(account.id)).not.toBeNull();

    let cookie = sessionCookie(registered);
    expect(cookie).toMatch(/^chat_session=/);

    const me = await app.request('/api/auth/me', { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ id: account.id, email });

    const out = await post('/api/auth/logout', {}, cookie);
    expect(out.status).toBe(200);
    const afterOut = await app.request('/api/auth/me', { headers: { cookie } });
    expect(afterOut.status).toBe(401);

    const again = await post('/api/auth/login', { email, password });
    expect(again.status).toBe(200);
    cookie = sessionCookie(again);
    const back = await app.request('/api/auth/me', { headers: { cookie } });
    expect(await back.json()).toMatchObject({ id: account.id });
  });

  it('refuses a duplicate address and a wrong password, in the words the page shows', async () => {
    const email = `dup-http-${Date.now()}@example.com`;
    const first = await post('/api/auth/register', { email, password: 'a-long-password' });
    made.push(((await first.json()) as { id: string }).id);

    const second = await post('/api/auth/register', { email, password: 'a-long-password' });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: 'An account with that email already exists.' });

    const wrong = await post('/api/auth/login', { email, password: 'wrong-password-here' });
    expect(wrong.status).toBe(401);
    /* Still says neither half was wrong. */
    expect(await wrong.json()).toMatchObject({ error: 'Invalid email or password.' });
  });

  it('a request with no cookie is nobody', async () => {
    expect((await app.request('/api/auth/me')).status).toBe(401);
  });
})
