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
  IMPROVE_RESPONSE_SCHEMA,
  PROMPT_VERSION,
  SYSTEM_INSTRUCTION,
  buildGuidancePrompt,
  buildImprovePrompt,
  guidanceResponseSchema,
} from '../prompt.ts';
import { validateGuidancePayload, validateImprovePayload } from '../validation.ts';
import { AiFailure } from '../types.ts';
import type {
  AIProvider,
  AiCallOptions,
  AiUsage,
  ImproveWritingRequest,
  ImproveWritingResult,
  ReflectionGuidanceRequest,
  ReflectionGuidanceResult,
} from '../types.ts';
import { randomUUID } from 'node:crypto';

/**
 * Bounded output.
 *
 * Three short questions, or one reworded paragraph and a few notes. Neither is
 * large, and an unbounded ceiling on a low-cost model is how a malformed prompt
 * turns into a bill. Thinking is switched off for the same reason: these are
 * shaping tasks, not reasoning ones.
 */
const MAX_OUTPUT_TOKENS = { guidance: 700, improve: 900 } as const;

/** Low, but not zero. Identical phrasing every time reads as a form, not help. */
const TEMPERATURE = 0.4;

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
    const nonce = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
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

  async improveReflectionWriting(
    request: ImproveWritingRequest,
    options?: AiCallOptions,
  ): Promise<ImproveWritingResult> {
    const nonce = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();

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
          /* Not a reasoning task. Thinking here buys latency and tokens only. */
          thinkingConfig: { thinkingBudget: 0 },
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

  /**
   * Turn a response into parsed JSON, or into a typed refusal.
   *
   * The order matters. A blocked prompt and a truncated answer both arrive as
   * a response with no usable text, and reporting either as "malformed JSON"
   * would tell the writer their reflection broke the parser when in fact it was
   * declined, or simply ran long.
   */
  private readPayload(response: {
    text?: string | undefined;
    promptFeedback?: { blockReason?: string | undefined } | undefined;
    candidates?: { finishReason?: string | undefined }[] | undefined;
  }): unknown {
    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason) {
      throw new AiFailure(
        AI_OUTCOMES.CONTENT_NOT_SUPPORTED,
        `prompt blocked (${blockReason})`,
        { retryable: false },
      );
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    if (
      finishReason === FinishReason.SAFETY ||
      finishReason === FinishReason.PROHIBITED_CONTENT ||
      finishReason === FinishReason.BLOCKLIST ||
      finishReason === FinishReason.SPII ||
      finishReason === FinishReason.RECITATION
    ) {
      throw new AiFailure(
        AI_OUTCOMES.CONTENT_NOT_SUPPORTED,
        `candidate blocked (${finishReason})`,
        { retryable: false },
      );
    }

    if (finishReason === FinishReason.MAX_TOKENS) {
      /*
       * Truncated JSON. Not retried: a second call with the same bounds gives
       * the same truncation, and retrying a validation-class failure is exactly
       * what the rules forbid.
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
      /* The text itself is never included — it is model output about the
       * writer's reflection, and a log line is not the place for it. */
      throw new AiFailure(AI_OUTCOMES.INVALID_PROVIDER_RESPONSE, 'response was not valid JSON', {
        retryable: false,
      });
    }
  }

  private readUsage(response: {
    usageMetadata?:
      | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
      | undefined;
  }): { usage?: AiUsage } {
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
  private toFailure(caught: unknown, callerCancelled: boolean): AiFailure {
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
         * Retrying it would burn a second call to be told the same thing, and
         * the operator needs to see `ai_not_configured` in the log rather than
         * an outage they will go looking for in the wrong place.
         */
        return new AiFailure(AI_OUTCOMES.AI_NOT_CONFIGURED, 'provider rejected the credential', {
          retryable: false,
          cause: caught,
        });
      }
      if (status === 400 || status === 404) {
        return new AiFailure(
          AI_OUTCOMES.PROVIDER_UNAVAILABLE,
          'provider rejected the request or the configured model',
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
}

/** Exposed so the developer docs and the smoke test agree on one version. */
export const GEMINI_PROMPT_VERSION = PROMPT_VERSION;
