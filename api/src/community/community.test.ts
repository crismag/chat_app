/*
 * Community authorisation, asserted on API payloads.
 *
 * Every claim in here is made against the JSON a request actually returns —
 * never against a store method, a helper or a rendered component. That is the
 * point: the rules that fail quietly fail in the payload, and a test that
 * inspects the store can pass while the route serialises something the store
 * never intended.
 *
 * The suite runs against `SqliteStore(':memory:')` rather than `MemoryStore`,
 * because the community module has one implementation — over SQL — and testing
 * a second, more forgiving one would be testing the wrong thing. See the header
 * of `store.ts`.
 */

import { beforeEach, describe, expect, test } from 'vitest';
import { AUDIENCES, MEMBERSHIP_STATES } from '@chat/shared';
import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import { cookieHeader } from '../http/set-cookie.ts';

type App = ReturnType<typeof createApp>;

let app: App;
let store: SqliteStore;

beforeEach(() => {
  store = new SqliteStore();
  app = createApp(store);
});

/*
 * Backdate an account, because some ceilings only apply to a new one.
 *
 * A registered account is minutes old in a test and days old in the cases
 * worth testing — the cross-posting rule, for instance, is deliberately behind
 * the new-account rule, so with a fresh account it can never be the reason
 * anybody is refused.
 */
function ageAccount(email: string, days: number): void {
  store.db
    .prepare('UPDATE users SET createdAt = ? WHERE email = ?')
    .run(new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(), email);
}

/* ------------------------------------------------------------- utilities */

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
  cookie: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const response = await app.request(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...init.headers },
  });
  const body = (await response.json().catch(() => null)) as T;
  return { status: response.status, body };
}

/** A complete Full C.H.A.T. — enough to pass the publication gate. */
async function writeReflection(
  cookie: string,
  title: string,
  reference = 'Romans 8:28',
): Promise<string> {
  const created = await call<{ id: string }>(cookie, '/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ title, scriptureReference: reference }),
  });
  const id = created.body.id;

  for (const [type, content] of [
    ['content', 'Paul is writing to a church under real pressure, not a comfortable one.'],
    ['heart', 'This met my fear that uncertainty means God has stopped working.'],
    ['application', 'I will choose to pray before reacting this week.'],
    ['testimony', 'I believe he is working even where I cannot see the shape of it.'],
  ] as const) {
    const patched = await call(cookie, `/api/conversations/${id}/sections`, {
      method: 'PATCH',
      body: JSON.stringify({ type, content }),
    });
    expect(patched.status).toBe(200);
  }
  return id;
}

async function makeCommunity(
  cookie: string,
  name: string,
  preset: 'public' | 'private' = 'private',
): Promise<string> {
  const created = await call<{ id: string }>(cookie, '/api/communities', {
    method: 'POST',
    body: JSON.stringify({ name, description: 'A small circle.', preset }),
  });
  expect(created.status).toBe(201);
  return created.body.id;
}

