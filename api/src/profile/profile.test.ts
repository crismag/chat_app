/*
 * Profile tests.
 *
 * The one that matters most is `never lists a private reflection`, and it
 * asserts on the **API payload** rather than on anything rendered. A rendering
 * test would pass just as happily against a server that sent every reflection
 * and a component that hid the private ones — which is the exact failure the
 * search-authorisation rule exists to forbid. So the assertion is on the JSON:
 * the private title, its Scripture reference, its section text and its id must
 * not appear anywhere in the serialised response, and the public count must not
 * reveal it either.
 *
 * Both store backings are exercised, because the whole point of having two is
 * that they must agree about who may see what.
 */

import { describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import { MemoryStore } from '../store.ts';

type App = ReturnType<typeof createApp>;

const backings = [
  { name: 'sqlite', make: () => new SqliteStore() },
  { name: 'memory', make: () => new MemoryStore() },
] as const;

async function register(app: App, email: string) {
  const response = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret12' }),
  });
  expect(response.status).toBe(201);
  return response.headers.get('set-cookie') ?? '';
}

function send(app: App, path: string, cookie: string, method = 'GET', body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** A reflection with one written section, optionally published. */
async function writeReflection(
  app: App,
  cookie: string,
  {
    title,
    reference,
    text,
    publish,
  }: { title: string; reference: string; text: string; publish: boolean },
) {
  const created = await send(app, '/api/conversations', cookie, 'POST', {
    title,
    scriptureReference: reference,
  });
  const { id } = (await created.json()) as { id: string };

  for (const type of ['content', 'heart', 'application', 'testimony']) {
    const written = await send(app, `/api/conversations/${id}/sections`, cookie, 'PATCH', {
      type,
      content: text,
    });
    expect(written.status).toBe(200);
  }

  if (publish) {
    const published = await send(app, `/api/conversations/${id}/share`, cookie, 'POST');
    expect(published.status).toBe(200);
  }
  return id;
}

for (const backing of backings) {
  describe(`public profile (${backing.name})`, () => {
    test('is provisioned on first read, with the limits attached', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');

      const response = await send(app, '/api/profiles/me', cookie);
      expect(response.status).toBe(200);
      const profile = (await response.json()) as Record<string, unknown>;

      expect(profile['handle']).toBe('ada');
      expect(profile['displayName']).toBe('Ada');
      expect(profile['publicChatCount']).toBe(0);
      expect(profile['limits']).toMatchObject({ displayName: 50, tagline: 160 });
      // Nothing about the account itself travels with the profile.
      expect(JSON.stringify(profile)).not.toContain('ada@example.com');
    });

    test('never lists a private reflection, in the payload itself', async () => {
      const app = createApp(backing.make());
      const author = await register(app, 'author@example.com');
      const stranger = await register(app, 'stranger@example.com');
      await send(app, '/api/profiles/me', author);

      await writeReflection(app, author, {
        title: 'Trusting while I cannot see',
        reference: 'Romans 8:28',
        text: 'This passage met my fear that uncertainty means God has stopped working.',
        publish: true,
      });
      const privateId = await writeReflection(app, author, {
        title: 'SECRET-CONFESSION-TITLE',
        reference: 'Psalm 51:1',
        text: 'SECRET-CONFESSION-BODY that no stranger may ever read.',
        publish: false,
      });

      const response = await send(app, '/api/profiles/author', stranger);
      expect(response.status).toBe(200);
      const body = await response.json();
      const serialised = JSON.stringify(body);

      /* The private reflection must not appear through any channel at all. */
      expect(serialised).not.toContain('SECRET-CONFESSION-TITLE');
      expect(serialised).not.toContain('SECRET-CONFESSION-BODY');
      expect(serialised).not.toContain('Psalm 51:1');
      expect(serialised).not.toContain(privateId);

      const payload = body as { shares: { title: string }[]; publicChatCount: number };
      expect(payload.shares).toHaveLength(1);
      expect(payload.shares[0]?.title).toBe('Trusting while I cannot see');
      /* And the count must not say "and one more you may not see". */
      expect(payload.publicChatCount).toBe(1);
    });

    test('unpublishing removes a reflection from the profile immediately', async () => {
      const app = createApp(backing.make());
      const author = await register(app, 'author@example.com');
      const stranger = await register(app, 'stranger@example.com');
      await send(app, '/api/profiles/me', author);

      const id = await writeReflection(app, author, {
        title: 'Shared for now',
        reference: 'John 15:5',
        text: 'Abiding is not a technique.',
        publish: true,
      });

      await send(app, `/api/conversations/${id}/make-private`, author, 'POST');

      const response = await send(app, '/api/profiles/author', stranger);
      const body = (await response.json()) as { shares: unknown[]; publicChatCount: number };
      expect(body.shares).toHaveLength(0);
      expect(body.publicChatCount).toBe(0);
      expect(JSON.stringify(body)).not.toContain('Shared for now');
    });

    test('a share carries which sections were written, and one excerpt', async () => {
      const app = createApp(backing.make());
      const author = await register(app, 'author@example.com');
      await send(app, '/api/profiles/me', author);
      await writeReflection(app, author, {
        title: 'Held',
        reference: 'Psalm 46:10',
        text: 'Be still is an instruction, not a mood.',
        publish: true,
      });

      const response = await send(app, '/api/profiles/author', author);
      const body = (await response.json()) as {
        isOwner: boolean;
        shares: { sections: string[]; excerpt: string }[];
      };
      expect(body.isOwner).toBe(true);
      expect(body.shares[0]?.sections).toEqual(['content', 'heart', 'application', 'testimony']);
      expect(body.shares[0]?.excerpt).toContain('Be still');
    });

    test('an unknown handle is a plain 404', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');
      const response = await send(app, '/api/profiles/nobody-here', cookie);
      expect(response.status).toBe(404);
    });

    test('a profile is not readable without a session', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');
      await send(app, '/api/profiles/me', cookie);
      const response = await app.request('/api/profiles/ada');
      expect(response.status).toBe(401);
    });
  });

  describe(`profile editing (${backing.name})`, () => {
    test('accepts an edit within the limits', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');

      const response = await send(app, '/api/profiles/me', cookie, 'PATCH', {
        handle: 'ada-lovelace',
        displayName: 'Ada Lovelace',
        tagline: 'Reading slowly, on purpose.',
        favouriteVerses: ['Romans 8:28', 'Psalm 46:10'],
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body['handle']).toBe('ada-lovelace');
      expect(body['favouriteVerses']).toEqual(['Romans 8:28', 'Psalm 46:10']);

      const reread = await send(app, '/api/profiles/ada-lovelace', cookie);
      expect(reread.status).toBe(200);
    });

    test('refuses a taken handle with a sentence, not a constraint error', async () => {
      const app = createApp(backing.make());
      const first = await register(app, 'ada@example.com');
      const second = await register(app, 'grace@example.com');
      await send(app, '/api/profiles/me', first);
      await send(app, '/api/profiles/me', second);

      const response = await send(app, '/api/profiles/me', second, 'PATCH', { handle: 'ada' });
      expect(response.status).toBe(409);
      const body = (await response.json()) as { error: string; field: string };
      expect(body.field).toBe('handle');
      expect(body.error).toContain('@ada');
      expect(body.error).toMatch(/already taken/i);
    });

    test('folds handle case, so @Ada cannot shadow @ada', async () => {
      const app = createApp(backing.make());
      const first = await register(app, 'ada@example.com');
      const second = await register(app, 'grace@example.com');
      await send(app, '/api/profiles/me', first);
      await send(app, '/api/profiles/me', second);

      const response = await send(app, '/api/profiles/me', second, 'PATCH', { handle: '@ADA' });
      expect(response.status).toBe(409);
    });

    test.each([
      ['displayName', { displayName: 'x'.repeat(51) }, 400],
      ['displayName empty', { displayName: '   ' }, 400],
      ['tagline', { tagline: 'x'.repeat(161) }, 400],
      ['favouriteVerses', { favouriteVerses: ['a', 'b', 'c', 'd'] }, 400],
      ['handle too short', { handle: 'ab' }, 400],
      ['handle too long', { handle: 'a'.repeat(31) }, 400],
      ['handle punctuation', { handle: 'not a handle!' }, 400],
      ['handle reserved', { handle: 'me' }, 400],
    ])('refuses %s', async (_name, patch, status) => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');
      const response = await send(app, '/api/profiles/me', cookie, 'PATCH', patch);
      expect(response.status).toBe(status);
    });

    test('limits are enforced on the server even when the client does not', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');
      await send(app, '/api/profiles/me', cookie, 'PATCH', {
        favouriteVerses: ['Romans 8:28', '', '  ', 'Psalm 46:10'],
      });
      const body = (await (await send(app, '/api/profiles/me', cookie)).json()) as {
        favouriteVerses: string[];
      };
      expect(body.favouriteVerses).toEqual(['Romans 8:28', 'Psalm 46:10']);
    });
  });

  describe(`report and block (${backing.name})`, () => {
    test('a report is recorded and removes nothing', async () => {
      const app = createApp(backing.make());
      const author = await register(app, 'author@example.com');
      const reporter = await register(app, 'reporter@example.com');
      await send(app, '/api/profiles/me', author);
      await writeReflection(app, author, {
        title: 'Still here',
        reference: 'John 1:1',
        text: 'In the beginning.',
        publish: true,
      });

      const reported = await send(app, '/api/profiles/author/report', reporter, 'POST', {
        reason: 'harassment',
        detail: 'The tagline is abusive.',
      });
      expect(reported.status).toBe(201);

      const stranger = await register(app, 'stranger@example.com');
      const view = (await (await send(app, '/api/profiles/author', stranger)).json()) as {
        shares: unknown[];
      };
      expect(view.shares).toHaveLength(1);
    });

    test('a report needs a reason from the offered list', async () => {
      const app = createApp(backing.make());
      const author = await register(app, 'author@example.com');
      const reporter = await register(app, 'reporter@example.com');
      await send(app, '/api/profiles/me', author);

      const response = await send(app, '/api/profiles/author/report', reporter, 'POST', {
        reason: 'because-i-disagree',
      });
      expect(response.status).toBe(400);
    });

    test('blocking hides the blocked profile from the blocker alone', async () => {
      const app = createApp(backing.make());
      const author = await register(app, 'author@example.com');
      const blocker = await register(app, 'blocker@example.com');
      const other = await register(app, 'other@example.com');
      await send(app, '/api/profiles/me', author);
      await writeReflection(app, author, {
        title: 'A reflection worth reading',
        reference: 'James 1:5',
        text: 'Ask for wisdom.',
        publish: true,
      });

      await send(app, '/api/profiles/author/block', blocker, 'POST');

      const blocked = (await (await send(app, '/api/profiles/author', blocker)).json()) as {
        blocked: boolean;
        shares: unknown[];
        publicChatCount: number | null;
      };
      expect(blocked.blocked).toBe(true);
      expect(blocked.shares).toHaveLength(0);
      /* Not zero — null. A count of 0 would be a claim, and a false one. */
      expect(blocked.publicChatCount).toBeNull();

      const unaffected = (await (await send(app, '/api/profiles/author', other)).json()) as {
        shares: unknown[];
      };
      expect(unaffected.shares).toHaveLength(1);

      await send(app, '/api/profiles/author/block', blocker, 'DELETE');
      const restored = (await (await send(app, '/api/profiles/author', blocker)).json()) as {
        blocked: boolean;
        shares: unknown[];
      };
      expect(restored.blocked).toBe(false);
      expect(restored.shares).toHaveLength(1);
    });

    test('a person cannot block or report themselves', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');
      await send(app, '/api/profiles/me', cookie);

      expect((await send(app, '/api/profiles/ada/block', cookie, 'POST')).status).toBe(400);
      expect(
        (await send(app, '/api/profiles/ada/report', cookie, 'POST', { reason: 'spam' })).status,
      ).toBe(400);
    });
  });
}
