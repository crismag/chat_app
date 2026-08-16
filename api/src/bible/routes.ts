/*
 * The endpoints.
 *
 *   GET    /api/bible/status
 *   GET    /api/bible/translations?language=en
 *   GET    /api/bible/passages?translationId=111&reference=JHN.3.16-18
 *   GET    /api/bible/reflections/:id/passage
 *   PUT    /api/bible/reflections/:id/passage
 *   DELETE /api/bible/reflections/:id/passage
 *
 * Handlers do four things and nothing else: authenticate, parse, hand to the
 * service, and turn a typed outcome into a status code and safe copy. **No
 * message from the provider reaches this file**, and none is forwarded from it
 * — every sentence a client receives is written here or in `@chat/shared`.
 * That is the rule that keeps an upstream `faultstring`, a URL with a key in
 * it, or an internal hostname out of a browser's network tab.
 *
 * The browser never sees YouVersion's shape either. It asks this application
 * for a passage and gets `BiblePassage`; the day the provider renames a field,
 * the change stops in `providers/youversion.ts`.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  BIBLE_OUTCOMES,
  BIBLE_OUTCOME_MESSAGES,
  type BibleErrorResponse,
  type BibleOutcome,
  type BiblePassage,
} from '@chat/shared';
import { BibleService } from './service.ts';
import type { PassageStore } from './passage-store.ts';

/** What a failure means in HTTP terms. */
const STATUS: Record<BibleOutcome, ContentfulStatusCode> = {
  [BIBLE_OUTCOMES.OK]: 200,
  /* 503: the server is missing something, and the caller can do nothing. */
  [BIBLE_OUTCOMES.NOT_CONFIGURED]: 503,
  [BIBLE_OUTCOMES.INVALID_REQUEST]: 400,
  [BIBLE_OUTCOMES.INVALID_REFERENCE]: 400,
  /* 409, not 404: the translation exists as an idea, it is just not reachable
   * with this deployment's credential, and the caller must choose another. */
  [BIBLE_OUTCOMES.TRANSLATION_UNAVAILABLE]: 409,
  [BIBLE_OUTCOMES.PASSAGE_NOT_FOUND]: 404,
  [BIBLE_OUTCOMES.RATE_LIMITED]: 429,
  [BIBLE_OUTCOMES.TIMEOUT]: 504,
  [BIBLE_OUTCOMES.PROVIDER_UNAVAILABLE]: 502,
  [BIBLE_OUTCOMES.INVALID_PROVIDER_RESPONSE]: 502,
};

function fail(
  c: Context,
  outcome: BibleOutcome,
  extra: { message?: string; retryAfterSeconds?: number } = {},
) {
  const body: BibleErrorResponse = {
    /*
     * A service may supply its own sentence for one case only: an invalid
     * reference, where "Romans has 16 chapters, so Romans 22 does not exist" is
     * worth far more than a generic refusal. That sentence is composed in
     * `reference.ts` from our own book table — it is never derived from
     * anything the provider said.
     */
    error: extra.message ?? BIBLE_OUTCOME_MESSAGES[outcome],
    outcome,
    ...(extra.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: extra.retryAfterSeconds }),
  };
  return c.json(body, STATUS[outcome]);
}

/** The caller's address, for rate limiting only. Not logged, not stored. */
function addressOf(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return c.req.header('x-real-ip')?.trim() || 'unknown';
}

export interface BibleRouteDeps {
  service: BibleService;
  /** The app's existing authentication. */
  currentUser: (c: Context) => { id: string } | null;
  /** Whether this user owns this reflection. Ownership is never assumed. */
  ownsConversation: (userId: string, conversationId: string) => boolean;
  passages: PassageStore;
}

/**
 * A passage arriving from a client, checked field by field.
 *
 * The saved passage is the one thing a client *does* send us — it is what the
 * browser was shown and approved — so it is validated rather than trusted.
 * Every field is length-bounded and type-checked, and unknown fields are
 * dropped rather than stored: a store that accepts arbitrary keys from a
 * request body is a store that will eventually hold something surprising.
 *
 * `content` is bounded generously. Three verses is a few hundred characters;
 * the ceiling exists to stop a body being used as free storage, not to police
 * how much Scripture somebody reflects on.
 */
function readPassageBody(raw: unknown): BiblePassage | null {
  if (raw === null || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;

  const str = (value: unknown, max: number): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
  };

  const translationId = typeof body['translationId'] === 'number' ? body['translationId'] : Number.NaN;
  const abbreviation = str(body['abbreviation'], 40);
  const name = str(body['name'], 200);
  const passageId = str(body['passageId'], 60);
  const reference = str(body['reference'], 120);
  const content = str(body['content'], 20_000);
  const retrievedAt = str(body['retrievedAt'], 40);

  if (
    !Number.isInteger(translationId) ||
    translationId <= 0 ||
    !abbreviation ||
    !name ||
    !passageId ||
    !reference ||
    !content ||
    !retrievedAt ||
    Number.isNaN(Date.parse(retrievedAt))
  ) {
    return null;
  }

  const copyright = str(body['copyright'], 4_000);
  const links = body['links'];
  const publisher =
    links && typeof links === 'object'
      ? str((links as Record<string, unknown>)['publisher'], 500)
      : null;
  const youVersion =
    links && typeof links === 'object'
      ? str((links as Record<string, unknown>)['youVersion'], 500)
      : null;

  return {
    /* The provider is recorded by us, never taken from the body. */
    provider: 'youversion',
    translationId,
    abbreviation,
    name,
    passageId,
    reference,
    content,
    ...(copyright ? { copyright } : {}),
    ...(publisher || youVersion
      ? {
          links: {
            ...(publisher ? { publisher } : {}),
            ...(youVersion ? { youVersion } : {}),
          },
        }
      : {}),
    retrievedAt,
  };
}

