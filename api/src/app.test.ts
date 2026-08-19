import { describe, expect, test } from 'vitest';
import { createApp } from './app.ts';
import { MemoryStore } from './store.ts';

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function register(
  app: ReturnType<typeof createApp>,
  email: string,
  password = 'secret12',
) {
  const response = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const cookie = response.headers.get('set-cookie') ?? '';
  return { response, cookie };
}

describe('GET /api/health', () => {
  test('returns an ok health payload', async () => {
    const app = createApp(new MemoryStore());
    const response = await app.request('/api/health');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: 'ok',
      service: 'chat-api',
      timestamp: expect.any(String),
    });
  });
});

describe('private conversation loop', () => {
  test('a user can create a conversation, leave, and continue it', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'ada@example.com');

    const created = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        title: 'John 15',
        scriptureReference: 'John 15:5',
      }),
    });
    expect(created.status).toBe(201);
    const conversation = await json<{ id: string }>(created);

    const message = await app.request(
      `/api/conversations/${conversation.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          content: 'I remain in the vine when I stay close to Jesus.',
        }),
      },
    );
    expect(message.status).toBe(201);

    const listed = await app.request('/api/conversations', {
      headers: { Cookie: cookie },
    });
    const listBody = await json<Array<{ id: string; title: string }>>(listed);
    expect(listBody).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: conversation.id, title: 'John 15' }),
      ]),
    );

    const opened = await app.request(`/api/conversations/${conversation.id}`, {
      headers: { Cookie: cookie },
    });
    const openedBody = await json<{ messages: Array<{ content: string }> }>(opened);
    expect(openedBody.messages).toHaveLength(1);
    expect(openedBody.messages[0]?.content).toContain('vine');
  });

  test('another user cannot retrieve a private conversation', async () => {
    const app = createApp(new MemoryStore());
    const owner = await register(app, 'owner@example.com');
    const stranger = await register(app, 'stranger@example.com');

    const created = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: owner.cookie },
      body: JSON.stringify({ title: 'Private reflection' }),
    });
    const conversation = await json<{ id: string }>(created);

    const stolen = await app.request(`/api/conversations/${conversation.id}`, {
      headers: { Cookie: stranger.cookie },
    });
    expect(stolen.status).toBe(404);

    const community = await app.request('/api/community', {
      headers: { Cookie: stranger.cookie },
    });
    const feed = await json<unknown[]>(community);
    expect(feed).toEqual([]);
  });
});

describe('publication and community', () => {
  test('only an explicit publish makes an entry community-visible', async () => {
    const app = createApp(new MemoryStore());
    const owner = await register(app, 'owner@example.com');
    const neighbor = await register(app, 'neighbor@example.com');

    const created = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: owner.cookie },
      body: JSON.stringify({
        title: 'To share later',
        scriptureReference: 'Psalm 46:10',
      }),
    });
    const conversation = await json<{ id: string }>(created);

    const before = await app.request('/api/community', {
      headers: { Cookie: neighbor.cookie },
    });
    expect(await json<unknown[]>(before)).toEqual([]);

    /*
     * Publication enforces the content-format rules, so the reflection has to
     * be a complete one before it can be shared. An empty C.H.A.T. is a draft
     * by definition.
     */
    for (const type of ['content', 'heart', 'application', 'testimony'] as const) {
      await app.request(`/api/conversations/${conversation.id}/sections`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: owner.cookie },
        body: JSON.stringify({ type, content: `A short ${type} from the author.` }),
      });
    }

    const published = await app.request(
      `/api/conversations/${conversation.id}/share`,
      { method: 'POST', headers: { Cookie: owner.cookie } },
    );
    expect(published.status).toBe(200);

    const after = await app.request('/api/community', {
      headers: { Cookie: neighbor.cookie },
    });
    expect(await json<Array<{ id: string; visibility: string }>>(after)).toEqual([
      expect.objectContaining({
        id: conversation.id,
        visibility: 'shared',
      }),
    ]);
  });
});

describe('C.H.A.T. extraction authorship', () => {
  test('extract leaves Heart and Testimony empty when the user did not express them', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'ada@example.com');

    const created = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'Psalm 23' }),
    });
    const conversation = await json<{ id: string }>(created);

    await app.request(`/api/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        content: 'The psalm describes the Lord as a shepherd who leads.',
      }),
    });

    const extracted = await app.request(
      `/api/conversations/${conversation.id}/ai`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ action: 'extract_chat' }),
      },
    );
    expect(extracted.status).toBe(200);
    const body = await json<{
      applied?: boolean;
      proposed?: Record<string, { content: string }>;
      sections?: Record<string, { content: string }>;
    }>(extracted);

    // What it proposes: Content only. Nothing was said that Heart or Testimony
    // could be honestly drawn from, so neither is offered.
    expect(body.applied).toBe(false);
    expect(body.proposed?.['content']?.content.length).toBeGreaterThan(0);
    expect(body.proposed?.['heart']).toBeUndefined();
    expect(body.proposed?.['testimony']).toBeUndefined();

    // And nothing has been written yet: a proposal is not a save.
    expect(body.sections?.['content']?.content).toBe('');
  });

  /*
   * The regression this repository exists to not repeat.
   *
   * "Extract from conversation" replaced the entire section record with one
   * built from empty strings, so every section the author had typed by hand was
   * silently deleted. Written from the author's side: four sections in, four
   * sections still there afterwards.
   */
  test('extraction cannot delete sections the author wrote by hand', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'ada@example.com');
    const created = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'Romans 8', scriptureReference: 'Romans 8:28' }),
    });
    const conversation = await json<{ id: string }>(created);

    await app.request(`/api/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ content: 'All things work together for good.' }),
    });

    const written = {
      content: 'Paul is writing to a church under pressure.',
      heart: 'It met me on a week I could not see the good.',
      application: 'I will pray before I answer my brother.',
      testimony: 'I declare that he is working even where I cannot see it.',
    } as const;

    for (const [type, content] of Object.entries(written)) {
      const saved = await app.request(`/api/conversations/${conversation.id}/sections`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ type, content }),
      });
      expect(saved.status).toBe(200);
    }

    await app.request(`/api/conversations/${conversation.id}/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ action: 'extract_chat' }),
    });

    const after = await app.request(`/api/conversations/${conversation.id}`, {
      headers: { Cookie: cookie },
    });
    const detail = await json<{
      sections: Record<string, { content: string; authorOrigin: string }>;
    }>(after);

    for (const [type, content] of Object.entries(written)) {
      expect(detail.sections[type]?.content).toBe(content);
      expect(detail.sections[type]?.authorOrigin).toBe('user');
    }
  });

  test('accepting an extraction records that the model assisted', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'ada@example.com');
    const created = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'Psalm 23' }),
    });
    const conversation = await json<{ id: string }>(created);

    await app.request(`/api/conversations/${conversation.id}/sections`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        type: 'content',
        content: 'A shepherd psalm.',
        authorOrigin: 'ai_assisted',
      }),
    });

    const after = await app.request(`/api/conversations/${conversation.id}`, {
      headers: { Cookie: cookie },
    });
    const detail = await json<{ sections: Record<string, { authorOrigin: string }> }>(after);
    expect(detail.sections['content']?.authorOrigin).toBe('ai_assisted');
  });
});

