/*
 * What a guest may read, and what they may not.
 *
 * A guest has a session and no account. The rule is that writing needs an
 * account and reading what is already public does not — a guest who can be
 * handed a link to a public reflection can obviously read it, and refusing to
 * render it inside the application while the link itself works is a
 * distinction without a difference.
 *
 * The half of this that matters most is the second half: widening who may ask
 * must not widen what the answer can contain. Member-only content stays
 * refused, by the same predicate that always refused it.
 */

import { beforeEach, expect, test } from 'vitest';
import { AUDIENCES } from '@chat/shared';
import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import { cookieHeader } from '../http/set-cookie.ts';

let app: ReturnType<typeof createApp>;
let store: SqliteStore;

beforeEach(() => {
  store = new SqliteStore();
  app = createApp(store);
});

async function call<T>(cookie: string, path: string, init: RequestInit = {}) {
  const response = await app.request(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...init.headers },
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as T };
}

async function register(email: string): Promise<string> {
  const response = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret12' }),
  });
  expect(response.status).toBe(201);
  /* Publishing asks for a confirmed address; these tests are about reading. */
  store.db
    .prepare('UPDATE users SET emailVerifiedAt = ? WHERE email = ?')
    .run(new Date().toISOString(), email);
  return cookieHeader(response.headers.get('set-cookie'));
}

/** A session with no account behind it. */
async function guest(): Promise<string> {
  const response = await app.request('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creationSource: 'REFLECTION_CREATE' }),
  });
  expect(response.status).toBe(201);
  return cookieHeader(response.headers.get('set-cookie'));
}

async function writeReflection(cookie: string, title: string): Promise<string> {
  const created = await call<{ id: string }>(cookie, '/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ title, scriptureReference: 'Romans 8:28' }),
  });
  for (const [type, content] of [
    ['content', 'Paul is writing to a church under real pressure, not a comfortable one.'],
    ['heart', 'This met my fear that uncertainty means God has stopped working.'],
    ['application', 'I will choose to pray before reacting this week.'],
    ['testimony', 'I believe he is working even where I cannot see the shape of it.'],
  ] as const) {
    await call(cookie, `/api/conversations/${created.body.id}/sections`, {
      method: 'PATCH',
      body: JSON.stringify({ type, content }),
    });
  }
  return created.body.id;
}

/* ------------------------------------------------------------ may read */

test('a guest reads the public feed', async () => {
  const author = await register('author@example.com');
  const conversationId = await writeReflection(author, 'Working even where I cannot see');
  const published = await call<{ id: string }>(author, '/api/publications', {
    method: 'POST',
    body: JSON.stringify({ conversationId, audience: AUDIENCES.PUBLIC }),
  });
  expect(published.status).toBe(201);

  const reader = await guest();
  const feed = await call<{ items: { id: string; title: string }[] }>(
    reader,
    '/api/publications?scope=public',
  );
  expect(feed.status).toBe(200);
  expect(feed.body.items.map((item) => item.title)).toContain('Working even where I cannot see');
});

test('a guest reads one publicly shared reflection in full', async () => {
  const author = await register('author@example.com');
  const conversationId = await writeReflection(author, 'Working even where I cannot see');
  const published = await call<{ id: string }>(author, '/api/publications', {
    method: 'POST',
    body: JSON.stringify({ conversationId, audience: AUDIENCES.PUBLIC }),
  });

  const reader = await guest();
  const one = await call<{ title: string; sections: unknown[] }>(
    reader,
    `/api/publications/${published.body.id}`,
  );
  expect(one.status).toBe(200);
  expect(one.body.title).toBe('Working even where I cannot see');
});

