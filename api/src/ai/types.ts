/*
 * The seam between the application and whoever is answering.
 *
 * Everything above this line — routes, the service, the domain — is written
 * against `AIProvider` and nothing else. Everything below it is one adapter per
 * vendor. The Gemini SDK is imported in exactly one file in this repository,
 * and it is not this one.
 *
 *     CHAT UI → /api/ai/* → AiService → AIProvider → GeminiProvider
 *
 * That ordering is the reason a provider can be replaced in an afternoon, and
 * the reason the browser can never reach a model directly.
 */

import {
  AI_OUTCOMES,
  type AiChatAction,
  type AiGuidanceSection,
  type AiOutcome,
  type ReflectionChatTurn,
} from '@chat/shared';

/* ------------------------------------------------------------- the asking */

export interface ReflectionGuidanceRequest {
  /** The passage being reflected on, as the writer named it. */
  passageReference: string;
  /** Optional passage text the writer supplied. Never fetched by us. */
  passageText?: string;
  /** Which sections to return questions for. At least one. */
  sections: AiGuidanceSection[];
  /**
   * What the writer has already put down, section by section.
   *
   * Sent so the questions do not ask what has already been answered — and only
   * the sections that carry something. Nothing else about the person travels
   * with this: no profile, no other drafts, no identifiers.
   */
  written: Partial<Record<AiGuidanceSection, string>>;
}

/**
 * One turn of the bounded conversation beside the C.H.A.T.
 *
 * Everything here is scoped to a single reflection: its passage, its four
 * sections, and the recent turns of its own thread. No other reflection, no
 * profile, no identifiers, no message from anywhere else.
 *
 * That narrowness is not only a privacy measure. It is what makes the
 * conversation *bounded* rather than general — a model cannot wander into
 * material it was never handed, so the boundary is enforced by what is sent as
 * well as by what the instruction says.
 */
export interface ReflectionChatRequest {
  passageReference: string;
  /** Passage text the writer supplied. Never fetched by us. */
  passageText?: string;
  /** The reflection's current sections, so a reply can build on what is there. */
  sections: Partial<Record<AiGuidanceSection, string>>;
  /** Recent turns of THIS conversation, oldest first and bounded in length. */
  history: ReflectionChatTurn[];
  /** The message just sent. Untrusted data, exactly like everything else. */
  message: string;
  /**
   * Scoped mode, from the application's own state.
   *
   * Guidance for the model, and — separately, in `draft-target.ts` — one of the
   * two trusted sources for deciding where a draft is offered.
   */
  focusSection?: AiGuidanceSection;
  /** A structured action the client chose from a fixed set. Never free text. */
  action?: AiChatAction;
  /** That action's own destination, already enum-validated. */
  actionSection?: AiGuidanceSection;
}

/**
 * Ask for names for a reflection.
 *
 * A title is a LABEL, not personal expression, so a model suggesting one is
 * legitimate where suggesting a Testimony is not — it is the handle the work is
 * filed under, and it makes no claim about what anyone believes or experienced.
 */
export interface TitleSuggestionRequest {
  passageReference: string;
  /** What the author has written, section by section. Only what exists. */
  sections: Partial<Record<AiGuidanceSection, string>>;
  /** Their own words from the conversation, bounded before it gets here. */
  history: ReflectionChatTurn[];
  /** The format's ceiling, so nothing comes back that the field would reject. */
  maxChars: number;
  /** What the field aims for. Candidates over this are allowed but discouraged. */
  recommendedChars: number;
}

export interface TitleSuggestionResult {
  titles: string[];
  usage?: AiUsage;
}

export interface ImproveWritingRequest {
  /** Which section the text belongs to, so tone and purpose are understood. */
  section: AiGuidanceSection;
  /** The writer's own words. Untrusted data — never instructions. */
  text: string;
  passageReference?: string;
}

/* ------------------------------------------------------------ the answers */

export interface GuidanceSectionResult {
  questions: string[];
}

export interface ReflectionGuidanceResult {
  sections: Partial<Record<AiGuidanceSection, GuidanceSectionResult>>;
  notice: string;
  /** Safe counts only. Never content. */
  usage?: AiUsage;
}

