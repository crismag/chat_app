/*
 * Not sending to a domain that cannot receive.
 *
 * Every message to an undeliverable domain is a bounce, and enough bounces are
 * what stop the real messages arriving — so this protects every other email
 * the product sends, not just this route.
 *
 * The reply must not change either way. Whether a domain takes mail is not a
 * fact about whether the address has an account, and a form that answered
 * differently would be a way to find out who writes here.
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import type { Mailer } from '../mail/mailer.ts';
import type { MailDomainResolver } from './mail-domain.ts';

/*
 * A reset link is only built from a configured public origin (B1), so without
 * one nothing is sent and these would pass for the wrong reason.
 */
let previousOrigin: string | undefined;

beforeEach(() => {
  previousOrigin = process.env.CHAT_PUBLIC_WEB_ORIGIN;
  process.env.CHAT_PUBLIC_WEB_ORIGIN = 'https://reflections.example';
});

afterEach(() => {
  if (previousOrigin === undefined) delete process.env.CHAT_PUBLIC_WEB_ORIGIN;
  else process.env.CHAT_PUBLIC_WEB_ORIGIN = previousOrigin;
});

const RESOLVER: MailDomainResolver = {
  resolveMx: (domain) =>
    domain === 'has-mail.example'
      ? Promise.resolve([{ exchange: 'mx.has-mail.example', priority: 10 }])
      : Promise.reject(Object.assign(new Error('not found'), { code: 'ENOTFOUND' })),
  resolveAddress: () =>
    Promise.reject(Object.assign(new Error('not found'), { code: 'ENOTFOUND' })),
};

function appWith(resolver: MailDomainResolver) {
  const sent: { to: string }[] = [];
  const mailer: Mailer = {
    configured: true,
    send: async (message) => {
      sent.push({ to: message.to });
    },
  };
  const app = createApp(new SqliteStore(), {}, {}, undefined, {
    mailer,
    mailDomainResolver: resolver,
  });
  return { app, sent };
}

async function register(app: ReturnType<typeof createApp>, email: string) {
  const response = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret12' }),
  });
  expect(response.status).toBe(201);
}

function forgot(app: ReturnType<typeof createApp>, email: string) {
  return app.request('/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

test('a domain that takes mail is written to', async () => {
  const { app, sent } = appWith(RESOLVER);
  await register(app, 'ada@has-mail.example');

  const response = await forgot(app, 'ada@has-mail.example');

  expect(response.status).toBe(200);
  expect(sent.map((message) => message.to)).toEqual(['ada@has-mail.example']);
});

test('a domain that cannot receive is not written to, and is told the same thing', async () => {
  const { app, sent } = appWith(RESOLVER);
  await register(app, 'ada@no-mail.example');

  const refused = await forgot(app, 'ada@no-mail.example');
  const accepted = await forgot(app, 'ada@has-mail.example');

  expect(sent).toHaveLength(0);
  /*
   * Byte for byte the same answer. The saving is the bounce, never a hint
   * about who has an account here.
   */
  expect(await refused.text()).toBe(await accepted.text());
  expect(refused.status).toBe(accepted.status);
});

test('a resolver that cannot answer delays nobody', async () => {
  /* One bad minute for DNS must not become a refusal for a real person. */
  const flaky: MailDomainResolver = {
    resolveMx: () => Promise.reject(Object.assign(new Error('timeout'), { code: 'EAI_AGAIN' })),
    resolveAddress: () =>
      Promise.reject(Object.assign(new Error('timeout'), { code: 'EAI_AGAIN' })),
  };
  const { app, sent } = appWith(flaky);
  await register(app, 'ada@has-mail.example');

  await forgot(app, 'ada@has-mail.example');

  expect(sent).toHaveLength(1);
});

test('nothing is looked up when no resolver is configured', async () => {
  /* The suite must never touch DNS, and a deployment without one must still send. */
  const sent: { to: string }[] = [];
  const mailer: Mailer = {
    configured: true,
    send: async (message) => {
      sent.push({ to: message.to });
    },
  };
  const app = createApp(new SqliteStore(), {}, {}, undefined, { mailer });
  await register(app, 'ada@has-mail.example');

  await forgot(app, 'ada@has-mail.example');

  expect(sent).toHaveLength(1);
});

test('the lookup happens once for a domain, not once per request', async () => {
  const resolveMx = vi.fn(RESOLVER.resolveMx);
  const { app } = appWith({ ...RESOLVER, resolveMx });
  await register(app, 'ada@has-mail.example');

  await forgot(app, 'ada@has-mail.example');
  await forgot(app, 'bob@has-mail.example');
  await forgot(app, 'cleo@has-mail.example');

  /* A decision is cached; otherwise this route is a DNS amplifier. */
  expect(resolveMx).toHaveBeenCalledTimes(1);
});
