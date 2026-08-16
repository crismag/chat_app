/*
 * ─────────────────────────────────────────────────────────────────────────────
 *  THE MUTATION BOUNDARY.
 *
 *  This file decides which section a generated draft is *offered* for. It is
 *  trusted application code, and it is deliberately the only place that
 *  decision is made.
 *
 *  The rule it exists to enforce:
 *
 *      Gemini may generate explanations, questions, and clearly labelled
 *      C.H.A.T. section drafts. Gemini must NEVER directly mutate a section.
 *      Moving content from a message into a section must require an explicit,
 *      trusted user action handled by application code, with no silent
 *      replacement of existing text.
 *
 *  How that is held, structurally rather than by good intentions:
 *
 *  1. The model returns CONTENT ONLY. The chat response schema has a `draft`
 *     string and nothing else — no section field, no action field, no target.
 *     There is no vocabulary in which the model could express "write this to
 *     Heart", so there is nothing for a client to obey. This is stronger than
 *     validating a destination the model proposed, and it is why the schema
 *     does not have one.
 *
 *  2. The destination is resolved HERE, from two sources the model does not
 *     control: the application's own scoped-mode state, and the user's own
 *     words. If neither yields an answer the draft is offered with no
 *     destination and the interface asks the author to choose — a click, which
 *     is itself the explicit action.
 *
 *  3. The result is always one of `AI_GUIDANCE_SECTIONS` or null. Nothing else
 *     can come out of this function, whatever went in.
 *
 *  4. Nothing in this file writes anything. Resolving a target is not
 *     performing a write. The write happens later, through the authenticated,
 *     owned-conversation section endpoint, triggered by a user gesture — the
 *     same endpoint the author uses when they type into a section by hand.
 *
 *  The structural guarantee stated once more, because the next person adding a
 *  feature here needs to see it rather than infer it: **a chat reply is a
 *  message.** `POST /api/ai/reflection-chat` appends to the message thread and
 *  touches the sections table not at all. There is no code path from a model
 *  response to a section write. If you are about to add one, you are about to
 *  break the rule this file exists for.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  AI_CHAT_ACTIONS,
  AI_GUIDANCE_SECTIONS,
  type AiChatAction,
  type AiGuidanceSection,
} from '@chat/shared';

/** Where a resolved destination came from. Recorded for logs and for tests. */
export const DRAFT_TARGET_SOURCES = {
  /** A structured action the client chose from a fixed set. */
  ACTION: 'action',
  /** Scoped mode: the author pressed "Discuss in chat" on a section. */
  SCOPE: 'scope',
  /** The author named the section in their own message. */
  REQUEST: 'request',
} as const;

export type DraftTargetSource =
  (typeof DRAFT_TARGET_SOURCES)[keyof typeof DRAFT_TARGET_SOURCES];

export interface DraftTarget {
  section: AiGuidanceSection;
  source: DraftTargetSource;
}

/**
 * Words that name a section in a request, in the author's own vocabulary.
 *
 * People do not say "testimony section". They say "write me a prayer", "turn
 * this into a declaration", "what should I do about it". Matching only the
 * formal names would resolve almost nothing and send every draft to the picker.
 *
 * Order matters within a section: the first match wins, so the most specific
 * phrasing is listed first.
 */
const SECTION_WORDS: Record<AiGuidanceSection, RegExp[]> = {
  context: [/\bcontext\b/, /\bbackground\b/, /\bwhat (?:is|was) happening\b/],
  heart: [/\bheart\b/, /\bhow (?:it|this) (?:touched|affected|moved)\b/],
  application: [/\bapplication\b/, /\bapply\b/, /\bpractical\b/, /\bwhat (?:should|can) i do\b/],
  testimony: [/\btestimony\b/, /\bprayer\b/, /\bpray\b/, /\bdeclaration\b/, /\bdeclare\b/],
};

