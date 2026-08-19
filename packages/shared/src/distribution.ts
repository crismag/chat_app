/*
 * How much somebody may distribute, and why the numbers are shaped this way.
 *
 * Writing is private by default and has no ceiling at all. Distribution is
 * different in kind: it puts something in front of other people, and other
 * people are the thing worth protecting. So the limits below apply to sharing
 * and to nothing else — reaching one of them must never stop somebody writing,
 * editing, or handing their own reflection to another app.
 *
 * The shape matters more than the numbers. Four separate ceilings, because
 * four different things are being prevented:
 *
 *   Same community, per hour — one person filling one room.
 *   All communities, per hour and per day — one person filling every room.
 *   Same reflection across communities — carpet-bombing, which is the strongest
 *     spam signal here and the one with an honest alternative: somebody who
 *     wants everybody to read something should share it publicly once.
 *   A new account's first day — almost all abuse arrives on accounts minutes
 *     old, and almost nobody's genuine first day involves twenty shares.
 *
 * The numbers themselves are guesses, made deliberately generous enough that a
 * person who is enthusiastic on a Sunday afternoon will not meet one. They are
 * collected here, as data, so that changing them is an edit to one object
 * rather than an archaeology expedition through the routes.
 */

export type ShareLimit = {
  /** How many, in the window. */
  count: number;
  /** How long the window is. */
  windowMs: number;
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const DISTRIBUTION_LIMITS = {
  /** Into one particular community. */
  perCommunityHour: { count: 5, windowMs: HOUR } satisfies ShareLimit,
  /** Into any community. */
  allCommunitiesHour: { count: 10, windowMs: HOUR } satisfies ShareLimit,
  allCommunitiesDay: { count: 25, windowMs: DAY } satisfies ShareLimit,
  /**
   * How many *different* communities one reflection may reach in a day.
   *
   * Counted in communities rather than in shares, which is the point: sharing
   * five different reflections into one community is participation, and
   * sharing one reflection into five communities is a broadcast.
   */
  communitiesPerReflectionDay: { count: 5, windowMs: DAY } satisfies ShareLimit,
  publicHour: { count: 5, windowMs: HOUR } satisfies ShareLimit,
  publicDay: { count: 10, windowMs: DAY } satisfies ShareLimit,
  /** Everything a new account may distribute, of either kind, on day one. */
  newAccountDay: { count: 5, windowMs: DAY } satisfies ShareLimit,
  /**
   * The backstop, across both destinations.
   *
   * Not a number anybody should ever see. It exists so that a combination of
   * the ceilings above that nobody anticipated still has a ceiling.
   */
  everythingDay: { count: 30, windowMs: DAY } satisfies ShareLimit,
} as const;

/** How long an account is treated as new. */
export const NEW_ACCOUNT_MS = DAY;

/**
 * Which ceiling was reached, so the interface can say the true thing.
 *
 * Distinguished because two of them deserve different sentences: being told
 * "you have shared a lot recently" when the real problem is that *this
 * reflection* has been to five communities today would send somebody to try
 * the sixth with a different reflection, which is not the behaviour being
 * asked for.
 */
export const SHARE_REFUSALS = {
  TOO_MANY: 'too_many_shares',
  TOO_MANY_COMMUNITIES: 'reflection_in_too_many_communities',
  NEW_ACCOUNT: 'new_account',
} as const;

export type ShareRefusal = (typeof SHARE_REFUSALS)[keyof typeof SHARE_REFUSALS];

/**
 * What somebody is told when they reach one.
 *
 * Only ever said at the moment it happens. A counter on the page — "17 of 25
 * shares remaining" — turns sharing into a budget to spend and this product
 * into something transactional, which is the opposite of what it is for.
 */
export const SHARE_REFUSAL_MESSAGES: Record<ShareRefusal, string> = {
  [SHARE_REFUSALS.TOO_MANY]:
    'You have shared quite a few reflections recently. Please wait a little before sharing again.',
  [SHARE_REFUSALS.TOO_MANY_COMMUNITIES]:
    'This reflection has already been shared to several communities today. Try again later, or share it publicly instead.',
  [SHARE_REFUSALS.NEW_ACCOUNT]:
    'New accounts can share a few reflections a day to begin with. This eases off after your first day — everything you write stays yours in the meantime.',
};