async function invite(ownerCookie: string, communityId: string, email: string) {
  return call(ownerCookie, `/api/communities/${communityId}/invitations`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

async function accept(cookie: string, communityId: string) {
  return call(cookie, `/api/communities/${communityId}/invitations/accept`, {
    method: 'POST',
  });
}

type Publication = {
  id: string;
  audience: string;
  community: { id: string; name: string } | null;
  author: { handle: string; displayName: string };
  isAuthor: boolean;
  title: string;
  scriptureReference: string | null;
  caption: string;
  sections: { type: string; content: string; authorOrigin: string }[];
  hashtags: { tag: string; label: string }[];
  encouraged: { count: number; byViewer: boolean };
  saved: boolean;
  canShareExternally: boolean;
  shareUrl?: string;
  moderationState: string;
};

type Feed = {
  scope: string;
  items: Publication[];
  hashtags: { tag: string; label: string }[];
};

async function publish(
  cookie: string,
  conversationId: string,
  audience: string,
  extra: Record<string, unknown> = {},
) {
  return call<Publication & { error?: string; validation?: unknown }>(
    cookie,
    '/api/publications',
    {
      method: 'POST',
      body: JSON.stringify({ conversationId, audience, ...extra }),
    },
  );
}

/* ------------------------------------------------------------------ tests */

describe('publishing', () => {
  test('a publication reaches exactly one audience, and its own row carries it', async () => {
    const cookie = await register('ada@example.com');
    const reflection = await writeReflection(cookie, 'Trusting while I cannot see');

    const published = await publish(cookie, reflection, AUDIENCES.PUBLIC, {
      caption: 'Something I keep coming back to.',
      hashtags: ['#faith', '#young-adults'],
    });

    expect(published.status).toBe(201);
    expect(published.body.audience).toBe(AUDIENCES.PUBLIC);
    expect(published.body.community).toBeNull();
    expect(published.body.caption).toBe('Something I keep coming back to.');
  });

  test('choosing several communities is refused, never converted to public', async () => {
    const cookie = await register('ada@example.com');
    const reflection = await writeReflection(cookie, 'Trusting');
    const first = await makeCommunity(cookie, 'Sunday Leaders');
    const second = await makeCommunity(cookie, 'Prayer Group');

    const attempt = await publish(cookie, reflection, AUDIENCES.COMMUNITY, {
      communityIds: [first, second],
    });

    expect(attempt.status).toBe(400);
    /*
     * The refusal suggests separate publications. It does not quietly widen
     * the audience, which is the failure this test exists to catch.
     */
    expect(attempt.body.error).toMatch(/one audience/i);
    expect((attempt.body as { suggestion?: string }).suggestion).toBe('publish_separately');

    const feed = await call<Feed>(cookie, '/api/publications?scope=public');
    expect(feed.body.items).toHaveLength(0);
  });

  test('two audiences means two publications, each with its own reactions', async () => {
    const author = await register('ada@example.com');
    const reader = await register('bob@example.com');
    const reflection = await writeReflection(author, 'Trusting');
    const community = await makeCommunity(author, 'Christlikeness');
    await invite(author, community, 'bob@example.com');
    await accept(reader, community);

    const publicOne = await publish(author, reflection, AUDIENCES.PUBLIC, {
      caption: 'For anyone.',
    });
    const communityOne = await publish(author, reflection, AUDIENCES.COMMUNITY, {
      communityId: community,
      caption: 'For our group.',
    });

    expect(publicOne.body.id).not.toBe(communityOne.body.id);
    expect(publicOne.body.caption).toBe('For anyone.');
    expect(communityOne.body.caption).toBe('For our group.');

    /* A reaction on one is not a reaction on the other. */
    await call(reader, `/api/publications/${publicOne.body.id}/encouraged`, {
      method: 'POST',
      body: JSON.stringify({ encouraged: true }),
    });

    const publicAfter = await call<Publication>(
      author,
      `/api/publications/${publicOne.body.id}`,
    );
    const communityAfter = await call<Publication>(
      author,
      `/api/publications/${communityOne.body.id}`,
    );
    expect(publicAfter.body.encouraged.count).toBe(1);
    expect(communityAfter.body.encouraged.count).toBe(0);
  });

  test('the encouraged feed lists what this person encouraged, and only that', async () => {
    const author = await register('ada@example.com');
    const reader = await register('bob@example.com');
    const reflection = await writeReflection(author, 'Trusting');
    const other = await writeReflection(author, 'Waiting');

    const encouraged = await publish(author, reflection, AUDIENCES.PUBLIC, {
      caption: 'For anyone.',
    });
    const ignored = await publish(author, other, AUDIENCES.PUBLIC, { caption: 'Also public.' });

    await call(reader, `/api/publications/${encouraged.body.id}/encouraged`, {
      method: 'POST',
      body: JSON.stringify({ encouraged: true }),
    });

    const feed = await call<Feed>(reader, '/api/publications/encouraged');
    expect(feed.body.items.map((item) => item.id)).toEqual([encouraged.body.id]);
    expect(feed.body.items.map((item) => item.id)).not.toContain(ignored.body.id);
  });

  test('withdrawing encouragement removes it from the list', async () => {
    const author = await register('ada@example.com');
    const reader = await register('bob@example.com');
    const reflection = await writeReflection(author, 'Trusting');
    const published = await publish(author, reflection, AUDIENCES.PUBLIC, { caption: 'For anyone.' });
    const url = `/api/publications/${published.body.id}/encouraged`;

    await call(reader, url, { method: 'POST', body: JSON.stringify({ encouraged: true }) });
    await call(reader, url, { method: 'POST', body: JSON.stringify({ encouraged: false }) });

    const feed = await call<Feed>(reader, '/api/publications/encouraged');
    expect(feed.body.items).toHaveLength(0);
  });

  test('one person\'s encouragements are not another\'s', async () => {
    const author = await register('ada@example.com');
    const reader = await register('bob@example.com');
    const stranger = await register('cleo@example.com');
    const reflection = await writeReflection(author, 'Trusting');
    const published = await publish(author, reflection, AUDIENCES.PUBLIC, { caption: 'For anyone.' });

    await call(reader, `/api/publications/${published.body.id}/encouraged`, {
      method: 'POST',
      body: JSON.stringify({ encouraged: true }),
    });

    const mine = await call<Feed>(stranger, '/api/publications/encouraged');
    expect(mine.body.items).toHaveLength(0);
  });

  test('a feed of several publications keeps each one’s sections its own', async () => {
    const author = await register('ada@example.com');
    const reader = await register('bob@example.com');

    const first = await writeReflection(author, 'The first reflection');
    const second = await writeReflection(author, 'The second reflection');
    const third = await writeReflection(author, 'The third reflection');

    const published = [];
    for (const [reflection, caption] of [
      [first, 'Caption for the first.'],
      [second, 'Caption for the second.'],
      [third, 'Caption for the third.'],
    ] as const) {
      published.push(await publish(author, reflection, AUDIENCES.PUBLIC, { caption }));
    }

    /*
     * The feed hydrates a page in a fixed number of queries rather than three
     * per row. The thing that goes wrong when rows are grouped by hand is that
     * one publication ends up wearing another's writing.
     */
    const feed = await call<Feed>(reader, '/api/publications?scope=public');
    expect(feed.body.items).toHaveLength(3);

    for (const item of feed.body.items) {
      const single = await call<Publication>(reader, `/api/publications/${item.id}`);
      /* Read one at a time, each is identical to how it arrived in the page. */
      expect(item.sections).toEqual(single.body.sections);
      expect(item.title).toBe(single.body.title);
      expect(item.caption).toBe(single.body.caption);
    }

    const captions = feed.body.items.map((item) => item.caption).sort();
    expect(captions).toEqual([
      'Caption for the first.',
      'Caption for the second.',
      'Caption for the third.',
    ]);
    expect(published).toHaveLength(3);
  });

  test('publishing copies the reflection and never mutates it', async () => {
    const cookie = await register('ada@example.com');
    const reflection = await writeReflection(cookie, 'Trusting');

    /* Share only two of the four sections. */
    await publish(cookie, reflection, AUDIENCES.PUBLIC, {
      sections: ['heart', 'application'],
    });

    const source = await call<{
      sections: Record<string, { content: string }>;
    }>(cookie, `/api/conversations/${reflection}`);

    /* All four are still there, untouched, in the private source. */
    for (const type of ['content', 'heart', 'application', 'testimony']) {
      expect(source.body.sections[type]?.content).not.toBe('');
    }
  });

  /*
   * Whether somebody used assistance is theirs, and does not travel to a
   * reader.
   *
   * This used to assert the opposite: that provenance survived into published
   * content, on the reasoning that AI wording must never be presented as
   * another person's own experience. The owner decided otherwise, and the
   * reasoning does not survive the decision either way — nothing reaches a
   * section until the author accepts it, so the words in a published
   * reflection are theirs however they were arrived at.
   *
   * It is still stored. It is how a suggestion is told apart from accepted
   * words while somebody is writing; it simply is not anybody else's business.
   */
  test('how a reflection was written does not travel to its readers', async () => {
    const cookie = await register('ada@example.com');
    const reflection = await writeReflection(cookie, 'Trusting');

    await call(cookie, `/api/conversations/${reflection}/sections`, {
      method: 'PATCH',
      body: JSON.stringify({
        type: 'content',
        content: 'A paragraph the model helped shape.',
        authorOrigin: 'ai_assisted',
      }),
    });

    const published = await publish(cookie, reflection, AUDIENCES.PUBLIC);
    const content = published.body.sections.find((section) => section.type === 'content');
    expect(content?.content).toBe('A paragraph the model helped shape.');
    /* Not rendered, and not served — a field in the payload is published. */
    expect(content).not.toHaveProperty('authorOrigin');
    expect(JSON.stringify(published.body)).not.toContain('ai_assisted');
  });

  test('an incomplete Full C.H.A.T. cannot be shared', async () => {
    const cookie = await register('ada@example.com');
    const created = await call<{ id: string }>(cookie, '/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title: 'Half a thought', scriptureReference: 'Psalm 46:10' }),
    });
    await call(cookie, `/api/conversations/${created.body.id}/sections`, {
      method: 'PATCH',
      body: JSON.stringify({ type: 'heart', content: 'Only this one so far.' }),
    });

    const attempt = await publish(cookie, created.body.id, AUDIENCES.PUBLIC);
    expect(attempt.status).toBe(422);
    expect(attempt.body.validation).toBeTruthy();
  });
});

describe('membership decides access, on every request', () => {
  test('a member sees a community publication; a non-member gets 404 on the same URL', async () => {
    const author = await register('ada@example.com');
    const member = await register('bob@example.com');
    const stranger = await register('eve@example.com');

    const reflection = await writeReflection(author, 'Trusting');
    const community = await makeCommunity(author, 'Christlikeness');
    await invite(author, community, 'bob@example.com');
    await accept(member, community);

    const published = await publish(author, reflection, AUDIENCES.COMMUNITY, {
      communityId: community,
    });
    const url = `/api/publications/${published.body.id}`;

    const asMember = await call<Publication>(member, url);
    expect(asMember.status).toBe(200);
    expect(asMember.body.title).toBe('Trusting');

    const asStranger = await call<{ error: string }>(stranger, url);
    expect(asStranger.status).toBe(404);
    /* The 404 says nothing about what is there. */
    expect(JSON.stringify(asStranger.body)).not.toContain('Trusting');
    expect(JSON.stringify(asStranger.body)).not.toContain(community);
  });

  test('a removed member loses access immediately, with the same URL', async () => {
    const author = await register('ada@example.com');
    const member = await register('bob@example.com');

    const reflection = await writeReflection(author, 'Trusting');
    const community = await makeCommunity(author, 'Christlikeness');
    await invite(author, community, 'bob@example.com');
    await accept(member, community);

    const published = await publish(author, reflection, AUDIENCES.COMMUNITY, {
      communityId: community,
    });
    const url = `/api/publications/${published.body.id}`;

    const before = await call<Publication>(member, url);
    expect(before.status).toBe(200);

    /* Find the member's id the way the roster reports it, then remove them. */
    const roster = await call<{ userId: string; handle: string | null }[]>(
      author,
      `/api/communities/${community}/members`,
    );
    const subject = roster.body.find((row) => row.handle === 'bob');
    expect(subject).toBeTruthy();

    const removed = await call(
      author,
      `/api/communities/${community}/members/${subject?.userId}`,
      { method: 'PATCH', body: JSON.stringify({ state: MEMBERSHIP_STATES.REMOVED }) },
    );
    expect(removed.status).toBe(200);

    /* The same URL, the very next request. Nothing was cached, nothing carried. */
    const after = await call<{ error: string }>(member, url);
    expect(after.status).toBe(404);

    const feed = await call<Feed>(member, '/api/publications?scope=shared');
    expect(feed.body.items).toHaveLength(0);
  });

  test('an invited but not yet accepted person cannot see community content', async () => {
    const author = await register('ada@example.com');
    const invited = await register('bob@example.com');

    const reflection = await writeReflection(author, 'Trusting');
    const community = await makeCommunity(author, 'Christlikeness');
    await invite(author, community, 'bob@example.com');
    /* Deliberately not accepted. */

    const published = await publish(author, reflection, AUDIENCES.COMMUNITY, {
      communityId: community,
    });

    const attempt = await call(invited, `/api/publications/${published.body.id}`);
    expect(attempt.status).toBe(404);

    const feed = await call<Feed>(invited, '/api/publications?scope=shared');
    expect(feed.body.items).toHaveLength(0);
  });

  test('someone who left cannot read the community they left', async () => {
    const author = await register('ada@example.com');
    const member = await register('bob@example.com');
    const reflection = await writeReflection(author, 'Trusting');
    const community = await makeCommunity(author, 'Christlikeness');
    await invite(author, community, 'bob@example.com');
    await accept(member, community);
    const published = await publish(author, reflection, AUDIENCES.COMMUNITY, {
      communityId: community,
    });

    const left = await call(member, `/api/communities/${community}/leave`, { method: 'POST' });
    expect(left.status).toBe(200);

    const after = await call(member, `/api/publications/${published.body.id}`);
    expect(after.status).toBe(404);
  });
});

describe('nothing leaks through the feed, its counts, or its suggestions', () => {
  test('a private reflection never appears in any Community response', async () => {
    const author = await register('ada@example.com');
    const reader = await register('bob@example.com');

    /* Written, never published. */
    await writeReflection(author, 'A private ache I have not shared');

    for (const scope of ['shared', 'public', 'mine']) {
      const feed = await call<Feed>(reader, `/api/publications?scope=${scope}`);
      expect(feed.status).toBe(200);
      expect(JSON.stringify(feed.body)).not.toContain('A private ache');
      expect(feed.body.items).toHaveLength(0);
    }
  });

  test("an Only Me publication is unreachable by anyone else's URL", async () => {
    const author = await register('ada@example.com');
    const reader = await register('bob@example.com');
    const reflection = await writeReflection(author, 'Only for me');

    const published = await publish(author, reflection, AUDIENCES.ONLY_ME);
    expect(published.status).toBe(201);

    const mine = await call<Publication>(author, `/api/publications/${published.body.id}`);
    expect(mine.status).toBe(200);

    const theirs = await call(reader, `/api/publications/${published.body.id}`);
    expect(theirs.status).toBe(404);

    const feed = await call<Feed>(reader, '/api/publications?scope=public');
    expect(feed.body.items).toHaveLength(0);
  });

  test('search does not match unauthorised content, by title, text or author', async () => {
    const author = await register('ada@example.com');
    const stranger = await register('eve@example.com');
    const reflection = await writeReflection(author, 'Pomegranate');
    const community = await makeCommunity(author, 'Christlikeness');
    await publish(author, reflection, AUDIENCES.COMMUNITY, { communityId: community });

    for (const term of ['Pomegranate', 'uncertainty', 'ada', 'Romans']) {
      for (const scope of ['shared', 'public']) {
        const feed = await call<Feed>(
          stranger,
          `/api/publications?scope=${scope}&q=${encodeURIComponent(term)}`,
        );
        expect(feed.body.items, `${term} in ${scope}`).toHaveLength(0);
        expect(JSON.stringify(feed.body)).not.toContain('Pomegranate');
      }
    }
  });

  test('hashtag facets never advertise a tag the viewer cannot reach', async () => {
    const author = await register('ada@example.com');
    const stranger = await register('eve@example.com');
    const reflection = await writeReflection(author, 'Trusting');
    const community = await makeCommunity(author, 'Christlikeness');
    await publish(author, reflection, AUDIENCES.COMMUNITY, {
      communityId: community,
      hashtags: ['#secretcircle'],
    });

    const feed = await call<Feed>(stranger, '/api/publications?scope=shared');
    expect(feed.body.hashtags).toHaveLength(0);
    expect(JSON.stringify(feed.body)).not.toContain('secretcircle');
  });

  test('a hashtag never grants access to anything', async () => {
    const author = await register('ada@example.com');
    const stranger = await register('eve@example.com');
    const reflection = await writeReflection(author, 'Trusting');
    const community = await makeCommunity(author, 'Christlikeness');
    await publish(author, reflection, AUDIENCES.COMMUNITY, {
      communityId: community,
      hashtags: ['#youngadults'],
    });

    /* Every spelling of the tag, from someone with no membership. */
    for (const tag of ['youngadults', 'young-adults', 'young_adults', '%23youngadults']) {
      const feed = await call<Feed>(stranger, `/api/publications?scope=shared&tag=${tag}`);
      expect(feed.body.items).toHaveLength(0);
    }
  });

  test('the three spellings of one tag find the same publication for a member', async () => {
    const author = await register('ada@example.com');
    const reflection = await writeReflection(author, 'Trusting');
    await publish(author, reflection, AUDIENCES.PUBLIC, { hashtags: ['#young-adults'] });

    for (const tag of ['youngadults', 'young-adults', 'young_adults']) {
      const feed = await call<Feed>(author, `/api/publications?scope=public&tag=${tag}`);
      expect(feed.body.items, tag).toHaveLength(1);
    }
  });

  test('a community filter for a community you are not in is a 404, not an empty list', async () => {
    const author = await register('ada@example.com');
    const stranger = await register('eve@example.com');
    const community = await makeCommunity(author, 'Christlikeness');

    const feed = await call(stranger, `/api/publications?scope=shared&community=${community}`);
    expect(feed.status).toBe(404);
  });
});

describe('Encouraged, and Save', () => {
  test('Encouraged is one per user, removable, and cannot be doubled', async () => {
    const author = await register('ada@example.com');
    const reader = await register('bob@example.com');
    const reflection = await writeReflection(author, 'Trusting');
    const published = await publish(author, reflection, AUDIENCES.PUBLIC);
    const url = `/api/publications/${published.body.id}/encouraged`;

    const first = await call<{ encouraged: { count: number; byViewer: boolean } }>(reader, url, {
      method: 'POST',
      body: JSON.stringify({ encouraged: true }),
    });
    expect(first.body.encouraged).toEqual({ count: 1, byViewer: true });

    /* Again. The primary key, not the client, is what keeps this at one. */
    const again = await call<{ encouraged: { count: number } }>(reader, url, {
      method: 'POST',
      body: JSON.stringify({ encouraged: true }),
    });
    expect(again.body.encouraged.count).toBe(1);

    const removed = await call<{ encouraged: { count: number; byViewer: boolean } }>(reader, url, {
      method: 'POST',
      body: JSON.stringify({ encouraged: false }),
    });
    expect(removed.body.encouraged).toEqual({ count: 0, byViewer: false });
  });

  test('Save is invisible to the author: no count exists in any payload', async () => {
    const author = await register('ada@example.com');
    const reader = await register('bob@example.com');
    const reflection = await writeReflection(author, 'Trusting');
    const published = await publish(author, reflection, AUDIENCES.PUBLIC);
    const id = published.body.id;

    const saved = await call<{ saved: boolean }>(reader, `/api/publications/${id}/save`, {
      method: 'POST',
      body: JSON.stringify({ saved: true }),
    });
    expect(saved.body.saved).toBe(true);
    /* Not even the person who saved it is told a total. */
    expect(saved.body).not.toHaveProperty('count');
    expect(saved.body).not.toHaveProperty('saveCount');

    /* The author's own view of their publication, in both shapes it is served. */
    const single = await call<Publication>(author, `/api/publications/${id}`);
    const feed = await call<Feed>(author, '/api/publications?scope=public');

    for (const payload of [single.body, feed.body.items[0]]) {
      expect(payload).toBeTruthy();
      expect(payload).not.toHaveProperty('saveCount');
      expect(payload).not.toHaveProperty('savedBy');
      /* `saved` is the *author's own* bookmark, and they have not saved it. */
      expect(payload?.saved).toBe(false);
    }

    /* And no key anywhere in the serialised payload smells like a save total. */
    expect(JSON.stringify(single.body)).not.toMatch(/save(count|s|d?by)/i);
  });

  test('a reader cannot encourage a publication they may not see', async () => {
    const author = await register('ada@example.com');
    const stranger = await register('eve@example.com');
    const reflection = await writeReflection(author, 'Trusting');
    const community = await makeCommunity(author, 'Christlikeness');
    const published = await publish(author, reflection, AUDIENCES.COMMUNITY, {
      communityId: community,
    });

    const attempt = await call(stranger, `/api/publications/${published.body.id}/encouraged`, {
      method: 'POST',
      body: JSON.stringify({ encouraged: true }),
    });
    expect(attempt.status).toBe(404);

    const after = await call<Publication>(author, `/api/publications/${published.body.id}`);
    expect(after.body.encouraged.count).toBe(0);
  });
});

describe('external sharing, by ownership', () => {
  test("another member's community publication gets no share control and no URL", async () => {
    const author = await register('ada@example.com');
    const member = await register('bob@example.com');
    const reflection = await writeReflection(author, 'Trusting');
    const community = await makeCommunity(author, 'Christlikeness');
    await invite(author, community, 'bob@example.com');
    await accept(member, community);

    const published = await publish(author, reflection, AUDIENCES.COMMUNITY, {
      communityId: community,
    });

    const asMember = await call<Publication>(member, `/api/publications/${published.body.id}`);
    expect(asMember.status).toBe(200);
    expect(asMember.body.canShareExternally).toBe(false);
    /* Not "present but false" — absent. There is nothing to render. */
    expect(asMember.body).not.toHaveProperty('shareUrl');
  });

  test('a public publication carries a link anyone may share', async () => {
    const author = await register('ada@example.com');
    const reader = await register('bob@example.com');
    const reflection = await writeReflection(author, 'Trusting');
    const published = await publish(author, reflection, AUDIENCES.PUBLIC);

    const asReader = await call<Publication>(reader, `/api/publications/${published.body.id}`);
    expect(asReader.body.canShareExternally).toBe(true);
    expect(asReader.body.shareUrl).toContain(`/community/publications/${published.body.id}`);
  });

  test('the author may share their own community publication', async () => {
    const author = await register('ada@example.com');
    const reflection = await writeReflection(author, 'Trusting');
    const community = await makeCommunity(author, 'Christlikeness');
    const published = await publish(author, reflection, AUDIENCES.COMMUNITY, {
      communityId: community,
    });

    const own = await call<Publication>(author, `/api/publications/${published.body.id}`);
    expect(own.body.canShareExternally).toBe(true);
    /*
     * But no community URL is handed out even to the author: sharing their own
     * community post externally means an external representation built from
     * their own content, not a link into the private community.
     */
    expect(own.body).not.toHaveProperty('shareUrl');
  });
});

describe('hiding and deleting are different states', () => {
  test('a report records, and hides nothing', async () => {
    const author = await register('ada@example.com');
    const reader = await register('bob@example.com');
    const reflection = await writeReflection(author, 'Trusting');
    const published = await publish(author, reflection, AUDIENCES.PUBLIC);

    const reported = await call<{ hidden: boolean }>(
      reader,
      `/api/publications/${published.body.id}/report`,
      { method: 'POST', body: JSON.stringify({ reason: 'spam' }) },
    );
    expect(reported.status).toBe(201);
    expect(reported.body.hidden).toBe(false);

    /* Still visible to everyone, because reports are reviewed before action. */
    const after = await call<Publication>(reader, `/api/publications/${published.body.id}`);
    expect(after.status).toBe(200);
    expect(after.body.moderationState).toBe('visible');
  });

  test('an author cannot delete a publication attached to an open report', async () => {
    const author = await register('ada@example.com');
    const reader = await register('bob@example.com');
    const reflection = await writeReflection(author, 'Trusting');
    const published = await publish(author, reflection, AUDIENCES.PUBLIC);
    const id = published.body.id;

    await call(reader, `/api/publications/${id}/report`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'harassment' }),
    });

    const deleted = await call<{ error: string; canHide: boolean }>(
      author,
      `/api/publications/${id}`,
      { method: 'DELETE' },
    );
    expect(deleted.status).toBe(409);
    expect(deleted.body.canHide).toBe(true);

    /* The evidence is still there. */
    const still = await call<Publication>(author, `/api/publications/${id}`);
    expect(still.status).toBe(200);

    /* Hiding is offered instead, and it works. */
    const hidden = await call<{ moderationState: string }>(
      author,
      `/api/publications/${id}/hide`,
      { method: 'POST', body: JSON.stringify({ hidden: true }) },
    );
    expect(hidden.body.moderationState).toBe('hidden');

    const toReader = await call(reader, `/api/publications/${id}`);
    expect(toReader.status).toBe(404);
  });

  test('a moderator may hide, and the author still sees their own hidden work', async () => {
    const owner = await register('ada@example.com');
    const member = await register('bob@example.com');
    const reflection = await writeReflection(member, 'Trusting');
    const community = await makeCommunity(owner, 'Christlikeness');
    await invite(owner, community, 'bob@example.com');
    await accept(member, community);

    const published = await publish(member, reflection, AUDIENCES.COMMUNITY, {
      communityId: community,
    });
    const id = published.body.id;

    const hidden = await call<{ moderationState: string }>(owner, `/api/publications/${id}/hide`, {
      method: 'POST',
      body: JSON.stringify({ hidden: true }),
    });
    expect(hidden.status).toBe(200);
    expect(hidden.body.moderationState).toBe('hidden');

    /* The author can still see what happened to their own publication. */
    const asAuthor = await call<Publication>(member, `/api/publications/${id}`);
    expect(asAuthor.status).toBe(200);
    expect(asAuthor.body.moderationState).toBe('hidden');
  });

  test('deleting a publication keeps the reflection it was made from', async () => {
    const author = await register('ada@example.com');
    const reflection = await writeReflection(author, 'Trusting');
    const published = await publish(author, reflection, AUDIENCES.PUBLIC);

    const deleted = await call<{ deleted: boolean; reflectionKept: boolean }>(
      author,
      `/api/publications/${published.body.id}`,
      { method: 'DELETE' },
    );
    expect(deleted.body).toMatchObject({ deleted: true, reflectionKept: true });

    const source = await call(author, `/api/conversations/${reflection}`);
    expect(source.status).toBe(200);
  });

  test('an ordinary member cannot hide someone else’s publication', async () => {
    const owner = await register('ada@example.com');
    const memberOne = await register('bob@example.com');
    const memberTwo = await register('cat@example.com');
    const community = await makeCommunity(owner, 'Christlikeness');
    for (const email of ['bob@example.com', 'cat@example.com']) {
      await invite(owner, community, email);
    }
    await accept(memberOne, community);
    await accept(memberTwo, community);

    const reflection = await writeReflection(memberOne, 'Trusting');
    const published = await publish(memberOne, reflection, AUDIENCES.COMMUNITY, {
      communityId: community,
    });

    const attempt = await call(memberTwo, `/api/publications/${published.body.id}/hide`, {
      method: 'POST',
      body: JSON.stringify({ hidden: true }),
    });
    expect(attempt.status).toBe(404);

    const still = await call<Publication>(memberOne, `/api/publications/${published.body.id}`);
    expect(still.body.moderationState).toBe('visible');
  });
});

