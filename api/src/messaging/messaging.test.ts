/*
 * Messaging, asserted on API payloads against SqliteStore.
 */

import { beforeEach, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';

import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import { MemoryStore } from '../store.ts';
import { cookieHeader } from '../http/set-cookie.ts';
import { MESSAGE_BODY_MAX } from './limits.ts';

type App = ReturnType<typeof createApp>;

let app: App;
let store: SqliteStore;

beforeEach(() => {
  store = new SqliteStore();
  app = createApp(store);
});

/**
 * What opening the confirmation link does, without sending one.
 *
 * Takes the store rather than the app, because the in-memory store used by one
 * test below keeps its accounts somewhere else entirely.
 */
function confirmEmail(email: string, target: SqliteStore | MemoryStore): void {
  const db = (target as { db?: { prepare(sql: string): { run(...a: unknown[]): unknown } } }).db;
  if (db) {
    db.prepare('UPDATE users SET emailVerifiedAt = ? WHERE email = ?').run(
      new Date().toISOString(),
      email,
    );
    return;
  }
  const accounts = (target as MemoryStore).accounts;
  const account = accounts.byEmail(email);
  if (account) accounts.setEmailVerified(account.id);
}

async function register(email: string, target: App = app, backing: SqliteStore | MemoryStore = store) {
  const response = await target.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret12' }),
  });
  expect(response.status).toBe(201);
  /*
   * Confirmed, because sending asks for it and these tests are about what
   * happens after that point. The gate has its own tests below.
   */
  confirmEmail(email, backing);
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
    const backing = new MemoryStore();
    const memory = createApp(backing);
    const ada = await register('ada@example.com', memory, backing);
    const bea = await register('bea@example.com', memory, backing);
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

test('an unconfirmed address may read its messages but not send one', async () => {
  const ada = await register('ada@example.com');
  const bea = await register('bea@example.com');

  /* Bea has not opened her link. Ada has. */
  store.db.prepare('UPDATE users SET emailVerifiedAt = NULL WHERE email = ?').run('bea@example.com');

  const opened = await call<{ thread: { id: string } }>(ada.cookie, '/api/messaging/open', {
    method: 'POST',
    body: JSON.stringify({ handle: bea.handle }),
  });
  expect(opened.status).toBe(201);
  const threadId = opened.body.thread.id;

  /* Reading is open: being unable to see a message somebody sent you would be
     a strange punishment for not having clicked a link yet. */
  const read = await call(bea.cookie, `/api/messaging/threads/${threadId}/messages`);
  expect(read.status).toBe(200);

  const replied = await call<{ error: string; needsEmailVerification: boolean }>(
    bea.cookie,
    `/api/messaging/threads/${threadId}/messages`,
    { method: 'POST', body: JSON.stringify({ body: 'Hello back.' }) },
  );
  expect(replied.status).toBe(403);
  expect(replied.body.needsEmailVerification).toBe(true);
  expect(replied.body.error).toMatch(/confirm your email/i);
});

test('an unconfirmed address cannot start a conversation either', async () => {
  const ada = await register('ada@example.com');
  const bea = await register('bea@example.com');
  store.db.prepare('UPDATE users SET emailVerifiedAt = NULL WHERE email = ?').run('ada@example.com');

  const opened = await call<{ needsEmailVerification: boolean }>(ada.cookie, '/api/messaging/open', {
    method: 'POST',
    body: JSON.stringify({ handle: bea.handle }),
  });

  /* The stranger-facing direction is the one that matters most. */
  expect(opened.status).toBe(403);
  expect(opened.body.needsEmailVerification).toBe(true);
});

test('sending very fast is refused, and says when to try again', async () => {
  const ada = await register('ada@example.com');
  const bea = await register('bea@example.com');
  const opened = await call<{ thread: { id: string } }>(ada.cookie, '/api/messaging/open', {
    method: 'POST',
    body: JSON.stringify({ handle: bea.handle }),
  });
  const threadId = opened.body.thread.id;
  await call(bea.cookie, `/api/messaging/requests`);
  const path = `/api/messaging/threads/${threadId}/messages`;

  const statuses: number[] = [];
  for (let n = 0; n < 32; n += 1) {
    const sent = await call(ada.cookie, path, {
      method: 'POST',
      body: JSON.stringify({ body: `Message ${String(n)}` }),
    });
    statuses.push(sent.status);
  }

  /* A real exchange never reaches this; a script does immediately. */
  expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
  const refusedAt = statuses.indexOf(429);
  expect(refusedAt).toBeGreaterThanOrEqual(25);

  const refused = await call<{ retryAfterSeconds: number }>(ada.cookie, path, {
    method: 'POST',
    body: JSON.stringify({ body: 'One more' }),
  });
  expect(refused.status).toBe(429);
  expect(refused.body.retryAfterSeconds).toBeGreaterThan(0);
});

