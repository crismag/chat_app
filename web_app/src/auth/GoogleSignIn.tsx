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

type Phase = 'loading' | 'ready' | 'signing-in' | 'unavailable' | 'failed'

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
function loadGoogleScript(): Promise<GoogleAccountsId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    const script = existing ?? document.createElement('script')
    const settle = () => {
      const api = window.google?.accounts?.id
      if (api) resolve(api)
      else reject(new Error('Google Identity Services loaded without its sign-in API.'))
    }
    script.addEventListener('load', settle)
    script.addEventListener('error', () => {
      reject(new Error('The Google sign-in library could not be loaded.'))
    })
    if (!existing) {
      script.src = SCRIPT_SRC
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    } else if (window.google?.accounts?.id) {
      settle()
    }
  })
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
      let clientId: string | null = null
      try {
        const config = await api<{ clientId: string | null }>('/auth/google/config')
        clientId = config.clientId
      } catch {
        if (live) setPhase('unavailable')
        return
      }
      /*
       * Not configured on this server is a different thing from broken, and it
       * is not the visitor's problem: the control simply is not offered.
       */
      if (!clientId) {
        if (live) setPhase('unavailable')
        return
      }

      let accounts: GoogleAccountsId
      try {
        accounts = await loadGoogleScript()
      } catch {
        if (live) setPhase('unavailable')
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
        accounts.renderButton(target.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'left',
        })
      }
      setPhase('ready')
    })()

    return () => {
      live = false
    }
  }, [continueWithGoogle])

  if (phase === 'unavailable') {
    /*
     * Nothing at all rather than a broken button. Every other way in still
     * works, and an explanation about somebody else's script is not something
     * a person can act on.
     */
    return null
  }

  return (
    <div className={styles.root}>
      {/* Google draws its own button in here; it is not ours to restyle. */}
      <div ref={target} className={styles.button} aria-busy={phase === 'loading'} />
      {phase === 'loading' ? <p className={styles.note}>Preparing Google sign-in…</p> : null}
      {phase === 'signing-in' ? (
        <p className={styles.note} role="status">
          Signing you in…
        </p>
      ) : null}
      {problem ? (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  )
}
