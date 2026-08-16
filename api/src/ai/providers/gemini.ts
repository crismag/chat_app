/*
 * The Gemini adapter. The ONLY file in this repository that imports the SDK.
 *
 * Everything vendor-specific stops here: the client, the model name, the
 * structured-output configuration, the token counts, and — most importantly —
 * the exceptions. An SDK error carries a status object, an endpoint, sometimes
 * a project identifier and occasionally a fragment of what was sent. None of
 * that may travel any further, so every throw is converted into an `AiFailure`
 * with a code the application defined and a message the application wrote.
 *
 * The key is read from `process.env.GEMINI_API_KEY` at construction and is held
 * only inside the SDK client. It is never stored on this object, never logged,
 * never included in an error, and never returned.
 *
 * Deliberately NOT enabled here, and each for a reason:
 *   - search grounding and URL retrieval: the model must work from the writer's
 *     passage and words, not from whatever it can find about them;
 *   - tools, function calling and code execution: nothing here needs an agent,
 *     and an agent is a much larger thing to reason about safely;
 *   - context caching and file upload: V1 retains nothing between requests;
 *   - conversation history: each call is complete in itself.
 */

import { ApiError, FinishReason, GoogleGenAI } from '@google/genai';
import { AI_GUIDANCE_NOTICE, AI_OUTCOMES } from '@chat/shared';
import {
  CHAT_RESPONSE_SCHEMA,
  IMPROVE_RESPONSE_SCHEMA,
  PROMPT_VERSION,
  SYSTEM_INSTRUCTION,
  buildChatPrompt,
  buildGuidancePrompt,
  buildImprovePrompt,
  guidanceResponseSchema,
} from '../prompt.ts';
import {
  validateChatPayload,
  validateGuidancePayload,
  validateImprovePayload,
} from '../validation.ts';
import { AiFailure } from '../types.ts';
import type {
  AIProvider,
  AiCallOptions,
  AiUsage,
  ImproveWritingRequest,
  ImproveWritingResult,
  ReflectionChatRequest,
  ReflectionChatResult,
  ReflectionGuidanceRequest,
  ReflectionGuidanceResult,
} from '../types.ts';
import { randomUUID } from 'node:crypto';

/**
 * Bounded output.
 *
 * Three short questions, one reworded paragraph, or one conversational reply.
 * None of them is large, and an unbounded ceiling on a low-cost model is how a
 * malformed prompt turns into a bill. Chat gets the most room of the three
 * because explaining a passage takes more words than asking about one — but it
 * is still a ceiling, and the reply length is capped again on the way back.
 */
const MAX_OUTPUT_TOKENS = { guidance: 700, improve: 900, chat: 1000 } as const;

/** Low, but not zero. Identical phrasing every time reads as a form, not help. */
const TEMPERATURE = 0.4;

/**
 * A fresh fence tag per request.
 *
 * It must be per request rather than per process: a nonce that outlives one
 * call is one an author could learn from a previous reply and then close.
 */
function newNonce(): string {
  return randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
}