/*
 * Suggesting a title.
 *
 * A title is a label rather than a confession, so proposing one is legitimate
 * where proposing a Testimony is not. The two properties that keep it safe are
 * worth holding whatever ends up behind the seam: it must fit the format, and
 * it must not write anything.
 */
describe('suggesting a title', () => {
  async function withWriting(
    app: ReturnType<typeof createApp>,
    cookie: string,
    content: string,
    format: 'full' | 'condensed' = 'full',
  ) {
    const created = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ scriptureReference: 'Romans 8:28', format }),
    });
    const conversation = await json<{ id: string; title: string }>(created);
    await app.request(`/api/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ content }),
    });
    return conversation;
  }

  const suggest = (app: ReturnType<typeof createApp>, cookie: string, id: string) =>
    app.request(`/api/conversations/${id}/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ action: 'suggest_title' }),
    });

  test('suggestions are drawn from what the author actually wrote', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'ada@example.com');
    const conversation = await withWriting(
      app,
      cookie,
      'The week I could not see it. Nothing about this looked like good.',
    );

    const response = await suggest(app, cookie, conversation.id);
    expect(response.status).toBe(200);
    const body = await json<{ applied: boolean; suggestions: string[] }>(response);

    expect(body.applied).toBe(false);
    expect(body.suggestions.length).toBeGreaterThan(0);
    expect(body.suggestions[0]).toContain('The week I could not see it');
    // The passage is how most people name a reflection out loud.
    expect(body.suggestions.some((s) => s.includes('Romans 8:28'))).toBe(true);
  });

  test('a suggestion never exceeds the format’s own title limit', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'ada@example.com');

    // One enormous sentence, so trimming is the only way anything fits.
    const flood = `${'a very long clause about the passage '.repeat(30)}.`;

    for (const [format, limits] of [
      ['full', { recommended: 60, hard: 100 }],
      ['condensed', { recommended: 50, hard: 80 }],
    ] as const) {
      const conversation = await withWriting(app, cookie, flood, format);
      const body = await json<{ suggestions: string[] }>(
        await suggest(app, cookie, conversation.id),
      );

      expect(body.suggestions.length).toBeGreaterThan(0);
      for (const suggestion of body.suggestions) {
        expect(suggestion.length).toBeLessThanOrEqual(limits.hard);
        expect(suggestion.length).toBeLessThanOrEqual(limits.recommended);
        expect(suggestion).not.toMatch(/\s$/);
      }
    }
  });

  test('suggesting never changes the stored title', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'ada@example.com');
    const conversation = await withWriting(app, cookie, 'Something I wrote down.');

    await app.request(`/api/conversations/${conversation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'The name I chose myself' }),
    });

    await suggest(app, cookie, conversation.id);
    await suggest(app, cookie, conversation.id);

    const after = await app.request(`/api/conversations/${conversation.id}`, {
      headers: { Cookie: cookie },
    });
    expect((await json<{ title: string }>(after)).title).toBe('The name I chose myself');
  });

  test('with nothing written, it says so rather than inventing one', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'ada@example.com');
    const created = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    });
    const conversation = await json<{ id: string }>(created);

    const response = await suggest(app, cookie, conversation.id);
    expect(response.status).toBe(422);
    expect((await json<{ error: string }>(response)).error).toMatch(/not enough written/i);
  });

  test('when assistance is switched off it refuses, with a reason', async () => {
    process.env['CHAT_AI_DISABLED'] = '1';
    try {
      const app = createApp(new MemoryStore());
      const { cookie } = await register(app, 'ada@example.com');
      const conversation = await withWriting(app, cookie, 'Something I wrote down.');

      const response = await suggest(app, cookie, conversation.id);
      expect(response.status).toBe(503);
      expect((await json<{ error: string }>(response)).error).toMatch(/switched off/i);

      const status = await app.request('/api/ai/status');
      expect(await json<{ enabled: boolean }>(status)).toMatchObject({ enabled: false });
    } finally {
      delete process.env['CHAT_AI_DISABLED'];
    }
  });
});

describe('editing a reflection', () => {
  async function start(app: ReturnType<typeof createApp>, cookie: string) {
    const created = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    });
    return json<{ id: string; title: string }>(created);
  }

  test('title, Scripture reference and format can all be changed after starting', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'ada@example.com');
    const conversation = await start(app, cookie);

    const patched = await app.request(`/api/conversations/${conversation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        title: 'The week I could not see it',
        scriptureReference: 'Romans 8:28',
        format: 'condensed',
      }),
    });
    expect(patched.status).toBe(200);

    const reloaded = await app.request(`/api/conversations/${conversation.id}`, {
      headers: { Cookie: cookie },
    });
    const detail = await json<{
      title: string;
      scriptureReference: string;
      format: string;
    }>(reloaded);
    expect(detail).toMatchObject({
      title: 'The week I could not see it',
      scriptureReference: 'Romans 8:28',
      format: 'condensed',
    });
  });

  test('changing format keeps both drafts', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'ada@example.com');
    const conversation = await start(app, cookie);

    await app.request(`/api/conversations/${conversation.id}/sections`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ type: 'heart', content: 'It met me where I was.' }),
    });
    await app.request(`/api/conversations/${conversation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ format: 'condensed' }),
    });
    await app.request(`/api/conversations/${conversation.id}/sections`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ type: 'reflection', content: 'A shorter telling of it.' }),
    });

    const reloaded = await app.request(`/api/conversations/${conversation.id}`, {
      headers: { Cookie: cookie },
    });
    const detail = await json<{
      sections: Record<string, { content: string }>;
      condensed: Record<string, { content: string }>;
    }>(reloaded);

    expect(detail.sections['heart']?.content).toBe('It met me where I was.');
    expect(detail.condensed['reflection']?.content).toBe('A shorter telling of it.');
  });

  test('an over-long title is refused with the numbers, never trimmed', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'ada@example.com');
    const conversation = await start(app, cookie);

    const response = await app.request(`/api/conversations/${conversation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'x'.repeat(140) }),
    });
    expect(response.status).toBe(422);
    const body = await json<{ validation: { field: string; length: number; hard: number } }>(
      response,
    );
    expect(body.validation).toMatchObject({ field: 'title', length: 140, hard: 100 });
  });

  test('a deleted reflection takes its messages and sections with it', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'ada@example.com');
    const conversation = await start(app, cookie);

    await app.request(`/api/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ content: 'Something written down.' }),
    });
    await app.request(`/api/conversations/${conversation.id}/sections`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ type: 'heart', content: 'And something felt.' }),
    });

    const deleted = await app.request(`/api/conversations/${conversation.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(deleted.status).toBe(200);

    const gone = await app.request(`/api/conversations/${conversation.id}`, {
      headers: { Cookie: cookie },
    });
    expect(gone.status).toBe(404);

    const list = await app.request('/api/conversations', { headers: { Cookie: cookie } });
    expect(await json<unknown[]>(list)).toEqual([]);
  });

  test('one person cannot delete another person’s reflection', async () => {
    const app = createApp(new MemoryStore());
    const owner = await register(app, 'owner@example.com');
    const stranger = await register(app, 'stranger@example.com');
    const conversation = await start(app, owner.cookie);

    const attempt = await app.request(`/api/conversations/${conversation.id}`, {
      method: 'DELETE',
      headers: { Cookie: stranger.cookie },
    });
    expect(attempt.status).toBe(404);

    const still = await app.request(`/api/conversations/${conversation.id}`, {
      headers: { Cookie: owner.cookie },
    });
    expect(still.status).toBe(200);
  });

  test('grammar assistance preserves the original message', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'ada@example.com');
    const created = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'Draft' }),
    });
    const conversation = await json<{ id: string }>(created);
    const posted = await app.request(
      `/api/conversations/${conversation.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ content: 'this is my rough note' }),
      },
    );
    const message = await json<{ id: string }>(posted);

    const revised = await app.request(
      `/api/conversations/${conversation.id}/ai`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ action: 'grammar', messageId: message.id }),
      },
    );
    const body = await json<{ original: string; revised: string; replaced: boolean }>(revised);
    expect(body.original).toBe('this is my rough note');
    expect(body.revised).not.toBeUndefined();
    expect(body.replaced).toBe(false);

    const opened = await app.request(`/api/conversations/${conversation.id}`, {
      headers: { Cookie: cookie },
    });
    const openedBody = await json<{ messages: Array<{ content: string }> }>(opened);
    expect(openedBody.messages[0]?.content).toBe('this is my rough note');
  });
});

describe('library search', () => {
  test('finds the owner conversation by scripture reference and hides others', async () => {
    const app = createApp(new MemoryStore());
    const owner = await register(app, 'owner@example.com');
    const stranger = await register(app, 'stranger@example.com');

    await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: owner.cookie },
      body: JSON.stringify({
        title: 'Abide',
        scriptureReference: 'John 15:5',
      }),
    });

    const mine = await app.request('/api/library?q=John%2015', {
      headers: { Cookie: owner.cookie },
    });
    expect(await json<{ items: Array<{ scriptureReference: string | null }> }>(mine)).toEqual(
      expect.objectContaining({
        items: [expect.objectContaining({ scriptureReference: 'John 15:5' })],
      }),
    );

    const theirs = await app.request('/api/library?q=John%2015', {
      headers: { Cookie: stranger.cookie },
    });
    expect(await json<{ items: unknown[] }>(theirs)).toEqual(
      expect.objectContaining({ items: [] }),
    );
  });

  test('filters by book, written section, tag and day', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'owner@example.com');
    const created = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'Abide', scriptureReference: 'Jn 15:5' }),
    });
    const conversation = await json<{ id: string }>(created);
    await app.request(`/api/conversations/${conversation.id}/sections`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ type: 'heart', content: 'It met my fear.' }),
    });
    await app.request(`/api/conversations/${conversation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ tags: ['faith'] }),
    });

    const byBook = await json<{ items: unknown[]; books: { usfm: string }[] }>(
      await app.request('/api/reflections?book=John', { headers: { Cookie: cookie } }),
    );
    expect(byBook.items).toHaveLength(1);
    expect(byBook.books).toEqual([expect.objectContaining({ usfm: 'JHN' })]);

    const bySection = await json<{ items: unknown[] }>(
      await app.request('/api/reflections?section=heart', { headers: { Cookie: cookie } }),
    );
    expect(bySection.items).toHaveLength(1);
    const emptySection = await json<{ items: unknown[] }>(
      await app.request('/api/reflections?section=testimony', { headers: { Cookie: cookie } }),
    );
    expect(emptySection.items).toHaveLength(0);

    const byTag = await json<{ items: unknown[]; tags: { tag: string }[] }>(
      await app.request('/api/reflections?tag=faith', { headers: { Cookie: cookie } }),
    );
    expect(byTag.items).toHaveLength(1);
    expect(byTag.tags).toEqual([expect.objectContaining({ tag: 'faith' })]);

    const day = new Date().toISOString().slice(0, 10);
    const today = await json<{ items: unknown[] }>(
      await app.request(`/api/reflections?from=${day}&to=${day}`, { headers: { Cookie: cookie } }),
    );
    expect(today.items).toHaveLength(1);
    const lastYear = await json<{ items: unknown[] }>(
      await app.request('/api/reflections?to=2020-01-01', { headers: { Cookie: cookie } }),
    );
    expect(lastYear.items).toHaveLength(0);
  });
});

