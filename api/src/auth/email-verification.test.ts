/*
 * Proving somebody can read the address they registered with.
 *
 * The rule this exists to keep is that the link proves a mailbox and nothing
 * else. It creates no session, so a link found in a forwarded email makes
 * nobody into anybody — which is the whole difference between this and signing
 * in by link.
 */
import { afterEach, beforeEach, expect, test } from 'vitest';

import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import { cookieHeader } from '../http/set-cookie.ts';
import type { Mailer, Message } from '../mail/mailer.ts';

let previousOrigin: string | undefined;

beforeEach(() => {
  previousOrigin = process.env.CHAT_PUBLIC_WEB_ORIGIN;
  process.env.CHAT_PUBLIC_WEB_ORIGIN = 'https://reflections.example';
});

afterEach(() => {
  if (previousOrigin === undefined) delete process.env.CHAT_PUBLIC_WEB_ORIGIN;
  else process.env.CHAT_PUBLIC_WEB_ORIGIN = previousOrigin;
});

function setup() {
  const outbox: Message[] = [];
  const mailer: Mailer = {
    configured: true,
    send: async (message) => {
      outbox.push(message);
    },
  };
  const store = new SqliteStore();
  return { store, outbox, app: createApp(store, {}, {}, undefined, { mailer }) };
}

async function register(app: ReturnType<typeof createApp>, email: string) {
  const response = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret12' }),
  });
  expect(response.status).toBe(201);
  return cookieHeader(response.headers.get('set-cookie'));
}

/** The token as somebody would take it out of their own email. */
function tokenFrom(message: Message | undefined): string {
  const found = /verify-email\?token=([^\s"<]+)/.exec(message?.text ?? '');
  expect(found?.[1]).toBeTruthy();
  return decodeURIComponent(found?.[1] ?? '');
}

function send(app: ReturnType<typeof createApp>, cookie?: string) {
  return app.request('/api/auth/send-verification', {
    method: 'POST',
    headers: cookie ? { Cookie: cookie } : {},
  });
}

function verify(app: ReturnType<typeof createApp>, token: string) {
  return app.request('/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

test('opening the link confirms the address and signs nobody in', async () => {
  const { app, outbox } = setup();
  const cookie = await register(app, 'ada@example.com');
  await send(app, cookie);

  const response = await verify(app, tokenFrom(outbox[0]));

  expect(response.status).toBe(200);
  /*
   * The one thing that must never happen here. A link that set a cookie would
   * be a second credential for the account, with everything that implies about
   * forwarded mail and shared inboxes.
   */
  expect(response.headers.get('set-cookie')).toBeNull();

  const me = await app.request('/api/auth/me', { headers: { Cookie: cookie } });
  expect(((await me.json()) as { emailVerified: boolean }).emailVerified).toBe(true);
});

test('the stored row does not contain the token that was emailed', async () => {
  const { app, store, outbox } = setup();
  const cookie = await register(app, 'ada@example.com');
  await send(app, cookie);
  const token = tokenFrom(outbox[0]);

  const rows = store.db.prepare('SELECT tokenHash FROM email_verifications').all() as {
    tokenHash: string;
  }[];
  expect(rows).toHaveLength(1);
  /* A database that leaked must not hold a working proof for every pending one. */
  expect(rows[0]?.tokenHash).not.toBe(token);
  expect(JSON.stringify(rows)).not.toContain(token);
});

test('a link works once, and asking again retires the one before it', async () => {
  const { app, outbox } = setup();
  const cookie = await register(app, 'ada@example.com');

  await send(app, cookie);
  const first = tokenFrom(outbox[0]);
  await send(app, cookie);
  const second = tokenFrom(outbox[1]);

  /* Somebody who pressed the button twice never holds two live keys. */
  expect((await verify(app, first)).status).toBe(400);
  expect((await verify(app, second)).status).toBe(200);
  /* And the one that worked does not work again. */
  expect((await verify(app, second)).status).toBe(400);
});

test('unknown, expired and already-spent are one answer', async () => {
  const { app, outbox } = setup();
  const cookie = await register(app, 'ada@example.com');
  await send(app, cookie);
  const token = tokenFrom(outbox[0]);
  await verify(app, token);

  const spent = await verify(app, token);
  const invented = await verify(app, 'a-token-nobody-ever-issued');

  /*
   * Byte for byte. Telling them apart would say whether a token was ever real,
   * which is the only thing somebody holding a guess wants to know.
   */
  expect(await spent.text()).toBe(await invented.text());
  expect(spent.status).toBe(invented.status);
});

test('asking for a link says the same thing to everybody', async () => {
  const { app } = setup();
  const cookie = await register(app, 'ada@example.com');

  const signedIn = await send(app, cookie);
  const signedOut = await send(app);

  /* This route is reachable without an account; a varying answer would be a probe. */
  expect(await signedIn.text()).toBe(await signedOut.text());
  expect(signedIn.status).toBe(signedOut.status);
});

test('an already-confirmed account is not sent another link', async () => {
  const { app, outbox } = setup();
  const cookie = await register(app, 'ada@example.com');
  await send(app, cookie);
  await verify(app, tokenFrom(outbox[0]));

  await send(app, cookie);

  /* Nothing to prove, so nothing is sent — and the reply still does not say so. */
  expect(outbox).toHaveLength(1);
});
