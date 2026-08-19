/*
 * The allowance decides who pays for a provider call and who is turned away,
 * so the cases worth protecting are the ones somebody would try on purpose:
 * clearing a cookie, and sharing a house with other people.
 */

import { describe, expect, test } from 'vitest';
import { ANONYMOUS_DAILY_MESSAGES, AnonymousAiAllowance } from './anonymous-allowance.ts';

describe('the anonymous AI allowance', () => {
  test('a visitor gets a handful of messages a day', () => {
    const allowance = new AnonymousAiAllowance();
    for (let attempt = 0; attempt < ANONYMOUS_DAILY_MESSAGES; attempt += 1) {
      expect(allowance.take('owner-1', '203.0.113.9').allowed).toBe(true);
    }
    const refused = allowance.take('owner-1', '203.0.113.9');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  test('clearing the cookie does not refill the allowance', () => {
    const allowance = new AnonymousAiAllowance(2);
    expect(allowance.take('owner-1', '203.0.113.9').allowed).toBe(true);
    expect(allowance.take('owner-1', '203.0.113.9').allowed).toBe(true);
    /* A fresh owner id, the same address, and the address ceiling is what holds. */
    let allowed = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (allowance.take(`owner-${attempt + 2}`, '203.0.113.9').allowed) allowed += 1;
    }
    expect(allowed).toBeLessThanOrEqual(2 * 4);
  });

  test('a household is not treated as one person', () => {
    const allowance = new AnonymousAiAllowance(2);
    for (const owner of ['a', 'b', 'c']) {
      expect(allowance.take(owner, '203.0.113.9').allowed).toBe(true);
      expect(allowance.take(owner, '203.0.113.9').allowed).toBe(true);
    }
  });

  test('one address running out does not affect another', () => {
    const allowance = new AnonymousAiAllowance(1);
    expect(allowance.take('a', '203.0.113.9').allowed).toBe(true);
    expect(allowance.take('a', '203.0.113.9').allowed).toBe(false);
    expect(allowance.take('b', '198.51.100.4').allowed).toBe(true);
  });

  test('the allowance resets the next day', () => {
    let clock = 1_000;
    const allowance = new AnonymousAiAllowance(1, () => clock);
    expect(allowance.take('a', '203.0.113.9').allowed).toBe(true);
    expect(allowance.take('a', '203.0.113.9').allowed).toBe(false);
    clock += 25 * 60 * 60 * 1_000;
    expect(allowance.take('a', '203.0.113.9').allowed).toBe(true);
  });
});
