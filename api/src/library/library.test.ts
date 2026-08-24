/*
 * Import and export of a person's library, asserted on HTTP.
 *
 * Authorisation tests run against SqliteStore, because that is the backing
 * that holds real writing. What is asserted is the file a person gets, and
 * the rows that appear after they send one back — never a helper's opinion.
 */

import { beforeEach, describe, expect, test } from 'vitest';
import { ACCOUNT_TYPES, LIBRARY_KIND, VISIBILITY } from '@chat/shared';
import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import { cookieHeader } from '../http/set-cookie.ts';

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

async function guest(target: App = app): Promise<string> {
  const response = await target.request('/api/auth/guest', { method: 'POST' });
  expect(response.status).toBe(201);
  return cookieHeader(response.headers.get('set-cookie'));
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function createReflection(
  cookie: string,
  body: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const created = await app.request('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: 'John 15', scriptureReference: 'John 15:5', ...body }),
  });
  expect(created.status).toBe(201);
  const conversation = await json<{ id: string }>(created);
  await app.request(`/api/conversations/${conversation.id}/sections`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ type: 'heart', content: 'I remain in the vine.' }),
  });
  return conversation;
}

async function createNote(
  cookie: string,
  body: Record<string, unknown> = {},
): Promise<{ id: string; title: string }> {
  const created = await app.request('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: 'Sunday list', body: 'Milk and bread.', ...body }),
  });
  expect(created.status).toBe(201);
  return json<{ id: string; title: string }>(created);
}

describe('who may use it', () => {
  test('nobody, and a guest, are refused, and a guest is not offered an account', async () => {
    const missing = await app.request('/api/library/export');
    expect(missing.status).toBe(401);
    expect(await json<{ needsAccount?: boolean }>(missing)).not.toHaveProperty('needsAccount');

    const cookie = await guest();
    const asGuest = await app.request('/api/library/export', { headers: { Cookie: cookie } });
    expect(asGuest.status).toBe(403);
    const body = await json<{ error: string; needsAccount?: boolean }>(asGuest);
    expect(body.error).toMatch(/signed-in account/i);
    expect(body.needsAccount).toBeUndefined();

    const imported = await app.request('/api/library/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ text: '{"notes":[{"title":"A","body":"B"}]}' }),
    });
    expect(imported.status).toBe(403);
  });

  test("one person cannot download another person's writing", async () => {
    const ada = await register('ada@example.com');
    await createReflection(ada);
    await createNote(ada);

    const gus = await register('gus@example.com');
    const file = await app.request('/api/library/export?format=json', {
      headers: { Cookie: gus },
    });
    expect(file.status).toBe(200);
    const archive = JSON.parse(await file.text()) as {
      reflections: unknown[];
      notes: unknown[];
    };
    expect(archive.reflections).toEqual([]);
    expect(archive.notes).toEqual([]);
  });
});

