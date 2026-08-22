/*
 * Messaging, asserted on API payloads against SqliteStore.
 */

import { beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import { MemoryStore } from '../store.ts';
import { cookieHeader } from '../http/set-cookie.ts';
import { MESSAGE_BODY_MAX } from './limits.ts';

type App = ReturnType<typeof createApp>;

let app: App;

beforeEach(() => {
  app = createApp(new SqliteStore());
});

async function register(email: string, target: App = app) {
  const response = await target.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret12' }),
  });
  expect(response.status).toBe(201);
  const cookie = cookieHeader(response.headers.get('set-cookie'));
  const me = await target.request('/api/profiles/me', { headers: { Cookie: cookie } });
  const profile = (await me.json()) as { handle: string };
  return { cookie, handle: profile.handle };
}

async function call<T>(cookie: string | null, path: string, init: RequestInit = {}, target: App = app) {
  const response = await target.request(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as T;
  return { status: response.status, body };
}

type Person = { id: string; handle: string | null; displayName: string; avatarUrl: string | null };
type Thread = {
  id: string;
  other: Person;
  unreadCount: number;
  pendingIncomingRequestId: string | null;
  lastMessage: { id: string; body: string; senderUserId: string } | null;
};
type Message = { id: string; threadId: string; senderUserId: string; body: string };

describe('auth', () => {
  test('anonymous and guests cannot list threads', async () => {
    expect((await call(null, '/api/messaging/threads')).status).toBe(401);
    const guest = await app.request('/api/auth/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creationSource: 'OTHER_PERSISTENT_ACTION' }),
    });
    expect(guest.status).toBe(201);
    const cookie = cookieHeader(guest.headers.get('set-cookie'));
    expect((await call(cookie, '/api/messaging/threads')).status).toBe(401);
  });
});

describe('direct threads and requests', () => {
  test('A and B resolve to one thread, and a third person cannot read it', async () => {
    const ada = await register('ada@example.com');
    const bea = await register('bea@example.com');
    const cal = await register('cal@example.com');

    const first = await call<{ thread: Thread }>(ada.cookie, '/api/messaging/open', {
      method: 'POST',
      body: JSON.stringify({ handle: bea.handle }),
    });
    expect(first.status).toBe(201);
    const again = await call<{ thread: Thread }>(bea.cookie, '/api/messaging/open', {
      method: 'POST',
      body: JSON.stringify({ handle: ada.handle }),
    });
    expect(again.body.thread.id).toBe(first.body.thread.id);

    const sneak = await call(cal.cookie, `/api/messaging/threads/${first.body.thread.id}`);
    expect(sneak.status).toBe(404);
    expect(JSON.stringify(sneak.body)).not.toContain(first.body.thread.id);
  });

  test('non-contact messages land as a request; accept creates a contact and a chat', async () => {
    const ada = await register('ada@example.com');
    const bea = await register('bea@example.com');
    const opened = await call<{ thread: Thread }>(ada.cookie, '/api/messaging/open', {
      method: 'POST',
      body: JSON.stringify({ handle: bea.handle }),
    });
    const sent = await call<Message>(ada.cookie, `/api/messaging/threads/${opened.body.thread.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Hello from Ada' }),
    });
    expect(sent.status).toBe(201);

    const adaChats = await call<{ items: Thread[] }>(ada.cookie, '/api/messaging/threads');
    expect(adaChats.body.items.map((item) => item.id)).toContain(opened.body.thread.id);

    const beaChats = await call<{ items: Thread[] }>(bea.cookie, '/api/messaging/threads');
    expect(beaChats.body.items).toEqual([]);

    const requests = await call<{ items: { id: string; threadId: string; preview: string; sender: Person }[] }>(
      bea.cookie,
      '/api/messaging/requests',
    );
    expect(requests.body.items).toHaveLength(1);
    expect(requests.body.items[0]?.preview).toBe('Hello from Ada');
    expect(JSON.stringify(requests.body)).not.toContain('@');
    expect(JSON.stringify(requests.body)).not.toContain('example.com');

    const reply = await call(bea.cookie, `/api/messaging/threads/${opened.body.thread.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'too soon' }),
    });
    expect(reply.status).toBe(403);

    const accepted = await call<Thread>(bea.cookie, `/api/messaging/requests/${requests.body.items[0]!.id}/accept`, {
      method: 'POST',
    });
    expect(accepted.status).toBe(200);
    const after = await call<{ items: Thread[] }>(bea.cookie, '/api/messaging/threads');
    expect(after.body.items.map((item) => item.id)).toContain(opened.body.thread.id);

    const contacts = await call<{ items: { person: Person }[] }>(ada.cookie, '/api/messaging/contacts');
    expect(contacts.body.items.some((item) => item.person.handle === bea.handle)).toBe(true);
  });

  test('decline does not create a contact and blocks an immediate repeat', async () => {
    const ada = await register('ada@example.com');
    const bea = await register('bea@example.com');
    await call(ada.cookie, '/api/messaging/open', {
      method: 'POST',
      body: JSON.stringify({ handle: bea.handle }),
    });
    const requests = await call<{ items: { id: string }[] }>(bea.cookie, '/api/messaging/requests');
    expect(
      (await call(bea.cookie, `/api/messaging/requests/${requests.body.items[0]!.id}/decline`, { method: 'POST' }))
        .status,
    ).toBe(200);
    expect((await call<{ items: unknown[] }>(ada.cookie, '/api/messaging/contacts')).body.items).toEqual([]);
    const repeat = await call(ada.cookie, '/api/messaging/open', {
      method: 'POST',
      body: JSON.stringify({ handle: bea.handle }),
    });
    expect(repeat.status).toBe(429);
  });

  test('recipient preference and profile block override requests', async () => {
    const ada = await register('ada@example.com');
    const bea = await register('bea@example.com');
    expect(
      (
        await call(bea.cookie, '/api/messaging/preferences', {
          method: 'PATCH',
          body: JSON.stringify({ allowNonContactRequests: false }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(ada.cookie, '/api/messaging/open', {
          method: 'POST',
          body: JSON.stringify({ handle: bea.handle }),
        })
      ).status,
    ).toBe(403);

    await call(bea.cookie, '/api/messaging/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ allowNonContactRequests: true }),
    });
    await call(bea.cookie, `/api/profiles/${ada.handle}/block`, { method: 'POST' });
    expect(
      (
        await call(ada.cookie, '/api/messaging/open', {
          method: 'POST',
          body: JSON.stringify({ handle: bea.handle }),
        })
      ).status,
    ).toBe(403);
  });
});