/*
 * Somebody to write to, made directly.
 *
 * Registering them over HTTP would meet the *registration* ceiling long before
 * the messaging one, and this test is about the messaging one.
 */
function seedPerson(handle: string, displayName: string = handle): string {
  const id = randomUUID();
  const at = new Date().toISOString();
  store.db
    .prepare(
      `INSERT INTO users (id, accountType, email, emailVerifiedAt, createdAt)
       VALUES (?, 'REGISTERED', ?, ?, ?)`,
    )
    .run(id, `${handle}@example.com`, at, at);
  store.db
    .prepare(
      `INSERT INTO profiles (userId, handle, displayName, tagline, favouriteVerses, createdAt, updatedAt)
       VALUES (?, ?, ?, '', '[]', ?, ?)`,
    )
    .run(id, handle, displayName, at, at);
  return handle;
}

test('reaching many strangers in a day is capped; returning to a thread is not', async () => {
  const ada = await register('ada@example.com');

  const statuses: number[] = [];
  for (let n = 0; n < 12; n += 1) {
    const handle = seedPerson(`stranger${String(n)}`);
    const opened = await call(ada.cookie, '/api/messaging/open', {
      method: 'POST',
      body: JSON.stringify({ handle }),
    });
    statuses.push(opened.status);
  }

  /* Ten new conversations a day is generous for a person and mean for a spammer. */
  expect(statuses.filter((status) => status === 201).length).toBe(10);
  expect(statuses.filter((status) => status === 429).length).toBe(2);
});

test('reopening a conversation you already have does not spend the daily allowance', async () => {
  const ada = await register('ada@example.com');
  const bea = await register('bea@example.com');
  const first = await call(ada.cookie, '/api/messaging/open', {
    method: 'POST',
    body: JSON.stringify({ handle: bea.handle }),
  });
  expect(first.status).toBe(201);

  /*
   * Opening an existing thread is navigation. Charging for it would put a
   * daily cap on reading your own messages.
   */
  for (let n = 0; n < 15; n += 1) {
    const again = await call(ada.cookie, '/api/messaging/open', {
      method: 'POST',
      body: JSON.stringify({ handle: bea.handle }),
    });
    expect(again.status).toBe(201);
  }
});

