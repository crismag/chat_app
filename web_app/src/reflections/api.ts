/*
 * What a reflection is, over HTTP.
 *
 * ── Two names for one thing ─────────────────────────────────────────────────
 *
 * The product calls these **reflections**. The API calls the private draft a
 * **conversation** — `/api/conversations/*` — and only the list is
 * `/api/reflections`. That split is historical and is not worth a migration,
 * but it is worth spelling out in one place instead of in four pages that each
 * build their own paths out of template strings.
 *
 * These helpers exist so a page says what it wants rather than how the URL is
 * spelled: `shareReflection(id)` rather than a backtick and a POST. Nothing
 * here decides anything — no filtering, no permission, no retry. The server
 * owns all of that, and a client-side copy of a rule is a weaker second one.
 */

import type { ChatFormat, ConversationSummary } from '@chat/shared'
import { api } from '../shared/api/client.ts'

export type ReflectionSummary = ConversationSummary & { format?: ChatFormat }

/** One reflection in full: its sections, and the thread that produced them. */
export type ReflectionDetail = ReflectionSummary & {
  messages: { id: string; role: string; content: string }[]
  sections: Record<string, { type: string; content: string; authorOrigin?: string }>
}

/* ------------------------------------------------------------------ reading */

export function fetchReflections(): Promise<ReflectionSummary[]> {
  return api<ReflectionSummary[]>('/conversations')
}

/**
 * The searchable, paged collection.
 *
 * Takes the query already assembled, because the page owns which filters
 * exist and this owns only where they are sent.
 */
export function fetchReflectionPage<T>(query: URLSearchParams | string): Promise<T> {
  const search = typeof query === 'string' ? query : query.toString()
  return api<T>(`/reflections${search ? `?${search}` : ''}`)
}

export function fetchReflection<T = ReflectionDetail>(id: string): Promise<T> {
  return api<T>(`/conversations/${encodeURIComponent(id)}`)
}

/* ------------------------------------------------------------------ writing */

export function createReflection<T = ReflectionSummary>(
  body: Record<string, unknown>,
): Promise<T> {
  return api<T>('/conversations', { method: 'POST', body: JSON.stringify(body) })
}

export function updateReflection<T = unknown>(
  id: string,
  body: Record<string, unknown>,
): Promise<T> {
  return api<T>(`/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteReflection<T = unknown>(id: string): Promise<T> {
  return api<T>(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function saveSection<T = unknown>(
  id: string,
  body: Record<string, unknown>,
): Promise<T> {
  return api<T>(`/conversations/${encodeURIComponent(id)}/sections`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function addMessage<T = unknown>(
  id: string,
  body: Record<string, unknown>,
): Promise<T> {
  return api<T>(`/conversations/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/* ------------------------------------------------------- visibility, in app */

/**
 * Make a reflection shareable.
 *
 * `acknowledgeExtension` is the author agreeing to share something longer than
 * the format suggests; without it the server answers 422 with the report the
 * editor needs to say which field is at fault. This does not create a
 * publication — that is a separate, explicit act.
 */
export function shareReflection<T = unknown>(
  id: string,
  options: { acknowledgeExtension?: boolean } = {},
): Promise<T> {
  const query = options.acknowledgeExtension ? '?acknowledgeExtension=true' : ''
  return api<T>(`/conversations/${encodeURIComponent(id)}/share${query}`, { method: 'POST' })
}

export function makeReflectionPrivate<T = unknown>(id: string): Promise<T> {
  return api<T>(`/conversations/${encodeURIComponent(id)}/make-private`, { method: 'POST' })
}
