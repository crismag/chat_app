/*
 * The outward surfaces are metered and switchable. Private writing is neither.
 *
 * That sentence is the product decision this file exists to keep true. A spam
 * wave, or a provider bill climbing at midnight, must be answerable by turning
 * off Public, Communities and assistance — and somebody in the middle of
 * writing about Romans 8 should not be able to tell that any of it happened.
 *
 * So the tests below are mostly about what still works: the degraded mode is
 * checked as a whole rather than one switch at a time, because "we can turn
 * that off" is only half a claim without "and this still runs".
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import { cookieHeader } from './set-cookie.ts';
import {
  CAPABILITIES,
  capabilityReport,
  isEnabled,
  unavailableReason,
} from './capabilities.ts';
import { OUTWARD_ACTIONS, OutwardLimits } from './outward-limits.ts';

describe('the switches', () => {
  test('absent means on — a missing variable never disables anything', () => {
    for (const capability of Object.values(CAPABILITIES)) {
      expect(isEnabled(capability, {})).toBe(true);
    }
    expect(Object.values(capabilityReport({})).every(Boolean)).toBe(true);
  });

  test('only the obvious truthy values switch something off', () => {
    for (const on of ['1', 'true', 'TRUE', 'yes']) {
      expect(isEnabled(CAPABILITIES.PUBLIC_SHARING, { CHAT_DISABLE_PUBLIC_SHARING: on })).toBe(
        false,
      );
    }
    for (const off of ['0', 'false', '', 'no', 'maybe']) {
      expect(isEnabled(CAPABILITIES.PUBLIC_SHARING, { CHAT_DISABLE_PUBLIC_SHARING: off })).toBe(
        true,
      );
    }
  });

  test('each one says what happened, and that nothing was lost', () => {
    /* Not "an error occurred", which invites somebody to keep pressing. */
    expect(unavailableReason(CAPABILITIES.PUBLIC_SHARING)).toMatch(/saved and unchanged/i);
    expect(unavailableReason(CAPABILITIES.AI_REQUESTS)).toMatch(/keep writing without it/i);
  });
});

describe('the safe degradation mode', () => {
  const restore: Record<string, string | undefined> = {};
  const OFF = [
    'CHAT_DISABLE_PUBLIC_SHARING',
    'CHAT_DISABLE_COMMUNITY_SHARING',
    'CHAT_DISABLE_COMMUNITY_CREATION',
    'CHAT_DISABLE_COMMUNITY_JOINING',
    'CHAT_DISABLE_AI_REQUESTS',
  ];

  beforeEach(() => {
    for (const name of OFF) {
      restore[name] = process.env[name];
      process.env[name] = '1';
    }
  });

  afterEach(() => {
    for (const name of OFF) {
      if (restore[name] === undefined) delete process.env[name];
      else process.env[name] = restore[name];
    }
  });

  test('a person can still write, save and keep their reflections', async () => {
    const app = createApp(new SqliteStore());
    const json = (body: unknown) => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    /* Guests are not an outward surface. They can still be made. */
    const guest = await app.request('/api/auth/guest', json({ creationSource: 'REFLECTION_CREATE' }));
    expect(guest.status).toBe(201);
    const cookie = cookieHeader(guest.headers.get('set-cookie'));

    const created = await app.request('/api/conversations', {
      ...json({ title: 'Still writing' }),
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const written = await app.request(`/api/conversations/${id}/sections`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ type: 'heart', content: 'This still met me today.' }),
    });
    expect(written.status).toBe(200);

    const listed = await app.request('/api/conversations', { headers: { Cookie: cookie } });
    expect(((await listed.json()) as unknown[]).length).toBe(1);
  });

  test('and the outward ones say they are paused rather than failing', async () => {
    const app = createApp(new SqliteStore());
    const registered = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'paused@example.com', password: 'secret12' }),
    });
    const cookie = cookieHeader(registered.headers.get('set-cookie'));

    const community = await app.request('/api/communities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Not right now' }),
    });
    expect(community.status).toBe(503);
    expect(await community.json()).toMatchObject({ error: expect.stringMatching(/paused/i) });
  });
});

describe('the ceilings', () => {
  /*
   * Fixed clock: the point is that a limit is reached, not how long the test
   * is prepared to wait.
   */
  let clock = 1_000;
  const limits = () => new OutwardLimits(() => clock);
  const who = (userId: string, ageMs: number | null = 90 * 24 * 60 * 60 * 1000) => ({
    userId,
    address: '203.0.113.9',
    accountAgeMs: ageMs,
  });

  test('a new account is held to less than an established one', () => {
    const fresh = limits();
    let allowed = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (fresh.take(OUTWARD_ACTIONS.COMMUNITY_CREATE, who('new', 60_000)).allowed) allowed += 1;
    }
    expect(allowed).toBe(2);

    const established = limits();
    allowed = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (established.take(OUTWARD_ACTIONS.COMMUNITY_CREATE, who('old')).allowed) allowed += 1;
    }
    expect(allowed).toBe(5);
  });

  test('an account of unknown age is treated as new, which is the safer answer', () => {
    const unknown = limits();
    let allowed = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (unknown.take(OUTWARD_ACTIONS.COMMUNITY_CREATE, who('unknown', null)).allowed) allowed += 1;
    }
    expect(allowed).toBe(2);
  });

  test('one account holding a button down does not spend everybody else’s allowance', () => {
    const shared = limits();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      shared.take(OUTWARD_ACTIONS.PUBLISH, who('loud'));
    }
    expect(shared.take(OUTWARD_ACTIONS.PUBLISH, who('loud')).allowed).toBe(false);
    /* Same address, different person: a household is not one person. */
    expect(shared.take(OUTWARD_ACTIONS.PUBLISH, who('quiet')).allowed).toBe(true);
  });

  test('a refusal says how long to wait, and reporting stays generous', () => {
    const one = limits();
    for (let attempt = 0; attempt < 40; attempt += 1) one.take(OUTWARD_ACTIONS.PUBLISH, who('a'));
    const refused = one.take(OUTWARD_ACTIONS.PUBLISH, who('a'));
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBeGreaterThan(0);

    /*
     * A limit low enough to stop somebody flagging things they genuinely find
     * troubling protects the wrong person.
     */
    const reports = limits();
    let allowed = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      clock += 60_000;
      if (reports.take(OUTWARD_ACTIONS.REPORT, who('careful')).allowed) allowed += 1;
    }
    expect(allowed).toBe(40);
  });
});