describe('messages', () => {
  test('sender cannot be spoofed; empty and oversized bodies are refused; polling is after-id', async () => {
    const ada = await register('ada@example.com');
    const bea = await register('bea@example.com');
    await call(ada.cookie, '/api/messaging/open', {
      method: 'POST',
      body: JSON.stringify({ handle: bea.handle }),
    });
    const requests = await call<{ items: { id: string; threadId: string }[] }>(bea.cookie, '/api/messaging/requests');
    await call(bea.cookie, `/api/messaging/requests/${requests.body.items[0]!.id}/accept`, { method: 'POST' });
    const threadId = requests.body.items[0]!.threadId;

    const first = await call<Message>(ada.cookie, `/api/messaging/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'one', senderUserId: bea.handle }),
    });
    expect(first.status).toBe(201);
    expect(first.body.body).toBe('one');

    expect(
      (
        await call(ada.cookie, `/api/messaging/threads/${threadId}/messages`, {
          method: 'POST',
          body: JSON.stringify({ body: '   ' }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(ada.cookie, `/api/messaging/threads/${threadId}/messages`, {
          method: 'POST',
          body: JSON.stringify({ body: 'x'.repeat(MESSAGE_BODY_MAX + 1) }),
        })
      ).status,
    ).toBe(400);

    const second = await call<Message>(bea.cookie, `/api/messaging/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'two' }),
    });
    const polled = await call<{ items: Message[] }>(
      ada.cookie,
      `/api/messaging/threads/${threadId}/messages?after=${first.body.id}`,
    );
    expect(polled.body.items.map((item) => item.body)).toEqual(['two']);
    expect(polled.body.items[0]?.id).toBe(second.body.id);

    expect(
      (await call(ada.cookie, `/api/messaging/threads/${threadId}/read`, {
        method: 'POST',
        body: JSON.stringify({ lastReadMessageId: second.body.id }),
      })).status,
    ).toBe(200);
    const chats = await call<{ items: Thread[] }>(ada.cookie, '/api/messaging/threads');
    expect(chats.body.items[0]?.unreadCount).toBe(0);

    const cal = await register('cal@example.com');
    expect(
      (
        await call(cal.cookie, `/api/messaging/threads/${threadId}/read`, {
          method: 'POST',
          body: JSON.stringify({ lastReadMessageId: second.body.id }),
        })
      ).status,
    ).toBe(404);
  });
});

describe('block from a request', () => {
  test('block uses the profile block and refuses a later open', async () => {
    const ada = await register('ada@example.com');
    const bea = await register('bea@example.com');
    await call(ada.cookie, '/api/messaging/open', {
      method: 'POST',
      body: JSON.stringify({ handle: bea.handle }),
    });
    const requests = await call<{ items: { id: string }[] }>(bea.cookie, '/api/messaging/requests');
    expect(
      (await call(bea.cookie, `/api/messaging/requests/${requests.body.items[0]!.id}/block`, { method: 'POST' })).status,
    ).toBe(200);
    expect(
      (
        await call(ada.cookie, '/api/messaging/open', {
          method: 'POST',
          body: JSON.stringify({ handle: bea.handle }),
        })
      ).status,
    ).toBe(403);
  });
});

describe('memory backing', () => {
  test('createApp(new MemoryStore()) still serves messaging', async () => {
    const memory = createApp(new MemoryStore());
    const ada = await register('ada@example.com', memory);
    const bea = await register('bea@example.com', memory);
    const opened = await call<{ thread: Thread }>(
      ada.cookie,
      '/api/messaging/open',
      { method: 'POST', body: JSON.stringify({ handle: bea.handle }) },
      memory,
    );
    expect(opened.status).toBe(201);
    expect(opened.body.thread.other.handle).toBe(bea.handle);
  });
});
