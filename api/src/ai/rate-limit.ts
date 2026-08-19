/*
 * A ceiling on how often one person, or one address, can reach the provider.
 *
 * Two counters rather than one. Per-user stops a single signed-in account
 * holding a button down; per-IP stops a handful of accounts created from one
 * place doing the same thing. Either one alone leaves the other open.
 *
 * A sliding window over remembered timestamps, in memory. That is honest about
 * its limits: it does not survive a restart and it does not span processes, so
 * a multi-instance deployment needs a shared store. It is written down here
 * rather than discovered later.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the next attempt could succeed. Safe to tell the client. */
  retryAfterSeconds: number;
}

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  /*
   * The window is a parameter because there are two different ceilings now: a
   * per-minute one that stops a button being held down, and a per-day one that
   * is the whole allowance somebody without an account gets. Same counting,
   * different question.
   */
  constructor(limit: number, now: () => number = Date.now, windowMs: number = MINUTE_MS) {
    this.limit = limit;
    this.now = now;
    this.windowMs = windowMs;
  }

  /**
   * Record an attempt against a key, and say whether it may proceed.
   *
   * A refused attempt is deliberately NOT recorded. Counting refusals would
   * mean that someone who keeps pressing extends their own lockout indefinitely
   * — a punishment the rule never intended and one that is hard to explain.
   */
  take(key: string): RateLimitDecision {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((at) => at > cutoff);

    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      const oldest = recent[0] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)),
      };
    }

    recent.push(now);
    this.hits.set(key, recent);

    /* Keys that have gone quiet are dropped, so this cannot grow without end. */
    if (this.hits.size > 5000) {
      for (const [existing, times] of this.hits) {
        if (times.every((at) => at <= cutoff)) this.hits.delete(existing);
      }
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/**
 * Both ceilings, checked together.
 *
 * The user counter is taken first and only if it passed is the address counter
 * taken, so one person hitting their own limit does not also spend the shared
 * budget of everyone behind the same address.
 */
export class AiRateLimiter {
  private readonly perUser: SlidingWindowRateLimiter;
  private readonly perAddress: SlidingWindowRateLimiter;

  constructor(perMinute: number, now: () => number = Date.now) {
    this.perUser = new SlidingWindowRateLimiter(perMinute, now);
    /*
     * More headroom for an address than for a user: a household, an office or a
     * campus behind one NAT is several legitimate people, and a limit that
     * treats them as one person punishes the wrong thing.
     */
    this.perAddress = new SlidingWindowRateLimiter(perMinute * 4, now);
  }

  take(userId: string, address: string): RateLimitDecision {
    const user = this.perUser.take(`u:${userId}`);
    if (!user.allowed) return user;
    return this.perAddress.take(`a:${address}`);
  }
}
