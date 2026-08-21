import { useState } from 'react'
import styles from './Recoverable.module.css'

/*
 * Something failed, and the page still works.
 *
 * What this replaces was a red band that appeared, said "Load failed", and
 * stayed — permanent, prominent, and offering nothing to do about it. On a
 * phone that band is a meaningful share of the screen given over to a sentence
 * nobody can act on, sitting above the writing somebody came here to do.
 *
 * Three things this must be:
 *
 *   **Recoverable.** A Retry, because the commonest cause is a connection that
 *   dropped for a second and the commonest fix is asking again.
 *
 *   **Dismissible**, when it is safe to be. A failure to load a *list* is
 *   worth knowing about and worth putting away; a failure to save something is
 *   not, and that is the caller's judgement rather than this component's.
 *
 *   **Non-blocking.** It sits in the flow, keeps its own size, and never takes
 *   the page. Nothing anybody typed is touched by it appearing or going.
 *
 * Retrying is bounded. A retry that fails repeatedly stops offering itself,
 * because a button that does nothing three times is worse than no button.
 */
const RETRY_LIMIT = 3

export function Recoverable({
  message,
  onRetry,
  onDismiss,
  detail,
}: {
  message: string
  /** Absent when there is nothing sensible to try again. */
  onRetry?: () => Promise<unknown> | void
  /** Absent when the failure must stay visible — an unsaved change, say. */
  onDismiss?: () => void
  detail?: string
}) {
  const [tries, setTries] = useState(0)
  const [busy, setBusy] = useState(false)

  const exhausted = tries >= RETRY_LIMIT

  return (
    <div className={styles.root} role="alert">
      <div className={styles.text}>
        <p className={styles.message}>{message}</p>
        {detail ? <p className={styles.detail}>{detail}</p> : null}
        {exhausted ? (
          <p className={styles.detail}>
            That has not worked a few times now. It is worth waiting a moment before trying
            again — nothing you have written is affected.
          </p>
        ) : null}
      </div>

      <div className={styles.actions}>
        {onRetry && !exhausted ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              setBusy(true)
              setTries((count) => count + 1)
              void Promise.resolve(onRetry()).finally(() => setBusy(false))
            }}
          >
            {busy ? 'Trying…' : 'Try again'}
          </button>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onDismiss}
            aria-label="Dismiss this message"
          >
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  )
}
