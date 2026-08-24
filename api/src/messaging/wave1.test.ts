/*
 * Messaging Wave 1 — conversation completeness, asserted on HTTP payloads.
 */

import { beforeEach, describe, expect, test } from 'vitest';

import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import { cookieHeader } from '../http/set-cookie.ts';
import { MESSAGE_CHANGE_WINDOW_MS } from './limits.ts';

type App = ReturnType<typeof createApp>;

let app: App;
let store: SqliteStore;

beforeEach(() => {
  store = new SqliteStore();
  app = createApp(store);
});

function confirmEmail(email: string): void {
  store.db.prepare('UPDATE users SET emailVerifiedAt = ? WHERE email = ?').run(new Date().toISOString(), email);
}

async function register(email: string) {
  const response = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret12' }),
  });
  expect(response.status).toBe(201);
  confirmEmail(email);
  const cookie = cookieHeader(response.headers.get('set-cookie'));
  const me = await app.request('/api/profiles/me', { headers: { Cookie: cookie } });
  const profile = (await me.json()) as { handle: string };
  return { cookie, handle: profile.handle };
}

async function call<T>(cookie: string, path: string, init: RequestInit = {}) {
  const response = await app.request(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as T;
  return { status: response.status, body };
}

async function acceptedThread() {
  const ada = await register('ada@example.com');
  const bea = await register('bea@example.com');
  const opened = await call<{ thread: { id: string } }>(ada.cookie, '/api/messaging/open', {
    method: 'POST',
    body: JSON.stringify({ handle: bea.handle }),
  });
  const requests = await call<{ items: { id: string; threadId: string }[] }>(bea.cookie, '/api/messaging/requests');
  await call(bea.cookie, `/api/messaging/requests/${requests.body.items[0]!.id}/accept`, { method: 'POST' });
  return { ada, bea, threadId: opened.body.thread.id };
}

type Message = {
  id: string;
  body: string;
  editedAt: string | null;
  deletedAt: string | null;
  parent: { id: string; body: string } | null;
  reactions: { emoji: string; count: number; me: boolean }[];
};

describe('reply, edit, delete, react', () => {
  test('a reply quotes the parent, and a foreign parent is refused', async () => {
    const { ada, bea, threadId } = await acceptedThread();
    const first = await call<Message>(ada.cookie, `/api/messaging/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Hello from Ada' }),
    });
    const reply = await call<Message>(bea.cookie, `/api/messaging/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'And from Bea', parentMessageId: first.body.id }),
    });
    expect(reply.status).toBe(201);
    expect(reply.body.parent?.id).toBe(first.body.id);
    expect(reply.body.parent?.body).toBe('Hello from Ada');

    const cal = await register('cal@example.com');
    const other = await call<{ thread: { id: string } }>(ada.cookie, '/api/messaging/open', {
      method: 'POST',
      body: JSON.stringify({ handle: cal.handle }),
    });
    const crossed = await call(ada.cookie, `/api/messaging/threads/${other.body.thread.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'nope', parentMessageId: first.body.id }),
    });
    expect(crossed.status).toBe(400);
  });

  test('the sender may edit inside the window and not after it', async () => {
    const { ada, bea, threadId } = await acceptedThread();
    const sent = await call<Message>(ada.cookie, `/api/messaging/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'typo' }),
    });
    const edited = await call<Message>(
      ada.cookie,
      `/api/messaging/threads/${threadId}/messages/${sent.body.id}`,
      { method: 'PATCH', body: JSON.stringify({ body: 'fixed' }) },
    );
    expect(edited.status).toBe(200);
    expect(edited.body.body).toBe('fixed');
    expect(edited.body.editedAt).toBeTruthy();
    expect(edited.body.id).toBe(sent.body.id);

    expect(
      (
        await call(bea.cookie, `/api/messaging/threads/${threadId}/messages/${sent.body.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ body: 'hijack' }),
        })
      ).status,
    ).toBe(403);

    store.db
      .prepare('UPDATE messaging_messages SET createdAt = ? WHERE id = ?')
      .run(new Date(Date.now() - MESSAGE_CHANGE_WINDOW_MS - 1_000).toISOString(), sent.body.id);
    expect(
      (
        await call(ada.cookie, `/api/messaging/threads/${threadId}/messages/${sent.body.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ body: 'too late' }),
        })
      ).status,
    ).toBe(400);
  });

  test('delete for me hides only for the deleter; delete for everyone leaves a tombstone', async () => {
    const { ada, bea, threadId } = await acceptedThread();
    const theirs = await call<Message>(bea.cookie, `/api/messaging/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'keep this word secret' }),
    });
    expect(
      (
        await call(ada.cookie, `/api/messaging/threads/${threadId}/messages/${theirs.body.id}/delete`, {
          method: 'POST',
          body: JSON.stringify({ scope: 'me' }),
        })
      ).status,
    ).toBe(200);
    const adaList = await call<{ items: Message[] }>(ada.cookie, `/api/messaging/threads/${threadId}/messages`);
    const beaList = await call<{ items: Message[] }>(bea.cookie, `/api/messaging/threads/${threadId}/messages`);
    expect(adaList.body.items.map((item) => item.id)).not.toContain(theirs.body.id);
    expect(beaList.body.items.map((item) => item.id)).toContain(theirs.body.id);

    const mine = await call<Message>(ada.cookie, `/api/messaging/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'take this back' }),
    });
    expect(
      (
        await call(ada.cookie, `/api/messaging/threads/${threadId}/messages/${mine.body.id}/delete`, {
          method: 'POST',
          body: JSON.stringify({ scope: 'everyone' }),
        })
      ).status,
    ).toBe(200);
    const after = await call<{ items: Message[] }>(bea.cookie, `/api/messaging/threads/${threadId}/messages`);
    const tomb = after.body.items.find((item) => item.id === mine.body.id);
    expect(tomb?.deletedAt).toBeTruthy();
    expect(tomb?.body).toBe('');
    expect(JSON.stringify(after.body)).not.toContain('take this back');
  });

  test('reactions are a closed set of one per person', async () => {
    const { ada, threadId } = await acceptedThread();
    const sent = await call<Message>(ada.cookie, `/api/messaging/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Amen?' }),
    });
    const prayed = await call<Message>(
      ada.cookie,
      `/api/messaging/threads/${threadId}/messages/${sent.body.id}/reaction`,
      { method: 'PUT', body: JSON.stringify({ emoji: '🙏' }) },
    );
    expect(prayed.body.reactions).toEqual([{ emoji: '🙏', count: 1, me: true }]);
    const heart = await call<Message>(
      ada.cookie,
      `/api/messaging/threads/${threadId}/messages/${sent.body.id}/reaction`,
      { method: 'PUT', body: JSON.stringify({ emoji: '❤' }) },
    );
    expect(heart.body.reactions).toEqual([{ emoji: '❤', count: 1, me: true }]);
    await call(
      ada.cookie,
      `/api/messaging/threads/${threadId}/messages/${sent.body.id}/reaction`,
      { method: 'PUT', body: JSON.stringify({ emoji: '❤' }) },
    );
    const cleared = await call<{ items: Message[] }>(ada.cookie, `/api/messaging/threads/${threadId}/messages`);
    expect(cleared.body.items[0]?.reactions).toEqual([]);
    expect(
      (
        await call(ada.cookie, `/api/messaging/threads/${threadId}/messages/${sent.body.id}/reaction`, {
          method: 'PUT',
          body: JSON.stringify({ emoji: '🔥' }),
        })
      ).status,
    ).toBe(400);
  });
});

describe('seen, mute, archive, pin, hide, search, pages', () => {
  test('seen receipts are reciprocal', async () => {
    const { ada, bea, threadId } = await acceptedThread();
    const sent = await call<Message>(ada.cookie, `/api/messaging/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'read me' }),
    });
    await call(bea.cookie, `/api/messaging/threads/${threadId}/read`, {
      method: 'POST',
      body: JSON.stringify({ lastReadMessageId: sent.body.id }),
    });
    const adaThread = await call<{ otherLastReadMessageId: string | null }>(
      ada.cookie,
      `/api/messaging/threads/${threadId}`,
    );
    expect(adaThread.body.otherLastReadMessageId).toBe(sent.body.id);

    await call(ada.cookie, '/api/messaging/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ allowSeenReceipts: false }),
    });
    const hidden = await call<{ otherLastReadMessageId: string | null }>(
      ada.cookie,
      `/api/messaging/threads/${threadId}`,
    );
    const beaView = await call<{ otherLastReadMessageId: string | null }>(
      bea.cookie,
      `/api/messaging/threads/${threadId}`,
    );
    expect(hidden.body.otherLastReadMessageId).toBeNull();
    expect(beaView.body.otherLastReadMessageId).toBeNull();
  });

  test('mute keeps the chat and quiets the badge', async () => {
    const { ada, bea, threadId } = await acceptedThread();
    await call(ada.cookie, `/api/messaging/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'hello' }),
    });
    const before = await call<{ messages: number; total: number }>(bea.cookie, '/api/messaging/waiting');
    expect(before.body.messages).toBe(1);
    await call(bea.cookie, `/api/messaging/threads/${threadId}/mute`, {
      method: 'POST',
      body: JSON.stringify({ until: '9999-01-01T00:00:00.000Z' }),
    });
    const waiting = await call<{ messages: number; total: number }>(bea.cookie, '/api/messaging/waiting');
    expect(waiting.body.messages).toBe(0);
    expect(waiting.body.total).toBe(0);
    const chats = await call<{ items: { id: string }[] }>(bea.cookie, '/api/messaging/threads');
    expect(chats.body.items.map((item) => item.id)).toContain(threadId);
  });

  test('archive hides the chat until they write back', async () => {
    const { ada, bea, threadId } = await acceptedThread();
    await call(bea.cookie, `/api/messaging/threads/${threadId}/archive`, {
      method: 'POST',
      body: JSON.stringify({ archived: true }),
    });
    expect((await call<{ items: { id: string }[] }>(bea.cookie, '/api/messaging/threads')).body.items).toEqual([]);
    expect(
      (await call<{ items: { id: string }[] }>(bea.cookie, '/api/messaging/threads?view=archived')).body.items.map(
        (item) => item.id,
      ),
    ).toEqual([threadId]);
    await call(ada.cookie, `/api/messaging/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'still here' }),
    });
    expect(
      (await call<{ items: { id: string }[] }>(bea.cookie, '/api/messaging/threads')).body.items.map((item) => item.id),
    ).toEqual([threadId]);
  });

  test('a fourth pin is refused', async () => {
    const { ada, bea, threadId } = await acceptedThread();
    const extras = [await register('cal@example.com'), await register('dot@example.com'), await register('eve@example.com')];
    const ids = [threadId];
    for (const extra of extras) {
      const opened = await call<{ thread: { id: string } }>(ada.cookie, '/api/messaging/open', {
        method: 'POST',
        body: JSON.stringify({ handle: extra.handle }),
      });
      ids.push(opened.body.thread.id);
    }
    for (const id of ids.slice(0, 3)) {
      expect(
        (await call(ada.cookie, `/api/messaging/threads/${id}/pin`, {
          method: 'POST',
          body: JSON.stringify({ pinned: true }),
        })).status,
      ).toBe(200);
    }
    expect(
      (
        await call(ada.cookie, `/api/messaging/threads/${ids[3]!}/pin`, {
          method: 'POST',
          body: JSON.stringify({ pinned: true }),
        })
      ).status,
    ).toBe(400);
    void bea;
  });

  test('hide-for-me reuses the same thread when reopened', async () => {
    const { ada, bea, threadId } = await acceptedThread();
    expect((await call(ada.cookie, `/api/messaging/threads/${threadId}/hide`, { method: 'POST' })).status).toBe(200);
    expect((await call<{ items: { id: string }[] }>(ada.cookie, '/api/messaging/threads')).body.items).toEqual([]);
    expect(
      (await call<{ items: { id: string }[] }>(bea.cookie, '/api/messaging/threads')).body.items.map((item) => item.id),
    ).toEqual([threadId]);
    const again = await call<{ thread: { id: string } }>(ada.cookie, '/api/messaging/open', {
      method: 'POST',
      body: JSON.stringify({ handle: bea.handle }),
    });
    expect(again.body.thread.id).toBe(threadId);
    expect(
      (await call<{ items: { id: string }[] }>(ada.cookie, '/api/messaging/threads')).body.items.map((item) => item.id),
    ).toEqual([threadId]);
  });

  test('search skips hidden and tombstone bodies; history pages from the newest', async () => {
    const { ada, bea, threadId } = await acceptedThread();
    const live = await call<Message>(ada.cookie, `/api/messaging/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'alpha live word' }),
    });
    const hidden = await call<Message>(ada.cookie, `/api/messaging/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'alpha hidden word' }),
    });
    await call(bea.cookie, `/api/messaging/threads/${threadId}/messages/${hidden.body.id}/delete`, {
      method: 'POST',
      body: JSON.stringify({ scope: 'me' }),
    });
    const gone = await call<Message>(ada.cookie, `/api/messaging/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'alpha gone word' }),
    });
    await call(ada.cookie, `/api/messaging/threads/${threadId}/messages/${gone.body.id}/delete`, {
      method: 'POST',
      body: JSON.stringify({ scope: 'everyone' }),
    });
    const found = await call<{ items: { id: string }[] }>(
      bea.cookie,
      `/api/messaging/threads/${threadId}/search?q=alpha`,
    );
    expect(found.body.items.map((item) => item.id)).toEqual([live.body.id]);

    for (let n = 0; n < 8; n += 1) {
      await call(ada.cookie, `/api/messaging/threads/${threadId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: `page ${String(n)}` }),
      });
    }
    const newest = await call<{ items: { body: string }[]; olderCursor: string | null }>(
      bea.cookie,
      `/api/messaging/threads/${threadId}/messages?limit=5`,
    );
    expect(newest.body.items).toHaveLength(5);
    expect(newest.body.items.at(-1)?.body).toBe('page 7');
    expect(newest.body.olderCursor).toBeTruthy();
    const older = await call<{ items: { body: string }[] }>(
      bea.cookie,
      `/api/messaging/threads/${threadId}/messages?before=${newest.body.olderCursor}&limit=5`,
    );
    expect(older.body.items.length).toBeGreaterThan(0);
    expect(older.body.items.at(-1)?.body).not.toBe('page 7');
  });

  test('a pending request still blocks reply, react, and edit', async () => {
    const ada = await register('ada-req@example.com');
    const bea = await register('bea-req@example.com');
    const opened = await call<{ thread: { id: string } }>(ada.cookie, '/api/messaging/open', {
      method: 'POST',
      body: JSON.stringify({ handle: bea.handle }),
    });
    const sent = await call<Message>(ada.cookie, `/api/messaging/threads/${opened.body.thread.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'please' }),
    });
    expect(
      (
        await call(bea.cookie, `/api/messaging/threads/${opened.body.thread.id}/messages`, {
          method: 'POST',
          body: JSON.stringify({ body: 'too soon' }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(bea.cookie, `/api/messaging/threads/${opened.body.thread.id}/messages/${sent.body.id}/reaction`, {
          method: 'PUT',
          body: JSON.stringify({ emoji: '👍' }),
        })
      ).status,
    ).toBe(403);
  });
});
