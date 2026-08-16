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
  'content',
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
  content:
    'Content — the passage itself, as the writer wants it read: the verse text, usually with its reference and translation. An explanation may follow it, but often nothing does.',
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
   * The provider refused the request WE built — a rejected config field, an
   * unsupported schema keyword, a payload it would not take.
   *
   * Separate from `provider_unavailable` because the two want opposite
   * reactions. An outage belongs to someone else, may pass on its own and is
   * worth one retry; a malformed request is ours, will be refused identically
   * forever, and needs a code change. Conflating them sends whoever is looking
   * to go and check a network that is perfectly fine.
   */
  PROVIDER_REQUEST_INVALID: 'provider_request_invalid',
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
  /* Our bug, so the person is told nothing more useful than "not right now". */
  [AI_OUTCOMES.PROVIDER_REQUEST_INVALID]: AI_UNAVAILABLE_MESSAGE,
  [AI_OUTCOMES.CONTENT_NOT_SUPPORTED]:
    'That request could not be assisted with. You can continue writing normally.',
  [AI_OUTCOMES.NEEDS_USER_CLARIFICATION]:
    'The meaning here was not clear enough to reword safely without guessing.',
  [AI_OUTCOMES.INVALID_REQUEST]: 'That request was not understood.',
  [AI_OUTCOMES.INPUT_TOO_LONG]:
    'There is more text here than can be sent for assistance. Shorten it, or ask about one section at a time.',
};

/* ------------------------------------------- the bounded reflection chat */

/*
 * The conversation beside the C.H.A.T. is a *bounded* one, and the boundary is
 * the whole point of it.
 *
 * It is not an open-ended assistant that happens to be pointed at Scripture.
 * Three things fence it in, and all three are enforced rather than hoped for:
 * a fixed system instruction it cannot be talked out of, the C.H.A.T.
 * framework, and the passage and sections of THIS reflection. Nothing else is
 * in scope, and nothing else is sent.
 *
 * Its job is to be the side helper for discussing, expanding and editing the
 * C.H.A.T. items: what the passage means, thinking a section aloud, asking for
 * a rewording, being asked a question back. Not homework, not search, not
 * counselling.
 */

/** How many past turns of THIS conversation may be sent. */
export const AI_CHAT_HISTORY_TURNS = 10;

/** A single reply's ceiling. Long enough to explain, short enough to read. */
export const AI_CHAT_REPLY_MAX_CHARS = 1200;

/** What the composer says when there is no provider to answer. */
export const AI_CHAT_NOTE_ONLY_MESSAGE =
  'Your messages are saved as private notes to yourself. Replies are unavailable right now.';

/**
 * The standing caveat under a reply.
 *
 * Deliberately not the same sentence as the guidance notice. That one governs a
 * suggestion offered for a section; this governs a conversational answer about
 * a passage, where the risk is a different one — that an explanation is taken
 * for settled theological authority rather than mistaken for the writer's own
 * words.
 */
export const AI_CHAT_SHORT_NOTICE =
  'AI suggestions are for reflection. Review before saving.';

/**
 * The full wording, for the popover.
 *
 * The short line above is what sits beside a draft; this is what someone gets
 * when they ask what it means. A caveat pinned permanently between the thread
 * and the composer is prime space spent on a sentence people stop seeing.
 */
export const AI_CHAT_NOTICE =
  'This is assistance for your thinking, not a verdict on the passage. Weigh it, and keep only what you believe to be true.';

/**
 * The structured actions a chip can invoke.
 *
 * A fixed set, chosen by the client from this list and validated by the server
 * against it. Never a free-form prompt string, and — the reason that matters
 * most — never taken from model output.
 *
 * Two things follow from making these identifiers rather than prompt text:
 *
 *   1. Whether a turn produces CONVERSATION or a DRAFT is decided by trusted
 *      code from the action, before anything is sent. It is not inferred from
 *      what came back. A model that volunteers draft text on an
 *      `explain_simply` turn has it discarded.
 *   2. The wording of each prompt lives on the server and can change without a
 *      client release, and the thread still reads correctly because the visible
 *      message is stored separately.
 */
export const AI_CHAT_ACTIONS = {
  EXPLAIN_SIMPLY: 'explain_simply',
  HISTORICAL_CONTEXT: 'historical_context',
  ASK_REFLECTION_QUESTION: 'ask_reflection_question',
  /** The only action that may produce a draft. Carries its own section. */
  DRAFT_SECTION: 'draft_section',
} as const;

export type AiChatAction = (typeof AI_CHAT_ACTIONS)[keyof typeof AI_CHAT_ACTIONS];

/**
 * What the thread shows for an action.
 *
 * Stored as an ordinary user message so the conversation still reads as a
 * conversation when someone comes back to it — a thread with a silent gap where
 * a button was pressed is a thread that no longer makes sense.
 */
export const AI_CHAT_ACTION_MESSAGES: Record<AiChatAction, string> = {
  [AI_CHAT_ACTIONS.EXPLAIN_SIMPLY]: 'Explain this passage simply.',
  [AI_CHAT_ACTIONS.HISTORICAL_CONTEXT]:
    'What is the historical and literary background to this passage?',
  [AI_CHAT_ACTIONS.ASK_REFLECTION_QUESTION]:
    'Ask me one question to help me reflect on this passage.',
  [AI_CHAT_ACTIONS.DRAFT_SECTION]: 'Draft this section for me.',
};

/** What a draft-section action shows, per destination. */
export function draftActionMessage(section: AiGuidanceSection): string {
  const name = section.charAt(0).toUpperCase() + section.slice(1);
  return `Draft my ${name} section.`;
}

export type ReflectionChatTurn = {
  role: 'user' | 'assistant';
  content: string;
};

export type ReflectionChatResponse = {
  /** The assistant's reply, already stored as a message on the conversation. */
  message: {
    id: string;
    role: 'assistant';
    content: string;
    authorOrigin: string;
    createdAt: string;
    /** Draft text, when one was asked for. Offered, never applied. */
    draftText?: string | null;
    /**
     * Where the draft is offered for — decided by trusted server code from the
     * scoped state and the author's own words, never by the model. Null means
     * the destination was not knowable and the author will be asked.
     */
    draftSection?: string | null;
  };
  /** True when the request was off-topic and the reply is a kind redirect. */
  redirected: boolean;
  notice: string;
};

/**
 * How many title candidates to ask for, and to accept.
 *
 * Three or four, and they must differ in ANGLE rather than in wording. Models
 * default to near-duplicates — three rephrasings of one idea look like a
 * choice and are not one — so the prompt says so and validation drops the
 * duplicates that get through anyway.
 */
export const AI_TITLE_OPTIONS = { min: 2, ask: 4, max: 4 } as const;

/** Which side produced the candidates. Shown, so nobody is misled. */
export const TITLE_SOURCES = { MODEL: 'model', HEURISTIC: 'heuristic' } as const;

export type TitleSource = (typeof TITLE_SOURCES)[keyof typeof TITLE_SOURCES];

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
  /*
   * Whether the conversation beside the C.H.A.T. gets replies. When false the
   * composer still works — messages are stored as private notes — so the
   * interface can say which of the two it is rather than appearing broken.
   */
  reflectionChat: boolean;
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