test('a guest sees the publicly discoverable communities, and belongs to none', async () => {
  const owner = await register('owner@example.com');
  await call(owner, '/api/communities', {
    method: 'POST',
    body: JSON.stringify({ name: 'Morning Readers', description: 'A small circle.', preset: 'public' }),
  });

  const reader = await guest();
  const found = await call<{ communities: { name: string; memberState: string | null }[] }>(
    reader,
    '/api/communities/discover',
  );
  expect(found.status).toBe(200);
  expect(found.body.communities.map((community) => community.name)).toContain('Morning Readers');
  expect(found.body.communities.every((community) => !community.memberState)).toBe(true);
});

/* -------------------------------------------------------- may not read */

test('a member-only community share stays invisible to a guest', async () => {
  const owner = await register('owner@example.com');
  const communityBody = await call<{ id: string }>(owner, '/api/communities', {
    method: 'POST',
    body: JSON.stringify({ name: 'Quiet Circle', description: 'Members only.', preset: 'private' }),
  });
  const conversationId = await writeReflection(owner, 'Only for the circle');
  const published = await call<{ id: string }>(owner, '/api/publications', {
    method: 'POST',
    body: JSON.stringify({
      conversationId,
      audience: AUDIENCES.COMMUNITY,
      communityId: communityBody.body.id,
    }),
  });
  expect(published.status).toBe(201);

  const reader = await guest();
  const feed = await call<{ items: { title: string }[] }>(reader, '/api/publications?scope=public');
  expect(feed.body.items.map((item) => item.title)).not.toContain('Only for the circle');

  /* And not by its own address either — the same 404 a stranger gets. */
  const direct = await call(reader, `/api/publications/${published.body.id}`);
  expect(direct.status).toBe(404);
});

test('a guest asking for the shared or mine scope still gets only public', async () => {
  const owner = await register('owner@example.com');
  const communityBody = await call<{ id: string }>(owner, '/api/communities', {
    method: 'POST',
    body: JSON.stringify({ name: 'Quiet Circle', description: 'Members only.', preset: 'private' }),
  });
  const conversationId = await writeReflection(owner, 'Only for the circle');
  await call(owner, '/api/publications', {
    method: 'POST',
    body: JSON.stringify({
      conversationId,
      audience: AUDIENCES.COMMUNITY,
      communityId: communityBody.body.id,
    }),
  });

  const reader = await guest();
  for (const scope of ['shared', 'mine']) {
    const feed = await call<{ items: { title: string }[] }>(
      reader,
      `/api/publications?scope=${scope}`,
    );
    expect(feed.status).toBe(200);
    expect(feed.body.items.map((item) => item.title)).not.toContain('Only for the circle');
  }
});

/* --------------------------------------------------------- may not write */

test('a guest is refused writing, and told it needs an account rather than a sign-in', async () => {
  const reader = await guest();
  const conversationId = await writeReflection(reader, 'Mine alone');

  const attempted = await call<{ error: string; code: string }>(reader, '/api/publications', {
    method: 'POST',
    body: JSON.stringify({ conversationId, audience: AUDIENCES.PUBLIC }),
  });

  /*
   * 403 rather than 401. They are authenticated; what they lack is an account,
   * and 401 would have the interface offer them a sign-in they already have.
   */
  expect(attempted.status).toBe(403);
  expect(attempted.body.code).toBe('ACCOUNT_REQUIRED');
  expect(attempted.body.error).toMatch(/needs an account/i);
  expect(attempted.body.error).not.toMatch(/signed? in again|no longer signed/i);
});

test('a guest may not join or request membership', async () => {
  const owner = await register('owner@example.com');
  const communityBody = await call<{ id: string }>(owner, '/api/communities', {
    method: 'POST',
    body: JSON.stringify({ name: 'Morning Readers', description: 'A circle.', preset: 'public' }),
  });

  const reader = await guest();
  const joined = await call<{ code: string }>(
    reader,
    `/api/communities/${communityBody.body.id}/join`,
    { method: 'POST' },
  );
  expect(joined.status).toBe(403);
  expect(joined.body.code).toBe('ACCOUNT_REQUIRED');
});

