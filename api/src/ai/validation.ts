/*
 * Runtime validation, on both sides.
 *
 * Requests are validated because a browser is a convenience and never an
 * authority. Provider responses are validated because a schema handed to a
 * vendor describes what was asked for, not what arrived — and because a
 * response is the one place a prompt injection could try to reach the interface
 * with something shaped like a suggestion.
 *
 * Nothing here auto-retries. A malformed response is a refusal, not a reason to
 * spend a second call hoping the model does better; the writer is told
 * assistance did not work and their own writing is untouched.
 */

import {
  AI_CHAT_ACTIONS,
  AI_CHAT_REPLY_MAX_CHARS,
  AI_TITLE_OPTIONS,
  AI_GUIDANCE_SECTIONS,
  AI_OUTCOMES,
  AI_QUESTIONS_PER_SECTION,
  AI_QUESTION_MAX_CHARS,
  type AiChatAction,
  type AiGuidanceSection,
  type ReflectionChatTurn,
} from '@chat/shared';
import { validSection } from './draft-target.ts';
import { AiFailure } from './types.ts';
import type {
  ImproveWritingRequest,
  ImproveWritingResult,
  ReflectionChatRequest,
  ReflectionChatResult,
  ReflectionGuidanceRequest,
  ReflectionGuidanceResult,
} from './types.ts';

/** A rejected request, with a reason safe to show the person who sent it. */
export class AiRequestError extends Error {
  readonly outcome: typeof AI_OUTCOMES.INVALID_REQUEST | typeof AI_OUTCOMES.INPUT_TOO_LONG;

