/*
 * Everything the browser knows about Bible passages.
 *
 * Four calls, all to this application's own endpoints. **YouVersion is not
 * named in this directory and its response shape does not appear in it** —
 * that is the point of a backend-owned connector. If the provider changes, or
 * is replaced, nothing here changes.
 *
 * There is also no key here, and there is nowhere for one to go. The credential
 * is read by the API server from its own environment; a browser bundle that
 * could hold it is a browser bundle that has published it.
 */

import { ApiError, api } from '../shared/api/client.ts'
import {
  BIBLE_OUTCOMES,
  BIBLE_OUTCOME_MESSAGES,
  type BibleOutcome,
  type BiblePassage,
  type BibleTranslation,
} from '@chat/shared'

export type { BiblePassage, BibleTranslation }
export { BIBLE_OUTCOMES }

export interface TranslationsAnswer {
  translations: BibleTranslation[]
  /**
   * The id to select when nobody has chosen yet.
   *
   * An id, never an abbreviation. The server resolves it — see `catalog.ts` —
   * and a browser that re-derived it from a string would reintroduce exactly
   * the bug that resolution exists to prevent: there is no translation whose
   * abbreviation is `NIV`, so matching on one silently selects a different
   * Bible.
   */
  defaultTranslationId: number | null
}

/**
 * A failure, already turned into something the interface can act on.
 *
 * The outcome decides which recovery is offered — retry, choose another
 * translation, fix the reference — and the message is the server's, which is
 * the only place safe copy is written. Nothing here composes an error sentence
 * from a status code, because a sentence invented in the browser is a sentence
 * nobody reviewed.
 */
export interface LookupFailure {
  outcome: BibleOutcome
  message: string
}

export function asLookupFailure(error: unknown): LookupFailure {
  if (error instanceof ApiError) {
    const body = error.body as { outcome?: BibleOutcome; error?: string } | null
    const outcome = body?.outcome ?? BIBLE_OUTCOMES.PROVIDER_UNAVAILABLE
    return {
      outcome,
      message: body?.error ?? BIBLE_OUTCOME_MESSAGES[outcome],
    }
  }
  /*
   * A network failure before the server was reached. Reported as an outage,
   * with the same promise attached: nothing the person wrote has changed.
   */
  return {
    outcome: BIBLE_OUTCOMES.PROVIDER_UNAVAILABLE,
    message: BIBLE_OUTCOME_MESSAGES[BIBLE_OUTCOMES.PROVIDER_UNAVAILABLE],
  }
}

export function fetchTranslations(language = 'en'): Promise<TranslationsAnswer> {
  return api<TranslationsAnswer>(`/bible/translations?language=${encodeURIComponent(language)}`)
}

export function fetchPassage(
  translationId: number,
  reference: string,
): Promise<{ passage: BiblePassage; verses: number }> {
  return api<{ passage: BiblePassage; verses: number }>(
    `/bible/passages?translationId=${encodeURIComponent(String(translationId))}&reference=${encodeURIComponent(reference)}`,
  )
}

/** The passage this reflection was written against, exactly as it was saved. */
export function fetchSavedPassage(conversationId: string): Promise<{ passage: BiblePassage | null }> {
  return api<{ passage: BiblePassage | null }>(
    `/bible/reflections/${encodeURIComponent(conversationId)}/passage`,
  )
}

export function saveSavedPassage(
  conversationId: string,
  passage: BiblePassage,
): Promise<{ passage: BiblePassage }> {
  return api<{ passage: BiblePassage }>(
    `/bible/reflections/${encodeURIComponent(conversationId)}/passage`,
    { method: 'PUT', body: JSON.stringify(passage) },
  )
}

/* ------------------------------------------------------ previous selection */

const SELECTION_KEY = 'chat.bible.translationId'

/**
 * The translation this person last chose, remembered between reflections.
 *
 * An id, and only an id. It is a preference, not a credential and not content,
 * so `localStorage` is the right home for it — and it is read defensively,
 * because a value put there by an older version of this code, or by hand, must
 * not be able to break the picker.
 */
export function readPreviousTranslationId(): number | null {
  try {
    const raw = window.localStorage.getItem(SELECTION_KEY)
    const parsed = Number.parseInt(raw ?? '', 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  } catch {
    /* Private browsing, a blocked origin, a full quota. Not worth an error. */
    return null
  }
}

export function rememberTranslationId(id: number): void {
  try {
    window.localStorage.setItem(SELECTION_KEY, String(id))
  } catch {
    /* Ignored for the same reason. */
  }
}
