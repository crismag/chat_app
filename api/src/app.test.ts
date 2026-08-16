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
      `/api/conversations/${conversation.id}/publish`,
      { method: 'POST', headers: { Cookie: owner.cookie } },
    );
    expect(published.status).toBe(200);

    const after = await app.request('/api/community', {
      headers: { Cookie: neighbor.cookie },
    });
    expect(await json<Array<{ id: string; publicationState: string }>>(after)).toEqual([
      expect.objectContaining({
        id: conversation.id,
        publicationState: 'published',
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
      body: JSON.stringify({ title: 'Romans 8' }),
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
    expect(await json<Array<{ scriptureReference: string | null }>>(mine)).toEqual([
      expect.objectContaining({ scriptureReference: 'John 15:5' }),
    ]);

    const theirs = await app.request('/api/library?q=John%2015', {
      headers: { Cookie: stranger.cookie },
    });
    expect(await json<unknown[]>(theirs)).toEqual([]);
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

    await app.request(`/api/conversations/${conversation.id}/publish`, {
      method: 'POST',
      headers: { Cookie: owner.cookie },
    });
    await app.request(`/api/conversations/${conversation.id}/unpublish`, {
      method: 'POST',
      headers: { Cookie: owner.cookie },
    });

    const feed = await app.request('/api/community', {
      headers: { Cookie: neighbor.cookie },
    });
    expect(await json<unknown[]>(feed)).toEqual([]);
  });
});
