/*
 * The four endpoints.
 *
 *   POST /api/ai/reflection-guidance
 *   POST /api/ai/improve-writing
 *   POST /api/ai/reflection-chat
 *   GET  /api/ai/status
 *
 * Handlers do four things and nothing else: authenticate, parse, hand to the
 * service, and translate a typed outcome into a status code and safe copy. No
 * provider is named here, no SDK is imported here, and no error from below is
 * passed through — every message a client receives is written in this file or
 * in `@chat/shared`.
 */

import { ANONYMOUS_MAX_INPUT_CHARS, AnonymousAiAllowance } from './anonymous-allowance.ts';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  AI_CHAT_NOTICE,
  AI_OUTCOMES,
  AI_OUTCOME_MESSAGES,
  AI_UNAVAILABLE_MESSAGE,
  type AiErrorResponse,
  type AiOutcome,
  type AiStatusResponse,
} from '@chat/shared';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  AiRequestError,
  parseChatRequest,
  parseGuidanceRequest,
  parseImproveRequest,
} from './validation.ts';
import { isDraftTurn, resolveDraftTarget } from './draft-target.ts';
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
  /*
   * 500, not 502. The provider refused a request we built wrong, so the fault
   * is ours — and a 5xx of our own is what puts it in front of the people who
   * can fix it, instead of filing it under "the upstream is flaky again".
   */
  [AI_OUTCOMES.PROVIDER_REQUEST_INVALID]: 500,
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
  currentUser: (c: Context) => Promise<{ id: string } | null>;
  /*
   * Who is asking when nobody has signed in. Assistance is the one feature
   * that costs money per call, so a visitor gets a small daily allowance
   * rather than the door being either open or shut.
   */
  currentOwner?: (c: Context) => Promise<{ id: string } | null>;
  anonymousAllowance?: AnonymousAiAllowance;
  /**
   * The whole capability answer, composed by the caller.
   *
   * The endpoint predates this work — the Suggest-title feature already reads
   * it — and model-backed assistance is only part of what it reports. Composing
   * it above this file is what stops one half silently switching off the other.
   */
  status: () => AiStatusResponse;
  /**
   * Read and write one reflection's conversation.
   *
   * Passed in rather than reached for, so this file never learns what a store
   * is. It also means the *server* decides what a chat request contains — the
   * passage, the sections and the thread are loaded here from the reflection
   * the caller owns, never taken from the request body. A client that could
   * describe its own context could describe someone else's.
   */
  conversation: {
    load(
      userId: string,
      conversationId: string,
    ): {
      passageReference: string;
      /**
       * The passage's own words, decided by the Bible seam.
       *
       * Loaded here with everything else, so the client cannot supply it and
       * cannot suppress it. Undefined means there is nothing to send — either
       * no passage was retrieved for this reflection, or configuration says a
       * translation's words may not leave the building — and in both cases the
       * prompt says so out loud instead of leaving the model a gap to fill.
       */
      passageText?: string;
      /** The translation those words came from, named exactly. */
      passageAbbreviation?: string;
      sections: Record<string, string>;
      history: { role: 'user' | 'assistant'; content: string }[];
    } | null;
    appendAssistantMessage(
      conversationId: string,
      content: string,
      draft?: { text: string; section: string | null },
    ): {
      id: string;
      role: 'assistant';
      content: string;
      authorOrigin: string;
      createdAt: string;
      draftText?: string | null;
      draftSection?: string | null;
    };
  };
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
  routes.get('/status', async (c) => c.json(deps.status()));

  /**
   * Who this request spends against, and whether it may.
   *
   * A signed-in account spends its own budget under the ordinary limits. A
   * visitor spends a small daily allowance counted against their owner and
   * their address together, and is told plainly what has run out rather than
   * being shown a login form they were not expecting.
   */
  const spender = async (c: Context) => {
    const user = await deps.currentUser(c);
    if (user) return { ok: true as const, userId: user.id, anonymous: false };
    if (!deps.anonymousAllowance || !deps.currentOwner) {
      return { ok: false as const, response: c.json({ error: 'Unauthenticated.' }, 401) };
    }
    const owner = await deps.currentOwner(c);
    const address = addressOf(c);
    const decision = deps.anonymousAllowance.take(owner?.id ?? null, address);
    if (!decision.allowed) {
      return {
        ok: false as const,
        response: c.json(
          {
            error:
              'That is all the assistance a visit gets today. Create an account to keep going — everything you have written is already saved.',
            outcome: AI_OUTCOMES.RATE_LIMITED,
            retryAfterSeconds: decision.retryAfterSeconds,
          },
          429,
        ),
      };
    }
    return { ok: true as const, userId: owner?.id ?? `address:${address}`, anonymous: true };
  };

  /*
   * "Short" is half of what the allowance is: five messages a day, each small
   * enough to be a question rather than a manuscript. Enforced where every
   * other length is enforced, so a visitor gets the same 400 and the same
   * wording an account would.
   */
  const limitsFor = (caller: { anonymous?: boolean }) => {
    const { maxInputChars } = deps.service.limits();
    return caller.anonymous
      ? { maxInputChars: Math.min(maxInputChars, ANONYMOUS_MAX_INPUT_CHARS) }
      : { maxInputChars };
  };

  routes.post('/reflection-guidance', async (c) => {
    const caller = await spender(c);
    if (!caller.ok) return caller.response;

    let request;
    try {
      request = parseGuidanceRequest(await c.req.json().catch(() => null), limitsFor(caller));
    } catch (caught: unknown) {
      if (caught instanceof AiRequestError) {
        return c.json({ error: caught.message, outcome: caught.outcome }, STATUS[caught.outcome]);
      }
      return fail(c, AI_OUTCOMES.INVALID_REQUEST);
    }

    const result = await deps.service.reflectionGuidance(request, {
      userId: caller.userId,
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
    const caller = await spender(c);
    if (!caller.ok) return caller.response;

    let request;
    try {
      request = parseImproveRequest(await c.req.json().catch(() => null), limitsFor(caller));
    } catch (caught: unknown) {
      if (caught instanceof AiRequestError) {
        return c.json({ error: caught.message, outcome: caught.outcome }, STATUS[caught.outcome]);
      }
      return fail(c, AI_OUTCOMES.INVALID_REQUEST);
    }

    const result = await deps.service.improveWriting(request, {
      userId: caller.userId,
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

  /*
   * A reply in the bounded conversation.
   *
   * Deliberately a SEPARATE call from `POST /conversations/:id/messages` rather
   * than part of it. Three reasons, in order of how much they matter:
   *
   *   1. Sending must never feel broken. A message is stored and acknowledged
   *      in milliseconds; the reply takes as long as a provider takes. Bolting
   *      the second onto the first would make every send wait on the slowest
   *      thing in the system, and a failed provider would look like a failed
   *      send — losing what the person typed, or appearing to.
   *   2. With AI off, `/messages` needs no branch at all. It stores the message
   *      and returns, exactly as it did before any of this existed, and the
   *      conversation becomes a private notebook rather than a broken chat.
   *   3. The reply gets the whole typed-outcome apparatus for free: rate
   *      limits, timeout, single retry, safe copy. None of that belongs on the
   *      path that writes down what someone said.
   *
   * The client sends the message, sees it immediately, and then asks for the
   * reply. No streaming, no polling loop, no second socket.
   */
  routes.post('/reflection-chat', async (c) => {
    const caller = await spender(c);
    if (!caller.ok) return caller.response;

    let parsed;
    try {
      parsed = parseChatRequest(await c.req.json().catch(() => null), limitsFor(caller));
    } catch (caught: unknown) {
      if (caught instanceof AiRequestError) {
        return c.json({ error: caught.message, outcome: caught.outcome }, STATUS[caught.outcome]);
      }
      return fail(c, AI_OUTCOMES.INVALID_REQUEST);
    }

    /*
     * Ownership is checked by loading. A reflection that is not this user's
     * does not load, and the answer is the same 404 an absent one gets — so the
     * endpoint cannot be used to discover which conversation ids exist.
     */
    const context = deps.conversation.load(caller.userId, parsed.conversationId);
    if (!context) {
      return c.json({ error: 'Conversation not found.' }, 404);
    }

    const result = await deps.service.discussReflection(
      {
        passageReference: context.passageReference,
        ...(context.passageText === undefined ? {} : { passageText: context.passageText }),
        ...(context.passageAbbreviation === undefined
          ? {}
          : { passageAbbreviation: context.passageAbbreviation }),
        sections: context.sections,
        history: context.history,
        message: parsed.message,
        ...(parsed.focusSection ? { focusSection: parsed.focusSection } : {}),
        ...(parsed.action ? { action: parsed.action } : {}),
        ...(parsed.actionSection ? { actionSection: parsed.actionSection } : {}),
      },
      { userId: caller.userId, address: addressOf(c), requestId: randomUUID() },
    );

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
     * ── The mutation boundary, in the one place a reader will look for it. ──
     *
     * The model returned a reply and, at most, some draft TEXT. It did not and
     * cannot name a destination: the response schema has no field for one.
     *
     * Where the draft is offered is decided here, by trusted code, from the
     * application's own scoped state and the author's own words — never from
     * anything in `result.value`. `resolveDraftTarget` returns a member of the
     * section enum or null, and null is fine: the draft is still offered and
     * the interface asks the author to choose.
     *
     * Nothing below writes a section. This handler appends to the message
     * thread and touches the sections table not at all. The write happens later
     * through the authenticated, owned-conversation section endpoint, on a
     * gesture the author makes. See `draft-target.ts`.
     */
    /*
     * Whether this turn may produce a draft at all is OURS, decided before the
     * provider was called and applied again here. A model that volunteers draft
     * text on an "Explain simply" turn has it dropped: producing conversation
     * versus producing generated material is the first half of the insertion
     * decision, and the model does not get to make either half.
     */
    const mayDraft = isDraftTurn({ action: parsed.action, userMessage: parsed.message });
    const draftText = mayDraft ? result.value.draft : undefined;

    const target = draftText
      ? resolveDraftTarget({
          actionSection: parsed.actionSection,
          focusSection: parsed.focusSection,
          userMessage: parsed.message,
        })
      : null;

    /*
     * Stored before it is returned, so a reply the person can see is a reply
     * that survives a reload. The thread is the record of the conversation; a
     * message that existed only in one browser tab would not be.
     */
    const message = deps.conversation.appendAssistantMessage(
      parsed.conversationId,
      result.value.reply,
      draftText ? { text: draftText, section: target?.section ?? null } : undefined,
    );

    return c.json({
      message,
      redirected: result.value.redirected,
      notice: AI_CHAT_NOTICE,
      ...(target ? { draftTargetSource: target.source } : {}),
    });
  });

  return routes;
}
