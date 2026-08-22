/*
 * The list asks for one person's reflections.
 *
 * It used to read every conversation in the database and drop everybody
 * else's afterwards, which is the whole product's writing materialised to
 * answer one person's page. The owner filter is a WHERE clause now, and
 * `idx_conversations_user` — which already existed — can finally serve it.
 *
 * SqliteStore, because the point is what the database is asked, and because
 * "another person's reflection never appears" is an authorization claim.
 */
import { expect, test } from 'vitest';

import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import { cookieHeader } from '../http/set-cookie.ts';

type App = ReturnType<typeof createApp>;

async function register(app: App, email: string) {
  const response = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret12' }),
  });
  expect(response.status).toBe(201);
  return cookieHeader(response.headers.get('set-cookie'));
}

async function write(app: App, cookie: string, title: string) {
  const created = await app.request('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title }),
  });
  return (await created.json()) as { id: string };
}

function list(app: App, cookie: string, query = '') {
  return app.request(`/api/reflections${query}`, { headers: { Cookie: cookie } });
}

test('the list is one person’s, and the query is what makes it so', async () => {
  const store = new SqliteStore();
  const app = createApp(store);

  const ada = await register(app, 'ada@example.com');
  const bob = await register(app, 'bob@example.com');
  const mine = await write(app, ada, 'Mine');
  await write(app, bob, 'Theirs');

  const body = (await (await list(app, ada)).json()) as {
    items: { id: string; title: string }[];
    total: number;
  };
  expect(body.items.map((item) => item.title)).toEqual(['Mine']);
  expect(body.total).toBe(1);
  expect(JSON.stringify(body)).not.toContain('Theirs');

  /* The owner column is what was asked for, not a shape the caller can widen. */
  const theirs = (await (await list(app, bob)).json()) as { items: { id: string }[] };
  expect(theirs.items.map((item) => item.id)).not.toContain(mine.id);
});

test('paging still describes the whole matching set, and clamps past the end', async () => {
  const store = new SqliteStore();
  const app = createApp(store);
  const cookie = await register(app, 'ada@example.com');
  /* Twelve, so the smallest allowed page size (10) leaves a short second page. */
  for (let n = 0; n < 12; n += 1) await write(app, cookie, `Reflection ${String(n)}`);

  const first = (await (await list(app, cookie, '?pageSize=10')).json()) as {
    items: unknown[];
    total: number;
    page: number;
    pageCount: number;
  };
  expect(first.items).toHaveLength(10);
  expect(first).toMatchObject({ total: 12, page: 1, pageCount: 2 });

  /* A stale link or a narrowed filter lands on the last page, not on nothing. */
  const past = (await (await list(app, cookie, '?pageSize=10&page=9')).json()) as {
    page: number;
    items: unknown[];
  };
  expect(past.page).toBe(2);
  expect(past.items).toHaveLength(2);
});

test('a signed-out visitor has no list at all', async () => {
  const app = createApp(new SqliteStore());
  const body = (await (await app.request('/api/reflections')).json()) as {
    items: unknown[];
    total: number;
  };
  expect(body.items).toEqual([]);
  expect(body.total).toBe(0);
});
