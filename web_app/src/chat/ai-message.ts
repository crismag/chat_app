import { AI_OUTCOMES, AI_UNAVAILABLE_MESSAGE } from '@chat/shared'

import { ApiError } from '../shared/api/client.ts'

/**
 * What to say when an assistance request fails.
 *
 * Used by both AI surfaces — the section helpers and the reply thread — which
 * is why it is not inside either. A rate limit is the one failure worth
 * describing precisely, because it is the one that ends: telling somebody to
 * try again in forty seconds is actionable where "unavailable" is not.
 * Everything else falls back to the one sentence that is always true, which
 * points at the manual workflow.
 */
export function assistMessage(caught: unknown): string {
  if (caught instanceof ApiError) {
    const body = caught.body as { error?: string; outcome?: string; retryAfterSeconds?: number }
    if (body.outcome === AI_OUTCOMES.RATE_LIMITED && body.retryAfterSeconds) {
      return `${body.error ?? ''} Try again in about ${body.retryAfterSeconds} seconds.`.trim()
    }
    if (body.error) return body.error
  }
  return AI_UNAVAILABLE_MESSAGE
}
