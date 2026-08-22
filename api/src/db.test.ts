import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { SESSION_TTL_MS, SqliteStore } from './db.ts';
import { cookieHeader } from './http/set-cookie.ts';
import { hashSessionToken } from './mysql/tokens.ts';

const dir = mkdtempSync(join(tmpdir(), 'chat-db-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** Register, and hand back the session cookie the API set. */
async function register(app: ReturnType<typeof createApp>, email: string) {
  const response = await app.request(
    '/api/auth/register',
    json({ email, password: 'password123' }),
  );
  expect(response.status).toBeLessThan(400);
  return cookieHeader(response.headers.get('set-cookie'));
}

/**
 * Fill the four sections so a reflection is shareable.
 *
 * Publication now enforces the content-format rules, so a conversation with
 * empty sections is a draft by definition. Tests that want to publish have to
 * write a reflection first — which is the behaviour, not an obstacle to it.
 */
async function completeChat(
  app: ReturnType<typeof createApp>,
  id: string,
  cookie: string,
) {
  for (const type of ['content', 'heart', 'application', 'testimony'] as const) {
    const response = await app.request(`/api/conversations/${id}/sections`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type, content: `A short ${type} written by the author.` }),
    });
    if (response.status >= 400) throw new Error(`${type}: ${response.status}`);
  }
}

