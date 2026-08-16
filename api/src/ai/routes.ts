/*
 * The three endpoints.
 *
 *   POST /api/ai/reflection-guidance
 *   POST /api/ai/improve-writing
 *   GET  /api/ai/status
 *
 * Handlers do four things and nothing else: authenticate, parse, hand to the
 * service, and translate a typed outcome into a status code and safe copy. No
 * provider is named here, no SDK is imported here, and no error from below is
 * passed through — every message a client receives is written in this file or
 * in `@chat/shared`.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  AI_OUTCOMES,
  AI_OUTCOME_MESSAGES,
  AI_UNAVAILABLE_MESSAGE,
  type AiErrorResponse,
  type AiOutcome,
  type AiStatusResponse,
} from '@chat/shared';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { AiRequestError, parseGuidanceRequest, parseImproveRequest } from './validation.ts';
import { readAiConfig } from './config.ts';
import type { AiService } from './service.ts';

/** What a failure means in HTTP terms. */
const STATUS: Record<AiOutcome, ContentfulStatusCode> = {
  [AI_OUTCOMES.OK]: 200,
  [AI_OUTCOMES.AI_DISABLED]: 503,
  [AI_OUTCOMES.AI_NOT_CONFIGURED]: 503,
  [AI_OUTCOMES.RATE_LIMITED]: 429,
  /* 504: the writer is waiting on something upstream, not on a bad request. */
  [AI_OUTCOMES.TIMEOUT]: 504,
  [AI_OUTCOMES.PROVIDER_UNAVAILABLE]: 502,
  [AI_OUTCOMES.INVALID_PROVIDER_RESPONSE]: 502,
  [AI_OUTCOMES.CONTENT_NOT_SUPPORTED]: 422,
  /* 200: an answer, not a failure. The provider did its job by asking. */
  [AI_OUTCOMES.NEEDS_USER_CLARIFICATION]: 200,
  [AI_OUTCOMES.INVALID_REQUEST]: 400,
  [AI_OUTCOMES.INPUT_TOO_LONG]: 413,
};

function fail(c: Context, outcome: AiOutcome, extra: Record<string, unknown> = {}) {
  const body: AiErrorResponse = {
    error: AI_OUTCOME_MESSAGES[outcome] || AI_UNAVAILABLE_MESSAGE,
    outcome,
  };
  return c.json({ ...body, ...extra }, STATUS[outcome]);
}

/**
 * The caller's address, for rate limiting only.
 *
 * Not logged, not stored, not returned. `x-forwarded-for` is trusted only as a
 * bucketing hint — it is spoofable, which is why it sits *behind* the per-user
 * limit rather than in front of it.
 */
function addressOf(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return c.req.header('x-real-ip')?.trim() || 'unknown';
}

export interface AiRouteDeps {
  service: AiService;
  /** The app's existing authentication. Assistance requires a signed-in user. */
  currentUser: (c: Context) => { id: string } | null;
  /**
   * The whole capability answer, composed by the caller.
   *
   * The endpoint predates this work — the Suggest-title feature already reads
   * it — and model-backed assistance is only part of what it reports. Composing
   * it above this file is what stops one half silently switching off the other.
   */
  status: () => AiStatusResponse;
}

export function createAiRoutes(deps: AiRouteDeps) {
  const routes = new Hono();

  /*
   * Capability state, and only capability state.
   *
   * Unauthenticated on purpose: the interface has to know whether to render a
   * control before it knows anything else, and the answer contains nothing
   * about anyone. It is also the endpoint the Suggest-title work already calls,
   * so its existing fields are preserved and the new ones sit beside them.
   */
  routes.get('/status', (c) => c.json(deps.status()));

  routes.post('/reflection-guidance', async (c) => {
    const user = deps.currentUser(c);
    if (!user) return c.json({ error: 'Unauthenticated.' }, 401);

    const config = readAiConfig();
    let request;
    try {
      request = parseGuidanceRequest(await c.req.json().catch(() => null), config);
    } catch (caught: unknown) {
      if (caught instanceof AiRequestError) {
        return c.json({ error: caught.message, outcome: caught.outcome }, STATUS[caught.outcome]);
      }
      return fail(c, AI_OUTCOMES.INVALID_REQUEST);
    }

    const result = await deps.service.reflectionGuidance(request, {
      userId: user.id,
      address: addressOf(c),
      requestId: randomUUID(),
    });

    if (!result.ok) {
      return fail(
        c,
        result.outcome,
        result.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: result.retryAfterSeconds },
      );
    }

    /*
     * The notice travels in the body. An interface that has to remember to add
     * it is an interface that will one day forget, and a set of suggestions
     * without it reads as a set of answers.
     */
    return c.json({ sections: result.value.sections, notice: result.value.notice });
  });

  routes.post('/improve-writing', async (c) => {
    const user = deps.currentUser(c);
    if (!user) return c.json({ error: 'Unauthenticated.' }, 401);

    const config = readAiConfig();
    let request;
    try {
      request = parseImproveRequest(await c.req.json().catch(() => null), config);
    } catch (caught: unknown) {
      if (caught instanceof AiRequestError) {
        return c.json({ error: caught.message, outcome: caught.outcome }, STATUS[caught.outcome]);
      }
      return fail(c, AI_OUTCOMES.INVALID_REQUEST);
    }

    const result = await deps.service.improveWriting(request, {
      userId: user.id,
      address: addressOf(c),
      requestId: randomUUID(),
    });

    if (!result.ok) {
      return fail(
        c,
        result.outcome,
        result.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: result.retryAfterSeconds },
      );
    }

    /*
     * Asking for clarification is a successful call with an honest answer, so
     * it comes back 200 with its own outcome rather than as an error the
     * interface would show as a failure.
     */
    if (result.value.outcome === AI_OUTCOMES.NEEDS_USER_CLARIFICATION) {
      return c.json({
        outcome: result.value.outcome,
        original: result.value.original,
        question: result.value.question,
      });
    }

    return c.json({
      outcome: result.value.outcome,
      original: result.value.original,
      suggested: result.value.suggested,
      summaryOfChanges: result.value.summaryOfChanges,
      meaningChanged: result.value.meaningChanged,
    });
  });

  return routes;
}