describe('communities are not a directory', () => {
  test('a community you are not in is not listed, described, or confirmed', async () => {
    const owner = await register('ada@example.com');
    const stranger = await register('eve@example.com');
    const community = await makeCommunity(owner, 'Magalang Family');

    const mine = await call<{ communities: unknown[]; invitations: unknown[] }>(
      stranger,
      '/api/communities',
    );
    expect(mine.body.communities).toHaveLength(0);
    expect(JSON.stringify(mine.body)).not.toContain('Magalang');

    const direct = await call(stranger, `/api/communities/${community}`);
    expect(direct.status).toBe(404);

    const roster = await call(stranger, `/api/communities/${community}/members`);
    expect(roster.status).toBe(404);
  });

  test('every community keeps at least one owner', async () => {
    const owner = await register('ada@example.com');
    const community = await makeCommunity(owner, 'Christlikeness');

    const leaving = await call<{ error: string }>(`${owner}`, `/api/communities/${community}/leave`, {
      method: 'POST',
    });
    expect(leaving.status).toBe(409);
    expect(leaving.body.error).toMatch(/owner/i);
  });

  test('only owners and moderators may invite', async () => {
    const owner = await register('ada@example.com');
    const member = await register('bob@example.com');
    const community = await makeCommunity(owner, 'Christlikeness');
    await invite(owner, community, 'bob@example.com');
    await accept(member, community);

    const attempt = await invite(member, community, 'eve@example.com');
    expect(attempt.status).toBe(403);
  });
});