  constructor(
    message: string,
    outcome:
      | typeof AI_OUTCOMES.INVALID_REQUEST
      | typeof AI_OUTCOMES.INPUT_TOO_LONG = AI_OUTCOMES.INVALID_REQUEST,
  ) {
    super(message);
    this.name = 'AiRequestError';
    this.outcome = outcome;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSection(value: unknown): value is AiGuidanceSection {
  return typeof value === 'string' && (AI_GUIDANCE_SECTIONS as readonly string[]).includes(value);
}

/** Total characters a request will put in front of a provider. */
export function guidanceInputSize(request: ReflectionGuidanceRequest): number {
  return (
    request.passageReference.length +
    (request.passageText?.length ?? 0) +
    Object.values(request.written).reduce((total, value) => total + (value?.length ?? 0), 0)
  );
}

/* ------------------------------------------------------------- requests */

export function parseGuidanceRequest(
  body: unknown,
  limits: { maxInputChars: number },
): ReflectionGuidanceRequest {
  if (!isRecord(body)) {
    throw new AiRequestError('A request body is required.');
  }

  const passageReference = typeof body['passageReference'] === 'string' ? body['passageReference'].trim() : '';
  if (!passageReference) {
    throw new AiRequestError('A Scripture reference is required to ask for guiding questions.');
  }

  const rawSections = body['sections'];
  if (!Array.isArray(rawSections) || rawSections.length === 0) {
    throw new AiRequestError('At least one section must be requested.');
  }
  const sections: AiGuidanceSection[] = [];
  for (const value of rawSections) {
    if (!isSection(value)) {
      throw new AiRequestError('Unknown section requested.');
    }
    if (!sections.includes(value)) sections.push(value);
  }

  const written: Partial<Record<AiGuidanceSection, string>> = {};
  const rawWritten = body['written'];
  if (rawWritten !== undefined) {
    if (!isRecord(rawWritten)) {
      throw new AiRequestError('Written sections must be an object.');
    }
    for (const [key, value] of Object.entries(rawWritten)) {
      if (!isSection(key)) {
        throw new AiRequestError('Unknown section in the written reflection.');
      }
      if (typeof value !== 'string') {
        throw new AiRequestError('Written section content must be text.');
      }
      if (value.trim()) written[key] = value;
    }
  }

  const passageText =
    typeof body['passageText'] === 'string' && body['passageText'].trim()
      ? body['passageText']
      : undefined;

  const request: ReflectionGuidanceRequest = {
    passageReference,
    sections,
    written,
    ...(passageText === undefined ? {} : { passageText }),
  };

  if (guidanceInputSize(request) > limits.maxInputChars) {
    throw new AiRequestError(
      'There is more text here than can be sent for assistance.',
      AI_OUTCOMES.INPUT_TOO_LONG,
    );
  }

  return request;
}

export function parseImproveRequest(
  body: unknown,
  limits: { maxInputChars: number },
): ImproveWritingRequest {
  if (!isRecord(body)) {
    throw new AiRequestError('A request body is required.');
  }

  const section = body['section'];
  if (!isSection(section)) {
    throw new AiRequestError('A known section is required.');
  }

  const text = typeof body['text'] === 'string' ? body['text'] : '';
  if (!text.trim()) {
    throw new AiRequestError('There is nothing written here to improve yet.');
  }

  const passageReference =
    typeof body['passageReference'] === 'string' && body['passageReference'].trim()
      ? body['passageReference'].trim()
      : undefined;

  if (text.length + (passageReference?.length ?? 0) > limits.maxInputChars) {
    throw new AiRequestError(
      'There is more text here than can be sent for assistance.',
      AI_OUTCOMES.INPUT_TOO_LONG,
    );
  }

  return {
    section,
    text,
    ...(passageReference === undefined ? {} : { passageReference }),
  };
}

/**
 * Trim a conversation down to what may be sent.
 *
 * Two ceilings, and both are needed. The turn count keeps the request bounded
 * in shape; the character budget keeps it bounded in size, because ten turns of
 * someone thinking aloud can be many times longer than ten short ones.
 *
 * Oldest turns are dropped first — the recent ones are what a reply has to
 * follow on from — and the result comes back oldest-first, so the model reads
 * the thread in the order it happened.
 */
export function boundHistory(
  turns: readonly ReflectionChatTurn[],
  limits: { maxTurns: number; maxChars: number },
): ReflectionChatTurn[] {
  const kept: ReflectionChatTurn[] = [];
  let budget = limits.maxChars;

  for (const turn of [...turns].reverse()) {
    if (kept.length >= limits.maxTurns) break;
    if (turn.content.length > budget) break;
    budget -= turn.content.length;
    kept.push(turn);
  }

  return kept.reverse();
}

export function parseChatRequest(
  body: unknown,
  limits: { maxInputChars: number },
): {
  conversationId: string;
  message: string;
  focusSection?: AiGuidanceSection;
  action?: AiChatAction;
  actionSection?: AiGuidanceSection;
} {
  if (!isRecord(body)) {
    throw new AiRequestError('A request body is required.');
  }

  const conversationId = typeof body['conversationId'] === 'string' ? body['conversationId'] : '';
  if (!conversationId) {
    throw new AiRequestError('A conversation is required.');
  }

  const message = typeof body['message'] === 'string' ? body['message'] : '';
  if (!message.trim()) {
    throw new AiRequestError('There is no message to reply to.');
  }

  /*
   * Scoped mode arrives from our own client, and is still validated against the
   * enum — "our own client" is only ever a claim about the sender.
   */
  const focusSection = validSection(body['focusSection']);

  /*
   * The action, checked against the fixed list rather than believed.
   *
   * A client sends an identifier; anything that is not one of ours becomes
   * "no action", which degrades to an ordinary conversational turn. It can
   * never become prompt text, because there is no path from this value to
   * anything but a lookup in a table the server owns.
   */
  const rawAction = body['action'];
  const action =
    typeof rawAction === 'string' &&
    (Object.values(AI_CHAT_ACTIONS) as string[]).includes(rawAction)
      ? (rawAction as AiChatAction)
      : undefined;
  const actionSection = validSection(body['section']);

  /*
   * Only the message is checked here. The passage, the sections and the history
   * are the server's own to load and measure — the client does not send them,
   * and would not be trusted to describe them if it did.
   */
  if (message.length > limits.maxInputChars) {
    throw new AiRequestError(
      'That message is longer than can be sent for assistance.',
      AI_OUTCOMES.INPUT_TOO_LONG,
    );
  }

  return {
    conversationId,
    message,
    ...(focusSection ? { focusSection } : {}),
    ...(action ? { action } : {}),
    ...(actionSection ? { actionSection } : {}),
  };
}

/** Everything a chat request will put in front of a provider. */
export function chatInputSize(request: ReflectionChatRequest): number {
  return (
    request.passageReference.length +
    (request.passageText?.length ?? 0) +
    Object.values(request.sections).reduce((total, value) => total + (value?.length ?? 0), 0) +
    request.history.reduce((total, turn) => total + turn.content.length, 0) +
    request.message.length
  );
}

/* ------------------------------------------------------------ responses */

function invalid(detail: string): AiFailure {
  /*
   * The detail names the shape that was wrong, never the content that was in
   * it. It reaches the server log; the client gets the outcome code and the
   * standard unavailable copy.
   */
  return new AiFailure(AI_OUTCOMES.INVALID_PROVIDER_RESPONSE, detail, { retryable: false });
}

/**
 * Check a parsed guidance payload against the application's own expectations.
 *
 * `requested` is passed in so a section nobody asked about cannot appear in the
 * result. That is not pedantry: an unrequested section is the signature of a
 * response that did not come from the request that was sent.
 */
export function validateGuidancePayload(
  payload: unknown,
  requested: readonly AiGuidanceSection[],
  notice: string,
): ReflectionGuidanceResult {
  if (!isRecord(payload)) throw invalid('guidance payload was not an object');
  const rawSections = payload['sections'];
  if (!isRecord(rawSections)) throw invalid('guidance payload had no sections object');

  const sections: Partial<Record<AiGuidanceSection, { questions: string[] }>> = {};

  for (const [key, value] of Object.entries(rawSections)) {
    if (!isSection(key)) throw invalid('guidance payload named an unknown section');
    if (!requested.includes(key)) throw invalid('guidance payload returned an unrequested section');
    if (!isRecord(value)) throw invalid('guidance section was not an object');

    const rawQuestions = value['questions'];
    if (!Array.isArray(rawQuestions)) throw invalid('guidance section had no questions array');

    const questions: string[] = [];
    for (const question of rawQuestions) {
      if (typeof question !== 'string') throw invalid('a guiding question was not text');
      const trimmed = question.trim();
      if (!trimmed) continue;
      if (trimmed.length > AI_QUESTION_MAX_CHARS) {
        throw invalid('a guiding question was over its maximum length');
      }
      questions.push(trimmed);
    }

    if (questions.length < AI_QUESTIONS_PER_SECTION.min) {
      throw invalid('a guidance section came back with no usable questions');
    }
    /*
     * More than three is not fatal — nothing about a fourth question is unsafe
     * — but the contract says one to three, so the contract is what is kept.
     */
    sections[key] = { questions: questions.slice(0, AI_QUESTIONS_PER_SECTION.max) };
  }

  if (Object.keys(sections).length === 0) {
    throw invalid('guidance payload contained no sections');
  }

  return { sections, notice };
}

/**
 * Check a parsed chat reply.
 *
 * A reply is prose rather than structure, so there is less to check — which
 * makes the checks that do exist matter more. An empty reply is a failure, not
 * an awkward silence to render; and the length ceiling is enforced here because
 * the API's JSON Schema subset has no `maxLength` to enforce it with.
 */
export function validateChatPayload(payload: unknown): ReflectionChatResult {
  if (!isRecord(payload)) throw invalid('chat payload was not an object');

  const onTopic = payload['onTopic'];
  if (typeof onTopic !== 'boolean') {
    throw invalid('chat payload did not say whether the message was in scope');
  }

  const reply = payload['reply'];
  if (typeof reply !== 'string' || !reply.trim()) {
    throw invalid('chat payload carried no reply');
  }

  /*
   * Read three keys and discard the rest.
   *
   * This is the adapter's half of the mutation boundary. A response that
   * invents a `section`, a `target`, an `action` or any other instruction to
   * act cannot carry it past this line — not because those keys are rejected,
   * but because nothing here ever looks for them. Building the result key by
   * key rather than spreading the payload is what makes that true by
   * construction. See `draft-target.ts`.
   */
  const draft = payload['draft'];
  const draftText =
    typeof draft === 'string' && draft.trim() ? draft.trim().slice(0, AI_CHAT_REPLY_MAX_CHARS) : undefined;

  /*
   * The reply is truncated rather than refused, and this is the one place that
   * is right. An over-long reply is still a good reply that ran on; refusing it
   * would throw away a whole useful answer over its last sentence, where
   * refusing a malformed *suggestion* protects the writer from something
   * unusable.
   */
  return {
    reply: reply.trim().slice(0, AI_CHAT_REPLY_MAX_CHARS),
    redirected: !onTopic,
    ...(draftText === undefined ? {} : { draft: draftText }),
  };
}

/**
 * Check candidate titles, and refuse the ones the field would reject.
 *
 * A suggestion that arrives already over its own format's maximum is a bug, not
 * a suggestion — the field would report invalid the moment it landed. So
 * over-long candidates are DROPPED rather than trimmed: trimming is how a title
 * becomes the truncated sentence this capability exists to stop producing.
 *
 * Near-duplicates go too. Three rewordings of one idea look like a choice and
 * are not one.
 */
export function validateTitlePayload(payload: unknown, limits: { maxChars: number }): string[] {
  if (!isRecord(payload)) throw invalid('title payload was not an object');
  const raw = payload['titles'];
  if (!Array.isArray(raw)) throw invalid('title payload had no titles array');

  const titles: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== 'string') throw invalid('a title candidate was not text');
    /* Models like to wrap a title in quotes or close it with a full stop. */
    const cleaned = item.trim().replace(/^["'\u201c\u2018]|["'\u201d\u2019]$/g, '').replace(/\.$/, '').trim();
    if (!cleaned) continue;
    if (cleaned.length > limits.maxChars) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(cleaned);
  }

  if (titles.length === 0) throw invalid('no usable title candidates came back');
  return titles.slice(0, AI_TITLE_OPTIONS.max);
}

export function validateImprovePayload(payload: unknown, original: string): ImproveWritingResult {
  if (!isRecord(payload)) throw invalid('improve payload was not an object');

  const needsClarification = payload['needsClarification'];
  if (typeof needsClarification !== 'boolean') {
    throw invalid('improve payload did not say whether clarification was needed');
  }

  if (needsClarification) {
    const question = payload['clarifyingQuestion'];
    if (typeof question !== 'string' || !question.trim()) {
      throw invalid('improve payload asked for clarification without a question');
    }
    return {
      outcome: AI_OUTCOMES.NEEDS_USER_CLARIFICATION,
      original,
      question: question.trim().slice(0, AI_QUESTION_MAX_CHARS),
    };
  }

  const suggested = payload['suggested'];
  if (typeof suggested !== 'string' || !suggested.trim()) {
    throw invalid('improve payload had no suggested wording');
  }

  const rawSummary = payload['summaryOfChanges'];
  const summaryOfChanges: string[] = [];
  if (rawSummary !== undefined) {
    if (!Array.isArray(rawSummary)) throw invalid('improve payload summary was not an array');
    for (const item of rawSummary) {
      if (typeof item !== 'string') throw invalid('an improve summary entry was not text');
      const trimmed = item.trim();
      if (trimmed) summaryOfChanges.push(trimmed.slice(0, 200));
    }
  }

  return {
    outcome: AI_OUTCOMES.OK,
    original,
    suggested: suggested.trim(),
    summaryOfChanges,
    meaningChanged: false,
  };
}
