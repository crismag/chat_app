import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { api } from '../shared/api/client.ts'

/*
 * How much is waiting, for the badge on the Messages icon.
 *
 * Somebody's first message goes to the recipient's Requests tab, and until now
 * nothing anywhere else in the application said so. The message arrived, the
 * page that holds it was one press away, and the person it was sent to had no
 * reason to look — which is indistinguishable, from both ends, from the message
 * never being delivered.
 *
 * ── When it asks ────────────────────────────────────────────────────────────
 *
 * On mount, on every navigation, when the tab is looked at again, and once a
 * minute while it is open. Deliberately not a socket and not a fast poll: this
 * is a number beside an icon, and the cost of being a minute late is that a
 * badge appears a minute late.
 *
 * The navigation trigger is what makes it feel immediate in the case that
 * matters — reading the messages and coming back finds the badge already gone,
 * because leaving `/messages` is itself a navigation.
 *
 * ── What it does on failure ─────────────────────────────────────────────────
 *
 * Nothing. No badge is the correct rendering of "we do not know", and a person
 * who is signed out gets zeros from the server rather than an error, so there
 * is no state in which this puts a message on screen of its own.
 */

const REFRESH_MS = 60_000

export type Waiting = { messages: number; requests: number; total: number }

const NOTHING: Waiting = { messages: 0, requests: 0, total: 0 }

export function useWaiting(): Waiting {
  const [waiting, setWaiting] = useState<Waiting>(NOTHING)
  const location = useLocation()

  const refresh = useCallback(() => {
    api<Waiting>('/messaging/waiting')
      .then(setWaiting)
      /* An unanswered count is no badge, which is what was there before. */
      .catch(() => setWaiting(NOTHING))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh, location.pathname])

  useEffect(() => {
    const timer = setInterval(refresh, REFRESH_MS)
    /*
     * A tab left open for an hour has been asking all along; one that was in
     * the background has not been looked at, and the first thing its owner
     * does is look. Both are covered, and neither polls while hidden.
     */
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])

  return waiting
}

/**
 * What the badge says.
 *
 * Capped at "9+". A two-digit number in a circle beside an icon either shrinks
 * the type below what anybody can read or grows the circle until it covers the
 * icon it belongs to, and the difference between 12 and 30 waiting messages
 * changes nothing about what the person does next.
 */
export function badgeText(count: number): string {
  if (count <= 0) return ''
  return count > 9 ? '9+' : String(count)
}

/** What a screen reader hears, which is the real number and what it is. */
export function badgeLabel(waiting: Waiting): string {
  const parts: string[] = []
  if (waiting.messages > 0) {
    parts.push(`${waiting.messages} unread message${waiting.messages === 1 ? '' : 's'}`)
  }
  if (waiting.requests > 0) {
    parts.push(`${waiting.requests} message request${waiting.requests === 1 ? '' : 's'}`)
  }
  return parts.join(', ')
}