/*
 * Communities are shared spaces, not broadcast channels.
 *
 * The rules below are the ones that decide whether that sentence is true in
 * the code or only in the documentation. Each is written from the position of
 * the person it protects: somebody who shared into a small group, somebody a
 * community asked to leave, somebody who deleted what they wrote.
 */
describe('what a community is', () => {
  test('Public and Private are two doors into one set of settings', async () => {
    const cookie = await register('presets@example.com');

    const open = await call<{ settings: Record<string, string> }>(cookie, '/api/communities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Open circle', preset: 'public' }),
    });
    expect(open.body.settings).toMatchObject({
      discoverability: 'public',
      joinPolicy: 'open',
      reflectionVisibility: 'public',
      approvalPolicy: 'owner_admin',
    });

    const closed = await call<{ settings: Record<string, string> }>(cookie, '/api/communities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Study group', preset: 'private' }),
    });
    /* Findable, so a newcomer can ask. That is not the same as joinable. */
    expect(closed.body.settings).toMatchObject({
      discoverability: 'public',
      joinPolicy: 'approval',
      reflectionVisibility: 'members',
    });
  });

  test('a hidden community is not in the directory, and a discoverable one shows nothing written in it', async () => {
    const owner = await register('owner-discover@example.com');
    const stranger = await register('stranger-discover@example.com');

    const hidden = await call<{ id: string }>(owner, '/api/communities', {
      method: 'POST',
      body: JSON.stringify({ name: 'Hidden circle', preset: 'private', settings: { discoverability: 'hidden' } }),
    });
    const found = await makeCommunity(owner, 'Findable circle', 'private');
    const reflection = await writeReflection(owner, 'Written inside');
    await publish(owner, reflection, AUDIENCES.COMMUNITY, { communityId: found });

    const directory = await call<{ communities: { id: string; name: string }[] }>(
      stranger,
      '/api/communities/discover',
    );
    const ids = directory.body.communities.map((entry) => entry.id);
    expect(ids).toContain(found);
    expect(ids).not.toContain(hidden.body.id);

    /* Seeing that it exists is not seeing what is in it. */
    const feed = await call<{ items: Publication[] }>(stranger, '/api/publications?scope=shared');
    expect(feed.body.items).toHaveLength(0);
  });
});

