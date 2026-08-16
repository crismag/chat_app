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

import { AI_OUTCOMES, type AiGuidanceSection, type AiOutcome } from '@chat/shared';

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
 * The contract. Two operations, both explicitly triggered by a person.
 *
 * There is no `chat`, no `complete`, no escape hatch that takes a free-form
 * prompt. The surface is narrow on purpose: a provider interface that can be
 * asked anything eventually is.
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