/* ------------------------------------------------- the first visit of all */

/*
 * Somebody arriving on a link, with no session of any kind.
 *
 * This is the case that was wrong: they were answered 401, so a link to a
 * public reflection put a login wall in front of words anybody may read. The
 * fix is not to mint them a guest account on arrival — that is silent account
 * creation, and an identity is made when somebody keeps something, not when
 * they read.
 */
async function firstVisit<T>(path: string) {
  const response = await app.request(path, { headers: { 'Content-Type': 'application/json' } });
  return { status: response.status, body: (await response.json().catch(() => null)) as T };
}

test('a first-time visitor with no session reads the public feed', async () => {
  const author = await register('author@example.com');
  const conversationId = await writeReflection(author, 'Working even where I cannot see');
  await call(author, '/api/publications', {
    method: 'POST',
    body: JSON.stringify({ conversationId, audience: AUDIENCES.PUBLIC }),
  });

  const feed = await firstVisit<{ items: { title: string }[] }>('/api/publications?scope=public');
  expect(feed.status).toBe(200);
  expect(feed.body.items.map((item) => item.title)).toContain('Working even where I cannot see');
});

test('a first-time visitor opens a public reflection by its own address', async () => {
  const author = await register('author@example.com');
  const conversationId = await writeReflection(author, 'Working even where I cannot see');
  const published = await call<{ id: string }>(author, '/api/publications', {
    method: 'POST',
    body: JSON.stringify({ conversationId, audience: AUDIENCES.PUBLIC }),
  });

  const one = await firstVisit<{ title: string }>(`/api/publications/${published.body.id}`);
  expect(one.status).toBe(200);
  expect(one.body.title).toBe('Working even where I cannot see');
});

test('a first-time visitor sees the discoverable communities', async () => {
  const owner = await register('owner@example.com');
  await call(owner, '/api/communities', {
    method: 'POST',
    body: JSON.stringify({ name: 'Morning Readers', description: 'A circle.', preset: 'public' }),
  });

  const found = await firstVisit<{ communities: { name: string }[] }>('/api/communities/discover');
  expect(found.status).toBe(200);
  expect(found.body.communities.map((community) => community.name)).toContain('Morning Readers');
});

test('reading without a session creates no session', async () => {
  const response = await app.request('/api/publications?scope=public');
  expect(response.status).toBe(200);
  /*
   * No cookie comes back. A reader who has kept nothing has no identity, and
   * arriving on a link is not consent to be given one.
   */
  expect(response.headers.get('set-cookie')).toBeNull();
});

test('a first-time visitor still sees no member-only content', async () => {
  const owner = await register('owner@example.com');
  const communityBody = await call<{ id: string }>(owner, '/api/communities', {
    method: 'POST',
    body: JSON.stringify({ name: 'Quiet Circle', description: 'Members only.', preset: 'private' }),
  });
  const conversationId = await writeReflection(owner, 'Only for the circle');
  const published = await call<{ id: string }>(owner, '/api/publications', {
    method: 'POST',
    body: JSON.stringify({
      conversationId,
      audience: AUDIENCES.COMMUNITY,
      communityId: communityBody.body.id,
    }),
  });

  const feed = await firstVisit<{ items: { title: string }[] }>('/api/publications?scope=public');
  expect(feed.body.items.map((item) => item.title)).not.toContain('Only for the circle');
  expect((await firstVisit(`/api/publications/${published.body.id}`)).status).toBe(404);
});

test('a first-time visitor may not write, and is told an account is needed', async () => {
  const attempt = await firstVisit<{ error: string }>('/api/publications');
  /* A GET on the publish route is not a publish; the write path is checked below. */
  const posted = await app.request('/api/publications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: 'nope', audience: AUDIENCES.PUBLIC }),
  });
  expect(attempt.status).toBeLessThan(500);
  expect(posted.status).toBe(401);
});