describe('joining', () => {
  test('an open community lets somebody in; a private one takes their request once', async () => {
    const owner = await register('owner-join@example.com');
    const joiner = await register('joiner@example.com');
    const open = await makeCommunity(owner, 'Anyone welcome', 'public');
    const approval = await makeCommunity(owner, 'Ask first', 'private');

    const joined = await call<{ state: string }>(joiner, `/api/communities/${open}/join`, {
      method: 'POST',
    });
    expect(joined.body.state).toBe('active');

    const asked = await call<{ state: string }>(joiner, `/api/communities/${approval}/join`, {
      method: 'POST',
    });
    expect(asked.body.state).toBe('pending');

    /* Pressing again is not a second request. */
    await call(joiner, `/api/communities/${approval}/join`, { method: 'POST' });
    const requests = await call<{ requests: unknown[] }>(
      owner,
      `/api/communities/${approval}/join-requests`,
    );
    expect(requests.body.requests).toHaveLength(1);
  });

  test('by default a member cannot approve, and the community can say otherwise', async () => {
    const owner = await register('owner-approve@example.com');
    const member = await register('member-approve@example.com');
    const asker = await register('asker-approve@example.com');
    const id = await makeCommunity(owner, 'Ask first', 'private');
    await invite(owner, id, 'member-approve@example.com');
    await accept(member, id);
    await call(asker, `/api/communities/${id}/join`, { method: 'POST' });

    /*
     * The default matters: with every member able to approve, one approved
     * person can let in everybody they know and the control the community was
     * created for is gone in an afternoon.
     */
    const refused = await call(member, `/api/communities/${id}/join-requests/${'x'}`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(refused.status).toBe(403);

    await call(owner, `/api/communities/${id}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ approvalPolicy: 'members' }),
    });
    const requests = await call<{ requests: { userId: string }[] }>(
      member,
      `/api/communities/${id}/join-requests`,
    );
    expect(requests.status).toBe(200);
    const decided = await call(
      member,
      `/api/communities/${id}/join-requests/${requests.body.requests[0]!.userId}`,
      { method: 'POST', body: JSON.stringify({ decision: 'approve' }) },
    );
    expect(decided.status).toBe(200);
  });

  test('declining is not banning: the person may ask again', async () => {
    const owner = await register('owner-decline@example.com');
    const asker = await register('asker-decline@example.com');
    const id = await makeCommunity(owner, 'Ask first', 'private');
    await call(asker, `/api/communities/${id}/join`, { method: 'POST' });
    const requests = await call<{ requests: { userId: string }[] }>(
      owner,
      `/api/communities/${id}/join-requests`,
    );
    await call(owner, `/api/communities/${id}/join-requests/${requests.body.requests[0]!.userId}`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'decline' }),
    });

    const again = await call<{ state: string }>(asker, `/api/communities/${id}/join`, {
      method: 'POST',
    });
    expect(again.body.state).toBe('pending');
  });
});

describe('a ban is not a stronger removal', () => {
  async function banned() {
    const owner = await register('owner-ban@example.com');
    const person = await register('banned@example.com');
    const id = await makeCommunity(owner, 'Open circle', 'public');
    await call(person, `/api/communities/${id}/join`, { method: 'POST' });
    const members = await call<{ userId: string; role: string }[]>(
      owner,
      `/api/communities/${id}/members`,
    );
    const subject = members.body.find((m) => m.role !== 'owner')!;
    const done = await call(owner, `/api/communities/${id}/members/${subject.userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'banned' }),
    });
    expect(done.status).toBe(200);
    return { owner, person, id };
  }

  test('they cannot simply rejoin an open community', async () => {
    const { person, id } = await banned();
    const rejoined = await call(person, `/api/communities/${id}/join`, { method: 'POST' });
    expect(rejoined.status).toBe(404);
  });

  test('and an invitation cannot quietly undo it', async () => {
    const { owner, id } = await banned();
    const invited = await invite(owner, id, 'banned@example.com');
    expect(invited.status).toBe(409);
  });
});