export interface ReflectionChatResult {
  reply: string;
  /**
   * Draft text, when the writer explicitly asked for one.
   *
   * Text and nothing else. There is deliberately no section on this type: the
   * model has no way to name a destination, and the destination is resolved by
   * trusted code in `draft-target.ts`. If you are adding a `section` field
   * here, read that file first — it is the boundary this shape protects.
   */
  draft?: string;
  /**
   * True when the request fell outside the boundary and the reply is a redirect.
   *
   * Carried out of the provider rather than guessed at from the wording, so the
   * server can count how often the fence is being tested without ever reading a
   * message to find out.
   */
  redirected: boolean;
  usage?: AiUsage;
}

export type ImproveWritingResult =
  | {
      outcome: typeof AI_OUTCOMES.OK;
      original: string;
      suggested: string;
      summaryOfChanges: string[];
      meaningChanged: false;
      usage?: AiUsage;
    }
  | {
      /*
       * The honest answer when preserving the meaning is uncertain.
       *
       * A model that cannot tell what someone meant has two options: ask, or
       * guess. Guessing about a sentence describing what God did for a person
       * is how an application starts manufacturing testimony one clarification
       * at a time. So it asks, and the writer decides.
       */
      outcome: typeof AI_OUTCOMES.NEEDS_USER_CLARIFICATION;
      original: string;
      question: string;
      usage?: AiUsage;
    };

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AiCallOptions {
  /** Cancellation. The service always supplies one; providers must honour it. */
  signal?: AbortSignal;
  /** Correlates a log line with a request. Not derived from user content. */
  requestId?: string;
}

/**
 * The contract. Three operations, each explicitly triggered by a person.
 *
 * None of them takes a free-form prompt. Even the conversational one is given a
 * passage, a set of sections and a thread rather than an instruction — so there
 * is no escape hatch through which this interface could be asked to do
 * something outside the reflection it belongs to. The surface is narrow on
 * purpose: a provider interface that can be asked anything eventually is.
 */
export interface AIProvider {
  readonly name: string;
  generateReflectionGuidance(
    request: ReflectionGuidanceRequest,
    options?: AiCallOptions,
  ): Promise<ReflectionGuidanceResult>;
  improveReflectionWriting(
    request: ImproveWritingRequest,
    options?: AiCallOptions,
  ): Promise<ImproveWritingResult>;
  /**
   * Reply within the boundary, or decline and redirect to the reflection.
   *
   * Still not a general `chat(prompt)`. It takes a reflection's passage, its
   * sections and its own recent turns, and it returns one reply — there is no
   * parameter through which a caller could hand this provider an arbitrary
   * instruction, which is the property that keeps "bounded" true at the seam
   * rather than only inside a prompt string.
   */
  discussReflection(
    request: ReflectionChatRequest,
    options?: AiCallOptions,
  ): Promise<ReflectionChatResult>;
  /**
   * Suggest names for a reflection.
   *
   * Returns strings. It cannot apply one, and there is no field in which it
   * could ask for one to be applied — renaming happens through the same PATCH
   * the author uses when they type a title themselves.
   */
  suggestReflectionTitles(
    request: TitleSuggestionRequest,
    options?: AiCallOptions,
  ): Promise<TitleSuggestionResult>;
}

/* ------------------------------------------------------------- the errors */

/**
 * A failure the application understands, in place of one the vendor described.
 *
 * Every SDK exception is converted into one of these at the adapter boundary.
 * The vendor's message, its status object and its stack never travel further:
 * they carry endpoint names, project identifiers, quota descriptions and
 * occasionally fragments of what was sent, none of which a browser should read.
 *
 * `cause` is kept for the server's own diagnosis and is never serialised.
 */
export class AiFailure extends Error {
  readonly outcome: AiOutcome;
  /** Whether one more attempt could plausibly succeed. Never for validation. */
  readonly retryable: boolean;

  constructor(outcome: AiOutcome, message: string, options?: { retryable?: boolean; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AiFailure';
    this.outcome = outcome;
    this.retryable = options?.retryable ?? false;
  }
}

export function isAiFailure(value: unknown): value is AiFailure {
  return value instanceof AiFailure;
}
