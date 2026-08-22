/*
 * Notes, asserted on API payloads.
 *
 * Every claim in here is made against the JSON a request actually returns —
 * never against a store method or a helper. Authorisation tests run against
 * `SqliteStore(':memory:')` via `createApp(new SqliteStore())`, because that is
 * the real WHERE clause, not a second implementation that might be kinder.
 */

import { beforeEach, describe, expect, test } from 'vitest';
import { CREATION_SOURCES } from '@chat/shared';
import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import { MemoryStore } from '../store.ts';
import { cookieHeader } from '../http/set-cookie.ts';
import { NOTE_BODY_MAX, NOTE_TITLE_MAX } from './limits.ts';

type App = ReturnType<typeof createApp>;

let app: App;

beforeEach(() => {
  app = createApp(new SqliteStore());
});

async function register(email: string, target: App = app): Promise<string> {
  const response = await target.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret12' }),
  });
  expect(response.status).toBe(201);
  return cookieHeader(response.headers.get('set-cookie'));
}

async function call<T>(
  cookie: string | null,
  path: string,
  init: RequestInit = {},
  target: App = app,
): Promise<{ status: number; body: T }> {
  const response = await target.request(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as T;
  return { status: response.status, body };
}

type Note = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  userId?: string;
};

type List = { items: Note[]; view: string; error?: string };

async function createNote(
  cookie: string,
  input: Record<string, unknown> = {},
  target: App = app,
): Promise<Note> {
  const created = await call<Note>(
    cookie,
    '/api/notes',
    { method: 'POST', body: JSON.stringify(input) },
    target,
  );
  expect(created.status).toBe(201);
  return created.body;
}

function assertPublic(note: Note) {
  expect(note).not.toHaveProperty('userId');
  expect(JSON.stringify(note)).not.toMatch(/"userId"/);
}

describe('create, read, update, list', () => {
  test('a person can create a note, read it, edit it and see it in the list', async () => {
    const cookie = await register('ada@example.com');

    const created = await createNote(cookie, { title: 'Sunday list', body: 'Milk and bread.' });
    expect(created.title).toBe('Sunday list');
    expect(created.body).toBe('Milk and bread.');
    expect(created.pinned).toBe(false);
    expect(created.archived).toBe(false);
    expect(created.deletedAt).toBeNull();
    assertPublic(created);

    const fetched = await call<Note>(cookie, `/api/notes/${created.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.title).toBe('Sunday list');
    assertPublic(fetched.body);

    const patched = await call<Note>(cookie, `/api/notes/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Sunday shopping', body: 'Milk, bread, eggs.' }),
    });
    expect(patched.status).toBe(200);
    expect(patched.body.title).toBe('Sunday shopping');
    expect(patched.body.body).toBe('Milk, bread, eggs.');

    const list = await call<List>(cookie, '/api/notes');
    expect(list.status).toBe(200);
    expect(list.body.view).toBe('active');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]?.title).toBe('Sunday shopping');
    assertPublic(list.body.items[0]!);
  });

  test('an empty note can be created and listed', async () => {
    const cookie = await register('ada@example.com');
    const created = await createNote(cookie);
    expect(created.title).toBe('');
    expect(created.body).toBe('');

    const list = await call<List>(cookie, '/api/notes');
    expect(list.body.items[0]?.id).toBe(created.id);
  });
});

