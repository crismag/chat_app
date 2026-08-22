/*
 * Getting back in, and what the route refuses to tell anybody.
 *
 * A forgotten-password form is the easiest place in an application to leak who
 * has an account: answer differently for an address that exists and the form
 * becomes a lookup service. Most of what is asserted here is therefore
 * sameness — same status, same wording, whether or not anybody was emailed.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import { cookieHeader } from '../http/set-cookie.ts';
import { RESET_REQUESTED_MESSAGE } from './password-reset.ts';
import type { Mailer, Message } from '../mail/mailer.ts';

class Outbox implements Mailer {
  readonly configured = true;
  readonly sent: Message[] = [];
  send(message: Message): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

let app: ReturnType<typeof createApp>;
let store: SqliteStore;
let outbox: Outbox;

beforeEach(() => {
  store = new SqliteStore();
  outbox = new Outbox();
  app = createApp(store, {}, {}, undefined, { mailer: outbox });
});

const post = (path: string, body: unknown, cookie = '') =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });

async function register(email: string, password = 'first-password') {
  const response = await post('/api/auth/register', { email, password });
  expect(response.status).toBe(201);
  /*
   * Registering also sends a confirmation link. These tests are about the
   * reset email, so the outbox starts empty for each of them.
   */
  outbox.sent.length = 0;
  return cookieHeader(response.headers.get('set-cookie'));
}

/** The token out of the link that was emailed. */
function tokenFromOutbox(outbox: Outbox): string {
  const link = outbox.sent.at(-1)?.text.match(/reset-password\?token=([^\s]+)/);
  expect(link).not.toBeNull();
  return decodeURIComponent(link![1]!);
}

describe('asking for a link', () => {
  test('says the same thing whether or not the address has an account', async () => {
    await register('real@example.com');

    const known = await post('/api/auth/forgot-password', { email: 'real@example.com' });
    const unknown = await post('/api/auth/forgot-password', { email: 'nobody@example.com' });

    expect(known.status).toBe(unknown.status);
    expect(await known.json()).toEqual({ message: RESET_REQUESTED_MESSAGE });
    expect(await unknown.json()).toEqual({ message: RESET_REQUESTED_MESSAGE });

    /* One email, to the one that exists. The reply gave nothing away. */
    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0]!.to).toBe('real@example.com');
  });

  test('the email says what to do, and what to do if it was not them', async () => {
    await register('worried@example.com');
    await post('/api/auth/forgot-password', { email: 'worried@example.com' });

    const message = outbox.sent[0]!;
    expect(message.subject).toMatch(/password/i);
    expect(message.text).toMatch(/reset-password\?token=/);
    /* Not a panic: a request is not a compromise. */
    expect(message.text).toMatch(/you can ignore this/i);
    expect(message.text).toMatch(/nothing has changed/i);
  });

  test('a guest is not an account to reset, and this is not how you find that out', async () => {
    const guest = await post('/api/auth/guest', { creationSource: 'REFLECTION_CREATE' });
    expect(guest.status).toBe(201);

    const asked = await post('/api/auth/forgot-password', { email: 'guest@example.com' });
    expect(asked.status).toBe(200);
    expect(outbox.sent).toHaveLength(0);
  });

  test('a forged Origin header does not become the reset link', async () => {
    const previous = process.env.CHAT_PUBLIC_WEB_ORIGIN;
    process.env.CHAT_PUBLIC_WEB_ORIGIN = 'https://reflections.example';
    try {
      await register('phished@example.com');
      await app.request('/api/auth/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://evil.example',
        },
        body: JSON.stringify({ email: 'phished@example.com' }),
      });
      const message = outbox.sent[0]!;
      expect(message.text).toContain('https://reflections.example/reset-password?token=');
      expect(message.text).not.toContain('evil.example');
      expect(message.html).toContain('href="https://reflections.example/reset-password?token=');
      expect(message.html).not.toContain('evil.example');
    } finally {
      if (previous === undefined) delete process.env.CHAT_PUBLIC_WEB_ORIGIN;
      else process.env.CHAT_PUBLIC_WEB_ORIGIN = previous;
    }
  });
});

