/*
 * Liveness and readiness are different questions.
 *
 * `/api/health` says the process is running, and a process manager restarts on
 * it — so it must not start failing because a database is briefly busy, which
 * would turn a blip into a restart loop. `/api/health/ready` says this process
 * can actually serve, which in a deployment with two stores means both of them.
 */
import { expect, test, vi } from 'vitest';

import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import type { AuthStore } from '../auth/store.ts';

type Ready = { status: string; checks: Record<string, string> };

test('liveness stays exactly what it was, for the clients already reading it', async () => {
  const response = await createApp(new SqliteStore()).request('/api/health');

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'ok', service: 'chat-api' });
});

test('readiness on SQLite alone reports the store it actually has', async () => {
  const response = await createApp(new SqliteStore()).request('/api/health/ready');

  expect(response.status).toBe(200);
  const body = (await response.json()) as Ready;
  expect(body.status).toBe('ready');
  expect(body.checks['content']).toBe('ok');
  /*
   * No accounts check, because there is no accounts store across a network to
   * check. Reporting an unconfigured MariaDB as unavailable would make every
   * SQLite-only deployment look broken.
   */
  expect(body.checks['accounts']).toBeUndefined();
});

test('an unreachable accounts database makes this process unavailable, not ok', async () => {
  const auth = {
    ready: vi.fn(() => Promise.reject(new Error('connect ECONNREFUSED'))),
  } as unknown as AuthStore;

  const response = await createApp(new SqliteStore(), {}, {}, auth).request('/api/health/ready');

  /*
   * A process that can reach content but not accounts cannot sign anybody in.
   * Saying "ok" is how a load balancer keeps sending people to a server that
   * cannot help them.
   */
  expect(response.status).toBe(503);
  const body = (await response.json()) as Ready;
  expect(body.status).toBe('unavailable');
  expect(body.checks).toMatchObject({ content: 'ok', accounts: 'unavailable' });
});

test('liveness does not go down with the accounts database', async () => {
  const auth = {
    ready: vi.fn(() => Promise.reject(new Error('connect ECONNREFUSED'))),
  } as unknown as AuthStore;
  const app = createApp(new SqliteStore(), {}, {}, auth);

  /* Restarting the process would not reconnect somebody else's database. */
  expect((await app.request('/api/health')).status).toBe(200);
  expect((await app.request('/api/health/ready')).status).toBe(503);
});
