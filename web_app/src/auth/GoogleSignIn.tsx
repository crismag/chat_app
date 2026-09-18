import { useEffect, useRef, useState } from 'react'
import { api } from '../shared/api/client.ts'
import { useAuth } from './useAuth.ts'
import styles from './GoogleSignIn.module.css'

/*
 * "Continue with Google", and the several ways it can fail.
 *
 * Google Identity Services is a script on somebody else's server, rendering a
 * button this application does not draw, into a page it does not control the
 * network conditions of. Every one of those is a way for the control to be
 * absent, silent or broken, and none of them may leave a blank space where a
 * sign-in used to be. So each is named, and each says what happened.
 *
 * The credential this produces is a token Google signed. It is passed straight
 * to the server, which is the only place it is believed — nothing here reads
 * it, and nothing about the person is taken from the browser's word for it.
 */

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
/** How long we wait for Google's script before treating it as gone. */
const GOOGLE_SCRIPT_TIMEOUT_MS = 8_000

type Phase = 'loading' | 'ready' | 'signing-in' | 'unavailable' | 'blocked' | 'failed'

interface GoogleAccountsId {
  initialize(options: {
    client_id: string
    callback: (response: { credential?: string }) => void
    cancel_on_tap_outside?: boolean
  }): void
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void
  disableAutoSelect(): void
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } }
  }
}

/** Load the Google script once, and tell every caller how it went. */
function loadGoogleScript(timeoutMs = GOOGLE_SCRIPT_TIMEOUT_MS): Promise<GoogleAccountsId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  return new Promise((resolve, reject) => {
    const previous = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    /*
     * A script that already failed will never fire `load` again. Leaving it
     * in the document would make every retry wait for the timeout instead of
     * trying again.
     */
    if (previous?.dataset['googleStatus'] === 'error') previous.remove()
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    const script = existing ?? document.createElement('script')
    let settled = false
    const succeed = () => {
      if (settled) return
      const api = window.google?.accounts?.id
      if (!api) {
        settled = true
        reject(new Error('Google Identity Services loaded without its sign-in API.'))
        return
      }
      settled = true
      resolve(api)
    }
    const fail = () => {
      if (settled) return
      settled = true
      script.dataset['googleStatus'] = 'error'
      reject(new Error('The Google sign-in library could not be loaded.'))
    }
    const timer = window.setTimeout(fail, timeoutMs)
    const onLoad = () => {
      window.clearTimeout(timer)
      succeed()
    }
    const onError = () => {
      window.clearTimeout(timer)
      fail()
    }
    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
    if (!existing) {
      script.src = SCRIPT_SRC
      script.async = true
      script.defer = true
      try {
        document.head.appendChild(script)
      } catch {
        window.clearTimeout(timer)
        fail()
      }
    } else if (window.google?.accounts?.id) {
      window.clearTimeout(timer)
      succeed()
    }
    /* An existing script that has not yet loaded is waited on via the listeners. */
  })
}

function GoogleMark() {
  return (
    <svg className={styles.mark} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.48a5.54 5.54 0 0 1-2.4 3.63v3.02h3.88c2.27-2.09 3.53-5.17 3.53-8.89z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.02c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.76-2.11-6.7-4.94H1.28v3.11A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.3 14.28A7.21 7.21 0 0 1 4.92 12c0-.79.14-1.56.38-2.28V6.61H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.39l4.02-3.11z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.6 4.58 1.79l3.43-3.43C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.28 6.61l4.02 3.11C6.24 6.86 8.88 4.75 12 4.75z"
      />
    </svg>
  )
}

