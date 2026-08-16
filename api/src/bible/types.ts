/*
 * The seam. What a Bible provider must be able to do, expressed without naming
 * one.
 *
 * The service above this interface owns gating, rate limiting, caching, the
 * retry policy and the translation of everything into a typed outcome. An
 * adapter below it owns one thing: speaking the provider's dialect and
 * converting its failures into `BibleFailure`. Nothing that is true of *Bibles*
 * belongs in an adapter, and nothing that is true of *YouVersion* belongs above
 * it.
 */

import { BIBLE_OUTCOMES, type BibleOutcome } from '@chat/shared';

/** A translation exactly as this application models it, before normalisation
 * into the wire shape — the two are the same today, and the type alias exists
 * so a provider with extra fields has somewhere to put them. */
export interface ProviderTranslation {
  id: number;
  /** The provider's own abbreviation, e.g. `NIV11`, `engWEBUS`. */
  abbreviation: string;
  /** The abbreviation a reader recognises, e.g. `NIV`, `WEBUS`. */
  localizedAbbreviation: string;
  name: string;
  language: string;
  copyright?: string;
  publisherUrl?: string;
  youVersionUrl?: string;
}

export interface ProviderPassage {
  passageId: string;
  reference: string;
  content: string;
}

export interface ProviderCall {
  signal: AbortSignal;
  requestId: string;
}

export interface BibleProviderPort {
  /** Every translation in the given language range, following pagination. */
  listTranslations(language: string, call: ProviderCall): Promise<ProviderTranslation[]>;
  /** One translation, including the attribution the list endpoint omits. */
  getTranslation(id: number, call: ProviderCall): Promise<ProviderTranslation>;
  getPassage(translationId: number, usfm: string, call: ProviderCall): Promise<ProviderPassage>;
}

/**
 * A failure with an outcome attached, and a message meant only for our logs.
 *
 * `message` is never shown to anybody. The sentence a person reads comes from
 * `BIBLE_OUTCOME_MESSAGES` in `@chat/shared` and is chosen by the route. Two
 * separate strings, on purpose: an upstream message is the most likely thing to
 * be carrying a URL, a key fragment, an account id or a stack trace, and the
 * only reliable way not to forward one is to have no code path that can.
 */
export class BibleFailure extends Error {
  readonly outcome: BibleOutcome;
  readonly retryable: boolean;

  constructor(outcome: BibleOutcome, message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = 'BibleFailure';
    this.outcome = outcome;
    /*
     * Nothing is retryable unless it is said to be. A retry that "seemed safe"
     * on a 4xx is a second request that will fail identically, on somebody
     * else's quota.
     */
    this.retryable = options.retryable ?? false;
  }
}

export function isBibleFailure(value: unknown): value is BibleFailure {
  return value instanceof BibleFailure;
}

export { BIBLE_OUTCOMES };