export interface GeminiProviderOptions {
  model: string;
  timeoutMs: number;
  /** Injected only by tests. Production reads the environment. */
  apiKey?: string;
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: GeminiProviderOptions) {
    const apiKey = (options.apiKey ?? process.env['GEMINI_API_KEY'] ?? '').trim();
    if (!apiKey) {
      /*
       * Refused at construction rather than at call time, so a misconfigured
       * server reports `ai_not_configured` from `/api/ai/status` instead of
       * offering a control that fails the moment someone presses it.
       */
      throw new AiFailure(AI_OUTCOMES.AI_NOT_CONFIGURED, 'No Gemini credential is configured.');
    }
    this.client = new GoogleGenAI({ apiKey });
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
  }

  async generateReflectionGuidance(
    request: ReflectionGuidanceRequest,
    options?: AiCallOptions,
  ): Promise<ReflectionGuidanceResult> {
    const nonce = newNonce();
    const written: Record<string, string> = {};
    for (const [section, value] of Object.entries(request.written)) {
      if (value) written[section] = value;
    }

    const { payload, usage } = await this.call({
      prompt: buildGuidancePrompt(
        {
          passageReference: request.passageReference,
          ...(request.passageText === undefined ? {} : { passageText: request.passageText }),
          sections: request.sections,
          written,
        },
        nonce,
      ),
      schema: guidanceResponseSchema(request.sections),
      maxOutputTokens: MAX_OUTPUT_TOKENS.guidance,
      options,
    });

    const result = validateGuidancePayload(payload, request.sections, AI_GUIDANCE_NOTICE);
    return usage ? { ...result, usage } : result;
  }

  async discussReflection(
    request: ReflectionChatRequest,
    options?: AiCallOptions,
  ): Promise<ReflectionChatResult> {
    const nonce = newNonce();
    const sections: Record<string, string> = {};
    for (const [section, value] of Object.entries(request.sections)) {
      if (value) sections[section] = value;
    }

    const { payload, usage } = await this.call({
      prompt: buildChatPrompt(
        {
          passageReference: request.passageReference,
          ...(request.passageText === undefined ? {} : { passageText: request.passageText }),
          sections,
          history: request.history,
          message: request.message,
        },
        nonce,
      ),
      schema: CHAT_RESPONSE_SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS.chat,
      options,
    });

    const result = validateChatPayload(payload);
    return usage ? { ...result, usage } : result;
  }

  async improveReflectionWriting(
    request: ImproveWritingRequest,
    options?: AiCallOptions,
  ): Promise<ImproveWritingResult> {
    const nonce = newNonce();

    const { payload, usage } = await this.call({
      prompt: buildImprovePrompt(
        {
          section: request.section,
          text: request.text,
          ...(request.passageReference === undefined
            ? {}
            : { passageReference: request.passageReference }),
        },
        nonce,
      ),
      schema: IMPROVE_RESPONSE_SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS.improve,
      options,
    });

    const result = validateImprovePayload(payload, request.text);
    return usage ? { ...result, usage } : result;
  }

  /* ------------------------------------------------------------ the call */

  private async call(input: {
    prompt: string;
    schema: Record<string, unknown>;
    maxOutputTokens: number;
    options?: AiCallOptions;
  }): Promise<{ payload: unknown; usage?: AiUsage }> {
    /*
     * Two ways to stop: the caller's signal, and our own deadline. They are
     * combined so a cancelled request does not sit holding a socket until the
     * timeout, and a hung provider does not sit forever waiting on a caller who
     * never cancels.
     */
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(new Error('deadline')), this.timeoutMs);
    const onCallerAbort = () => controller.abort(new Error('cancelled'));
    input.options?.signal?.addEventListener('abort', onCallerAbort, { once: true });

    let response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;
    try {
      response = await this.client.models.generateContent({
        model: this.model,
        contents: input.prompt,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseJsonSchema: input.schema,
          maxOutputTokens: input.maxOutputTokens,
          temperature: TEMPERATURE,
          candidateCount: 1,
          abortSignal: controller.signal,
          /*
           * No thinkingConfig. Disabling thinking with `thinkingBudget: 0` was a
           * latency optimisation on 2.x, and the 3.x models reject it outright —
           * 400 INVALID_ARGUMENT, which this adapter reported to callers as the
           * far less useful `provider_unavailable`. Left off rather than made
           * conditional on the model name: the saving was small and a per-model
           * exception here would have to be maintained against a moving list.
           */
        },
      });
    } catch (caught: unknown) {
      throw this.toFailure(caught, input.options?.signal?.aborted === true);
    } finally {
      clearTimeout(deadline);
      input.options?.signal?.removeEventListener('abort', onCallerAbort);
    }

    return { payload: this.readPayload(response), ...this.readUsage(response) };
  }

  private readPayload(response: GeminiShapedResponse): unknown {
    return readGeminiPayload(response);
  }

  private readUsage(response: GeminiShapedResponse): { usage?: AiUsage } {
    return readGeminiUsage(response);
  }

  private toFailure(caught: unknown, callerCancelled: boolean): AiFailure {
    return mapGeminiError(caught, callerCancelled);
  }
}

/* ------------------------------------------------------- mapping, exposed */

/*
 * The three translation steps are module functions rather than private
 * methods, and that is a testing decision with a safety purpose.
 *
 * Blocked content, a truncated answer, a rejected credential, a 429 and a
 * 500 are the paths a person will actually meet, and they are exactly the
 * paths hardest to reach through a live client. Kept private they would be
 * tested by hoping; exposed they are tested by calling, with no network, no
 * key and no quota spent.
 */

/** Only the parts of a response this adapter reads. */
export interface GeminiShapedResponse {
  text?: string | undefined;
  promptFeedback?: { blockReason?: string | undefined } | undefined;
  candidates?: { finishReason?: string | undefined }[] | undefined;
  usageMetadata?:
    | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
    | undefined;
}

/**
 * Turn a response into parsed JSON, or into a typed refusal.
 *
 * The order matters. A blocked prompt and a truncated answer both arrive as a
 * response with no usable text, and reporting either as "malformed JSON" would
 * tell the writer their reflection broke the parser when in fact it was
 * declined, or simply ran long.
 */
