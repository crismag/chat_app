/*
 * What a guest owns when they sign into an account they already had.
 *
 * The merge used to move `conversations` and nothing else. Everything else a
 * guest could own stayed behind under an id nobody can sign in as: a
 * publication with no reachable author, a membership belonging to no one, a
 * Studio image orphaned from the person who made it. The reflections arrived
 * and the rest of the same act did not.
 *
 * These build a guest who owns one of everything, sign them into an existing
 * account, and check every owner column. SqliteStore, never MemoryStore: this
 * is the store that holds real writing.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';

import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import { cookieHeader } from '../http/set-cookie.ts';
import { readMysqlConfig } from '../mysql/config.ts';
import { migrate } from '../mysql/migrate.ts';
import { MysqlPersistence } from '../mysql/persistence.ts';
import { createMysqlPool, type MysqlPool } from '../mysql/pool.ts';
import { MysqlAuthStore } from './store.ts';

const mysql = (() => {
  try {
    return readMysqlConfig();
  } catch {
    return null;
  }
})();

type App = ReturnType<typeof createApp>;

const now = () => new Date().toISOString();

async function guestSession(app: App) {
  const response = await app.request('/api/auth/guest', { method: 'POST' });
  expect(response.status).toBe(201);
  const cookie = cookieHeader(response.headers.get('set-cookie'));
  const me = (await (await app.request('/api/auth/me', { headers: { Cookie: cookie } })).json()) as {
    id: string;
  };
  return { cookie, id: me.id };
}

async function registerElsewhere(app: App, email: string) {
  /* A separate app instance would be a separate database; same app, no cookie. */
  const response = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret12' }),
  });
  expect(response.status).toBe(201);
  const cookie = cookieHeader(response.headers.get('set-cookie'));
  const me = (await (await app.request('/api/auth/me', { headers: { Cookie: cookie } })).json()) as {
    id: string;
  };
  return { cookie, id: me.id };
}

/**
 * One of everything, owned by `userId`.
 *
 * Written straight to the tables because a guest has no HTTP route to most of
 * it — community and profile endpoints require a registered account. The merge
 * is SQL over owner columns, and that is what is being tested; how a row came
 * to exist is not what makes it need moving.
 */
function seedOwnedRows(store: SqliteStore, userId: string, conversationId: string) {
  const db = store.db;
  const stamp = now();
  const communityId = randomUUID();
  const publicationId = randomUUID();
  const noteId = randomUUID();

  db.prepare(
    `INSERT INTO communities (id, name, description, createdByUserId, createdAt)
     VALUES (?, ?, '', ?, ?)`,
  ).run(communityId, 'A circle', userId, stamp);

  db.prepare(
    `INSERT INTO community_members (communityId, userId, role, state, invitedByUserId, createdAt, updatedAt)
     VALUES (?, ?, 'owner', 'active', ?, ?, ?)`,
  ).run(communityId, userId, userId, stamp, stamp);

  db.prepare(
    `INSERT INTO publications
       (id, authorUserId, conversationId, audience, communityId, format, title,
        scriptureReference, caption, shareVisibility, moderationState, hiddenByUserId,
        hiddenAt, deletedAt, createdAt, updatedAt)
     VALUES (?, ?, ?, 'public', NULL, 'full', 'Shared', NULL, '', 'public', 'visible', ?, NULL, NULL, ?, ?)`,
  ).run(publicationId, userId, conversationId, userId, stamp, stamp);

  db.prepare(
    'INSERT INTO publication_reactions (publicationId, userId, createdAt) VALUES (?, ?, ?)',
  ).run(publicationId, userId, stamp);
  db.prepare(
    'INSERT INTO publication_saves (publicationId, userId, createdAt) VALUES (?, ?, ?)',
  ).run(publicationId, userId, stamp);
  db.prepare(
    `INSERT INTO share_events (id, userId, conversationId, audience, communityId, createdAt)
     VALUES (?, ?, ?, 'public', NULL, ?)`,
  ).run(randomUUID(), userId, conversationId, Date.now());

  db.prepare(
    `INSERT INTO studio_image_assets
       (id, userId, conversationId, bytes, contentType, width, height, provenanceJson, createdAt)
     VALUES (?, ?, ?, ?, 'image/png', 1, 1, '{}', ?)`,
  ).run(randomUUID(), userId, conversationId, Buffer.from([1]), stamp);

  db.prepare(
    `INSERT INTO notes (id, userId, title, body, isPinned, isArchived, createdAt, updatedAt, deletedAt)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?, NULL)`,
  ).run(noteId, userId, 'A private note', 'Written as a guest.', stamp, stamp);

  db.prepare(
    `INSERT INTO profiles (userId, handle, displayName, tagline, favouriteVerses, createdAt, updatedAt)
     VALUES (?, ?, ?, '', '[]', ?, ?)`,
  ).run(userId, `handle-${userId.slice(0, 8)}`, 'A guest', stamp, stamp);

  return { communityId, publicationId, noteId };
}