describe('unpublish', () => {
  test('unpublish removes a conversation from the community feed', async () => {
    const app = createApp(new MemoryStore());
    const owner = await register(app, 'owner@example.com');
    const neighbor = await register(app, 'neighbor@example.com');

    const created = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: owner.cookie },
      body: JSON.stringify({ title: 'Shared then private' }),
    });
    const conversation = await json<{ id: string }>(created);

    await app.request(`/api/conversations/${conversation.id}/share`, {
      method: 'POST',
      headers: { Cookie: owner.cookie },
    });
    await app.request(`/api/conversations/${conversation.id}/make-private`, {
      method: 'POST',
      headers: { Cookie: owner.cookie },
    });

    const feed = await app.request('/api/community', {
      headers: { Cookie: neighbor.cookie },
    });
    expect(await json<unknown[]>(feed)).toEqual([]);
  });
});

/*
 * Pagination is the server's job.
 *
 * The collection has to work with a thousand reflections, and it cannot do
 * that by being sent a thousand and hiding rows. These assert that the page is
 * cut here, and that `total` describes the whole matching set rather than the
 * slice.
 */
describe('GET /api/reflections, paged', () => {
  async function withReflections(count: number) {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'pager@example.com');
    for (let i = 0; i < count; i += 1) {
      await app.request('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ title: `Reflection ${String(i).padStart(3, '0')}` }),
      });
    }
    return { app, cookie };
  }

  const page = (body: { items: { title: string }[] }) => body.items.map((item) => item.title);

  test('returns one page and the size of the whole set', async () => {
    const { app, cookie } = await withReflections(25);
    const body = await json<{ items: unknown[]; total: number; page: number; pageCount: number; pageSize: number }>(
      await app.request('/api/reflections?pageSize=10', { headers: { Cookie: cookie } }),
    );
    expect(body.items).toHaveLength(10);
    expect(body.total).toBe(25);
    expect(body.pageCount).toBe(3);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(10);
  });

  test('a later page carries different reflections, and the last one is short', async () => {
    const { app, cookie } = await withReflections(25);
    const first = await json<{ items: { title: string }[] }>(
      await app.request('/api/reflections?pageSize=10&page=1&sort=title', { headers: { Cookie: cookie } }),
    );
    const last = await json<{ items: { title: string }[] }>(
      await app.request('/api/reflections?pageSize=10&page=3&sort=title', { headers: { Cookie: cookie } }),
    );
    expect(page(last)).toHaveLength(5);
    expect(page(first).some((title) => page(last).includes(title))).toBe(false);
  });

  /* A stale link or a narrowed filter, which must not read as "you have none". */
  test('a page past the end answers with the last page, not an empty one', async () => {
    const { app, cookie } = await withReflections(12);
    const body = await json<{ items: unknown[]; page: number }>(
      await app.request('/api/reflections?pageSize=10&page=99', { headers: { Cookie: cookie } }),
    );
    expect(body.page).toBe(2);
    expect(body.items).toHaveLength(2);
  });

  test('100 is the ceiling, and anything else falls back to the default', async () => {
    const { app, cookie } = await withReflections(3);
    const capped = await json<{ pageSize: number }>(
      await app.request('/api/reflections?pageSize=500', { headers: { Cookie: cookie } }),
    );
    expect(capped.pageSize).toBe(20);
    const odd = await json<{ pageSize: number }>(
      await app.request('/api/reflections?pageSize=37', { headers: { Cookie: cookie } }),
    );
    expect(odd.pageSize).toBe(20);
  });

  /*
   * Finished and private are independent questions. A single filter made them
   * exclusive, which they never were.
   */
  test('status and visibility narrow separately', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'facets@example.com');
    await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'A draft' }),
    });

    const drafts = await json<{ total: number }>(
      await app.request('/api/reflections?status=draft', { headers: { Cookie: cookie } }),
    );
    expect(drafts.total).toBe(1);

    const complete = await json<{ total: number }>(
      await app.request('/api/reflections?status=complete', { headers: { Cookie: cookie } }),
    );
    expect(complete.total).toBe(0);

    const priv = await json<{ total: number }>(
      await app.request('/api/reflections?visibility=private', { headers: { Cookie: cookie } }),
    );
    expect(priv.total).toBe(1);

    const shared = await json<{ total: number }>(
      await app.request('/api/reflections?visibility=shared', { headers: { Cookie: cookie } }),
    );
    expect(shared.total).toBe(0);
  });
});