describe('using the link', () => {
  test('sets the new password, and the old one stops working', async () => {
    await register('changer@example.com', 'the-old-password');
    await post('/api/auth/forgot-password', { email: 'changer@example.com' });

    const done = await post('/api/auth/reset-password', {
      token: tokenFromOutbox(outbox),
      password: 'the-new-password',
    });
    expect(done.status).toBe(200);

    const withOld = await post('/api/auth/login', {
      email: 'changer@example.com',
      password: 'the-old-password',
    });
    expect(withOld.status).toBe(401);

    const withNew = await post('/api/auth/login', {
      email: 'changer@example.com',
      password: 'the-new-password',
    });
    expect(withNew.status).toBe(200);
  });

  test('signs the person in, since they have just proved it is theirs', async () => {
    await register('straight-in@example.com');
    await post('/api/auth/forgot-password', { email: 'straight-in@example.com' });
    const done = await post('/api/auth/reset-password', {
      token: tokenFromOutbox(outbox),
      password: 'a-brand-new-password',
    });

    const cookie = cookieHeader(done.headers.get('set-cookie'));
    const me = await app.request('/api/auth/me', { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
  });

  /*
   * The reason a reset exists is usually that somebody else may have the
   * password. Leaving their sessions and their remembered browsers alive would
   * leave them exactly where they were.
   */
  test('closes every session and forgets every remembered browser', async () => {
    const before = await register('compromised@example.com');
    const kept = await post('/api/auth/login', {
      email: 'compromised@example.com',
      password: 'first-password',
      keepSignedIn: true,
    });
    const remembered = cookieHeader(kept.headers.get('set-cookie'));
    expect((await app.request('/api/auth/me', { headers: { Cookie: remembered } })).status).toBe(
      200,
    );

    await post('/api/auth/forgot-password', { email: 'compromised@example.com' });
    await post('/api/auth/reset-password', {
      token: tokenFromOutbox(outbox),
      password: 'a-password-only-i-know',
    });

    for (const cookie of [before, remembered]) {
      expect((await app.request('/api/auth/me', { headers: { Cookie: cookie } })).status).toBe(401);
    }
  });

  test('a link works once', async () => {
    await register('once@example.com');
    await post('/api/auth/forgot-password', { email: 'once@example.com' });
    const token = tokenFromOutbox(outbox);

    expect((await post('/api/auth/reset-password', { token, password: 'first-new-one' })).status).toBe(200);
    const again = await post('/api/auth/reset-password', { token, password: 'second-new-one' });
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: expect.stringMatching(/expired or has already been used/i) });
  });

  test('asking twice does not leave the first link live', async () => {
    await register('twice@example.com');
    await post('/api/auth/forgot-password', { email: 'twice@example.com' });
    const first = tokenFromOutbox(outbox);
    await post('/api/auth/forgot-password', { email: 'twice@example.com' });
    const second = tokenFromOutbox(outbox);

    expect((await post('/api/auth/reset-password', { token: second, password: 'the-newest' })).status).toBe(200);
    expect((await post('/api/auth/reset-password', { token: first, password: 'not-this-one' })).status).toBe(400);
  });

  test('a made-up link and an expired one are told apart from nothing', async () => {
    const invented = await post('/api/auth/reset-password', {
      token: 'not-a-real-token',
      password: 'long-enough-password',
    });
    expect(invented.status).toBe(400);
    /* The same sentence a used link gets: which kind of wrong is not said. */
    expect(await invented.json()).toMatchObject({
      error: expect.stringMatching(/expired or has already been used/i),
    });
  });

  test('a short password is refused before the link is spent', async () => {
    await register('careful@example.com');
    await post('/api/auth/forgot-password', { email: 'careful@example.com' });
    const token = tokenFromOutbox(outbox);

    const short = await post('/api/auth/reset-password', { token, password: 'four' });
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ field: 'password' });

    /* The link survived, because nothing was done with it. */
    expect((await post('/api/auth/reset-password', { token, password: 'a-proper-password' })).status).toBe(200);
  });
});
