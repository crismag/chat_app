/*
 * The Bible passage contract, stated once and shared by both sides.
 *
 * Everything in this file is OUR shape. Nothing here mirrors the provider's
 * JSON, and that is the whole point: the browser asks this application for a
 * passage and receives these fields, so the day the provider changes a key —
 * or is replaced entirely — the change stops at the connector and never
 * reaches a component.
 *
 * Two rules govern what may appear below.
 *
 *   1. **No credential, ever.** These types are serialised into HTTP responses
 *      and into a saved reflection. A field that could hold a key would
 *      eventually hold one.
 *   2. **Optional means genuinely absent.** `copyright` is optional because the
 *      provider really does return `null` for some translations (the American
 *      Standard Version, for one). An absent attribution line is omitted; it is
 *      never replaced with a plausible-looking sentence we wrote ourselves,
 *      because an invented copyright notice is worse than none at all.
 */

/** The only provider this connector speaks to today. Recorded on every saved
 * passage so a future second provider can be told apart from this one without
 * guessing from the shape of an id. */
export const BIBLE_PROVIDERS = {
  YOUVERSION: 'youversion',
} as const;

export type BibleProvider = (typeof BIBLE_PROVIDERS)[keyof typeof BIBLE_PROVIDERS];

/**
 * A translation, as the interface needs it.
 *
 * `id` is numeric and is the thing that gets stored. The abbreviation is for
 * display and for searching; it is emphatically NOT an identifier, because the
 * provider's abbreviations are not what anyone expects — the New International
 * Version's is `NIV11`, the World English Bible's is `engWEBUS` — and code that
 * keys off them silently selects the wrong Bible.
 */
export interface BibleTranslation {
  id: number;
  /** What a reader would call it: `NIV`, `BSB`, `WEBUS`. */
  abbreviation: string;
  name: string;
  /** BCP 47 language tag, as the provider states it. */
  language: string;
  /**
   * The language as a person would say it: `Filipino`, `Cebuano`, `Spanish`.
   *
   * Carried because a catalog spanning several languages is unreadable without
   * it. `NVI` appears twice — once Spanish, once Portuguese — and `CCB` is
   * Chinese while the Cebuano Bible is `APD`. A row showing only an
   * abbreviation makes those indistinguishable, and picking the wrong one is
   * not a small mistake when it decides which Bible somebody reads.
   */
  languageName: string;
  /**
   * Other names for that language, carried for searching only.
   *
   * `tl` displays as "Filipino", but a great many people would type "Tagalog",
   * and a search that refuses them is a search that looks broken.
   */
  languageAliases?: string[];
  copyright?: string;
  publisherUrl?: string;
  youVersionUrl?: string;
}

export interface BibleTranslationsResponse {
  translations: BibleTranslation[];
}

/** Where a reader can go to read more. Absent links are omitted, not empty. */
export interface BiblePassageLinks {
  publisher?: string;
  youVersion?: string;
}

/**
 * A passage, and everything a reflection has to remember about it.
 *
 * This is also the persisted shape. A reflection opened in a year must show the
 * translation and the words it was actually written against, so the attribution
 * and the text travel with it rather than being fetched again and quietly
 * re-rendered in whatever translation happens to be selected that day.
 */
export interface BiblePassage {
  provider: BibleProvider;
  translationId: number;
  abbreviation: string;
  name: string;
  /** USFM, e.g. `JHN.3.16-18`. The provider's own passage identifier. */
  passageId: string;
  /** The canonical human reference, as the provider renders it. */
  reference: string;
  /** Plain text. The provider sends no markup and no verse numbers. */
  content: string;
  copyright?: string;
  links?: BiblePassageLinks;
  /** When this text was fetched, ISO 8601. */
  retrievedAt: string;
}

/* --------------------------------------------------------------- outcomes */

/**
 * Every way a lookup can end, named.
 *
 * A typed outcome rather than a message, so the interface can decide what a
 * failure looks like — retry, choose another translation, correct the
 * reference — instead of pattern-matching English.
 */
