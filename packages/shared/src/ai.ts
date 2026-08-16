/*
 * What assistance is, said once, where every client can read it.
 *
 * This module is deliberately provider-free. It names the sections, the typed
 * outcomes, the copy the interface must show and the shapes that cross the
 * wire. It knows nothing about Gemini, about models, about keys or about
 * timeouts — swapping the provider must not touch a single line here, and the
 * browser must never learn which provider answered beyond its name.
 *
 * The word is **Heart**. Never "Highlight". The H in C.H.A.T. is how the
 * passage personally touched the writer, and calling it a highlight turns a
 * confession into a bookmark. There is a regression test on this specifically,
 * because the mistake is one letter of carelessness away at all times.
 */

/** The four sections guidance may be asked about. */
export const AI_GUIDANCE_SECTIONS = [
  'context',
  'heart',
  'application',
  'testimony',
] as const;

export type AiGuidanceSection = (typeof AI_GUIDANCE_SECTIONS)[number];

/**
 * What each letter means, for prompts and for interface copy.
 *
 * Kept beside the section names so a prompt and a label can never drift into
 * describing the section differently.
 */
export const AI_SECTION_MEANINGS: Record<AiGuidanceSection, string> = {
  context: 'Context — what is happening in and around the passage.',
  heart: 'Heart — how the passage personally touches the writer.',
  application: 'Application — how it applies, and what they may do.',
  testimony: 'Testimony — their own declaration of faith, conviction or prayer.',
};

/**
 * Every way an assistance request can end.
 *
 * A typed outcome is the difference between an interface that can say "you have
 * asked a few times in a row, try again in a minute" and one that says
 * "something went wrong". Codes are stable and safe to show; the messages that
 * accompany them are written here rather than derived from a provider's.
 */
export const AI_OUTCOMES = {
  OK: 'ok',
  AI_DISABLED: 'ai_disabled',
  AI_NOT_CONFIGURED: 'ai_not_configured',
  RATE_LIMITED: 'rate_limited',
  TIMEOUT: 'timeout',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  INVALID_PROVIDER_RESPONSE: 'invalid_provider_response',
  CONTENT_NOT_SUPPORTED: 'content_not_supported',
  NEEDS_USER_CLARIFICATION: 'needs_user_clarification',
  /*
   * The caller's own fault rather than the provider's. Separate from the eight
   * above because it never reaches a provider at all — it is refused at the
   * door, and conflating it with `content_not_supported` would tell someone the
   * model declined when in fact nothing was ever sent.
   */
  INVALID_REQUEST: 'invalid_request',
  INPUT_TOO_LONG: 'input_too_long',
} as const;

export type AiOutcome = (typeof AI_OUTCOMES)[keyof typeof AI_OUTCOMES];

/**
 * The sentence that must travel with every set of suggestions.
 *
 * It is part of the response rather than a string the interface remembers to
 * add, because a suggestion that arrives without it has been stripped of the
 * only thing that keeps it a suggestion.
 */
export const AI_GUIDANCE_NOTICE =
  'AI suggestions may be incomplete. Keep only what faithfully reflects your understanding and experience.';

/** Shown once, before the first real request leaves the browser. */
export const AI_DISCLOSURE =
  'When you use AI assistance, the selected Bible passage and reflection text needed for that request are sent to our AI provider. Do not include information you do not want processed by that provider.';

/**
 * What failure says.
 *
 * Every failure path ends here, and it ends by pointing at the manual workflow.
 * The person came to write; assistance going away is an inconvenience, not an
 * interruption of the thing they actually came to do.
 */
export const AI_UNAVAILABLE_MESSAGE =
  'AI assistance is unavailable right now. You can continue writing normally.';

/** Messages for the outcomes the interface has to explain. Safe to display. */
export const AI_OUTCOME_MESSAGES: Record<AiOutcome, string> = {
  [AI_OUTCOMES.OK]: '',
  [AI_OUTCOMES.AI_DISABLED]: 'AI assistance is switched off for this server.',
  [AI_OUTCOMES.AI_NOT_CONFIGURED]: 'AI assistance is not configured on this server.',
  [AI_OUTCOMES.RATE_LIMITED]:
    'You have asked for assistance several times in a row. Give it a moment and try again.',
  [AI_OUTCOMES.TIMEOUT]: AI_UNAVAILABLE_MESSAGE,
  [AI_OUTCOMES.PROVIDER_UNAVAILABLE]: AI_UNAVAILABLE_MESSAGE,
  [AI_OUTCOMES.INVALID_PROVIDER_RESPONSE]: AI_UNAVAILABLE_MESSAGE,
  [AI_OUTCOMES.CONTENT_NOT_SUPPORTED]:
    'That request could not be assisted with. You can continue writing normally.',
  [AI_OUTCOMES.NEEDS_USER_CLARIFICATION]:
    'The meaning here was not clear enough to reword safely without guessing.',
  [AI_OUTCOMES.INVALID_REQUEST]: 'That request was not understood.',
  [AI_OUTCOMES.INPUT_TOO_LONG]:
    'There is more text here than can be sent for assistance. Shorten it, or ask about one section at a time.',
};

/** How many guiding questions a section may come back with. */
export const AI_QUESTIONS_PER_SECTION = { min: 1, max: 3 } as const;

/** A single question's ceiling, enforced on both sides of the wire. */
export const AI_QUESTION_MAX_CHARS = 240;

/* --------------------------------------------------------------- the wire */

export type AiGuidanceSectionResult = {
  /** Between one and three. Questions to think with — never answers. */
  questions: string[];
};

export type ReflectionGuidanceResponse = {
  /** A section is absent when it was not asked for. */
  sections: Partial<Record<AiGuidanceSection, AiGuidanceSectionResult>>;
  notice: string;
};

export type ImproveWritingResponse =
  | {
      outcome: typeof AI_OUTCOMES.OK;
      original: string;
      suggested: string;
      summaryOfChanges: string[];
      /*
       * Always false on a returned suggestion. When the model cannot reword
       * without risking the meaning it must say so instead, and that answer
       * comes back as `needs_user_clarification` rather than as a guess with a
       * flag on it.
       */
      meaningChanged: false;
    }
  | {
      outcome: typeof AI_OUTCOMES.NEEDS_USER_CLARIFICATION;
      original: string;
      question: string;
    };

/** What the client may know about assistance. Nothing else belongs here. */
export type AiCapabilities = {
  suggestTitle: boolean;
  reflectionGuidance: boolean;
  improveWriting: boolean;
};

export type AiStatusResponse = {
  enabled: boolean;
  /** A name, never a configuration value. `none` when nothing can answer. */
  provider: string;
  reason?: string;
  capabilities: AiCapabilities;
};

/** The body of a failed assistance request. Codes and copy, never internals. */
export type AiErrorResponse = {
  error: string;
  outcome: AiOutcome;
};

/**
 * Is this string the H of C.H.A.T.?
 *
 * Exported so the regression test has something to point at, and so a future
 * caller reaching for "highlight" finds the refusal in one place.
 */
export function isHeartSection(value: string): value is 'heart' {
  return value === 'heart';
}
