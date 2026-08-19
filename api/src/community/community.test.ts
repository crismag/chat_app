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

beforeEach(() => {
  app = createApp(new SqliteStore());
});

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

async function makeCommunity(cookie: string, name: string): Promise<string> {
  const created = await call<{ id: string }>(cookie, '/api/communities', {
    method: 'POST',
    body: JSON.stringify({ name, description: 'A small circle.' }),
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

  test('authorOrigin provenance survives into the published content', async () => {
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
    expect(content?.authorOrigin).toBe('ai_assisted');
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