describe('membership includes the right to participate', () => {
  test('an ordinary member may share, not only the owner', async () => {
    const owner = await register('owner-share@example.com');
    const member = await register('member-share@example.com');
    const id = await makeCommunity(owner, 'Shared space', 'private');
    await invite(owner, id, 'member-share@example.com');
    await accept(member, id);

    const reflection = await writeReflection(member, 'Mine to share');
    const shared = await publish(member, reflection, AUDIENCES.COMMUNITY, { communityId: id });
    expect(shared.status).toBe(201);
  });
});

describe('a setting change cannot publish what is already there', () => {
  test('members-only to public leaves existing shares members-only', async () => {
    const owner = await register('owner-expose@example.com');
    const stranger = await register('stranger-expose@example.com');
    const id = await makeCommunity(owner, 'Study group', 'private');
    const reflection = await writeReflection(owner, 'Said to twelve people');
    const shared = await publish(owner, reflection, AUDIENCES.COMMUNITY, { communityId: id });
    const publicationId = shared.body.id;

    const changed = await call<{ existingSharesUnchanged?: boolean }>(
      owner,
      `/api/communities/${id}/settings`,
      { method: 'PATCH', body: JSON.stringify({ reflectionVisibility: 'public' }) },
    );
    expect(changed.status).toBe(200);
    /* And it says so, rather than leaving it to be discovered. */
    expect(changed.body.existingSharesUnchanged).toBe(true);

    const peek = await call(stranger, `/api/publications/${publicationId}`);
    expect(peek.status).toBe(404);

    /* What it does change is what happens next. */
    const later = await writeReflection(owner, 'Shared after the change');
    const openly = await publish(owner, later, AUDIENCES.COMMUNITY, { communityId: id });
    const visible = await call(stranger, `/api/publications/${openly.body.id}`);
    expect(visible.status).toBe(200);
  });
});

