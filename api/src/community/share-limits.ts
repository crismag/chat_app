/*
 * Whether this share may happen, decided from what has already been shared.
 *
 * Two things make this more than a counter.
 *
 * First, it counts share *events*, not publications that currently exist. A
 * publication can be deleted, and if the count came from the live rows then
 * share, unshare, share would be free forever — the limit would be a limit on
 * how much is visible rather than on how much somebody is doing. So every
 * successful share writes a row that nothing removes, and the ceilings are
 * read from those.
 *
 * Second, it distinguishes which ceiling was reached. Telling somebody "you
 * have shared a lot recently" when the real answer is "this reflection has
 * been to five communities today" sends them off to try the sixth with a
 * different reflection, which is exactly the behaviour the rule exists to
 * discourage. They are told the true thing, and told the honest alternative.
 */

import {
  DISTRIBUTION_LIMITS,
  NEW_ACCOUNT_MS,
  SHARE_REFUSALS,
  SHARE_REFUSAL_MESSAGES,
  type ShareLimit,
  type ShareRefusal,
} from '@chat/shared';

/** One window's worth of history: how many, and when the oldest of them was. */
export type WindowCount = { count: number; oldestAt: number | null };

/**
 * Everything the decision needs, read from the share log in one pass.
 *
 * Supplied by the store rather than fetched here, so this file has no database
 * in it and can be reasoned about — and tested — as what it is: a rule.
 */
export type ShareHistory = {
  publicHour: WindowCount;
  publicDay: WindowCount;
  communitiesHour: WindowCount;
  communitiesDay: WindowCount;
  thisCommunityHour: WindowCount;
  /** Distinct communities this reflection has reached in the last day. */
  communitiesForReflectionDay: { communityIds: string[]; oldestAt: number | null };
  everythingDay: WindowCount;
};

export type ShareIntent = {
  audience: 'public' | 'community';
  communityId: string | null;
  accountAgeMs: number | null;
};

export type ShareDecision =
  | { allowed: true }
  | { allowed: false; refusal: ShareRefusal; message: string; retryAfterSeconds: number };

/** When the oldest event in a full window ages out, there is room again. */
function retryAfter(oldestAt: number | null, limit: ShareLimit, now: number): number {
  if (oldestAt === null) return Math.ceil(limit.windowMs / 1000);
  return Math.max(1, Math.ceil((oldestAt + limit.windowMs - now) / 1000));
}

function refuse(
  refusal: ShareRefusal,
  oldestAt: number | null,
  limit: ShareLimit,
  now: number,
): ShareDecision {
  return {
    allowed: false,
    refusal,
    message: SHARE_REFUSAL_MESSAGES[refusal],
    retryAfterSeconds: retryAfter(oldestAt, limit, now),
  };
}

export function decideShare(
  history: ShareHistory,
  intent: ShareIntent,
  now: number = Date.now(),
): ShareDecision {
  const limits = DISTRIBUTION_LIMITS;

  /*
   * A new account first. It is the tightest ceiling and the one whose message
   * is most worth hearing — it explains itself and says it is temporary,
   * rather than reading as an accusation.
   *
   * An unknown age counts as new: the safer of the two answers.
   */
  const isNew = intent.accountAgeMs === null || intent.accountAgeMs < NEW_ACCOUNT_MS;
  if (isNew && history.everythingDay.count >= limits.newAccountDay.count) {
    return refuse(
      SHARE_REFUSALS.NEW_ACCOUNT,
      history.everythingDay.oldestAt,
      limits.newAccountDay,
      now,
    );
  }

  if (intent.audience === 'public') {
    if (history.publicHour.count >= limits.publicHour.count) {
      return refuse(SHARE_REFUSALS.TOO_MANY, history.publicHour.oldestAt, limits.publicHour, now);
    }
    if (history.publicDay.count >= limits.publicDay.count) {
      return refuse(SHARE_REFUSALS.TOO_MANY, history.publicDay.oldestAt, limits.publicDay, now);
    }
  }

  if (intent.audience === 'community') {
    /*
     * Carpet-bombing, checked before the ordinary ceilings so its own sentence
     * is the one somebody sees. Sharing again into a community this reflection
     * has already reached today does not widen anything, so it is not counted
     * against this one.
     */
    const reached = new Set(history.communitiesForReflectionDay.communityIds);
    const wouldWiden = intent.communityId !== null && !reached.has(intent.communityId);
    if (wouldWiden && reached.size >= limits.communitiesPerReflectionDay.count) {
      return refuse(
        SHARE_REFUSALS.TOO_MANY_COMMUNITIES,
        history.communitiesForReflectionDay.oldestAt,
        limits.communitiesPerReflectionDay,
        now,
      );
    }

    if (history.thisCommunityHour.count >= limits.perCommunityHour.count) {
      return refuse(
        SHARE_REFUSALS.TOO_MANY,
        history.thisCommunityHour.oldestAt,
        limits.perCommunityHour,
        now,
      );
    }
    if (history.communitiesHour.count >= limits.allCommunitiesHour.count) {
      return refuse(
        SHARE_REFUSALS.TOO_MANY,
        history.communitiesHour.oldestAt,
        limits.allCommunitiesHour,
        now,
      );
    }
    if (history.communitiesDay.count >= limits.allCommunitiesDay.count) {
      return refuse(
        SHARE_REFUSALS.TOO_MANY,
        history.communitiesDay.oldestAt,
        limits.allCommunitiesDay,
        now,
      );
    }
  }

  /* The backstop nobody should ever meet. */
  if (history.everythingDay.count >= limits.everythingDay.count) {
    return refuse(
      SHARE_REFUSALS.TOO_MANY,
      history.everythingDay.oldestAt,
      limits.everythingDay,
      now,
    );
  }

  return { allowed: true };
}