export function createBibleRoutes(deps: BibleRouteDeps) {
  const routes = new Hono();

  /*
   * Capability state, unauthenticated on purpose. The interface has to know
   * whether to render the passage card before it knows anything else, and this
   * answer contains nothing about anyone and nothing about the credential
   * beyond whether one is usable.
   */
  routes.get('/status', (c) => c.json(deps.service.status()));

  routes.get('/translations', async (c) => {
    const user = deps.currentUser(c);
    if (!user) return c.json({ error: 'Unauthenticated.' }, 401);

    const language = (c.req.query('language') ?? 'en').trim().toLowerCase();
    /*
     * A language range is a short tag, and anything longer is either a mistake
     * or an attempt to put something else in the query string we build.
     */
    if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(language)) {
      return fail(c, BIBLE_OUTCOMES.INVALID_REQUEST, {
        message: 'That is not a language we can look up.',
      });
    }

    const result = await deps.service.translations(language, {
      userId: user.id,
      address: addressOf(c),
      requestId: randomUUID(),
    });

    if (!result.ok) {
      return fail(c, result.outcome, {
        ...(result.message === undefined ? {} : { message: result.message }),
        ...(result.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: result.retryAfterSeconds }),
      });
    }

    return c.json({
      translations: result.value.translations,
      /*
       * The id, not the abbreviation. A client that defaulted by string would
       * be reintroducing the `NIV` / `NIV11` bug in the browser — see
       * `catalog.ts`.
       */
      defaultTranslationId: result.value.defaultId,
    });
  });

  routes.get('/passages', async (c) => {
    const user = deps.currentUser(c);
    if (!user) return c.json({ error: 'Unauthenticated.' }, 401);

    const translationId = Number.parseInt((c.req.query('translationId') ?? '').trim(), 10);
    const reference = c.req.query('reference') ?? '';

    if (!Number.isInteger(translationId) || translationId <= 0) {
      return fail(c, BIBLE_OUTCOMES.INVALID_REQUEST, {
        message: 'Choose a translation before looking up a passage.',
      });
    }

    const result = await deps.service.passage(
      { translationId, reference },
      { userId: user.id, address: addressOf(c), requestId: randomUUID() },
    );

    if (!result.ok) {
      return fail(c, result.outcome, {
        ...(result.message === undefined ? {} : { message: result.message }),
        ...(result.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: result.retryAfterSeconds }),
      });
    }

    const { verses, ...passage } = result.value;
    return c.json({ passage, verses });
  });

  /* ------------------------------------------------ the reflection's passage */

  /*
   * Ownership is checked by the same rule everywhere below: a reflection that
   * is not this user's answers 404, exactly as an absent one does, so these
   * endpoints cannot be used to discover which reflection ids exist.
   */
  const owned = (c: Context): { userId: string; conversationId: string } | null => {
    const user = deps.currentUser(c);
    if (!user) return null;
    const conversationId = c.req.param('id') ?? '';
    if (!conversationId || !deps.ownsConversation(user.id, conversationId)) return null;
    return { userId: user.id, conversationId };
  };

  routes.get('/reflections/:id/passage', (c) => {
    const scope = owned(c);
    if (!scope) return c.json({ error: 'Reflection not found.' }, 404);
    const passage = deps.passages.get(scope.conversationId);
    /*
     * Answered from storage and never re-fetched. A reflection must show the
     * exact translation and wording it was written against; a "helpful" refresh
     * here is how a year-old reflection quietly changes Bibles.
     */
    return c.json({ passage });
  });

  routes.put('/reflections/:id/passage', async (c) => {
    const scope = owned(c);
    if (!scope) return c.json({ error: 'Reflection not found.' }, 404);

    const passage = readPassageBody(await c.req.json().catch(() => null));
    if (!passage) {
      return fail(c, BIBLE_OUTCOMES.INVALID_REQUEST, {
        message: 'That passage could not be saved.',
      });
    }

    deps.passages.set(scope.conversationId, passage);
    return c.json({ passage });
  });

  routes.delete('/reflections/:id/passage', (c) => {
    const scope = owned(c);
    if (!scope) return c.json({ error: 'Reflection not found.' }, 404);
    deps.passages.delete(scope.conversationId);
    return c.body(null, 204);
  });

  return routes;
}
