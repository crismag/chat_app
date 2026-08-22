/*
 * A list item says what is in the reflection.
 *
 * The collection used to render a page and then fetch every reflection on it,
 * one request per card, to find out what had been written — twenty round trips
 * to draw one page, and cards reading "Nothing written yet" until their own
 * request came back. This route has already loaded the sections in order to
 * filter and sort by them, so these assert that it answers with them.
 */
import { expect, test } from 'vitest';

import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import { cookieHeader } from '../http/set-cookie.ts';

type App = ReturnType<typeof createApp>;
type Card = {
  id: string;
  title: string;
  excerpt: string;
  preview: string;
  written: string[];
};

async function register(app: App, email: string) {
  const response = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret12' }),
  });
  return cookieHeader(response.headers.get('set-cookie'));
}

async function reflection(app: App, cookie: string, body: Record<string, unknown>) {
  const created = await app.request('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
  return (await created.json()) as { id: string };
}

async function writeSection(app: App, cookie: string, id: string, type: string, content: string) {
  const response = await app.request(`/api/conversations/${id}/sections`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ type, content }),
  });
  expect(response.status).toBe(200);
}

async function cards(app: App, cookie: string) {
  const body = (await (await app.request('/api/reflections', { headers: { Cookie: cookie } })).json()) as {
    items: Card[];
  };
  return body.items;
}

test('a card carries what was written, without a second request per reflection', async () => {
  const app = createApp(new SqliteStore());
  const cookie = await register(app, 'ada@example.com');
  const made = await reflection(app, cookie, { title: 'Abide', scriptureReference: 'John 15:5' });
  await writeSection(app, cookie, made.id, 'heart', 'It met the fear I had not named.');

  const [card] = await cards(app, cookie);
  expect(card?.written).toEqual(['heart']);
  expect(card?.excerpt).toBe('It met the fear I had not named.');
  expect(card?.preview).toBe('It met the fear I had not named.');
});

test('the preview prefers the author’s own writing over the passage they pasted', async () => {
  const app = createApp(new SqliteStore());
  const cookie = await register(app, 'ada@example.com');
  const made = await reflection(app, cookie, { title: 'Abide', scriptureReference: 'John 15:5' });
  await writeSection(app, cookie, made.id, 'content', 'John 15:5 (NIV) — I am the vine.');
  await writeSection(app, cookie, made.id, 'application', 'One thing to do this week.');

  const [card] = await cards(app, cookie);
  /* Content is written, so it is listed — but it is not what the card says. */
  expect(card?.written).toEqual(['content', 'application']);
  expect(card?.preview).toBe('One thing to do this week.');
});

test('a passage with nothing written about it loses the reference the card already shows', async () => {
  const app = createApp(new SqliteStore());
  const cookie = await register(app, 'ada@example.com');
  const made = await reflection(app, cookie, { title: 'Abide', scriptureReference: 'John 15:5' });
  await writeSection(app, cookie, made.id, 'content', 'John 15:5 (NIV) — I am the vine.');

  const [card] = await cards(app, cookie);
  expect(card?.preview).toBe('I am the vine.');
});

test('a reflection that is still a conversation excerpts what the person said', async () => {
  const app = createApp(new SqliteStore());
  const cookie = await register(app, 'ada@example.com');
  const made = await reflection(app, cookie, { title: 'Thinking aloud' });
  await app.request(`/api/conversations/${made.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ content: 'I keep coming back to this one.' }),
  });

  const [card] = await cards(app, cookie);
  expect(card?.written).toEqual([]);
  expect(card?.excerpt).toBe('I keep coming back to this one.');
});

test('an empty reflection says nothing rather than guessing', async () => {
  const app = createApp(new SqliteStore());
  const cookie = await register(app, 'ada@example.com');
  await reflection(app, cookie, { title: 'Only a title' });

  const [card] = await cards(app, cookie);
  expect(card).toMatchObject({ excerpt: '', preview: '', written: [] });
});

test('a Short reflection previews its reflection field, not its verse', async () => {
  const app = createApp(new SqliteStore());
  const cookie = await register(app, 'ada@example.com');
  const made = await reflection(app, cookie, { title: 'Short one', format: 'condensed' });
  await writeSection(app, cookie, made.id, 'verse', 'Psalm 46:10 — Be still.');
  await writeSection(app, cookie, made.id, 'reflection', 'Being still is the hard part.');

  const [card] = await cards(app, cookie);
  expect(card?.preview).toBe('Being still is the hard part.');
  expect(card?.written).toEqual(['verse', 'reflection']);
});

test('one reflection’s writing never appears on another’s card', async () => {
  const app = createApp(new SqliteStore());
  const cookie = await register(app, 'ada@example.com');
  const first = await reflection(app, cookie, { title: 'First' });
  const second = await reflection(app, cookie, { title: 'Second' });
  await writeSection(app, cookie, first.id, 'heart', 'Belongs to the first.');
  await writeSection(app, cookie, second.id, 'heart', 'Belongs to the second.');

  const items = await cards(app, cookie);
  const byTitle = new Map(items.map((item) => [item.title, item]));
  expect(byTitle.get('First')?.excerpt).toBe('Belongs to the first.');
  expect(byTitle.get('Second')?.excerpt).toBe('Belongs to the second.');
});
