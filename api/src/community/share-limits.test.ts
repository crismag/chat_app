/*
 * The distribution ceilings, tested as the rule they are.
 *
 * `decideShare` takes numbers and returns a decision, so these tests are about
 * the policy rather than about SQL: which ceiling binds first, what somebody is
 * told when it does, and — the case the whole design turns on — that sharing
 * one reflection into many communities is treated differently from sharing
 * many reflections into one.
 */
import { describe, expect, test } from 'vitest';
import { DISTRIBUTION_LIMITS, SHARE_REFUSALS } from '@chat/shared';
import { decideShare, type ShareHistory } from './share-limits.ts';

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const nothing = { count: 0, oldestAt: null };

function history(overrides: Partial<ShareHistory> = {}): ShareHistory {
  return {
    publicHour: nothing,
    publicDay: nothing,
    communitiesHour: nothing,
    communitiesDay: nothing,
    thisCommunityHour: nothing,
    communitiesForReflectionDay: { communityIds: [], oldestAt: null },
    everythingDay: nothing,
    ...overrides,
  };
}

const established = 90 * 24 * HOUR;
const toPublic = { audience: 'public' as const, communityId: null, accountAgeMs: established };
const toCommunity = (id = 'c1') => ({
  audience: 'community' as const,
  communityId: id,
  accountAgeMs: established,
});

describe('an ordinary day', () => {
  test('sharing is allowed when nothing has been shared', () => {
    expect(decideShare(history(), toPublic, NOW).allowed).toBe(true);
    expect(decideShare(history(), toCommunity(), NOW).allowed).toBe(true);
  });

  test('five into one community is fine; the sixth in that hour is not', () => {
    const full = history({ thisCommunityHour: { count: 5, oldestAt: NOW - 10 * 60 * 1000 } });
    const refused = decideShare(full, toCommunity(), NOW);
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      expect(refused.refusal).toBe(SHARE_REFUSALS.TOO_MANY);
      /* Told when, not just no: fifty minutes until the oldest ages out. */
      expect(refused.retryAfterSeconds).toBe(50 * 60);
    }
    /*
     * And a different community is a different room. `thisCommunityHour` is
     * counted for whichever community is being shared to, so the history for
     * c2 is its own — which is the point of having a per-community ceiling at
     * all rather than one number for everywhere.
     */
    const elsewhere = history({ communitiesHour: { count: 5, oldestAt: NOW - 10 * 60 * 1000 } });
    expect(decideShare(elsewhere, toCommunity('c2'), NOW).allowed).toBe(true);
  });
});

/*
 * The distinction the whole design turns on. Five reflections into one
 * community is participation. One reflection into five communities is a
 * broadcast, and there is an honest way to do that: share it publicly.
 */
describe('cross-posting', () => {
  const reached = ['a', 'b', 'c', 'd', 'e'];

  test('a sixth community for the same reflection is refused, and says so', () => {
    const refused = decideShare(
      history({ communitiesForReflectionDay: { communityIds: reached, oldestAt: NOW - HOUR } }),
      toCommunity('f'),
      NOW,
    );
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      expect(refused.refusal).toBe(SHARE_REFUSALS.TOO_MANY_COMMUNITIES);
      /* The message points at the alternative rather than only refusing. */
      expect(refused.message).toMatch(/share it publicly instead/i);
    }
  });

  test('sharing again into a community it already reached widens nothing', () => {
    const allowed = decideShare(
      history({ communitiesForReflectionDay: { communityIds: reached, oldestAt: NOW - HOUR } }),
      toCommunity('a'),
      NOW,
    );
    expect(allowed.allowed).toBe(true);
  });

  test('a different reflection is not held to the first one’s history', () => {
    /* The count is per reflection: this one has been nowhere. */
    expect(decideShare(history(), toCommunity('f'), NOW).allowed).toBe(true);
  });
});

describe('a new account', () => {
  const fresh = { ...toPublic, accountAgeMs: 60_000 };

  test('gets a handful in its first day, and is told it is temporary', () => {
    const refused = decideShare(
      history({ everythingDay: { count: DISTRIBUTION_LIMITS.newAccountDay.count, oldestAt: NOW } }),
      fresh,
      NOW,
    );
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      expect(refused.refusal).toBe(SHARE_REFUSALS.NEW_ACCOUNT);
      expect(refused.message).toMatch(/eases off after your first day/i);
      /* And that their writing is not what is limited. */
      expect(refused.message).toMatch(/everything you write stays yours/i);
    }
  });

  test('an established account is not held to that ceiling', () => {
    const same = history({
      everythingDay: { count: DISTRIBUTION_LIMITS.newAccountDay.count, oldestAt: NOW },
    });
    expect(decideShare(same, toPublic, NOW).allowed).toBe(true);
  });

  test('an unknown age counts as new, which is the safer answer', () => {
    const unknown = { ...toPublic, accountAgeMs: null };
    const refused = decideShare(
      history({ everythingDay: { count: DISTRIBUTION_LIMITS.newAccountDay.count, oldestAt: NOW } }),
      unknown,
      NOW,
    );
    expect(refused.allowed).toBe(false);
  });
});

describe('the ceilings that stack', () => {
  test('the public hour and the public day are separate', () => {
    expect(
      decideShare(history({ publicHour: { count: 5, oldestAt: NOW } }), toPublic, NOW).allowed,
    ).toBe(false);
    expect(
      decideShare(history({ publicDay: { count: 10, oldestAt: NOW } }), toPublic, NOW).allowed,
    ).toBe(false);
  });

  test('the backstop applies across both destinations', () => {
    const everything = history({
      everythingDay: { count: DISTRIBUTION_LIMITS.everythingDay.count, oldestAt: NOW },
    });
    expect(decideShare(everything, toPublic, NOW).allowed).toBe(false);
    expect(decideShare(everything, toCommunity(), NOW).allowed).toBe(false);
  });

  test('a public ceiling does not stop a community share, or the reverse', () => {
    expect(
      decideShare(history({ publicHour: { count: 5, oldestAt: NOW } }), toCommunity(), NOW).allowed,
    ).toBe(true);
    expect(
      decideShare(history({ communitiesHour: { count: 10, oldestAt: NOW } }), toPublic, NOW)
        .allowed,
    ).toBe(true);
  });
});
