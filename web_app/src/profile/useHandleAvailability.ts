import { useEffect, useState } from 'react'

import { api } from '../shared/api/client.ts'

/*
 * Whether a handle can be had, asked while somebody types it.
 *
 * The server decides this at save time and is the only authority; this exists
 * so a person is not told "already taken" *after* filling in the rest of the
 * form. It is advice, never a gate — the PATCH re-checks, because the handle
 * can be claimed by somebody else between the answer and the save.
 *
 * Debounced, so typing a ten-character handle is one question rather than ten.
 */

export type Availability =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'free' }
  | { state: 'taken'; problem: string }

const DEBOUNCE_MS = 400

export function useHandleAvailability(handle: string, current: string): Availability {
  const [availability, setAvailability] = useState<Availability>({ state: 'idle' })

  useEffect(() => {
    const wanted = handle.trim().replace(/^@+/, '').toLowerCase()

    /* Their own handle, unchanged. There is nothing to ask and nothing to say. */
    if (!wanted || wanted === current.trim().toLowerCase()) {
      setAvailability({ state: 'idle' })
      return
    }

    setAvailability({ state: 'checking' })
    let live = true
    const timer = setTimeout(() => {
      api<{ available: boolean; problem: string | null }>(
        `/profiles/me/handle-available?handle=${encodeURIComponent(wanted)}`,
      )
        .then((answer) => {
          if (!live) return
          setAvailability(
            answer.available
              ? { state: 'free' }
              : { state: 'taken', problem: answer.problem ?? 'That handle cannot be used.' },
          )
        })
        .catch(() => {
          /*
           * Silent. A failed check must not look like a refusal — the save
           * will ask again and give a real answer.
           */
          if (live) setAvailability({ state: 'idle' })
        })
    }, DEBOUNCE_MS)

    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [handle, current])

  return availability
}
