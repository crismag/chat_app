/*
 * What somebody without an account gets from the AI, and why it is small.
 *
 * Assistance is the one part of this application that costs money per use and
 * cannot be undone by rate-limiting a page: every call reaches a provider and
 * is billed. An unmetered anonymous path is therefore not a generosity, it is
 * an invitation — so a visitor gets enough to see what assistance is for, and
 * an account is what makes it ordinary.
 *
 * Counted against the owner AND the address, and both have to pass. Either
 * alone is trivially defeated: clearing a cookie resets an owner, and one
 * address is shared by everyone behind a router or a phone network. Requiring
 * both means clearing a cookie does not refill the allowance, while a household
 * still gets a household's worth rather than one person's.
 *
 * Deliberately NOT device fingerprinting. The address is already in every
 * request and is used for nothing else; building an identifier out of a
 * browser's characteristics to recognise somebody who did not ask to be
 * recognised is a different thing, and not one this product does.
 */

import type { RateLimitDecision } from './rate-limit.ts';
import { DAY_MS, SlidingWindowRateLimiter } from './rate-limit.ts';

/** Enough to see what assistance does, not enough to run on. */
export const ANONYMOUS_DAILY_MESSAGES = 5;

/**
 * How long a message from somebody without an account may be.
 *
 * Short, because the allowance is about trying assistance rather than working
 * with it, and because the cost of a call scales with what is sent. The signed
 * -in ceiling is `AI_MAX_INPUT_CHARS`, which is far larger.
 */
export const ANONYMOUS_MAX_INPUT_CHARS = 1_500;

export class AnonymousAiAllowance {
  private readonly byOwner: SlidingWindowRateLimiter;
  private readonly byAddress: SlidingWindowRateLimiter;

  constructor(
    perDay: number = ANONYMOUS_DAILY_MESSAGES,
    now: () => number = Date.now,
    /*
     * The address ceiling is deliberately looser than the owner one. A shared
     * address is common and ordinary — a family, an office, a campus — and
     * treating it as one person would refuse people who have done nothing.
     */
    perDayPerAddress: number = perDay * 4,
  ) {
    this.byOwner = new SlidingWindowRateLimiter(perDay, now, DAY_MS);
    this.byAddress = new SlidingWindowRateLimiter(perDayPerAddress, now, DAY_MS);
  }

  /**
   * Spend one message, or explain why not.
   *
   * The owner counter is taken first and the address counter only if it passed,
   * so somebody who has used their own allowance does not also spend their
   * household's.
   */
  take(ownerId: string | null, address: string): RateLimitDecision {
    const owner = this.byOwner.take(ownerId ?? `address:${address}`);
    if (!owner.allowed) return owner;
    return this.byAddress.take(address);
  }
}