/**
 * Did the author's own message name a section?
 *
 * Exported so the boundary test can point at it directly. It reads the USER's
 * words — never the model's reply — which is what makes it a trusted source.
 */
export function sectionFromUserRequest(message: string): AiGuidanceSection | null {
  const text = message.toLowerCase();

  /*
   * Only when they are actually asking for something to be written. "My heart
   * is heavy today" names a section word without being a request for a Heart
   * draft, and treating it as one would put an add-to-Heart button under an
   * ordinary sentence about how someone feels.
   */
  if (!DRAFT_VERB.test(text)) {
    return null;
  }

  const matches: AiGuidanceSection[] = [];
  for (const section of AI_GUIDANCE_SECTIONS) {
    if (SECTION_WORDS[section].some((pattern) => pattern.test(text))) {
      matches.push(section);
    }
  }

  /*
   * Exactly one, or nothing. "Draft my Heart and my Testimony" is ambiguous,
   * and guessing which they meant is the kind of small confident wrong answer
   * that costs more trust than asking would have.
   */
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/** The verbs that make a message a request for something to be written. */
const DRAFT_VERB =
  /\b(draft|write|compose|generate|create|help me (?:with|express|write)|turn this into|put this)\b/;

/**
 * Is this turn allowed to produce a draft at all?
 *
 * Decided here, in trusted code, BEFORE the provider is called and regardless
 * of what it returns. A model that volunteers draft text on a turn that was not
 * a draft request has it discarded — the model does not get to choose whether
 * this turn produces conversation or generated material, because that choice is
 * the first half of the insertion decision.
 *
 * Two ways to qualify, and both are ours:
 *   - the client invoked the one structured action that means "draft";
 *   - the author asked for one in their own words.
 */
export function isDraftTurn(input: { action?: AiChatAction | undefined; userMessage: string }): boolean {
  if (input.action) return input.action === AI_CHAT_ACTIONS.DRAFT_SECTION;
  return DRAFT_VERB.test(input.userMessage.toLowerCase());
}

/**
 * Which section a draft is offered for.
 *
 * Trusted inputs only:
 *   - `focusSection` is application state, set when the author pressed
 *     "Discuss in chat" on a section. It is validated against the enum anyway,
 *     because it arrives over the wire and a client is a convenience, never an
 *     authority.
 *   - `userMessage` is the author's own words.
 *
 * The model's reply is not a parameter. That is the point, and it is why this
 * signature has no place to pass one.
 *
 * Returns null when the destination is not knowable, which is not a failure:
 * the draft is still offered, and the interface asks the author to choose.
 */
export function resolveDraftTarget(input: {
  /** From a structured action the client chose. Still enum-validated. */
  actionSection?: string | undefined;
  focusSection?: string | undefined;
  userMessage: string;
}): DraftTarget | null {
  /*
   * A structured action carries its own destination — "Draft Heart" is a
   * different button from "Draft Context" — and the client picked it from a
   * fixed list. It outranks the scope, because it is the more specific thing
   * the author just pressed.
   */
  const fromAction = validSection(input.actionSection);
  if (fromAction) {
    return { section: fromAction, source: DRAFT_TARGET_SOURCES.ACTION };
  }

  const scoped = validSection(input.focusSection);
  if (scoped) {
    return { section: scoped, source: DRAFT_TARGET_SOURCES.SCOPE };
  }

  const requested = sectionFromUserRequest(input.userMessage);
  if (requested) {
    return { section: requested, source: DRAFT_TARGET_SOURCES.REQUEST };
  }

  return null;
}

/**
 * The known-good enum, applied to anything arriving from outside.
 *
 * Every value that could ever name a section passes through here before it is
 * believed — including values that came from our own client, because "our own
 * client" is only ever a claim about the sender.
 */
export function validSection(value: unknown): AiGuidanceSection | null {
  return typeof value === 'string' && (AI_GUIDANCE_SECTIONS as readonly string[]).includes(value)
    ? (value as AiGuidanceSection)
    : null;
}
