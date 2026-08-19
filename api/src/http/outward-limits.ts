/*
 * What the outward-facing surfaces cost, and what happens when they are held
 * down.
 *
 * Anonymous people cannot reach any of this — publishing, joining, creating a
 * community and reporting all require an account — and that is the first and
 * largest barrier: a bot has to get registered before it can be a nuisance to
 * anybody but itself. It is not the last one. Registration is cheap, and an
 * account is not evidence of good faith.
 *
 * So every outward action has a server-side ceiling. Server-side is the only
 * kind there is: a limit enforced in the browser is a suggestion to anybody
 * who has opened the network tab, which is exactly the population this exists
 * for.
 *
 * Two counters per action, per user and per address, for the reason the AI
 * limiter already has two: one stops a single account holding a button down,
 * the other stops twenty accounts made in one place doing it together.
 *
 * A new account is held to a tighter ceiling for its first day. Almost all
 * abuse arrives on accounts minutes old, and almost no genuine first day
 * involves publishing forty times.
 */

import { DAY_MS, MINUTE_MS, SlidingWindowRateLimiter } from '../ai/rate-limit.ts';

/*
 * The outward actions. Private writing is deliberately not among them.
 *
 * Publishing is not here either, and that is deliberate rather than an
 * oversight: distribution has its own ceilings, in `share-limits.ts`, which
 * know the difference between five reflections into one community and one
 * reflection into five. A second, coarser count on top of those would refuse
 * people for reasons nobody could explain to them.
 */
export const OUTWARD_ACTIONS = {
  COMMUNITY_CREATE: 'community_create',
  COMMUNITY_JOIN: 'community_join',
  REACT: 'react',
  REPORT: 'report',
} as const;

export type OutwardAction = (typeof OUTWARD_ACTIONS)[keyof typeof OUTWARD_ACTIONS];

/**
 * How many of each, per day, for one account.
 *
 * Set from what an enthusiastic person plausibly does rather than from what a
 * script can do. Somebody who publishes twenty reflections in a day is
 * unusual; somebody who publishes two hundred is not a person.
 */
const PER_DAY: Record<OutwardAction, { established: number; fresh: number }> = {
  /*
   * Communities are cheap to make and expensive to clean up — but somebody
   * setting up their church's groups on the day they join is doing something
   * ordinary, and two would have refused them. Bounded, not stingy.
   */
  [OUTWARD_ACTIONS.COMMUNITY_CREATE]: { established: 15, fresh: 5 },
  [OUTWARD_ACTIONS.COMMUNITY_JOIN]: { established: 30, fresh: 10 },
  [OUTWARD_ACTIONS.REACT]: { established: 300, fresh: 100 },
  /*
   * Reporting is generous on purpose. A limit low enough to stop somebody
   * flagging things they genuinely find troubling is a limit that protects the
   * wrong person — and a report costs nothing and punishes nobody by itself.
   */
  [OUTWARD_ACTIONS.REPORT]: { established: 60, fresh: 30 },
};

/** How long an account counts as new. */
export const FRESH_ACCOUNT_MS = 24 * 60 * 60 * 1000;

/** A short burst ceiling, so nothing can be held down for a minute either. */
const PER_MINUTE = 12;

/*
 * Per address, across every account behind it. Four times the per-account
 * allowance, for the reason the anonymous AI allowance uses the same shape: a
 * household, an office or a campus is one address and several people, and
 * treating it as one person refuses somebody who has done nothing.
 */
const ADDRESS_MULTIPLIER = 4;

export type OutwardDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; message: string };

export class OutwardLimits {
  private readonly byUser = new Map<OutwardAction, SlidingWindowRateLimiter>();
  private readonly byAddress = new Map<OutwardAction, SlidingWindowRateLimiter>();
  private readonly burst: SlidingWindowRateLimiter;
  private readonly freshUser = new Map<OutwardAction, SlidingWindowRateLimiter>();

  constructor(now: () => number = Date.now) {
    for (const action of Object.values(OUTWARD_ACTIONS)) {
      const limits = PER_DAY[action];
      this.byUser.set(action, new SlidingWindowRateLimiter(limits.established, now, DAY_MS));
      this.freshUser.set(action, new SlidingWindowRateLimiter(limits.fresh, now, DAY_MS));
      this.byAddress.set(
        action,
        new SlidingWindowRateLimiter(limits.established * ADDRESS_MULTIPLIER, now, DAY_MS),
      );
    }
    this.burst = new SlidingWindowRateLimiter(PER_MINUTE, now, MINUTE_MS);
  }

  /**
   * Spend one, or say why not.
   *
   * `accountAgeMs` decides which daily ceiling applies. It is read from the
   * account rather than guessed, and an unknown age is treated as new — the
   * safer of the two answers.
   */
  take(
    action: OutwardAction,
    who: { userId: string; address: string; accountAgeMs: number | null },
  ): OutwardDecision {
    const fresh = who.accountAgeMs === null || who.accountAgeMs < FRESH_ACCOUNT_MS;
    const daily = (fresh ? this.freshUser : this.byUser).get(action)!.take(who.userId);
    if (!daily.allowed) {
      return {
        allowed: false,
        retryAfterSeconds: daily.retryAfterSeconds,
        message: fresh
          ? 'That is as much as a new account can do in a day. This eases off tomorrow.'
          : 'That is as much of this as one account can do in a day.',
      };
    }

    const burst = this.burst.take(`${action}:${who.userId}`);
    if (!burst.allowed) {
      return {
        allowed: false,
        retryAfterSeconds: burst.retryAfterSeconds,
        message: 'That was a lot at once. Try again in a moment.',
      };
    }

    const address = this.byAddress.get(action)!.take(who.address);
    if (!address.allowed) {
      return {
        allowed: false,
        retryAfterSeconds: address.retryAfterSeconds,
        message: 'That is as much of this as one connection can do in a day.',
      };
    }
    return { allowed: true };
  }
}
