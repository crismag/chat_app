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
import { DEFAULT_PREFERENCES } from '@chat/shared';
import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import { MemoryStore } from '../store.ts';
import { cookieHeader } from '../http/set-cookie.ts';

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
  return cookieHeader(response.headers.get('set-cookie'));
}

function send(app: App, path: string, cookie: string, method = 'GET', body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/*
 * The smallest byte strings that are genuinely the formats they claim. These
 * are magic numbers plus filler, not decodable images, which is exactly what
 * the route checks — it validates the header, never the pixels.
 */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

function putAvatar(app: App, cookie: string, bytes: Uint8Array, contentType: string) {
  return app.request('/api/profiles/me/avatar', {
    method: 'PUT',
    headers: { 'Content-Type': contentType, Cookie: cookie },
    body: bytes,
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

  describe(`reading a public profile without an account (${backing.name})`, () => {
    async function published(app: App) {
      const author = await register(app, 'ada@example.com');
      await send(app, '/api/profiles/me', author, 'PATCH', {
        handle: 'ada',
        displayName: 'Ada Lovelace',
        tagline: 'Writing slowly, on purpose.',
      });
      await writeReflection(app, author, {
        title: 'Trusting while I cannot see',
        reference: 'Romans 8:28',
        text: 'This passage met my fear.',
        publish: true,
      });
      return author;
    }

    test('a guest may read a public profile, because it is public', async () => {
      const app = createApp(backing.make());
      await published(app);

      const guest = await app.request('/api/auth/guest', { method: 'POST' });
      expect(guest.status).toBe(201);
      const cookie = cookieHeader(guest.headers.get('set-cookie'));

      const seen = await send(app, '/api/profiles/ada', cookie);
      expect(seen.status).toBe(200);
      const view = (await seen.json()) as {
        displayName: string
        shares: unknown[]
        isOwner: boolean
      };
      expect(view.displayName).toBe('Ada Lovelace');
      expect(view.shares).toHaveLength(1);
      /* A guest is not the owner of somebody else's profile. */
      expect(view.isOwner).toBe(false);
    });

    test('a session is still required, so a profile is not open to be scraped', async () => {
      const app = createApp(backing.make());
      await published(app);

      /*
       * A guest has a session and is inside the product. Something with no
       * session at all is not, and a directory of names and handles should not
       * be readable by anything that can make a request.
       */
      expect((await app.request('/api/profiles/ada')).status).toBe(401);
    });

    test('reading one still grants nothing: no account, no writing', async () => {
      const app = createApp(backing.make());
      await published(app);

      /* Reading is open; every door off it is not. */
      const guest = await app.request('/api/auth/guest', { method: 'POST' });
      const cookie = cookieHeader(guest.headers.get('set-cookie'));

      expect((await send(app, '/api/profiles/me', cookie)).status).toBe(401);
      expect(
        (await send(app, '/api/profiles/ada/report', cookie, 'POST', { reason: 'spam' })).status,
      ).toBe(401);
      expect((await send(app, '/api/profiles/ada/block', cookie, 'POST')).status).toBe(401);
    });

    test('a private field is absent whoever is reading', async () => {
      const app = createApp(backing.make());
      await published(app);

      const guest = await app.request('/api/auth/guest', { method: 'POST' });
      const cookie = cookieHeader(guest.headers.get('set-cookie'));
      const view = (await (await send(app, '/api/profiles/ada', cookie)).json()) as Record<
        string,
        unknown
      >;
      expect(view['email']).toBeUndefined();
      expect(view['userId']).toBeUndefined();
    });
  });

  describe(`profile editing (${backing.name})`, () => {
    test('a profile says which month it was made, and not which day', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'member@example.com');
      const mine = await send(app, '/api/profiles/me', cookie);
      const body = (await mine.json()) as { memberSince: string | null };

      /*
       * To the month. The exact day somebody joined is a fact about them that
       * nothing here needs, and precise dates are one of the things that make
       * a person identifiable across sites.
       */
      expect(body.memberSince).toMatch(/^\d{4}-\d{2}$/);
    });

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

  describe(`handle availability (${backing.name})`, () => {
    const check = (app: App, cookie: string, handle: string) =>
      send(app, `/api/profiles/me/handle-available?handle=${encodeURIComponent(handle)}`, cookie);

    test('a free handle is free', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');

      const answer = (await (await check(app, cookie, 'quietcedar')).json()) as {
        available: boolean
        problem: string | null
      };
      expect(answer).toEqual({ handle: 'quietcedar', available: true, problem: null });
    });

    test('somebody else\'s handle is not, and says so the way saving would', async () => {
      const app = createApp(backing.make());
      const ada = await register(app, 'ada@example.com');
      await send(app, '/api/profiles/me', ada, 'PATCH', {
        handle: 'taken',
        displayName: 'Ada Lovelace',
      });

      const bob = await register(app, 'bob@example.com');
      const answer = (await (await check(app, bob, 'taken')).json()) as { available: boolean };
      expect(answer.available).toBe(false);

      /* The same refusal the PATCH gives, so the two can never disagree. */
      const refused = await send(app, '/api/profiles/me', bob, 'PATCH', {
        handle: 'taken',
        displayName: 'Bob',
      });
      expect(refused.status).toBe(409);
    });

    test('a person may keep the handle they already have', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');
      const mine = (await (await send(app, '/api/profiles/me', cookie)).json()) as {
        handle: string
      };

      const answer = (await (await check(app, cookie, mine.handle)).json()) as {
        available: boolean
      };
      expect(answer.available).toBe(true);
    });

    test('@Cris and @cris are the same person, so one blocks the other', async () => {
      const app = createApp(backing.make());
      const ada = await register(app, 'ada@example.com');
      await send(app, '/api/profiles/me', ada, 'PATCH', { handle: 'cris', displayName: 'Cris' });

      const bob = await register(app, 'bob@example.com');
      const answer = (await (await check(app, bob, '@CRIS')).json()) as { available: boolean };
      expect(answer.available).toBe(false);
    });

    test('a malformed or reserved handle is refused with its reason', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');

      const tooShort = (await (await check(app, cookie, 'ab')).json()) as { problem: string };
      expect(tooShort.problem).toMatch(/between/);

      const punctuation = (await (await check(app, cookie, 'not a handle!')).json()) as {
        problem: string
      };
      expect(punctuation.problem).toMatch(/lowercase letters/);
    });

    test('a signed-out visitor cannot use this to enumerate handles', async () => {
      const app = createApp(backing.make());
      const refused = await app.request('/api/profiles/me/handle-available?handle=cris');
      expect(refused.status).toBe(401);
    });
  });

  describe(`settings (${backing.name})`, () => {
    test('somebody who has chosen nothing has the defaults', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');

      const read = await send(app, '/api/profiles/me/preferences', cookie);
      expect(read.status).toBe(200);
      expect((await read.json()) as unknown).toEqual({
        preferences: {
          theme: DEFAULT_PREFERENCES.theme,
          bibleTranslationId: null,
          defaultChatFormat: 'full',
        },
      });
    });

    test('a change keeps everything it did not mention', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');

      await send(app, '/api/profiles/me/preferences', cookie, 'PATCH', {
        theme: 'techno',
        bibleTranslationId: 111,
      });
      const after = await send(app, '/api/profiles/me/preferences', cookie, 'PATCH', {
        defaultChatFormat: 'condensed',
      });

      expect(((await after.json()) as { preferences: unknown }).preferences).toEqual({
        theme: 'techno',
        bibleTranslationId: 111,
        defaultChatFormat: 'condensed',
      });
    });

    test('a value this release does not have falls back instead of failing', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');

      const saved = await send(app, '/api/profiles/me/preferences', cookie, 'PATCH', {
        theme: 'neon-1998',
        defaultChatFormat: 'epic',
      });

      expect(saved.status).toBe(200);
      /* The default appearance, whichever it currently is. */
      expect(((await saved.json()) as { preferences: { theme: string } }).preferences.theme).toBe(
        DEFAULT_PREFERENCES.theme,
      );
    });

    test('settings survive the round trip, because they belong to the person', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');
      await send(app, '/api/profiles/me/preferences', cookie, 'PATCH', { theme: 'zen' });

      const read = await send(app, '/api/profiles/me/preferences', cookie);
      expect(((await read.json()) as { preferences: { theme: string } }).preferences.theme).toBe(
        'zen',
      );
    });

    test('one person cannot read or write another person\'s settings', async () => {
      const app = createApp(backing.make());
      const ada = await register(app, 'ada@example.com');
      await send(app, '/api/profiles/me/preferences', ada, 'PATCH', { theme: 'retro' });

      const bob = await register(app, 'bob@example.com');
      const theirs = await send(app, '/api/profiles/me/preferences', bob);
      expect(((await theirs.json()) as { preferences: { theme: string } }).preferences.theme).toBe(
        DEFAULT_PREFERENCES.theme,
      );
    });

    test('a signed-out visitor has no settings to read', async () => {
      const app = createApp(backing.make());
      const refused = await app.request('/api/profiles/me/preferences');
      expect(refused.status).toBe(401);
    });
  });

  describe(`profile picture (${backing.name})`, () => {
    test('a picture becomes a stamped URL the profile hands out', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');

      const before = await send(app, '/api/profiles/me', cookie);
      expect(((await before.json()) as { avatarUrl: string | null }).avatarUrl).toBeNull();

      const uploaded = await putAvatar(app, cookie, PNG_BYTES, 'image/png');
      expect(uploaded.status).toBe(200);
      const { avatarUrl, handle } = (await uploaded.json()) as {
        avatarUrl: string
        handle: string
      };
      expect(avatarUrl).toContain(`/api/profiles/${handle}/avatar`);
      expect(avatarUrl).toMatch(/\?v=/);

      const served = await app.request(avatarUrl);
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toBe('image/png');
      expect(served.headers.get('x-content-type-options')).toBe('nosniff');
      expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG_BYTES);
    });

    test('replacing a picture changes the URL, so a cached one cannot linger', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');

      const first = (await (await putAvatar(app, cookie, PNG_BYTES, 'image/png')).json()) as {
        avatarUrl: string
      };
      await new Promise((resolve) => setTimeout(resolve, 2));
      const second = (await (await putAvatar(app, cookie, JPEG_BYTES, 'image/jpeg')).json()) as {
        avatarUrl: string
      };

      expect(second.avatarUrl).not.toBe(first.avatarUrl);
      const served = await app.request(second.avatarUrl);
      expect(served.headers.get('content-type')).toBe('image/jpeg');
    });

    test('a stranger sees the picture, because a public profile has a face', async () => {
      const app = createApp(backing.make());
      const owner = await register(app, 'ada@example.com');
      await putAvatar(app, owner, PNG_BYTES, 'image/png');
      const { handle } = (await (await send(app, '/api/profiles/me', owner)).json()) as {
        handle: string
      };

      const stranger = await register(app, 'bob@example.com');
      const seen = await send(app, `/api/profiles/${handle}`, stranger);
      const view = (await seen.json()) as { avatarUrl: string | null };
      expect(view.avatarUrl).toContain('/avatar');
      expect((await app.request(view.avatarUrl as string)).status).toBe(200);
    });

    test('removing a picture returns the person to a generated face', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');
      const { avatarUrl } = (await (await putAvatar(app, cookie, PNG_BYTES, 'image/png')).json()) as {
        avatarUrl: string
      };

      const removed = await send(app, '/api/profiles/me/avatar', cookie, 'DELETE');
      expect(removed.status).toBe(200);
      expect(((await removed.json()) as { avatarUrl: string | null }).avatarUrl).toBeNull();
      expect((await app.request(avatarUrl)).status).toBe(404);
    });

    test('an SVG is refused, because it is a document that can carry script', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');
      const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

      const refused = await putAvatar(app, cookie, svg, 'image/svg+xml');
      expect(refused.status).toBe(415);
    });

    test('bytes that disagree with the declared type are refused', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');
      const script = new TextEncoder().encode('<script>alert(1)</script>');

      /* Declared PNG so the allowlist passes; the magic number is what stops it. */
      const refused = await putAvatar(app, cookie, script, 'image/png');
      expect(refused.status).toBe(400);
      expect((await send(app, '/api/profiles/me', cookie)).status).toBe(200);
      const view = (await (await send(app, '/api/profiles/me', cookie)).json()) as {
        avatarUrl: string | null
      };
      expect(view.avatarUrl).toBeNull();
    });

    test('an oversized picture is refused before it is stored', async () => {
      const app = createApp(backing.make());
      const cookie = await register(app, 'ada@example.com');
      const huge = new Uint8Array(600 * 1024);
      huge.set(PNG_BYTES);

      const refused = await putAvatar(app, cookie, huge, 'image/png');
      expect(refused.status).toBe(413);
    });

    test('a signed-out visitor cannot set a picture on anybody', async () => {
      const app = createApp(backing.make());
      const refused = await putAvatar(app, '', PNG_BYTES, 'image/png');
      expect(refused.status).toBe(401);
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