describe('pin, archive, delete, restore', () => {
  test('pin and unpin', async () => {
    const cookie = await register('ada@example.com');
    const note = await createNote(cookie, { title: 'Keep this' });

    const pinned = await call<Note>(cookie, `/api/notes/${note.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned: true }),
    });
    expect(pinned.status).toBe(200);
    expect(pinned.body.pinned).toBe(true);

    const unpinned = await call<Note>(cookie, `/api/notes/${note.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned: false }),
    });
    expect(unpinned.body.pinned).toBe(false);
  });

  test('archive and unarchive keep the note out of the active list', async () => {
    const cookie = await register('ada@example.com');
    const note = await createNote(cookie, { title: 'Old list' });

    const archived = await call<Note>(cookie, `/api/notes/${note.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    });
    expect(archived.body.archived).toBe(true);

    const active = await call<List>(cookie, '/api/notes?view=active');
    expect(active.body.items).toHaveLength(0);

    const archive = await call<List>(cookie, '/api/notes?view=archived');
    expect(archive.body.items).toHaveLength(1);
    expect(archive.body.items[0]?.id).toBe(note.id);

    const restored = await call<Note>(cookie, `/api/notes/${note.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived: false }),
    });
    expect(restored.body.archived).toBe(false);
    const after = await call<List>(cookie, '/api/notes');
    expect(after.body.items).toHaveLength(1);
  });

  test('delete moves a note to trash and unpins it; restore keeps the archived flag', async () => {
    const cookie = await register('ada@example.com');
    const note = await createNote(cookie, { title: 'Done', pinned: true, archived: true });

    const deleted = await call<Note>(cookie, `/api/notes/${note.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(deleted.body.deletedAt).toBeTruthy();
    expect(deleted.body.pinned).toBe(false);
    expect(deleted.body.archived).toBe(true);

    const active = await call<List>(cookie, '/api/notes');
    expect(active.body.items).toHaveLength(0);
    const archive = await call<List>(cookie, '/api/notes?view=archived');
    expect(archive.body.items).toHaveLength(0);
    const trash = await call<List>(cookie, '/api/notes?view=trash');
    expect(trash.body.items).toHaveLength(1);
    expect(trash.body.items[0]?.id).toBe(note.id);

    const restored = await call<Note>(cookie, `/api/notes/${note.id}/restore`, { method: 'POST' });
    expect(restored.status).toBe(200);
    expect(restored.body.deletedAt).toBeNull();
    expect(restored.body.archived).toBe(true);
    expect(restored.body.pinned).toBe(false);

    const afterTrash = await call<List>(cookie, '/api/notes?view=trash');
    expect(afterTrash.body.items).toHaveLength(0);
    const afterArchive = await call<List>(cookie, '/api/notes?view=archived');
    expect(afterArchive.body.items).toHaveLength(1);
  });

  test('a pinned note sorts first even when another is newer', async () => {
    const cookie = await register('ada@example.com');
    const older = await createNote(cookie, { title: 'Older' });
    await createNote(cookie, { title: 'Newer' });

    await call(cookie, `/api/notes/${older.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned: true }),
    });
    /*
     * Pinning bumps updatedAt, which would also put this note first. Create a
     * still-newer unpinned note afterwards so the pin, not recency, is why it
     * leads.
     */
    await createNote(cookie, { title: 'Newest unpinned' });

    const list = await call<List>(cookie, '/api/notes');
    expect(list.body.items.map((item) => item.title)).toEqual([
      'Older',
      'Newest unpinned',
      'Newer',
    ]);
    expect(list.body.items[0]?.pinned).toBe(true);
  });
});

describe('search', () => {
  test('search is scoped to the owner and the current view', async () => {
    const ada = await register('ada@example.com');
    const gus = await register('gus@example.com');

    await createNote(ada, { title: 'Ada grocery', body: 'apples' });
    await createNote(ada, { title: 'Ada archived grocery', body: 'apples' }).then((note) =>
      call(ada, `/api/notes/${note.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: true }),
      }),
    );
    await createNote(gus, { title: 'Gus grocery', body: 'SECRET-OTHER-USER-BODY' });

    const found = await call<List>(ada, '/api/notes?q=grocery');
    expect(found.body.items).toHaveLength(1);
    expect(found.body.items[0]?.title).toBe('Ada grocery');
    const serialised = JSON.stringify(found.body);
    expect(serialised).not.toContain('Gus grocery');
    expect(serialised).not.toContain('SECRET-OTHER-USER-BODY');
    expect(serialised).not.toContain('Ada archived grocery');

    const archived = await call<List>(ada, '/api/notes?view=archived&q=grocery');
    expect(archived.body.items).toHaveLength(1);
    expect(archived.body.items[0]?.title).toBe('Ada archived grocery');
  });

  test('a search for % matches a literal percent, not every note', async () => {
    const cookie = await register('ada@example.com');
    await createNote(cookie, { title: '100% complete', body: 'done' });
    await createNote(cookie, { title: 'hello world', body: 'nothing special' });

    const found = await call<List>(cookie, `/api/notes?q=${encodeURIComponent('%')}`);
    expect(found.body.items).toHaveLength(1);
    expect(found.body.items[0]?.title).toBe('100% complete');
  });
});

describe('ownership', () => {
  test('User A cannot read, update, delete or restore User B, and the JSON names nothing', async () => {
    const ada = await register('ada@example.com');
    const gus = await register('gus@example.com');

    const secret = await createNote(gus, {
      title: 'SECRET-NOTE-TITLE',
      body: 'SECRET-NOTE-BODY',
    });
    const secretId = secret.id;

    const deleted = await createNote(gus, {
      title: 'SECRET-TRASH-TITLE',
      body: 'SECRET-TRASH-BODY',
    });
    await call(gus, `/api/notes/${deleted.id}`, { method: 'DELETE' });

    const attempts = [
      await call<Record<string, unknown>>(ada, `/api/notes/${secretId}`),
      await call<Record<string, unknown>>(ada, `/api/notes/${secretId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'mine now' }),
      }),
      await call<Record<string, unknown>>(ada, `/api/notes/${secretId}`, { method: 'DELETE' }),
      await call<Record<string, unknown>>(ada, `/api/notes/${deleted.id}/restore`, {
        method: 'POST',
      }),
    ];

    for (const attempt of attempts) {
      expect(attempt.status).toBe(404);
      const serialised = JSON.stringify(attempt.body);
      expect(serialised).not.toContain('SECRET-NOTE-TITLE');
      expect(serialised).not.toContain('SECRET-NOTE-BODY');
      expect(serialised).not.toContain('SECRET-TRASH-TITLE');
      expect(serialised).not.toContain('SECRET-TRASH-BODY');
      expect(serialised).not.toContain(secretId);
      expect(serialised).not.toContain(deleted.id);
      expect(serialised).not.toMatch(/"userId"/);
    }

    const stillThere = await call<Note>(gus, `/api/notes/${secretId}`);
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.title).toBe('SECRET-NOTE-TITLE');
  });

  test('a missing note is the same 404 as somebody else\'s', async () => {
    const cookie = await register('ada@example.com');
    const missing = await call<Record<string, unknown>>(
      cookie,
      '/api/notes/00000000-0000-4000-8000-000000000000',
    );
    expect(missing.status).toBe(404);
    expect(JSON.stringify(missing.body)).not.toMatch(/"title"|"body"/);
  });
});