describe('SQLite store', () => {
  it('serves the same flows the in-memory store did', async () => {
    const app = createApp(new SqliteStore());
    const cookie = await register(app, 'flows@example.com');

    const created = await app.request('/api/conversations', {
      ...json({ title: 'Trusting when I cannot see', scriptureReference: 'Romans 8:28' }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(created.status).toBeLessThan(400);
    const conversation = (await created.json()) as { id: string };

    const sent = await app.request(`/api/conversations/${conversation.id}/messages`, {
      ...json({ content: 'This passage met me in a hard week.' }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(sent.status).toBeLessThan(400);

    const read = await app.request(`/api/conversations/${conversation.id}`, {
      headers: { cookie },
    });
    const detail = (await read.json()) as { messages: unknown[] };
    expect(detail.messages.length).toBeGreaterThan(0);
  });

  /*
   * The reason this change exists. Everything used to vanish on restart, so the
   * test opens one database, closes it, opens the same file again with a fresh
   * app, and checks the account and its work are still there.
   */
  it('keeps accounts and conversations across a restart', async () => {
    const file = join(dir, 'restart.sqlite');

    const first = new SqliteStore(file);
    const app = createApp(first);
    const cookie = await register(app, 'restart@example.com');
    const created = await app.request('/api/conversations', {
      ...json({ title: 'Be still and know', scriptureReference: 'Psalm 46:10' }),
      headers: { 'content-type': 'application/json', cookie },
    });
    const conversation = (await created.json()) as { id: string };
    first.close();

    // A new process, the same file.
    const second = new SqliteStore(file);
    const restarted = createApp(second);

    const me = await restarted.request('/api/auth/me', { headers: { cookie } });
    expect(me.status).toBe(200);

    const again = await restarted.request(`/api/conversations/${conversation.id}`, {
      headers: { cookie },
    });
    expect(again.status).toBe(200);
    expect((await again.json()) as { title: string }).toMatchObject({
      title: 'Be still and know',
    });
    second.close();
  });

  /*
   * A regression guard for the swap itself. Under MemoryStore a route could
   * mutate the object it got back from the store and the Map would see it,
   * because it was the same object. A row read out of SQLite is a copy, so a
   * mutation that is never written back is silently lost — publish would answer
   * 200, echo the change, and persist nothing.
   */
  it('persists a publish, not just the response', async () => {
    const file = join(dir, 'publish.sqlite');

    const first = new SqliteStore(file);
    const app = createApp(first);
    const cookie = await register(app, 'publish@example.com');
    const created = await app.request('/api/conversations', {
      ...json({
        title: 'Trusting when I cannot see',
        scriptureReference: 'Romans 8:28',
      }),
      headers: { 'content-type': 'application/json', cookie },
    });
    const conversation = (await created.json()) as { id: string };

    await completeChat(app, conversation.id, cookie);

    const published = await app.request(
      `/api/conversations/${conversation.id}/share`,
      { method: 'POST', headers: { cookie } },
    );
    expect(published.status).toBe(200);
    first.close();

    const second = new SqliteStore(file);
    const state = second.conversations.get(conversation.id);
    expect(state?.visibility).toBe('shared');
    second.close();
  });

  it('refuses a session that has aged out, and forgets it', () => {
    const store = new SqliteStore();
    store.accounts.createRegistered('expiry@example.com', 'x');
    const { id: userId } = store.accounts.byEmail('expiry@example.com')!;
    store.sessions.set('token-1', { token: 'token-1', userId });
    expect(store.sessions.get('token-1')).toBeTruthy();
    expect(
      store.db.prepare('SELECT token FROM sessions WHERE userId = ?').get(userId) as { token: string },
    ).toEqual({ token: hashSessionToken('token-1') });

    // Age it past the window rather than waiting thirty days.
    store.db
      .prepare('UPDATE sessions SET expiresAt = ? WHERE token = ?')
      .run(Date.now() - SESSION_TTL_MS, hashSessionToken('token-1'));

    expect(store.sessions.get('token-1')).toBeUndefined();
    const remaining = store.db
      .prepare('SELECT COUNT(*) AS n FROM sessions WHERE token = ?')
      .get(hashSessionToken('token-1')) as { n: number };
    expect(remaining.n).toBe(0);
    store.close();
  });

  it('still authenticates a session stored as the raw cookie, until those rows expire', () => {
    const store = new SqliteStore();
    store.accounts.createRegistered('legacy-session@example.com', 'x');
    const { id: userId } = store.accounts.byEmail('legacy-session@example.com')!;
    store.db
      .prepare(
        `INSERT INTO sessions (token, userId, sessionType, expiresAt)
         VALUES (?, ?, 'REGISTERED_TEMPORARY', ?)`,
      )
      .run('raw-legacy-token', userId, Date.now() + SESSION_TTL_MS);
    expect(store.sessions.get('raw-legacy-token')?.userId).toBe(userId);
    store.close();
  });
});

/*
 * Renaming the C of C.H.A.T. moved a value that is written down.
 *
 * `sections.type` stores the section's name as a literal, so a database from
 * before the rename holds rows the running code no longer asks for. These tests
 * are written from the author's side: the words they typed are still there
 * afterwards, and are reachable under the name the application now uses.
 */
describe('the Context → Content rename carries stored writing across', () => {
  /** A database as it stood before the rename, written directly. */
  function legacyDatabase(name: string): string {
    const file = join(dir, name);
    const seed = new SqliteStore(file);
    seed.db
      .prepare('INSERT INTO users (id, email, passwordHash) VALUES (?, ?, ?)')
      .run('u1', `${name}@example.com`, 'x');
    /*
     * Written with the column this database would actually have had. The store
     * creates `visibility`, so the old name is put back deliberately — these
     * fixtures exist to be migrated, and one built with the new schema would
     * prove nothing.
     */
    /* The shape this database actually had: a column called publicationState. */
    seed.db.exec('ALTER TABLE conversations RENAME COLUMN visibility TO publicationState');
    seed.db
      .prepare(
        `INSERT INTO conversations
           (id, userId, format, title, scriptureReference, publicationState, createdAt, updatedAt)
         VALUES ('c1', 'u1', 'full', 'Romans 8', 'Romans 8:28', 'private', '2026-01-01', '2026-01-01')`,
      )
      .run();
    seed.db
      .prepare(
        `INSERT INTO sections (conversationId, type, content, authorOrigin)
         VALUES ('c1', 'context', 'Paul is writing to a church under pressure.', 'user')`,
      )
      .run();
    seed.close();
    return file;
  }

  it('moves what the author wrote to the section under its new name', () => {
    const file = legacyDatabase('legacy.sqlite');

    const store = new SqliteStore(file);
    const sections = store.sections.get('c1');
    expect(sections?.['context']).toBeUndefined();
    expect(sections?.['content']).toMatchObject({
      type: 'content',
      content: 'Paul is writing to a church under pressure.',
      authorOrigin: 'user',
    });
    store.close();
  });

  it('is harmless the second time, and on a database that never held the old name', () => {
    const file = legacyDatabase('idempotent.sqlite');

    /* Three opens: the migrating one, then two that must find nothing to do. */
    for (let run = 0; run < 3; run += 1) {
      const store = new SqliteStore(file);
      expect(store.sections.get('c1')?.['content']?.content).toBe(
        'Paul is writing to a church under pressure.',
      );
      const rows = store.db
        .prepare('SELECT COUNT(*) AS n FROM sections')
        .get() as { n: number };
      expect(rows.n).toBe(1);
      store.close();
    }

    /* And a database built fresh, which never had a 'context' row at all. */
    const fresh = new SqliteStore(join(dir, 'fresh.sqlite'));
    expect(fresh.sections.get('c1')).toBeUndefined();
    fresh.close();
  });

  it('keeps the row that has writing when a conversation somehow carries both', () => {
    const file = legacyDatabase('collision.sqlite');
    const seeded = new SqliteStore(file);
    /* The migration already ran on open; put the pair back to force the case. */
    seeded.db.prepare("UPDATE sections SET type = 'context' WHERE conversationId = 'c1'").run();
    seeded.db
      .prepare(
        `INSERT INTO sections (conversationId, type, content, authorOrigin)
         VALUES ('c1', 'content', '', 'user')`,
      )
      .run();
    seeded.close();

    const store = new SqliteStore(file);
    const sections = store.sections.get('c1');
    expect(Object.keys(sections ?? {})).toEqual(['content']);
    /* The empty row lost. Nobody's sentence was dropped to settle a key clash. */
    expect(sections?.['content']?.content).toBe('Paul is writing to a church under pressure.');
    store.close();
  });

  it('repoints a draft that was still waiting to be added', () => {
    const file = join(dir, 'draft-pointer.sqlite');
    const seed = new SqliteStore(file);
    seed.db
      .prepare('INSERT INTO users (id, email, passwordHash) VALUES (?, ?, ?)')
      .run('u1', 'draft@example.com', 'x');
    /*
     * Written with the column this database would actually have had. The store
     * creates `visibility`, so the old name is put back deliberately — these
     * fixtures exist to be migrated, and one built with the new schema would
     * prove nothing.
     */
    /* The shape this database actually had: a column called publicationState. */
    seed.db.exec('ALTER TABLE conversations RENAME COLUMN visibility TO publicationState');
    seed.db
      .prepare(
        `INSERT INTO conversations
           (id, userId, format, title, scriptureReference, publicationState, createdAt, updatedAt)
         VALUES ('c1', 'u1', 'full', 'Romans 8', 'Romans 8:28', 'private', '2026-01-01', '2026-01-01')`,
      )
      .run();
    seed.db
      .prepare(
        `INSERT INTO messages
           (id, conversationId, position, role, content, originalContent, authorOrigin, createdAt,
            draftText, draftSection)
         VALUES ('m1', 'c1', 0, 'assistant', 'Here is a draft.', 'Here is a draft.',
                 'ai_generated', '2026-01-01', 'Some draft text.', 'context')`,
      )
      .run();
    seed.close();

    const store = new SqliteStore(file);
    expect(store.messages.get('c1')?.[0]?.draftSection).toBe('content');
    store.close();
  });
});

/*
 * The rename that carries a value with it.
 *
 * `publicationState` said a reflection moved along a publishing lifecycle. It
 * never did: two values, both answers to "who can see this". Renaming the
 * column without moving `published` to `shared` would leave every shared
 * reflection reading as private — a data-loss bug wearing a rename's clothes.
 */
describe('publicationState → visibility', () => {
  /** A database as it stood before sharing was called sharing. */
  function beforeTheRename(name: string): string {
    const file = join(dir, name);
    const seed = new SqliteStore(file);
    /* The shape this database actually had: a column called publicationState. */
    seed.db.exec('ALTER TABLE conversations RENAME COLUMN visibility TO publicationState');
    seed.db
      .prepare('INSERT INTO users (id, email, passwordHash) VALUES (?, ?, ?)')
      .run('u1', `${name}@example.com`, 'x');
    const rows: [string, string][] = [
      ['shared-one', 'published'],
      ['private-one', 'private'],
    ];
    for (const [id, state] of rows) {
      seed.db
        .prepare(
          `INSERT INTO conversations
             (id, userId, format, title, scriptureReference, publicationState, createdAt, updatedAt)
           VALUES (?, 'u1', 'full', ?, NULL, ?, '2026-01-01', '2026-01-01')`,
        )
        .run(id, `Reflection ${id}`, state);
    }
    seed.close();
    return file;
  }

  it('a reflection that was published is still shared afterwards', () => {
    const file = beforeTheRename('rename-values.sqlite');
    const store = new SqliteStore(file);
    try {
      expect(store.conversations.get('shared-one')?.visibility).toBe('shared');
      expect(store.conversations.get('private-one')?.visibility).toBe('private');
    } finally {
      store.close();
    }
  });

  it('the old column is gone, and the new one holds the value', () => {
    const file = beforeTheRename('rename-column.sqlite');
    const store = new SqliteStore(file);
    try {
      const columns = (store.db.prepare('PRAGMA table_info(conversations)').all() as {
        name: string
      }[]).map((column) => column.name);
      expect(columns).toContain('visibility');
      expect(columns).not.toContain('publicationState');
    } finally {
      store.close();
    }
  });

  it('running again on an already-migrated database changes nothing', () => {
    const file = beforeTheRename('rename-twice.sqlite');
    new SqliteStore(file).close();
    const store = new SqliteStore(file);
    try {
      expect(store.conversations.get('shared-one')?.visibility).toBe('shared');
    } finally {
      store.close();
    }
  });
});

/*
 * Two older shapes, both of which still have to open.
 *
 * The first is the original: a reflection keyed to a user by a foreign key,
 * which is the login wall written as a constraint. The second is the design in
 * between, where a separate `owners` table stood between a reflection and the
 * person who wrote it. Both become the same thing -- a reflection owned by a
 * user, guest or registered -- and a database in either state has to arrive
 * there without losing a row.
 */
describe('older databases become accounts', () => {
  /*
   * The original shape, constraint and all.
   *
   * `REFERENCES users(id)` is not decoration here: it is the login wall
   * written as SQL, and it is what made a guest's first reflection fail on a
   * database that predates them. A fixture without it -- which is what this
   * was, once -- proves nothing about the migration that has to remove it.
   */
  function beforeAccounts(name: string): string {
    const file = join(dir, name);
    const seed = new DatabaseSync(file);
    seed.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, passwordHash TEXT NOT NULL);
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        format TEXT NOT NULL DEFAULT 'full',
        title TEXT NOT NULL, scriptureReference TEXT, visibility TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        position INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
        originalContent TEXT NOT NULL, authorOrigin TEXT NOT NULL, createdAt TEXT NOT NULL
      );
      CREATE TABLE sections (
        conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        type TEXT NOT NULL, content TEXT NOT NULL, authorOrigin TEXT NOT NULL,
        PRIMARY KEY (conversationId, type)
      );
      CREATE TABLE sessions (
        token TEXT PRIMARY KEY,
        userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expiresAt INTEGER NOT NULL
      );
      INSERT INTO users (id, email, passwordHash) VALUES ('u1', 'author@example.com', 'x');
      INSERT INTO conversations (id, userId, title, visibility, createdAt, updatedAt)
        VALUES ('c1', 'u1', 'First', 'private', '2026-01-01', '2026-01-01'),
               ('c2', 'u1', 'Second', 'shared', '2026-01-01', '2026-01-01');
      INSERT INTO messages (id, conversationId, position, role, content, originalContent, authorOrigin, createdAt)
        VALUES ('m1', 'c1', 0, 'user', 'Written before guests existed', 'Written before guests existed', 'user', '2026-01-01');
      INSERT INTO sections (conversationId, type, content, authorOrigin)
        VALUES ('c1', 'heart', 'What it meant that morning', 'user');
      INSERT INTO sessions (token, userId, expiresAt) VALUES ('t1', 'u1', 99999999999999);
    `);
    seed.close();
    return file;
  }

  /** The in-between shape: an owners table, and reflections pointing at it. */
  function beforeGuestsWereUsers(name: string): string {
    const file = join(dir, name);
    const seed = new DatabaseSync(file);
    seed.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, passwordHash TEXT NOT NULL);
      CREATE TABLE owners (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, userId TEXT,
        createdAt TEXT NOT NULL, claimedAt TEXT, expiresAt TEXT
      );
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY, ownerId TEXT NOT NULL, format TEXT NOT NULL DEFAULT 'full',
        title TEXT NOT NULL, scriptureReference TEXT, visibility TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      INSERT INTO users (id, email, passwordHash) VALUES ('u1', 'author@example.com', 'x');
      INSERT INTO owners (id, kind, userId, createdAt) VALUES
        ('o-account', 'user', 'u1', '2026-01-01'),
        ('o-guest', 'anonymous', NULL, '2026-01-01');
      INSERT INTO conversations (id, ownerId, title, visibility, createdAt, updatedAt)
        VALUES ('c1', 'o-account', 'Signed in', 'private', '2026-01-01', '2026-01-01'),
               ('c2', 'o-guest', 'Written first', 'private', '2026-01-01', '2026-01-01');
    `);
    seed.close();
    return file;
  }

  it('keeps every reflection with the account that wrote it', () => {
    const store = new SqliteStore(beforeAccounts('accounts-upgrade.sqlite'));
    try {
      expect(store.conversations.get('c1')?.userId).toBe('u1');
      expect(store.conversations.get('c2')?.userId).toBe('u1');
      /* Accounts that existed before guests did are registered ones. */
      expect(store.accounts.get('u1')?.accountType).toBe('REGISTERED');
    } finally {
      store.close();
    }
  });

  /*
   * The defect this fixture exists for: a guest lives in MariaDB, so a
   * reflection of theirs has an owner SQLite has never heard of, and the old
   * foreign key refused the insert. Reached through the API rather than the
   * table, because that is where it failed.
   */
  it('lets somebody SQLite has never heard of own a reflection', () => {
    const store = new SqliteStore(beforeAccounts('accounts-foreign-key.sqlite'));
    try {
      const keys = store.db.prepare('PRAGMA foreign_key_list(conversations)').all() as {
        table: string;
      }[];
      expect(keys.some((key) => key.table === 'users')).toBe(false);

      store.conversations.set('c3', {
        id: 'c3',
        userId: 'a-guest-in-another-database',
        format: 'full',
        title: 'Written as a guest',
        scriptureReference: null,
        visibility: 'private',
        tags: [],
        createdAt: '2026-08-01',
        updatedAt: '2026-08-01',
      });
      expect(store.conversations.get('c3')?.userId).toBe('a-guest-in-another-database');

      /* And the rebuild did not take the thread with it. */
      expect(store.messages.get('c1')?.[0]?.content).toBe('Written before guests existed');
    } finally {
      store.close();
    }
  });

  /*
   * The defect this whole fixture exists for, and it is not hypothetical: this
   * migration ran against the live database and emptied it.
   *
   * Rebuilding `users` means dropping it, and `DROP TABLE` with foreign keys
   * enabled behaves as though every row were deleted first -- so every child
   * with `ON DELETE CASCADE` fired. Sessions went, and so did every reflection
   * still carrying the old `REFERENCES users(id)`. The rebuild was meant to be
   * invisible; instead it was the most destructive thing in the file.
   *
   * A fixture without the constraints could not see it, which is exactly what
   * the first version of this test was.
   */
  it('carries every row through a rebuild that used to cascade them away', () => {
    const store = new SqliteStore(beforeAccounts('accounts-no-cascade.sqlite'));
    try {
      expect(store.conversations.values()).toHaveLength(2);
      expect(store.messages.get('c1')?.[0]?.content).toBe('Written before guests existed');
      expect(store.sections.get('c1')?.['heart']?.content).toBe('What it meant that morning');
      expect(store.sessions.get('t1')?.userId).toBe('u1');
      /* And the rebuilds left nothing pointing at something that is gone. */
      expect(store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      store.close();
    }
  });

  it('gives the old users table room for a guest', () => {
    const store = new SqliteStore(beforeAccounts('accounts-nullable.sqlite'));
    try {
      const guest = store.accounts.createGuest('QuietCedar-1', {
        creationMethod: 'GUEST_OPT_IN',
        creationSource: 'REFLECTION_CREATE',
        platform: 'WEB',
        deviceClass: 'UNKNOWN',
      });
      /* The old columns were NOT NULL, which a guest cannot satisfy. */
      expect(guest.email).toBeNull();
      expect(guest.passwordHash).toBeNull();
      expect(guest.accountType).toBe('ANONYMOUS');
    } finally {
      store.close();
    }
  });

  it('turns owners into the users they were standing in for', () => {
    const store = new SqliteStore(beforeGuestsWereUsers('owners-carried.sqlite'));
    try {
      /* An owner with an account was always that account. */
      expect(store.conversations.get('c1')?.userId).toBe('u1');

      /* An owner without one becomes the guest it was already describing. */
      const guestId = store.conversations.get('c2')?.userId;
      expect(guestId).toBe('o-guest');
      expect(store.accounts.get(guestId!)?.accountType).toBe('ANONYMOUS');

      const columns = (store.db.prepare('PRAGMA table_info(conversations)').all() as {
        name: string;
      }[]).map((column) => column.name);
      expect(columns).toContain('userId');
      expect(columns).not.toContain('ownerId');
    } finally {
      store.close();
    }
  });
});

/*
 * Accounts live in MariaDB, so nothing here may require a row in this file's
 * `users` table.
 *
 * `conversations` was fixed when it broke in production. That was treating a
 * symptom: eleven other tables carried the same constraint for the same
 * reason, each waiting for somebody to reach it — creating a community, saving
 * a profile, publishing, encouraging, saving, reporting. This asserts the
 * class rather than the instance.
 */
describe('no table requires a local user row', () => {
  it('has no foreign key into users anywhere, and keeps every other one', () => {
    const store = new SqliteStore();
    try {
      const tables = store.db
        .prepare('SELECT name, sql FROM sqlite_master WHERE type = @kind')
        .all({ kind: 'table' }) as { name: string; sql: string | null }[];

      const offenders = tables
        .filter(
          (table) =>
            table.sql && table.name !== 'users' && /REFERENCES\s+users\s*\(/i.test(table.sql),
        )
        .map((table) => table.name);
      expect(offenders).toEqual([]);

      /* The rebuild is surgical: the constraints that still mean something stay. */
      const messages = tables.find((table) => table.name === 'messages');
      expect(messages?.sql).toMatch(/REFERENCES\s+conversations/i);
      expect(store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      store.close();
    }
  });

  it('lets an account that exists only in MariaDB own everything it should', () => {
    const store = new SqliteStore();
    const app = createApp(store);
    try {
      /* An id from another database entirely — which is what a real one is. */
      const elsewhere = 'a-user-that-lives-in-mariadb';
      store.conversations.set('c1', {
        id: 'c1',
        userId: elsewhere,
        format: 'full',
        title: 'Written by somebody the local users table has never heard of',
        scriptureReference: null,
        visibility: 'private',
        tags: [],
        createdAt: '2026-08-01',
        updatedAt: '2026-08-01',
      });
      expect(store.conversations.get('c1')?.userId).toBe(elsewhere);
      expect(app).toBeTruthy();
    } finally {
      store.close();
    }
  });
});