export function readGeminiPayload(response: GeminiShapedResponse): unknown {
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) {
    throw new AiFailure(AI_OUTCOMES.CONTENT_NOT_SUPPORTED, `prompt blocked (${blockReason})`, {
      retryable: false,
    });
  }

  const finishReason = response.candidates?.[0]?.finishReason;
  if (
    finishReason === FinishReason.SAFETY ||
    finishReason === FinishReason.PROHIBITED_CONTENT ||
    finishReason === FinishReason.BLOCKLIST ||
    finishReason === FinishReason.SPII ||
    finishReason === FinishReason.RECITATION
  ) {
    throw new AiFailure(AI_OUTCOMES.CONTENT_NOT_SUPPORTED, `candidate blocked (${finishReason})`, {
      retryable: false,
    });
  }

  if (finishReason === FinishReason.MAX_TOKENS) {
    /*
     * Truncated JSON. Not retried: a second call with the same bounds gives the
     * same truncation, and retrying a validation-class failure is exactly what
     * the rules forbid.
     */
    throw new AiFailure(
      AI_OUTCOMES.INVALID_PROVIDER_RESPONSE,
      'response hit the output ceiling and was truncated',
      { retryable: false },
    );
  }

  const text = response.text;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new AiFailure(AI_OUTCOMES.INVALID_PROVIDER_RESPONSE, 'response carried no text', {
      retryable: false,
    });
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    /*
     * The text itself is never included. It is model output about the writer's
     * reflection, and a log line is not the place for that.
     */
    throw new AiFailure(AI_OUTCOMES.INVALID_PROVIDER_RESPONSE, 'response was not valid JSON', {
      retryable: false,
    });
  }
}

export function readGeminiUsage(response: GeminiShapedResponse): { usage?: AiUsage } {
  const meta = response.usageMetadata;
  if (!meta) return {};
  return {
    usage: {
      ...(meta.promptTokenCount === undefined ? {} : { inputTokens: meta.promptTokenCount }),
      ...(meta.candidatesTokenCount === undefined
        ? {}
        : { outputTokens: meta.candidatesTokenCount }),
      ...(meta.totalTokenCount === undefined ? {} : { totalTokens: meta.totalTokenCount }),
    },
  };
}

/**
 * Every SDK exception becomes one of ours.
 *
 * The original is kept as `cause` for the server's own diagnosis and is never
 * serialised towards a client. The messages below are ours; the vendor's are
 * discarded at this line and go no further.
 */
export function mapGeminiError(caught: unknown, callerCancelled: boolean): AiFailure {
  if (caught instanceof AiFailure) return caught;

  const aborted =
    caught instanceof Error && (caught.name === 'AbortError' || /abort/i.test(caught.message));
  if (aborted) {
    return callerCancelled
      ? new AiFailure(AI_OUTCOMES.PROVIDER_UNAVAILABLE, 'request cancelled', {
          retryable: false,
          cause: caught,
        })
      : new AiFailure(AI_OUTCOMES.TIMEOUT, 'request exceeded its deadline', {
          retryable: false,
          cause: caught,
        });
  }

  if (caught instanceof ApiError) {
    const status = caught.status;
    if (status === 429) {
      return new AiFailure(AI_OUTCOMES.RATE_LIMITED, 'provider rate limit', {
        retryable: true,
        cause: caught,
      });
    }
    if (status === 401 || status === 403) {
      /*
       * A rejected credential is a configuration fault, not a transient one.
       * Retrying it would burn a second call to be told the same thing, and the
       * operator needs to see `ai_not_configured` in the log rather than an
       * outage they will go looking for in the wrong place.
       */
      return new AiFailure(AI_OUTCOMES.AI_NOT_CONFIGURED, 'provider rejected the credential', {
        retryable: false,
        cause: caught,
      });
    }
    /*
     * A model the provider does not know is a configuration fault, and saying
     * so saves an afternoon. This is precisely what happened when the default
     * model was withdrawn: the provider answered 404, this adapter called it an
     * outage, and the hunt went to the network and the credential rather than
     * to the one variable that was actually wrong.
     */
    if (status === 404) {
      return new AiFailure(
        AI_OUTCOMES.AI_NOT_CONFIGURED,
        'provider does not know the configured model',
        { retryable: false, cause: caught },
      );
    }

    /*
     * Any other 4xx means the request WE built was refused — a rejected config
     * field, an unsupported schema keyword, an over-long payload. That is a bug
     * in this adapter, not an unavailable provider.
     *
     * It earns its own outcome because the two want opposite reactions. An
     * outage belongs to someone else, may pass on its own, and is worth one
     * retry. A malformed request will be refused identically forever, no retry
     * can help, and somebody has to change code. Reporting the second as the
     * first sends whoever is looking at a network that is perfectly fine —
     * which is exactly the wasted hunt that `thinkingConfig` caused.
     */
    if (status >= 400 && status < 500) {
      return new AiFailure(
        AI_OUTCOMES.PROVIDER_REQUEST_INVALID,
        `provider rejected our request (status ${status})`,
        { retryable: false, cause: caught },
      );
    }

    return new AiFailure(AI_OUTCOMES.PROVIDER_UNAVAILABLE, `provider error (status ${status})`, {
      retryable: status >= 500,
      cause: caught,
    });
  }

  return new AiFailure(AI_OUTCOMES.PROVIDER_UNAVAILABLE, 'provider call failed', {
    retryable: true,
    cause: caught,
  });
}

/** Exposed so the developer docs and the smoke test agree on one version. */
export const GEMINI_PROMPT_VERSION = PROMPT_VERSION;