/*
 * The invariant the whole vocabulary change exists to protect.
 *
 * A reflection is private until somebody shares it. Not when it is saved, not
 * when every section is written, not when it validates — only when a person
 * asks. "Published" implied a lifecycle a reflection moved along; these say
 * plainly that it does not move on its own.
 */
describe('sharing is always an explicit act', () => {
  async function reflection(app: ReturnType<typeof createApp>, cookie: string) {
    const created = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'Romans 8', scriptureReference: 'Romans 8:28' }),
    });
    return json<{ id: string; visibility: string }>(created);
  }

  test('a new reflection is private', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'private-by-default@example.com');
    expect((await reflection(app, cookie)).visibility).toBe('private');
  });

  test('writing every section does not share it', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'complete-stays-private@example.com');
    const made = await reflection(app, cookie);

    for (const type of ['content', 'heart', 'application', 'testimony']) {
      await app.request(`/api/conversations/${made.id}/sections`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ type, content: `Something written in ${type}.` }),
      });
    }

    const after = await json<{ visibility: string }>(
      await app.request(`/api/conversations/${made.id}`, { headers: { Cookie: cookie } }),
    );
    expect(after.visibility).toBe('private');

    /* And it is still absent from anything anyone else can read. */
    const community = await json<unknown[]>(
      await app.request('/api/community', { headers: { Cookie: cookie } }),
    );
    expect(community).toHaveLength(0);
  });

  test('sharing, and then taking it back', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'share-then-private@example.com');
    const made = await reflection(app, cookie);
    for (const type of ['content', 'heart', 'application', 'testimony']) {
      await app.request(`/api/conversations/${made.id}/sections`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ type, content: `Something written in ${type}.` }),
      });
    }

    const response = await app.request(`/api/conversations/${made.id}/share`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect((await json<{ visibility: string }>(response)).visibility).toBe('shared');

    const back = await json<{ visibility: string }>(
      await app.request(`/api/conversations/${made.id}/make-private`, {
        method: 'POST',
        headers: { Cookie: cookie },
      }),
    );
    expect(back.visibility).toBe('private');
  });

  /* The old verbs are gone, not aliased. */
  test('the publish routes no longer exist', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await register(app, 'no-publish-route@example.com');
    const made = await reflection(app, cookie);
    for (const path of ['publish', 'unpublish']) {
      const response = await app.request(`/api/conversations/${made.id}/${path}`, {
        method: 'POST',
        headers: { Cookie: cookie },
      });
      expect(response.status).toBe(404);
    }
  });
});