describe('sharing is not giving away', () => {
  test('deleting the reflection takes its shares with it', async () => {
    const owner = await register('owner-delete@example.com');
    const member = await register('member-delete@example.com');
    const id = await makeCommunity(owner, 'Circle', 'private');
    await invite(owner, id, 'member-delete@example.com');
    await accept(member, id);

    const reflection = await writeReflection(owner, 'Shared then deleted');
    const shared = await publish(owner, reflection, AUDIENCES.COMMUNITY, { communityId: id });
    expect((await call(member, `/api/publications/${shared.body.id}`)).status).toBe(200);

    const deleted = await call<{ sharesRemoved: number }>(
      owner,
      `/api/conversations/${reflection}`,
      { method: 'DELETE' },
    );
    expect(deleted.body.sharesRemoved).toBe(1);
    /* A community must never keep a copy of something its author destroyed. */
    expect((await call(member, `/api/publications/${shared.body.id}`)).status).toBe(404);
  });

  test('deleting the community keeps everybody’s reflections', async () => {
    const owner = await register('owner-close@example.com');
    const member = await register('member-close@example.com');
    const id = await makeCommunity(owner, 'Circle', 'private');
    await invite(owner, id, 'member-close@example.com');
    await accept(member, id);
    const reflection = await writeReflection(member, 'Written by a member');
    await publish(member, reflection, AUDIENCES.COMMUNITY, { communityId: id });

    const closed = await call(owner, `/api/communities/${id}`, { method: 'DELETE' });
    expect(closed.status).toBe(200);

    /* The share is gone; the reflection is exactly where its author left it. */
    const mine = await call<{ id: string }>(member, `/api/conversations/${reflection}`);
    expect(mine.status).toBe(200);
    expect(mine.body.id).toBe(reflection);
  });
});

/*
 * Distribution is limited; writing is not.
 *
 * The two tests that matter here are the evasion and the survival: unsharing
 * must not refund a share, and somebody who has reached a ceiling must still
 * be able to write. Everything else about the numbers is tested against the
 * rule itself in share-limits.test.ts, where it does not need a database.
 */
describe('sharing limits', () => {
  test('unsharing and resharing does not refund the share', async () => {
    const cookie = await register('evade@example.com');
    ageAccount('evade@example.com', 30);
    const id = await makeCommunity(cookie, 'One room', 'private');

    /* Five into one community in an hour is the ceiling. */
    const published: string[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const reflection = await writeReflection(cookie, `Reflection ${attempt}`);
      const shared = await publish(cookie, reflection, AUDIENCES.COMMUNITY, { communityId: id });
      expect(shared.status).toBe(201);
      published.push(shared.body.id);
    }

    const sixth = await writeReflection(cookie, 'One too many');
    const refused = await publish(cookie, sixth, AUDIENCES.COMMUNITY, { communityId: id });
    expect(refused.status).toBe(429);

    /*
     * Deleting a publication removes it from the community. It does not give
     * back the share — otherwise share, unshare, share would be free forever
     * and the ceiling would only ever have limited what is visible.
     */
    await call(cookie, `/api/publications/${published[0]}`, { method: 'DELETE' });
    const again = await publish(cookie, sixth, AUDIENCES.COMMUNITY, { communityId: id });
    expect(again.status).toBe(429);
  });

  test('one reflection cannot be carpet-bombed across communities', async () => {
    /*
     * Six communities, made by somebody else, because creating them is itself
     * limited — this test is about where one reflection may go, not about how
     * many rooms one person may build in an afternoon.
     */
    const hosts = [
      await register('crosspost-host-a@example.com'),
      await register('crosspost-host-b@example.com'),
    ];
    const cookie = await register('crossposter@example.com');
    ageAccount('crossposter@example.com', 30);
    const communities: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const id = await makeCommunity(hosts[index % 2]!, `Circle ${index}`, 'public');
      await call(cookie, `/api/communities/${id}/join`, { method: 'POST' });
      communities.push(id);
    }
    const reflection = await writeReflection(cookie, 'Everywhere at once');

    for (let index = 0; index < 5; index += 1) {
      const shared = await publish(cookie, reflection, AUDIENCES.COMMUNITY, {
        communityId: communities[index],
      });
      expect(shared.status).toBe(201);
    }

    const refused = await call<{ refusal: string; error: string }>(cookie, '/api/publications', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: reflection,
        audience: AUDIENCES.COMMUNITY,
        communityId: communities[5],
      }),
    });
    expect(refused.status).toBe(429);
    expect(refused.body.refusal).toBe('reflection_in_too_many_communities');
    /* And it names the honest alternative rather than only refusing. */
    expect(refused.body.error).toMatch(/share it publicly instead/i);

    /* A different reflection is not held to that reflection's history. */
    const another = await writeReflection(cookie, 'Something else');
    const allowed = await publish(cookie, another, AUDIENCES.COMMUNITY, {
      communityId: communities[5],
    });
    expect(allowed.status).toBe(201);
  });

  test('reaching a limit stops distribution and nothing else', async () => {
    const cookie = await register('still-writing@example.com');
    ageAccount('still-writing@example.com', 30);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const reflection = await writeReflection(cookie, `Public ${attempt}`);
      expect((await publish(cookie, reflection, AUDIENCES.PUBLIC)).status).toBe(201);
    }
    const blocked = await writeReflection(cookie, 'Sixth');
    expect((await publish(cookie, blocked, AUDIENCES.PUBLIC)).status).toBe(429);

    /*
     * A social-platform problem must not become a private-writing problem.
     * Writing, editing and keeping a reflection all carry on untouched.
     */
    const written = await call(cookie, `/api/conversations/${blocked}/sections`, {
      method: 'PATCH',
      body: JSON.stringify({ type: 'heart', content: 'Still writing, regardless.' }),
    });
    expect(written.status).toBe(200);
    const created = await call(cookie, '/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ title: 'A new one' }),
    });
    expect(created.status).toBe(201);
  });
});

/*
 * A new account's first day, which is a different ceiling from the others and
 * has a different thing to say. It is also the one that must never read as an
 * accusation: somebody who has just joined and shared five times is far more
 * likely to be enthusiastic than automated.
 */
describe('a new account’s first day', () => {
  test('gets a few shares, and is told it is temporary and not about their writing', async () => {
    const cookie = await register('brand-new@example.com');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const reflection = await writeReflection(cookie, `Early ${attempt}`);
      expect((await publish(cookie, reflection, AUDIENCES.PUBLIC)).status).toBe(201);
    }

    const reflection = await writeReflection(cookie, 'One more');
    const refused = await call<{ refusal: string; error: string }>(cookie, '/api/publications', {
      method: 'POST',
      body: JSON.stringify({ conversationId: reflection, audience: AUDIENCES.PUBLIC }),
    });
    expect(refused.status).toBe(429);
    expect(refused.body.refusal).toBe('new_account');
    expect(refused.body.error).toMatch(/eases off after your first day/i);
    expect(refused.body.error).toMatch(/everything you write stays yours/i);
  });
});

/*
 * Personal controls are not moderation, and the difference is the whole point:
 * a reader gets what they want immediately, nobody is accused of anything, and
 * no moderator has to agree first.
 */