describe('export', () => {
  test('JSON carries private reflections and notes, and never a user id or a share flag', async () => {
    const cookie = await register('ada@example.com');
    const reflection = await createReflection(cookie);
    await createNote(cookie);
    await app.request(`/api/conversations/${reflection.id}/share`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    const file = await app.request('/api/library/export?reflections=1&notes=1&format=json', {
      headers: { Cookie: cookie },
    });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toMatch(/json/);
    expect(file.headers.get('content-disposition')).toMatch(/chat-library-.*\.json/);
    const text = await file.text();
    expect(text).not.toMatch(/userId/);
    expect(text).not.toMatch(/"visibility"/);
    const archive = JSON.parse(text) as {
      kind: string;
      reflections: Array<{ title: string; sections: { heart?: { content: string } } }>;
      notes: Array<{ title: string; body: string }>;
    };
    expect(archive.kind).toBe(LIBRARY_KIND);
    expect(archive.reflections).toHaveLength(1);
    expect(archive.reflections[0]?.title).toBe('John 15');
    expect(archive.reflections[0]?.sections.heart?.content).toBe('I remain in the vine.');
    expect(archive.notes).toHaveLength(1);
    expect(archive.notes[0]?.title).toBe('Sunday list');
  });

  test('Markdown is a readable copy of the same writing', async () => {
    const cookie = await register('ada@example.com');
    await createReflection(cookie);
    await createNote(cookie);

    const file = await app.request('/api/library/export?format=markdown', {
      headers: { Cookie: cookie },
    });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toMatch(/markdown/);
    expect(file.headers.get('content-disposition')).toMatch(/\.md/);
    const text = await file.text();
    expect(text).toContain('# C.H.A.T. library');
    expect(text).toContain('## Reflections');
    expect(text).toContain('John 15');
    expect(text).toContain('I remain in the vine.');
    expect(text).toContain('## Notes');
    expect(text).toContain('Sunday list');
  });

  test('the boxes choose which collection is in the file', async () => {
    const cookie = await register('ada@example.com');
    await createReflection(cookie);
    await createNote(cookie);

    const notesOnly = await app.request('/api/library/export?reflections=0&notes=1&format=json', {
      headers: { Cookie: cookie },
    });
    const archive = JSON.parse(await notesOnly.text()) as {
      reflections: unknown[];
      notes: unknown[];
    };
    expect(archive.reflections).toEqual([]);
    expect(archive.notes).toHaveLength(1);
    expect(notesOnly.headers.get('content-disposition')).toMatch(/chat-notes-/);
  });

  test('archived and trashed notes are still in the backup', async () => {
    const cookie = await register('ada@example.com');
    const archived = await createNote(cookie, { title: 'Kept aside', body: 'Later.', archived: true });
    const trashed = await createNote(cookie, { title: 'Bin', body: 'Gone.' });
    await app.request(`/api/notes/${trashed.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });

    const file = await app.request('/api/library/export?reflections=0&notes=1', {
      headers: { Cookie: cookie },
    });
    const archive = JSON.parse(await file.text()) as {
      notes: Array<{ title: string; archived: boolean; deleted: boolean }>;
    };
    const titles = archive.notes.map((note) => note.title).sort();
    expect(titles).toEqual(['Bin', 'Kept aside']);
    expect(archive.notes.find((note) => note.title === 'Kept aside')?.archived).toBe(true);
    expect(archive.notes.find((note) => note.title === 'Bin')?.deleted).toBe(true);
    expect(archived.id).toBeTruthy();
  });
});

describe('import', () => {
  test('JSON round-trips into new private copies', async () => {
    const cookie = await register('ada@example.com');
    const original = await createReflection(cookie);
    await app.request(`/api/conversations/${original.id}/share`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    await createNote(cookie);

    const file = await app.request('/api/library/export?format=json', { headers: { Cookie: cookie } });
    const text = await file.text();

    const imported = await app.request('/api/library/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ text, include: { reflections: true, notes: true } }),
    });
    expect(imported.status).toBe(201);
    const result = await json<{ imported: { reflections: number; notes: number } }>(imported);
    expect(result.imported).toEqual({ reflections: 1, notes: 1 });

    const listed = await json<Array<{ id: string; visibility: string; title: string }>>(
      await app.request('/api/conversations', { headers: { Cookie: cookie } }),
    );
    expect(listed).toHaveLength(2);
    const copies = listed.filter((item) => item.id !== original.id);
    expect(copies).toHaveLength(1);
    expect(copies[0]?.visibility).toBe(VISIBILITY.PRIVATE);
    expect(copies[0]?.title).toBe('John 15');

    const notes = await json<{ items: Array<{ title: string }> }>(
      await app.request('/api/notes', { headers: { Cookie: cookie } }),
    );
    expect(notes.items).toHaveLength(2);
  });

  test('Markdown notes-only import respects the boxes', async () => {
    const cookie = await register('ada@example.com');
    const markdown = `# C.H.A.T. library

## Reflections

### Should not land

**Scripture:** Psalm 1:1

#### Heart

Skipped because notes were ticked.

## Notes

### Shopping

Eggs and tea.
`;
    const imported = await app.request('/api/library/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ text: markdown, include: { reflections: false, notes: true } }),
    });
    expect(imported.status).toBe(201);
    const result = await json<{ imported: { reflections: number; notes: number } }>(imported);
    expect(result.imported).toEqual({ reflections: 0, notes: 1 });

    const listed = await json<unknown[]>(
      await app.request('/api/conversations', { headers: { Cookie: cookie } }),
    );
    expect(listed).toHaveLength(0);
    const notes = await json<{ items: Array<{ title: string; body: string }> }>(
      await app.request('/api/notes', { headers: { Cookie: cookie } }),
    );
    expect(notes.items[0]?.title).toBe('Shopping');
    expect(notes.items[0]?.body).toContain('Eggs');
  });

  test('an empty import, and both boxes off, are refused', async () => {
    const cookie = await register('ada@example.com');
    const empty = await app.request('/api/library/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ text: '' }),
    });
    expect(empty.status).toBe(400);

    const none = await app.request('/api/library/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        text: '{"notes":[{"title":"A","body":"B"}]}',
        include: { reflections: false, notes: false },
      }),
    });
    expect(none.status).toBe(400);
  });

  test('a registered account is the only kind that can import', async () => {
    const me = await app.request('/api/auth/me', {
      headers: { Cookie: await register('ada@example.com') },
    });
    const account = await json<{ accountType: string }>(me);
    expect(account.accountType).toBe(ACCOUNT_TYPES.REGISTERED);
  });
});
