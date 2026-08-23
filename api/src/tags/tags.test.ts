/*
 * Tags over HTTP, asserted on the payloads a request actually returns.
 *
 * The registry's own behaviour is covered in `registry.test.ts`. What is here
 * is the part a client can reach: that the server's limit is the server's, that
 * a refused tag does not cost a save, and that nothing a browser sends can put
 * a word into the dictionary without passing the gate.
 */

import { beforeEach, describe, expect, test } from 'vitest';
import { TAG_SUGGEST_LIMIT, TAG_REFUSED_MESSAGE } from '@chat/shared';
import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import { cookieHeader } from '../http/set-cookie.ts';

type App = ReturnType<typeof createApp>;

let app: App;

beforeEach(() => {
  app = createApp(new SqliteStore());
});

async function register(email: string): Promise<string> {
  const response = await app.request('/api/auth/register', {
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
): Promise<{ status: number; body: T }> {
  const response = await app.request(path, {
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

/**
 * A complete Full C.H.A.T., which is what the share gate asks for.
 *
 * Sharing an empty reflection answers 422, and a test that shared one would
 * assert about a request that never reached the registry at all.
 */
async function writeReflection(cookie: string): Promise<string> {
  const created = await call<{ id: string }>(cookie, '/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ title: 'Working in all things', scriptureReference: 'Romans 8:28' }),
  });
  expect(created.status).toBe(201);
  for (const [type, content] of [
    ['content', 'Paul is writing to a church under real pressure, not a comfortable one.'],
    ['heart', 'This met my fear that uncertainty means God has stopped working.'],
    ['application', 'I will choose to pray before reacting this week.'],
    ['testimony', 'He kept me through a year I could not see the shape of.'],
  ] as const) {
    const patched = await call(cookie, `/api/conversations/${created.body.id}/sections`, {
      method: 'PATCH',
      body: JSON.stringify({ type, content }),
    });
    expect(patched.status).toBe(200);
  }
  return created.body.id;
}

/** Share it, and refuse to continue if the gate turned it down. */
async function share(cookie: string, id: string) {
  const shared = await call(cookie, `/api/conversations/${id}/share`, { method: 'POST' });
  expect(shared.status).toBe(200);
}

/** Make a reflection and put tags on it, the way the editor does. */
async function tagReflection(cookie: string, tags: string[]) {
  const id = await writeReflection(cookie);
  const patched = await call<{ tags: { tag: string }[]; refusedTags?: unknown[]; tagError?: string }>(
    cookie,
    `/api/conversations/${id}`,
    { method: 'PATCH', body: JSON.stringify({ tags }) },
  );
  return { id, ...patched };
}

type Suggestions = { suggestions: { tag: string; label: string }[] };

describe('GET /api/tags/suggest', () => {
  test('suggests a tag this person has used', async () => {
    const cookie = await register('ada@example.com');
    await tagReflection(cookie, ['prayer']);
    const found = await call<Suggestions>(cookie, '/api/tags/suggest?q=pray');
    expect(found.status).toBe(200);
    expect(found.body.suggestions.map((s) => s.tag)).toEqual(['prayer']);
  });

  test('the query is folded the same way a tag is', async () => {
    const cookie = await register('ada@example.com');
    await tagReflection(cookie, ['prayer']);
    for (const q of ['PRAY', '%23pray', '+pray+']) {
      const found = await call<Suggestions>(cookie, `/api/tags/suggest?q=${q}`);
      expect(found.body.suggestions.map((s) => s.tag), q).toEqual(['prayer']);
    }
  });

  test('the maximum is the server’s, not the client’s', async () => {
    const cookie = await register('ada@example.com');
    await tagReflection(cookie, [
      'pray',
      'prayer',
      'prayerlife',
      'praying',
      'prayerrequest',
      'praise',
    ]);
    const found = await call<Suggestions>(cookie, '/api/tags/suggest?q=pra&limit=500');
    expect(found.body.suggestions).toHaveLength(TAG_SUGGEST_LIMIT);
  });

  test('a nonsense limit does not become a huge one', async () => {
    const cookie = await register('ada@example.com');
    await tagReflection(cookie, ['pray', 'prayer', 'prayerlife', 'praying', 'prayerrequest']);
    const found = await call<Suggestions>(cookie, '/api/tags/suggest?q=pra&limit=abc');
    expect(found.body.suggestions.length).toBeLessThanOrEqual(TAG_SUGGEST_LIMIT);
  });

  test('an empty query returns nothing rather than the dictionary', async () => {
    const cookie = await register('ada@example.com');
    await tagReflection(cookie, ['prayer']);
    const found = await call<Suggestions>(cookie, '/api/tags/suggest?q=');
    expect(found.body.suggestions).toEqual([]);
  });

  test('a visitor with no account may still be suggested published tags', async () => {
    const cookie = await register('ada@example.com');
    const made = await tagReflection(cookie, ['prayer']);
    await share(cookie, made.id);
    const found = await call<Suggestions>(null, '/api/tags/suggest?q=pray');
    expect(found.status).toBe(200);
    expect(found.body.suggestions.map((s) => s.tag)).toEqual(['prayer']);
  });

  /*
   * The rule that gives this feature two counts. A private reflection's
   * vocabulary is the author's; offering it to a stranger publishes it slowly.
   */
  test('another person’s private tag is not offered to anybody', async () => {
    const ada = await register('ada@example.com');
    await tagReflection(ada, ['miscarriage']);
    const gus = await register('gus@example.com');
    const found = await call<Suggestions>(gus, '/api/tags/suggest?q=mis');
    expect(found.body.suggestions).toEqual([]);
    const anonymous = await call<Suggestions>(null, '/api/tags/suggest?q=mis');
    expect(anonymous.body.suggestions).toEqual([]);
  });

  test('sharing a reflection gives its tags standing with everybody', async () => {
    const ada = await register('ada@example.com');
    const made = await tagReflection(ada, ['lectio-divina']);
    const gus = await register('gus@example.com');
    expect((await call<Suggestions>(gus, '/api/tags/suggest?q=lectio')).body.suggestions).toEqual([]);
    await share(ada, made.id);
    expect(
      (await call<Suggestions>(gus, '/api/tags/suggest?q=lectio')).body.suggestions.map((s) => s.tag),
    ).toEqual(['lectiodivina']);
  });

  test('a suggestion carries no counts', async () => {
    const cookie = await register('ada@example.com');
    await tagReflection(cookie, ['prayer']);
    const found = await call<Suggestions>(cookie, '/api/tags/suggest?q=pray');
    expect(Object.keys(found.body.suggestions[0] ?? {}).sort()).toEqual(['label', 'tag']);
  });
});

describe('saving tags', () => {
  test('a refused tag is dropped, the others are kept, and the save succeeds', async () => {
    const cookie = await register('ada@example.com');
    const saved = await tagReflection(cookie, ['prayer', '#shit', 'fasting']);
    expect(saved.status).toBe(200);
    expect(saved.body.tags.map((t) => t.tag)).toEqual(['prayer', 'fasting']);
    expect(saved.body.refusedTags).toHaveLength(1);
    expect(saved.body.tagError).toBe(TAG_REFUSED_MESSAGE);
  });

  test('nothing refused means nothing said about it', async () => {
    const cookie = await register('ada@example.com');
    const saved = await tagReflection(cookie, ['prayer']);
    expect(saved.body.refusedTags).toBeUndefined();
    expect(saved.body.tagError).toBeUndefined();
  });

  /*
   * The message is the same sentence for every reason on purpose. One that
   * distinguished "too short" from "not allowed" would let anybody map the
   * word list a few attempts at a time.
   */
  test('the message never says which rule refused it', async () => {
    const cookie = await register('ada@example.com');
    const saved = await tagReflection(cookie, ['#shit']);
    expect(saved.body.tagError).toBe(TAG_REFUSED_MESSAGE);
    expect(JSON.stringify(saved.body)).not.toMatch(/shit.*list|banned|profan/i);
  });

  test('a refused tag never becomes a suggestion for anybody', async () => {
    const cookie = await register('ada@example.com');
    const made = await tagReflection(cookie, ['#shit']);
    await share(cookie, made.id);
    expect((await call<Suggestions>(cookie, '/api/tags/suggest?q=sh')).body.suggestions).toEqual([]);
    expect((await call<Suggestions>(null, '/api/tags/suggest?q=sh')).body.suggestions).toEqual([]);
  });
});