test('messages sent in the same instant are all delivered, in order', async () => {
  const ada = await register('ada@example.com');
  const bea = await register('bea@example.com');
  const opened = await call<{ thread: { id: string } }>(ada.cookie, '/api/messaging/open', {
    method: 'POST',
    body: JSON.stringify({ handle: bea.handle }),
  });
  const requests = await call<{ items: { id: string; threadId: string }[] }>(
    bea.cookie,
    '/api/messaging/requests',
  );
  await call(bea.cookie, `/api/messaging/requests/${requests.body.items[0]!.id}/accept`, {
    method: 'POST',
  });
  const threadId = opened.body.thread.id;
  const path = `/api/messaging/threads/${threadId}/messages`;

  /*
   * Fast enough to share a millisecond, which is ordinary in a conversation
   * and constant on a machine like this one. Ordering used to fall back to
   * comparing random UUIDs, so a message whose id happened to sort low was
   * never returned by polling — permanently missing rather than late.
   */
  const sent: string[] = [];
  for (const body of ['one', 'two', 'three', 'four', 'five']) {
    const posted = await call<{ id: string }>(ada.cookie, path, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
    sent.push(posted.body.id);
  }

  const all = await call<{ items: { id: string; body: string }[] }>(bea.cookie, path);
  expect(all.body.items.map((item) => item.body)).toEqual(['one', 'two', 'three', 'four', 'five']);

  /* And polling from each point returns everything after it, never a gap. */
  for (let n = 0; n < sent.length - 1; n += 1) {
    const rest = await call<{ items: { body: string }[] }>(bea.cookie, `${path}?after=${sent[n]!}`);
    expect(rest.body.items.map((item) => item.body)).toEqual(
      ['one', 'two', 'three', 'four', 'five'].slice(n + 1),
    );
  }

  const unread = await call<{ items: { unreadCount: number }[] }>(bea.cookie, '/api/messaging/threads');
  expect(unread.body.items[0]?.unreadCount).toBe(5);
});

describe('finding somebody to write to', () => {
  test('finds a person by handle and by the name they are shown under', async () => {
    const ada = await register('ada@example.com');
    seedPerson('quietcedar', 'Grace Hopper');

    const byHandle = await call<{ items: { handle: string }[] }>(
      ada.cookie,
      '/api/messaging/people?q=quietced',
    );
    const byName = await call<{ items: { handle: string }[] }>(
      ada.cookie,
      '/api/messaging/people?q=hopper',
    );

    expect(byHandle.body.items.map((item) => item.handle)).toEqual(['quietcedar']);
    expect(byName.body.items.map((item) => item.handle)).toEqual(['quietcedar']);
  });

  test('a search never returns the person doing it', async () => {
    const ada = await register('ada@example.com');

    const found = await call<{ items: { handle: string }[] }>(
      ada.cookie,
      `/api/messaging/people?q=${ada.handle.slice(0, 4)}`,
    );

    /* Offering somebody themselves is an invitation to a conversation of one. */
    expect(found.body.items.map((item) => item.handle)).not.toContain(ada.handle);
  });

  test('one letter is an empty answer, not a complaint', async () => {
    const ada = await register('ada@example.com');
    seedPerson('quietcedar', 'Grace Hopper');

    const found = await call<{ items: unknown[] }>(ada.cookie, '/api/messaging/people?q=q');

    /*
     * The box is typed into one character at a time. An error that appears on
     * the first keystroke and vanishes on the second is noise about nothing —
     * and a one-letter search is a page of the directory, not a search.
     */
    expect(found.status).toBe(200);
    expect(found.body.items).toEqual([]);
  });

  test('wildcards typed into the box mean themselves', async () => {
    const ada = await register('ada@example.com');
    seedPerson('axb', 'Someone Else');
    seedPerson('a_b', 'Another Person');

    const found = await call<{ items: { handle: string }[] }>(
      ada.cookie,
      '/api/messaging/people?q=a_b',
    );

    /*
     * `_` is a wildcard to LIKE and a letter to the person typing. Unescaped,
     * this search would quietly answer a different question than the one asked.
     */
    expect(found.body.items.map((item) => item.handle)).toEqual(['a_b']);
  });

  test('the answer is a handful, not a page of the directory', async () => {
    const ada = await register('ada@example.com');
    for (let n = 0; n < 25; n += 1) seedPerson(`seeker${String(n)}`, `Seeker ${String(n)}`);

    const found = await call<{ items: unknown[] }>(ada.cookie, '/api/messaging/people?q=seeker');

    expect(found.body.items).toHaveLength(10);
  });

  test('somebody who has never opened a profile cannot be found', async () => {
    const ada = await register('ada@example.com');
    /* A user row with no profile: nothing to search, and nothing to show. */
    store.db
      .prepare("INSERT INTO users (id, accountType, email, createdAt) VALUES (?, 'REGISTERED', ?, ?)")
      .run(randomUUID(), 'invisible@example.com', new Date().toISOString());

    const found = await call<{ items: unknown[] }>(ada.cookie, '/api/messaging/people?q=invisible');

    expect(found.body.items).toEqual([]);
  });

  test('a person who blocked you is not offered to you', async () => {
    const ada = await register('ada@example.com');
    const bea = await register('bea@example.com');
    await call(bea.cookie, `/api/profiles/${ada.handle}/block`, { method: 'POST' });

    const found = await call<{ items: { handle: string }[] }>(
      ada.cookie,
      `/api/messaging/people?q=${bea.handle.slice(0, 4)}`,
    );

    expect(found.body.items.map((item) => item.handle)).not.toContain(bea.handle);
  });

  test('an unconfirmed address cannot search for people to write to', async () => {
    const ada = await register('ada@example.com');
    seedPerson('quietcedar', 'Grace Hopper');
    store.db.prepare('UPDATE users SET emailVerifiedAt = NULL WHERE email = ?').run('ada@example.com');

    const found = await call<{ needsEmailVerification: boolean }>(
      ada.cookie,
      '/api/messaging/people?q=quietced',
    );

    /*
     * Searching is the first half of writing to a stranger. An account that
     * may not send should not be harvesting names either.
     */
    expect(found.status).toBe(403);
    expect(found.body.needsEmailVerification).toBe(true);
  });

  test('a visitor cannot use it to enumerate anybody', async () => {
    seedPerson('quietcedar', 'Grace Hopper');

    const found = await call(null, '/api/messaging/people?q=quietced');

    expect(found.status).toBe(401);
  });

  test('searching very fast is refused', async () => {
    const ada = await register('ada@example.com');
    seedPerson('quietcedar', 'Grace Hopper');

    const statuses: number[] = [];
    for (let n = 0; n < 34; n += 1) {
      const found = await call(ada.cookie, '/api/messaging/people?q=quietced');
      statuses.push(found.status);
    }

    /* Bounded so the directory cannot be walked a page at a time. */
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
    expect(statuses.filter((status) => status === 200).length).toBe(30);
  });
});
