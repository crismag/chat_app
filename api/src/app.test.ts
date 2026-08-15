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
      body: JSON.stringify({ title: 'To share later' }),
    });
    const conversation = await json<{ id: string }>(created);

    const before = await app.request('/api/community', {
      headers: { Cookie: neighbor.cookie },
    });
    expect(await json<unknown[]>(before)).toEqual([]);

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
      original?: string;
      revised?: string;
      replaced?: boolean;
      sections?: { context: { content: string }; heart: { content: string }; testimony: { content: string } };
    }>(extracted);
    expect(body.sections?.context.content.length).toBeGreaterThan(0);
    expect(body.sections?.heart.content).toBe('');
    expect(body.sections?.testimony.content).toBe('');
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
