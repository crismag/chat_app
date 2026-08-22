import { describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { SlidingWindowRateLimiter } from '../ai/rate-limit.ts';
import { SqliteStore } from '../db.ts';

const post = (
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
) =>
  app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });

describe('auth rate limits', () => {
  test('password login is refused after the per-email ceiling', async () => {
    const store = new SqliteStore();
    const app = createApp(store, {}, {}, undefined, {
      loginEmailLimiter: new SlidingWindowRateLimiter(2),
      loginAddressLimiter: new SlidingWindowRateLimiter(40),
    });
    await post(app, '/api/auth/register', { email: 'kept@example.com', password: 'secret12' });

    expect((await post(app, '/api/auth/login', { email: 'kept@example.com', password: 'wrong-password' })).status).toBe(401);
    expect((await post(app, '/api/auth/login', { email: 'kept@example.com', password: 'wrong-password' })).status).toBe(401);
    const blocked = await post(app, '/api/auth/login', { email: 'kept@example.com', password: 'wrong-password' });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    expect(await blocked.json()).toMatchObject({ error: 'Too many sign-in attempts. Try again shortly.' });

    /* A different address still has its own budget. */
    const other = await post(app, '/api/auth/login', { email: 'other@example.com', password: 'wrong-password' });
    expect(other.status).toBe(401);
  });

  test('rotating emails from one address still hits the per-address ceiling', async () => {
    const store = new SqliteStore();
    const app = createApp(store, {}, {}, undefined, {
      loginEmailLimiter: new SlidingWindowRateLimiter(40),
      loginAddressLimiter: new SlidingWindowRateLimiter(2),
    });
    expect((await post(app, '/api/auth/login', { email: 'a@example.com', password: 'x' })).status).toBe(401);
    expect((await post(app, '/api/auth/login', { email: 'b@example.com', password: 'x' })).status).toBe(401);
    expect((await post(app, '/api/auth/login', { email: 'c@example.com', password: 'x' })).status).toBe(429);
  });

  test('register and guest creation are metered per address', async () => {
    const store = new SqliteStore();
    const app = createApp(store, {}, {}, undefined, {
      registerLimiter: new SlidingWindowRateLimiter(1),
      guestLimiter: new SlidingWindowRateLimiter(1),
    });
    expect((await post(app, '/api/auth/register', { email: 'one@example.com', password: 'secret12' })).status).toBe(201);
    expect((await post(app, '/api/auth/register', { email: 'two@example.com', password: 'secret12' })).status).toBe(429);

    const guests = createApp(new SqliteStore(), {}, {}, undefined, {
      guestLimiter: new SlidingWindowRateLimiter(1),
    });
    expect((await post(guests, '/api/auth/guest', { creationSource: 'REFLECTION_CREATE' })).status).toBe(201);
    expect((await post(guests, '/api/auth/guest', { creationSource: 'REFLECTION_CREATE' })).status).toBe(429);
  });
});
