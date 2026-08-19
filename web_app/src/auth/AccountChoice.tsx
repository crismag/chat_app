import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { CREATION_SOURCES, type CreationSource } from '@chat/shared'
import { onAccountRequired } from '../shared/api/client.ts'
import { useAuth } from './useAuth.ts'
import styles from './AccountChoice.module.css'

/*
 * The one moment an account is asked for, and the only place one is created.
 *
 * A visitor can read, browse and look up a passage without existing. The first
 * time they try to keep something, the server refuses and says so, and this is
 * what that refusal turns into: a small question with two honest answers,
 * shown once, in the middle of what they were already doing.
 *
 * It is deliberately not a login wall. "Continue as guest" is a real answer
 * that costs nothing and loses nothing, and what it means is stated plainly --
 * kept in this browser, carried into an account later if they want one. The
 * alternative would be to make the guest silently, which is quicker and takes
 * the choice away from the person it belongs to.
 *
 * Closing the question is also a real answer. The action fails, the page keeps
 * what they had written, and nothing was created on their behalf.
 */
type Pending = {
  creationSource: CreationSource
  resolve: (resolved: boolean) => void
}

function isCreationSource(value: string): value is CreationSource {
  return (Object.values(CREATION_SOURCES) as string[]).includes(value)
}

/** What the person was doing, so the question is about that and not in general. */
const WHAT_THEY_WERE_DOING: Record<CreationSource, string> = {
  [CREATION_SOURCES.REFLECTION_CREATE]: 'To keep this reflection',
  [CREATION_SOURCES.REFLECTION_SAVE]: 'To save this reflection',
  [CREATION_SOURCES.CHAT_START]: 'To keep this conversation',
  [CREATION_SOURCES.IMAGE_CREATE]: 'To keep this image',
  [CREATION_SOURCES.PASSAGE_SAVE]: 'To save this passage',
  [CREATION_SOURCES.OTHER_PERSISTENT_ACTION]: 'To keep this',
}

export function AccountChoiceProvider({ children }: { children?: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)

  const handler = useCallback(
    (creationSource: string) =>
      new Promise<boolean>((resolve) => {
        setPending({
          creationSource: isCreationSource(creationSource)
            ? creationSource
            : CREATION_SOURCES.OTHER_PERSISTENT_ACTION,
          resolve,
        })
      }),
    [],
  )

  useEffect(() => onAccountRequired(handler), [handler])

  return (
    <>
      {children}
      {pending ? (
        <AccountChoice
          creationSource={pending.creationSource}
          onSettled={(resolved) => {
            pending.resolve(resolved)
            setPending(null)
          }}
        />
      ) : null}
    </>
  )
}

function AccountChoice({
  creationSource,
  onSettled,
}: {
  creationSource: CreationSource
  onSettled: (resolved: boolean) => void
}) {
  const { continueAsGuest } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const headingId = useId()
  const firstRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onSettled(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSettled])

  async function chooseGuest() {
    setBusy(true)
    setError(null)
    try {
      await continueAsGuest(creationSource)
      /* Resolved: the request that was refused is retried as this guest. */
      onSettled(true)
    } catch {
      setError('That did not work. Try again, or sign in instead.')
      setBusy(false)
    }
  }

  function chooseSignIn() {
    /*
     * Not resolved: signing in happens on another page, and the action is
     * retried by the person rather than by the client. Where they were is
     * carried along so they come back to it.
     */
    onSettled(false)
    void navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`)
  }

  return (
    <div className={styles.scrim} onClick={() => onSettled(false)}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className={styles.title} id={headingId}>
          {WHAT_THEY_WERE_DOING[creationSource]}, choose how it is kept
        </h2>
        <p className={styles.lead}>
          Nothing has been saved yet. Either way, what you have written stays where it is.
        </p>

        <div className={styles.options}>
          <button
            ref={firstRef}
            type="button"
            className={styles.option}
            disabled={busy}
            onClick={() => void chooseGuest()}
          >
            <span className={styles.optionTitle}>{busy ? 'Setting up…' : 'Continue as guest'}</span>
            <span className={styles.optionNote}>
              Kept in this browser on this device. You can create an account later and everything
              you have written comes with you — nothing needs moving. If you clear this browser’s
              site data, it is lost.
            </span>
          </button>

          <button type="button" className={styles.option} disabled={busy} onClick={chooseSignIn}>
            <span className={styles.optionTitle}>Sign in or create an account</span>
            <span className={styles.optionNote}>
              Kept to your account, so you can reach it from any browser or device.
            </span>
          </button>
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}

        <button
          type="button"
          className={`btn btn-ghost btn-sm ${styles.dismiss}`}
          disabled={busy}
          onClick={() => onSettled(false)}
        >
          Not now
        </button>
      </div>
    </div>
  )
}