describe('hide and mute', () => {
  async function twoPeopleAndAPublication() {
    const author = await register('author-hide@example.com');
    const reader = await register('reader-hide@example.com');
    const reflection = await writeReflection(author, 'Something shared');
    const shared = await publish(author, reflection, AUDIENCES.PUBLIC);
    return { author, reader, publicationId: shared.body.id };
  }

  test('hiding takes a publication out of one reader’s sight and nobody else’s', async () => {
    const { author, reader, publicationId } = await twoPeopleAndAPublication();

    const hidden = await call(reader, `/api/publications/${publicationId}/hide-for-me`, {
      method: 'POST',
      body: JSON.stringify({ hidden: true }),
    });
    expect(hidden.status).toBe(200);

    /* Gone for them, including by direct link — that is what hiding means. */
    expect((await call(reader, `/api/publications/${publicationId}`)).status).toBe(404);
    const feed = await call<{ items: Publication[] }>(reader, '/api/publications?scope=public');
    expect(feed.body.items.map((item) => item.id)).not.toContain(publicationId);

    /* Untouched for everybody else, and for its author. */
    expect((await call(author, `/api/publications/${publicationId}`)).status).toBe(200);
    const third = await register('third-hide@example.com');
    expect((await call(third, `/api/publications/${publicationId}`)).status).toBe(200);
  });

  test('and it is reversible, because it was never a punishment', async () => {
    const { reader, publicationId } = await twoPeopleAndAPublication();
    await call(reader, `/api/publications/${publicationId}/hide-for-me`, {
      method: 'POST',
      body: JSON.stringify({ hidden: true }),
    });
    await call(reader, `/api/publications/${publicationId}/hide-for-me`, {
      method: 'POST',
      body: JSON.stringify({ hidden: false }),
    });
    expect((await call(reader, `/api/publications/${publicationId}`)).status).toBe(200);
  });

  test('muting an author hides what they share from that reader alone', async () => {
    const { author, reader, publicationId } = await twoPeopleAndAPublication();
    const muted = await call(reader, `/api/publications/${publicationId}/mute-author`, {
      method: 'POST',
      body: JSON.stringify({ muted: true }),
    });
    expect(muted.status).toBe(200);

    /* Everything of theirs, not only the one that prompted it. */
    const second = await writeReflection(author, 'Another one');
    const alsoShared = await publish(author, second, AUDIENCES.PUBLIC);
    expect((await call(reader, `/api/publications/${alsoShared.body.id}`)).status).toBe(404);

    /* The author notices nothing: their own work is exactly where it was. */
    expect((await call(author, `/api/publications/${alsoShared.body.id}`)).status).toBe(200);
  });
});

describe('reporting', () => {
  test('“Something else” needs a sentence somebody can act on', async () => {
    const author = await register('reported@example.com');
    const reader = await register('reporter@example.com');
    const reflection = await writeReflection(author, 'Shared publicly');
    const shared = await publish(author, reflection, AUDIENCES.PUBLIC);

    const empty = await call(reader, `/api/publications/${shared.body.id}/report`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'other', detail: '' }),
    });
    expect(empty.status).toBe(400);

    const explained = await call(reader, `/api/publications/${shared.body.id}/report`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'other', detail: 'It links to a phishing page.' }),
    });
    expect(explained.status).toBe(201);

    /* And a report is an allegation: nothing about the publication changed. */
    expect((await call(reader, `/api/publications/${shared.body.id}`)).status).toBe(200);
  });
});

/*
 * A share is where a reflection went, not how many times somebody pressed the
 * button. The feed filling with three identical cards is what happens when a
 * share has no identity of its own.
 */
describe('one share per destination', () => {
  test('sharing the same reflection again updates it instead of piling up', async () => {
    const cookie = await register('repeat@example.com');
    const id = await makeCommunity(cookie, 'One room', 'private');
    const reflection = await writeReflection(cookie, 'Said once');

    const first = await publish(cookie, reflection, AUDIENCES.COMMUNITY, { communityId: id });
    expect(first.status).toBe(201);

    /* Pressing Share again on the same reflection, into the same community. */
    const again = await call<{ id: string; alreadyShared?: boolean }>(cookie, '/api/publications', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: reflection,
        audience: AUDIENCES.COMMUNITY,
        communityId: id,
        caption: 'A second thought about it',
      }),
    });
    expect(again.status).toBe(200);
    expect(again.body.alreadyShared).toBe(true);
    /* The same share, not a new one. */
    expect(again.body.id).toBe(first.body.id);

    const feed = await call<{ items: Publication[] }>(cookie, '/api/publications?scope=shared');
    expect(feed.body.items).toHaveLength(1);
    expect(feed.body.items[0]!.caption).toBe('A second thought about it');
  });

  test('a different community is a different destination', async () => {
    const cookie = await register('two-rooms@example.com');
    const first = await makeCommunity(cookie, 'First room', 'private');
    const second = await makeCommunity(cookie, 'Second room', 'private');
    const reflection = await writeReflection(cookie, 'Said in both');

    await publish(cookie, reflection, AUDIENCES.COMMUNITY, { communityId: first });
    await publish(cookie, reflection, AUDIENCES.COMMUNITY, { communityId: second });

    const feed = await call<{ items: Publication[] }>(cookie, '/api/publications?scope=shared');
    expect(feed.body.items).toHaveLength(2);
  });

  test('re-sharing keeps what people did with it, and spends no allowance', async () => {
    const author = await register('keeper@example.com');
    const reader = await register('encourager@example.com');
    const id = await makeCommunity(author, 'One room', 'private');
    await invite(author, id, 'encourager@example.com');
    await accept(reader, id);

    const reflection = await writeReflection(author, 'Encouraged once');
    const shared = await publish(author, reflection, AUDIENCES.COMMUNITY, { communityId: id });
    await call(reader, `/api/publications/${shared.body.id}/encouraged`, { method: 'POST' });

    await publish(author, reflection, AUDIENCES.COMMUNITY, { communityId: id });

    /* The reaction is on the share, and the share is still the same one. */
    const view = await call<{ encouraged: { count: number } }>(
      reader,
      `/api/publications/${shared.body.id}`,
    );
    expect(view.status).toBe(200);
    expect(view.body.encouraged.count).toBe(1);
  });

  test('unsharing and sharing again is a new share, because it really was removed', async () => {
    const cookie = await register('removed-then-back@example.com');
    const id = await makeCommunity(cookie, 'One room', 'private');
    const reflection = await writeReflection(cookie, 'Taken back');

    const first = await publish(cookie, reflection, AUDIENCES.COMMUNITY, { communityId: id });
    await call(cookie, `/api/publications/${first.body.id}`, { method: 'DELETE' });

    const second = await publish(cookie, reflection, AUDIENCES.COMMUNITY, { communityId: id });
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);

    const feed = await call<{ items: Publication[] }>(cookie, '/api/publications?scope=shared');
    expect(feed.body.items).toHaveLength(1);
  });
});