export const BIBLE_OUTCOMES = {
  OK: 'ok',
  /** No usable credential. Deliberately says nothing about *why*. */
  NOT_CONFIGURED: 'bible_not_configured',
  INVALID_REQUEST: 'invalid_request',
  INVALID_REFERENCE: 'invalid_reference',
  TRANSLATION_UNAVAILABLE: 'translation_unavailable',
  PASSAGE_NOT_FOUND: 'passage_not_found',
  RATE_LIMITED: 'rate_limited',
  TIMEOUT: 'timeout',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  INVALID_PROVIDER_RESPONSE: 'invalid_provider_response',
} as const;

export type BibleOutcome = (typeof BIBLE_OUTCOMES)[keyof typeof BIBLE_OUTCOMES];

/**
 * The sentence a person reads, chosen here so both sides agree on it.
 *
 * Each one is written to be true without being diagnostic. "Not configured"
 * never distinguishes a missing key from a malformed one from a rejected one:
 * that difference is useful to an attacker probing the deployment and useless
 * to the person trying to look up John 3:16.
 *
 * Every failure message also states what did NOT happen, because the fear on
 * the other side of the screen is that a failed lookup ate the reflection.
 */
export const BIBLE_OUTCOME_MESSAGES: Record<BibleOutcome, string> = {
  [BIBLE_OUTCOMES.OK]: '',
  [BIBLE_OUTCOMES.NOT_CONFIGURED]: 'Bible passage lookup is not configured.',
  [BIBLE_OUTCOMES.INVALID_REQUEST]: 'That request could not be understood.',
  [BIBLE_OUTCOMES.INVALID_REFERENCE]: 'That reference could not be understood.',
  [BIBLE_OUTCOMES.TRANSLATION_UNAVAILABLE]:
    'That translation is not available. Your reflection has not been changed.',
  [BIBLE_OUTCOMES.PASSAGE_NOT_FOUND]:
    'That passage is not in this translation. Your reflection has not been changed.',
  [BIBLE_OUTCOMES.RATE_LIMITED]: 'Too many passage lookups just now. Try again in a moment.',
  [BIBLE_OUTCOMES.TIMEOUT]:
    'Bible passage lookup took too long. Your reflection has not been changed.',
  [BIBLE_OUTCOMES.PROVIDER_UNAVAILABLE]:
    'Bible passage lookup is unavailable right now. Your reflection has not been changed.',
  [BIBLE_OUTCOMES.INVALID_PROVIDER_RESPONSE]:
    'Bible passage lookup returned something unexpected. Your reflection has not been changed.',
};

export interface BibleErrorResponse {
  error: string;
  outcome: BibleOutcome;
  /** Seconds until a rate-limited caller could try again. */
  retryAfterSeconds?: number;
}

/* ------------------------------------------------------------- AI boundary */

/**
 * The seam that keeps Scripture out of a model prompt.
 *
 * Assistance is given the *reference* — "John 3:16-18" — and, only when this
 * says so, the text. Licensing for a translation may forbid sending its words
 * to a third party, and that decision has to be one switch in trusted code
 * rather than an audit of every prompt builder.
 *
 * The second field is the more important one and it is not about licensing at
 * all. When retrieval fails there is no passage, and a model asked to reflect
 * on "John 3:16" will happily supply a remembered verse — subtly wrong, in the
 * wrong translation, attributed to a publisher who never wrote it. So a failed
 * lookup must reach the prompt as an explicit absence, never as a gap the model
 * is free to fill.
 */
export interface ScriptureForPrompt {
  reference: string;
  abbreviation: string;
  /** Present only when policy allows the words themselves to be sent. */
  text?: string;
  /**
   * True when no passage could be retrieved. A prompt builder that sees this
   * must instruct the model not to quote or reconstruct the passage.
   */
  unavailable: boolean;
}

/** Whether a translation's text may be included in a provider prompt. */
export const SCRIPTURE_IN_PROMPTS_DEFAULT = false;
