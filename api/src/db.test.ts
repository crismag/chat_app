import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { SESSION_TTL_MS, SqliteStore } from './db.ts';

const dir = mkdtempSync(join(tmpdir(), 'chat-db-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** Register, and hand back the session cookie the API set. */
async function register(app: ReturnType<typeof createApp>, email: string) {
  const response = await app.request(
    '/api/auth/register',
    json({ email, password: 'password123' }),
  );
  expect(response.status).toBeLessThan(400);
  const cookie = response.headers.get('set-cookie') ?? '';
  return cookie.split(';')[0] ?? '';
}

/**
 * Fill the four sections so a reflection is publishable.
 *
 * Publication now enforces the content-format rules, so a conversation with
 * empty sections is a draft by definition. Tests that want to publish have to
 * write a reflection first — which is the behaviour, not an obstacle to it.
 */
async function completeChat(
  app: ReturnType<typeof createApp>,
  id: string,
  cookie: string,
) {
  for (const type of ['context', 'heart', 'application', 'testimony'] as const) {
    const response = await app.request(`/api/conversations/${id}/sections`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type, content: `A short ${type} written by the author.` }),
    });
    if (response.status >= 400) throw new Error(`${type}: ${response.status}`);
  }
}

describe('SQLite store', () => {
  it('serves the same flows the in-memory store did', async () => {
    const app = createApp(new SqliteStore());
    const cookie = await register(app, 'flows@example.com');

    const created = await app.request('/api/conversations', {
      ...json({ title: 'Trusting when I cannot see', scriptureReference: 'Romans 8:28' }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(created.status).toBeLessThan(400);
    const conversation = (await created.json()) as { id: string };

    const sent = await app.request(`/api/conversations/${conversation.id}/messages`, {
      ...json({ content: 'This passage met me in a hard week.' }),
      headers: { 'content-type': 'application/json', cookie },
    });
    expect(sent.status).toBeLessThan(400);

    const read = await app.request(`/api/conversations/${conversation.id}`, {
      headers: { cookie },
    });
    const detail = (await read.json()) as { messages: unknown[] };
    expect(detail.messages.length).toBeGreaterThan(0);
  });

  /*
   * The reason this change exists. Everything used to vanish on restart, so the
   * test opens one database, closes it, opens the same file again with a fresh
   * app, and checks the account and its work are still there.
   */
  it('keeps accounts and conversations across a restart', async () => {
    const file = join(dir, 'restart.sqlite');

    const first = new SqliteStore(file);
    const app = createApp(first);
    const cookie = await register(app, 'restart@example.com');
    const created = await app.request('/api/conversations', {
      ...json({ title: 'Be still and know', scriptureReference: 'Psalm 46:10' }),
      headers: { 'content-type': 'application/json', cookie },
    });
    const conversation = (await created.json()) as { id: string };
    first.close();

    // A new process, the same file.
    const second = new SqliteStore(file);
    const restarted = createApp(second);

    const me = await restarted.request('/api/auth/me', { headers: { cookie } });
    expect(me.status).toBe(200);

    const again = await restarted.request(`/api/conversations/${conversation.id}`, {
      headers: { cookie },
    });
    expect(again.status).toBe(200);
    expect((await again.json()) as { title: string }).toMatchObject({
      title: 'Be still and know',
    });
    second.close();
  });

  /*
   * A regression guard for the swap itself. Under MemoryStore a route could
   * mutate the object it got back from the store and the Map would see it,
   * because it was the same object. A row read out of SQLite is a copy, so a
   * mutation that is never written back is silently lost — publish would answer
   * 200, echo the change, and persist nothing.
   */
  it('persists a publish, not just the response', async () => {
    const file = join(dir, 'publish.sqlite');

    const first = new SqliteStore(file);
    const app = createApp(first);
    const cookie = await register(app, 'publish@example.com');
    const created = await app.request('/api/conversations', {
      ...json({
        title: 'Trusting when I cannot see',
        scriptureReference: 'Romans 8:28',
      }),
      headers: { 'content-type': 'application/json', cookie },
    });
    const conversation = (await created.json()) as { id: string };

    await completeChat(app, conversation.id, cookie);

    const published = await app.request(
      `/api/conversations/${conversation.id}/publish`,
      { method: 'POST', headers: { cookie } },
    );
    expect(published.status).toBe(200);
    first.close();

    const second = new SqliteStore(file);
    const state = second.conversations.get(conversation.id);
    expect(state?.publicationState).toBe('published');
    second.close();
  });

  it('refuses a session that has aged out, and forgets it', () => {
    const store = new SqliteStore();
    store.users.set('u1', {
      id: 'u1',
      email: 'expiry@example.com',
      passwordHash: 'x',
    });
    store.sessions.set('token-1', { token: 'token-1', userId: 'u1' });
    expect(store.sessions.get('token-1')).toBeTruthy();

    // Age it past the window rather than waiting thirty days.
    store.db
      .prepare('UPDATE sessions SET expiresAt = ? WHERE token = ?')
      .run(Date.now() - SESSION_TTL_MS, 'token-1');

    expect(store.sessions.get('token-1')).toBeUndefined();
    const remaining = store.db
      .prepare('SELECT COUNT(*) AS n FROM sessions WHERE token = ?')
      .get('token-1') as { n: number };
    expect(remaining.n).toBe(0);
    store.close();
  });
});
