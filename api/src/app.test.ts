import { describe, expect, test } from 'vitest';
import { createApp } from './app.ts';
import { MemoryStore } from './store.ts';
import { cookieHeader, cookieNamed as namedCookie } from './http/set-cookie.ts';

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
  return { response, cookie: cookieHeader(response.headers.get('set-cookie')) };
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

    const mine = await app.request('/api/reflections?q=John%2015', {
      headers: { Cookie: owner.cookie },
    });
    expect(await json<{ items: Array<{ scriptureReference: string | null }> }>(mine)).toEqual(
      expect.objectContaining({
        items: [expect.objectContaining({ scriptureReference: 'John 15:5' })],
      }),
    );

    const theirs = await app.request('/api/reflections?q=John%2015', {
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

/*
 * The login wall, and what replaced it.
 *
 * A visitor writes first and decides about an account later. These say that
 * plainly: no session is needed to create or read your own work, ownership is
 * still proved on every request, and neither way of acquiring an account loses
 * anything written before it.
 */
describe('writing as a guest', () => {
  const cookieNamed = (response: Response, name: string) =>
    namedCookie(response.headers.get('set-cookie'), name);

  const cookieFrom = (response: Response) => cookieHeader(response.headers.get('set-cookie'));

  const post = (app: ReturnType<typeof createApp>, path: string, cookie: string, body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    });

  /** Take the choice a visitor is offered, and keep the credential. */
  async function continueAsGuest(app: ReturnType<typeof createApp>) {
    const response = await post(app, '/api/auth/guest', '', {
      creationSource: 'REFLECTION_CREATE',
      platform: 'WEB',
    });
    expect(response.status).toBe(201);
    return {
      response,
      cookie: cookieHeader(response.headers.get('set-cookie')),
      account: await json<Record<string, unknown>>(response),
    };
  }

  const reflection = (app: ReturnType<typeof createApp>, cookie: string, title = 'Written as a guest') =>
    post(app, '/api/conversations', cookie, { title });

  test('a visitor is asked to choose rather than given an account', async () => {
    const app = createApp(new MemoryStore());
    const response = await reflection(app, '');
    expect(response.status).toBe(401);
    /* What the client keys on to show the two ways of being somebody. */
    expect(await json<{ needsAccount: boolean }>(response)).toMatchObject({ needsAccount: true });
    /* Nothing was created and nothing was set on the way past. */
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  test('reading a page creates nobody', async () => {
    const app = createApp(new MemoryStore());
    const listed = await app.request('/api/conversations');
    expect(listed.status).toBe(200);
    expect(listed.headers.get('set-cookie')).toBeNull();
    expect((await app.request('/api/auth/me')).status).toBe(401);
  });

  test('a guest is a real user, with a name and a protected credential', async () => {
    const app = createApp(new MemoryStore());
    const { response, account } = await continueAsGuest(app);
    expect(account['accountType']).toBe('ANONYMOUS');
    expect(account['id']).toBeTruthy();
    expect(account['guestName']).toMatch(/^[A-Z][a-zA-Z]+-\d+$/);

    const cookie = response.headers.get('set-cookie') ?? '';
    /*
     * Two credentials, not one. The installation is durable recognition of
     * this browser; the session is the current interaction, and ending it must
     * not be what destroys a guest's only way back to their reflections.
     */
    expect(cookie).toMatch(/chat_install=/);
    expect(cookie).toMatch(/chat_session=/);
    /* The id alone proves nothing: a secret travels with it. */
    expect(cookieNamed(response, 'chat_install')).toMatch(/^chat_install=[^.]+\..+/);
    /* Bearer credentials for everything they write: script may not read them. */
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  test('asking twice returns the same guest, not a second one', async () => {
    const app = createApp(new MemoryStore());
    const first = await continueAsGuest(app);
    const again = await post(app, '/api/auth/guest', first.cookie, {});
    expect(again.status).toBe(200);
    expect((await json<{ id: string }>(again)).id).toBe(first.account['id']);
  });

  test('a guest owns what they write, and nobody else sees it', async () => {
    const app = createApp(new MemoryStore());
    const { cookie } = await continueAsGuest(app);
    const mine = await json<{ id: string }>(await reflection(app, cookie));

    const listed = await json<{ id: string }[]>(
      await app.request('/api/conversations', { headers: { Cookie: cookie } }),
    );
    expect(listed.map((item) => item.id)).toEqual([mine.id]);

    /* Another browser is another guest, and sees none of it. */
    expect(await json<unknown[]>(await app.request('/api/conversations'))).toEqual([]);
    expect((await app.request(`/api/conversations/${mine.id}`)).status).toBe(404);
  });

  test('a credential naming nobody is nobody', async () => {
    const app = createApp(new MemoryStore());
    const response = await app.request('/api/conversations', {
      headers: { Cookie: 'chat_install=not-a-real.credential' },
    });
    expect(response.status).toBe(200);
    expect(await json<unknown[]>(response)).toEqual([]);
  });

  /*
   * The product invariant: registering claims the account that already exists,
   * so the id does not change and nothing that points at it has to be found.
   */
  test('registering upgrades the guest in place, keeping the same user id', async () => {
    const app = createApp(new MemoryStore());
    const { cookie, account } = await continueAsGuest(app);
    const before = await json<{ id: string }>(await reflection(app, cookie));

    const registered = await post(app, '/api/auth/register', cookie, {
      email: 'claims@example.com',
      password: 'a-long-password',
    });
    expect(registered.status).toBe(201);
    const body = await json<Record<string, unknown>>(registered);
    expect(body['id']).toBe(account['id']);
    expect(body['accountType']).toBe('REGISTERED');
    /* The name they were known by is kept rather than thrown away. */
    expect(body['guestName']).toBe(account['guestName']);

    const session = cookieFrom(registered);
    const listed = await json<{ id: string }[]>(
      await app.request('/api/conversations', { headers: { Cookie: session } }),
    );
    expect(listed.map((item) => item.id)).toContain(before.id);
  });

  /*
   * The one case an upgrade cannot handle. The existing account is not
   * overwritten, no second account is made, and nothing is moved until the
   * person has proved the account is theirs.
   */
  test('an email that already has an account is refused, not overwritten', async () => {
    const app = createApp(new MemoryStore());
    await post(app, '/api/auth/register', '', {
      email: 'taken@example.com',
      password: 'a-long-password',
    });

    const { cookie } = await continueAsGuest(app);
    await reflection(app, cookie);
    const refused = await post(app, '/api/auth/register', cookie, {
      email: 'taken@example.com',
      password: 'another-password',
    });
    expect(refused.status).toBe(409);
    expect(await json<Record<string, unknown>>(refused)).toMatchObject({
      accountExists: true,
      guestReflections: 1,
    });
  });

  test('signing in merges the guest’s work into the account, keeping both', async () => {
    const app = createApp(new MemoryStore());

    const registered = await post(app, '/api/auth/register', '', {
      email: 'merger@example.com',
      password: 'a-long-password',
    });
    const firstSession = cookieFrom(registered);
    const accountReflection = (
      await json<{ id: string }>(await reflection(app, firstSession, 'From the account'))
    ).id;

    /* Another browser: a guest, who writes something and then signs in. */
    const { cookie } = await continueAsGuest(app);
    const guestReflection = (await json<{ id: string }>(await reflection(app, cookie))).id;

    const signedIn = await post(app, '/api/auth/login', cookie, {
      email: 'merger@example.com',
      password: 'a-long-password',
    });
    expect(await json<{ merged: number }>(signedIn)).toMatchObject({ merged: 1 });
    const session = cookieFrom(signedIn);

    const ids = (
      await json<{ id: string }[]>(
        await app.request('/api/conversations', { headers: { Cookie: session } }),
      )
    ).map((item) => item.id);
    expect(ids).toContain(accountReflection);
    expect(ids).toContain(guestReflection);
  });

  test('a merged guest’s credential is revoked, not left owning nothing', async () => {
    const app = createApp(new MemoryStore());
    await post(app, '/api/auth/register', '', {
      email: 'revoke@example.com',
      password: 'a-long-password',
    });
    const { cookie } = await continueAsGuest(app);
    await reflection(app, cookie);
    await post(app, '/api/auth/login', cookie, {
      email: 'revoke@example.com',
      password: 'a-long-password',
    });

    /* The old credential resolves to nobody now, rather than to an empty guest. */
    expect((await app.request('/api/auth/me', { headers: { Cookie: cookie } })).status).toBe(401);
  });

  /*
   * The two credentials do different jobs, and the difference is the whole
   * reason a guest can be signed out without being destroyed.
   */
  test('a guest whose session ended is still recognised', async () => {
    const app = createApp(new MemoryStore());
    const { response } = await continueAsGuest(app);
    const install = cookieNamed(response, 'chat_install')
    const mine = await json<{ id: string }>(
      await reflection(app, cookieHeader(response.headers.get('set-cookie'))),
    );

    /* The session is gone; only durable recognition of the browser remains. */
    const listed = await app.request('/api/conversations', { headers: { Cookie: install } });
    expect((await json<{ id: string }[]>(listed)).map((item) => item.id)).toEqual([mine.id]);
    /* And a session was quietly re-established rather than being demanded. */
    expect(cookieNamed(listed, 'chat_session')).not.toBe('');
  });

  test('the installation id alone is not a credential', async () => {
    const app = createApp(new MemoryStore());
    const { response } = await continueAsGuest(app);
    const [, credential] = cookieNamed(response, 'chat_install').split('=');
    const id = (credential ?? '').split('.')[0];

    const response2 = await app.request('/api/auth/me', {
      headers: { Cookie: `chat_install=${id}.` },
    });
    expect(response2.status).toBe(401);
    const guessed = await app.request('/api/auth/me', {
      headers: { Cookie: `chat_install=${id}.wrong-secret` },
    });
    expect(guessed.status).toBe(401);
  });

  test('forgetting a guest on this browser really forgets them', async () => {
    const app = createApp(new MemoryStore());
    const { cookie, response } = await continueAsGuest(app);
    await reflection(app, cookie);

    const forgotten = await post(app, '/api/auth/forget-installation', cookie, {});
    expect(forgotten.status).toBe(200);

    /* The credential that was their whole account no longer names anybody. */
    const install = cookieNamed(response, 'chat_install');
    expect((await app.request('/api/auth/me', { headers: { Cookie: install } })).status).toBe(401);
  });

  test('keeping signed in is what makes a browser remembered, and nothing else', async () => {
    const app = createApp(new MemoryStore());
    await post(app, '/api/auth/register', '', {
      email: 'shared@example.com',
      password: 'a-long-password',
    });

    /* On a shared computer: a session that dies with the window, and no more. */
    const temporary = await post(app, '/api/auth/login', '', {
      email: 'shared@example.com',
      password: 'a-long-password',
    });
    expect(cookieNamed(temporary, 'chat_install')).toBe('');
    expect(temporary.headers.get('set-cookie')).not.toMatch(/chat_session=[^;]+;[^,]*Max-Age/)

    /* On their own: durable recognition, because they asked for it. */
    const persistent = await post(app, '/api/auth/login', '', {
      email: 'shared@example.com',
      password: 'a-long-password',
      keepSignedIn: true,
    })
    const install = cookieNamed(persistent, 'chat_install')
    expect(install).not.toBe('')
    const restored = await app.request('/api/auth/me', { headers: { Cookie: install } })
    expect(restored.status).toBe(200)
  })

  test('signing out of a remembered device does not remember it afterwards', async () => {
    const app = createApp(new MemoryStore());
    await post(app, '/api/auth/register', '', {
      email: 'forgets@example.com',
      password: 'a-long-password',
    });
    const signedIn = await post(app, '/api/auth/login', '', {
      email: 'forgets@example.com',
      password: 'a-long-password',
      keepSignedIn: true,
    });
    const cookie = cookieHeader(signedIn.headers.get('set-cookie'));
    await post(app, '/api/auth/logout', cookie, {});

    /* Otherwise the account would restore itself on the very next request. */
    expect((await app.request('/api/auth/me', { headers: { Cookie: cookie } })).status).toBe(401);
  });

  test('a guest can say who they are', async () => {
    const app = createApp(new MemoryStore());
    const { cookie, account } = await continueAsGuest(app);
    const me = await app.request('/api/auth/me', { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
    expect(await json<Record<string, unknown>>(me)).toMatchObject({
      id: account['id'],
      accountType: 'ANONYMOUS',
      email: null,
    });
  });
});