function ownerOf(store: SqliteStore, sql: string, ...params: unknown[]) {
  const row = store.db.prepare(sql).get(...(params as never[])) as Record<string, unknown> | undefined;
  return row ?? null;
}

async function guestWithEverything(app: App, store: SqliteStore) {
  const guest = await guestSession(app);

  const created = await app.request('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: guest.cookie },
    body: JSON.stringify({ title: 'Written before signing in' }),
  });
  const conversation = (await created.json()) as { id: string };

  await app.request(`/api/conversations/${conversation.id}/sections`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: guest.cookie },
    body: JSON.stringify({ type: 'heart', content: 'Something felt, before there was an account.' }),
  });

  const seeded = seedOwnedRows(store, guest.id, conversation.id);
  return { guest, conversationId: conversation.id, ...seeded };
}

describe('a guest signing into an account they already had', () => {
  test('brings every kind of work with them, not only their reflections', async () => {
    const store = new SqliteStore();
    const app = createApp(store);

    const target = await registerElsewhere(app, 'ada@example.com');
    const { guest, conversationId, communityId, publicationId, noteId } = await guestWithEverything(
      app,
      store,
    );

    const signedIn = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: guest.cookie },
      body: JSON.stringify({ email: 'ada@example.com', password: 'secret12' }),
    });
    expect(signedIn.status).toBe(200);

    /* The reflection, which always moved. */
    expect(ownerOf(store, 'SELECT userId FROM conversations WHERE id = ?', conversationId)).toEqual({
      userId: target.id,
    });

    /* And everything that used to be left behind. */
    expect(
      ownerOf(store, 'SELECT authorUserId, hiddenByUserId FROM publications WHERE id = ?', publicationId),
    ).toEqual({ authorUserId: target.id, hiddenByUserId: target.id });
    expect(
      ownerOf(store, 'SELECT createdByUserId FROM communities WHERE id = ?', communityId),
    ).toEqual({ createdByUserId: target.id });
    expect(
      ownerOf(
        store,
        'SELECT userId, invitedByUserId FROM community_members WHERE communityId = ?',
        communityId,
      ),
    ).toEqual({ userId: target.id, invitedByUserId: target.id });
    expect(
      ownerOf(store, 'SELECT userId FROM publication_reactions WHERE publicationId = ?', publicationId),
    ).toEqual({ userId: target.id });
    expect(
      ownerOf(store, 'SELECT userId FROM publication_saves WHERE publicationId = ?', publicationId),
    ).toEqual({ userId: target.id });
    expect(
      ownerOf(store, 'SELECT userId FROM share_events WHERE conversationId = ?', conversationId),
    ).toEqual({ userId: target.id });
    expect(
      ownerOf(store, 'SELECT userId FROM studio_image_assets WHERE conversationId = ?', conversationId),
    ).toEqual({ userId: target.id });
    expect(ownerOf(store, 'SELECT userId FROM notes WHERE id = ?', noteId)).toEqual({
      userId: target.id,
    });

    /* Nothing at all is still owned by the guest. */
    for (const [table, column] of [
      ['conversations', 'userId'],
      ['publications', 'authorUserId'],
      ['communities', 'createdByUserId'],
      ['community_members', 'userId'],
      ['publication_reactions', 'userId'],
      ['publication_saves', 'userId'],
      ['share_events', 'userId'],
      ['studio_image_assets', 'userId'],
      ['notes', 'userId'],
    ] as const) {
      const left = store.db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
        .get(guest.id) as { n: number };
      expect({ table, left: Number(left.n) }).toEqual({ table, left: 0 });
    }
  });

  test('the public identity stays the one people can already see', async () => {
    const store = new SqliteStore();
    const app = createApp(store);

    const target = await registerElsewhere(app, 'ada@example.com');
    /* The target opens their profile, so they have one before the merge. */
    const mine = await app.request('/api/profiles/me', { headers: { Cookie: target.cookie } });
    const theirs = (await mine.json()) as { handle: string };

    const { guest } = await guestWithEverything(app, store);

    await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: guest.cookie },
      body: JSON.stringify({ email: 'ada@example.com', password: 'secret12' }),
    });

    /* One profile, and it is the one that was already public. */
    const rows = store.db
      .prepare('SELECT handle FROM profiles WHERE userId = ?')
      .all(target.id) as { handle: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.handle).toBe(theirs.handle);
  });

  test('what both identities did once is kept once', async () => {
    const store = new SqliteStore();
    const app = createApp(store);

    const target = await registerElsewhere(app, 'ada@example.com');
    const { guest, publicationId, communityId } = await guestWithEverything(app, store);

    /* The account had already encouraged, saved, and joined the same things. */
    const stamp = now();
    store.db
      .prepare('INSERT INTO publication_reactions (publicationId, userId, createdAt) VALUES (?, ?, ?)')
      .run(publicationId, target.id, stamp);
    store.db
      .prepare('INSERT INTO publication_saves (publicationId, userId, createdAt) VALUES (?, ?, ?)')
      .run(publicationId, target.id, stamp);
    store.db
      .prepare(
        `INSERT INTO community_members (communityId, userId, role, state, createdAt, updatedAt)
         VALUES (?, ?, 'member', 'active', ?, ?)`,
      )
      .run(communityId, target.id, stamp, stamp);

    const signedIn = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: guest.cookie },
      body: JSON.stringify({ email: 'ada@example.com', password: 'secret12' }),
    });
    /* A collision must not fail the sign-in. */
    expect(signedIn.status).toBe(200);

    for (const [table, key] of [
      ['publication_reactions', publicationId],
      ['publication_saves', publicationId],
    ] as const) {
      const rows = store.db
        .prepare(`SELECT userId FROM ${table} WHERE publicationId = ?`)
        .all(key) as { userId: string }[];
      expect({ table, rows: rows.map((row) => row.userId) }).toEqual({
        table,
        rows: [target.id],
      });
    }

    /* The membership the account already had is the one that survives. */
    const members = store.db
      .prepare('SELECT userId, role FROM community_members WHERE communityId = ?')
      .all(communityId) as { userId: string; role: string }[];
    expect(members).toEqual([{ userId: target.id, role: 'member' }]);
    expect(members.filter((member) => member.userId === guest.id)).toHaveLength(0);
  });

  test('a guest who muted the account they are joining does not end up muting themselves', async () => {
    const store = new SqliteStore();
    const app = createApp(store);

    const target = await registerElsewhere(app, 'ada@example.com');
    const { guest } = await guestWithEverything(app, store);

    store.db
      .prepare('INSERT INTO author_mutes (userId, mutedUserId, createdAt) VALUES (?, ?, ?)')
      .run(guest.id, target.id, now());
    store.db
      .prepare('INSERT INTO profile_blocks (blockerUserId, blockedUserId, createdAt) VALUES (?, ?, ?)')
      .run(guest.id, target.id, now());

    await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: guest.cookie },
      body: JSON.stringify({ email: 'ada@example.com', password: 'secret12' }),
    });

    /* Nobody can express this, so nobody should be left holding it. */
    expect(
      store.db.prepare('SELECT COUNT(*) AS n FROM author_mutes').get() as { n: number },
    ).toEqual({ n: 0 });
    expect(
      store.db.prepare('SELECT COUNT(*) AS n FROM profile_blocks').get() as { n: number },
    ).toEqual({ n: 0 });
  });
});