export function GoogleSignIn({
  keepSignedIn = false,
  onSignedIn,
}: {
  keepSignedIn?: boolean
  /** Called once the CHAT session exists, so the caller can resume what it was doing. */
  onSignedIn: (result: { merged: number }) => void
}) {
  const { continueWithGoogle } = useAuth()
  const [phase, setPhase] = useState<Phase>('loading')
  const [problem, setProblem] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const target = useRef<HTMLDivElement>(null)
  /*
   * The latest values, for a callback Google keeps a reference to. Google
   * holds the function it was initialised with, so reading state through it
   * directly would read whatever was true when the button was drawn.
   */
  const latest = useRef({ keepSignedIn, onSignedIn })
  latest.current = { keepSignedIn, onSignedIn }

  useEffect(() => {
    let live = true

    void (async () => {
      setPhase('loading')
      setProblem(null)

      let clientId: string | null = null
      try {
        const config = await api<{ clientId: string | null; configured?: boolean }>(
          '/auth/google/config',
        )
        clientId = config.clientId
        /*
         * Not configured on this server is a different thing from broken, and it
         * is not the visitor's problem: the control simply is not offered.
         */
        if (!clientId) {
          if (live) setPhase('unavailable')
          return
        }
      } catch {
        if (live) {
          setPhase('blocked')
          setProblem('Google sign-in could not be reached just now. Try again in a moment.')
        }
        return
      }
      if (!live) return

      let accounts: GoogleAccountsId
      try {
        accounts = await loadGoogleScript()
      } catch {
        if (live) {
          setPhase('blocked')
          setProblem('Google sign-in could not be loaded. You can still use email.')
        }
        return
      }
      if (!live) return

      accounts.initialize({
        client_id: clientId,
        cancel_on_tap_outside: true,
        callback: (response) => {
          const credential = response.credential
          /*
           * Google calls back with nothing when somebody closes the popup. That
           * is a decision, not a failure, so it says nothing and leaves the
           * button exactly where it was.
           */
          if (!credential) {
            setPhase('ready')
            return
          }
          setPhase('signing-in')
          setProblem(null)
          void continueWithGoogle(credential, latest.current.keepSignedIn)
            .then((result) => {
              latest.current.onSignedIn(result)
            })
            .catch((caught: unknown) => {
              setPhase('failed')
              setProblem(
                caught instanceof Error && caught.message
                  ? caught.message
                  : 'That sign-in could not be completed. Try again.',
              )
            })
        },
      })

      if (target.current) {
        target.current.replaceChildren()
        /*
         * Google sizes its iframe in pixels. A flex/grid parent with no
         * definite width makes that iframe 0×44, which reads as "the button
         * is missing" — the control was drawn, just not at a size anyone
         * can see. Cap at 400, Google's documented maximum.
         */
        const width = Math.max(
          200,
          Math.min(400, Math.round(target.current.getBoundingClientRect().width) || 320),
        )
        accounts.renderButton(target.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'left',
          width,
        })
      }
      setPhase('ready')
    })()

    return () => {
      live = false
    }
  }, [continueWithGoogle, attempt])

  if (phase === 'unavailable') {
    /*
     * Nothing at all rather than a broken button. Every other way in still
     * works, and an explanation about somebody else's script is not something
     * a person can act on.
     */
    return null
  }

  return (
    <>
      <div className={styles.root}>
        {/* Google draws its own button in here; it is not ours to restyle. */}
        <div
          ref={target}
          className={styles.button}
          hidden={phase === 'blocked'}
          aria-busy={phase === 'loading'}
        />
        {phase === 'blocked' ? (
          <button
            type="button"
            className={styles.fallback}
            onClick={() => {
              setPhase('loading')
              setProblem(null)
              setAttempt((n) => n + 1)
            }}
          >
            <GoogleMark />
            Continue with Google
          </button>
        ) : null}
        {phase === 'loading' ? <p className={styles.note}>Preparing Google sign-in…</p> : null}
        {phase === 'signing-in' ? (
          <p className={styles.note} role="status">
            Signing you in…
          </p>
        ) : null}
        {problem ? (
          <p className={styles.problem} role={phase === 'failed' ? 'alert' : 'status'}>
            {problem}
          </p>
        ) : null}
      </div>
      <p className={styles.divider}>
        <span>or</span>
      </p>
    </>
  )
}