describe('unauthenticated visitors', () => {
  test('listing notes with nobody signed in is an empty active list', async () => {
    const listed = await call<List>(null, '/api/notes');
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({ items: [], view: 'active' });
  });

  test('creating a note with nobody signed in is 401 needsAccount', async () => {
    const created = await call<Record<string, unknown>>(null, '/api/notes', {
      method: 'POST',
      body: JSON.stringify({ title: 'Nope' }),
    });
    expect(created.status).toBe(401);
    expect(created.body['needsAccount']).toBe(true);
    expect(created.body['creationSource']).toBe(CREATION_SOURCES.OTHER_PERSISTENT_ACTION);
    expect(created.body['error']).toEqual(expect.any(String));
  });

  test('writes with nobody signed in are 401, not 404', async () => {
    const cookie = await register('ada@example.com');
    const note = await createNote(cookie, { title: 'Mine' });

    for (const attempt of [
      await call<Record<string, unknown>>(null, `/api/notes/${note.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Stolen' }),
      }),
      await call<Record<string, unknown>>(null, `/api/notes/${note.id}`, { method: 'DELETE' }),
      await call<Record<string, unknown>>(null, `/api/notes/${note.id}/restore`, {
        method: 'POST',
      }),
    ]) {
      expect(attempt.status).toBe(401);
      expect(attempt.body['needsAccount']).toBe(true);
      expect(attempt.body['creationSource']).toBe(CREATION_SOURCES.OTHER_PERSISTENT_ACTION);
    }
  });
});

describe('validation', () => {
  test('over-long title and body are 400, not clipped', async () => {
    const cookie = await register('ada@example.com');
    const longTitle = 'T'.repeat(NOTE_TITLE_MAX + 1);
    const tooLong = await call<Record<string, unknown>>(cookie, '/api/notes', {
      method: 'POST',
      body: JSON.stringify({ title: longTitle }),
    });
    expect(tooLong.status).toBe(400);
    expect(String(tooLong.body['error'])).toMatch(/title/i);

    const note = await createNote(cookie, { title: 'ok' });
    const longBody = 'B'.repeat(NOTE_BODY_MAX + 1);
    const patched = await call<Record<string, unknown>>(cookie, `/api/notes/${note.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: longBody }),
    });
    expect(patched.status).toBe(400);
    expect(String(patched.body['error'])).toMatch(/body/i);

    const fetched = await call<Note>(cookie, `/api/notes/${note.id}`);
    expect(fetched.body.body).toBe('');
    expect(fetched.body.title).toBe('ok');
  });

  test('wrong types are 400', async () => {
    const cookie = await register('ada@example.com');
    const created = await call<Record<string, unknown>>(cookie, '/api/notes', {
      method: 'POST',
      body: JSON.stringify({ title: 12 }),
    });
    expect(created.status).toBe(400);

    const note = await createNote(cookie);
    const pinned = await call<Record<string, unknown>>(cookie, `/api/notes/${note.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned: 'yes' }),
    });
    expect(pinned.status).toBe(400);
  });

  test('an unknown view is 400', async () => {
    const cookie = await register('ada@example.com');
    const listed = await call<List>(cookie, '/api/notes?view=everything');
    expect(listed.status).toBe(400);
  });
});

describe('memory backing', () => {
  test('createApp(new MemoryStore()) still serves notes', async () => {
    const memoryApp = createApp(new MemoryStore());
    const cookie = await register('ada@example.com', memoryApp);
    const created = await createNote(cookie, { title: 'In memory' }, memoryApp);
    const list = await call<List>(cookie, '/api/notes', {}, memoryApp);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]?.id).toBe(created.id);
  });
});