/*
 * The production combination: accounts on MariaDB, content on SQLite.
 *
 * This is the split that made B3 matter. `accounts.merge` moves content in
 * SQLite while `auth.merge` revokes the guest's sessions in MariaDB, and the
 * id that ties them together is the account's public uuid — so a merge that
 * works on one store and not the other is a merge that half happened.
 *
 * Skipped without MYSQL_*, like every other durable suite. SqliteStore for
 * content, never MemoryStore.
 */
describe.skipIf(!mysql)('a guest merging when accounts live in MariaDB', () => {
  let pool: MysqlPool;
  let db: MysqlPersistence;
  const made: string[] = [];

  beforeAll(async () => {
    if (!mysql) return;
    pool = createMysqlPool(mysql);
    await migrate(pool);
    db = new MysqlPersistence(pool);
  });

  afterAll(async () => {
    for (const uuid of made) {
      const user = await db.getUserByPublicUuid(uuid).catch(() => null);
      if (user) await db.deleteUserGraph(user.id).catch(() => undefined);
    }
    await pool?.end();
  });

  test('content in SQLite follows an account that lives somewhere else', async () => {
    const store = new SqliteStore();
    const app = createApp(store, {}, {}, new MysqlAuthStore(db));

    const email = `merge-${randomUUID()}@example.com`;
    const target = await registerElsewhere(app, email);
    made.push(target.id);

    const { guest, conversationId, publicationId } = await guestWithEverything(app, store);
    made.push(guest.id);

    const signedIn = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: guest.cookie },
      body: JSON.stringify({ email, password: 'secret12' }),
    });
    expect(signedIn.status).toBe(200);

    expect(ownerOf(store, 'SELECT userId FROM conversations WHERE id = ?', conversationId)).toEqual({
      userId: target.id,
    });
    expect(
      ownerOf(store, 'SELECT authorUserId FROM publications WHERE id = ?', publicationId),
    ).toEqual({ authorUserId: target.id });
    expect(
      ownerOf(store, 'SELECT userId FROM studio_image_assets WHERE conversationId = ?', conversationId),
    ).toEqual({ userId: target.id });
  });
});
