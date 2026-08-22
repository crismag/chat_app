import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { ApiError, api } from '../shared/api/client.ts'
import styles from './VerifyEmailPage.module.css'

/*
 * Where the confirmation link lands.
 *
 * Opening it proves the mailbox and does only that: nobody is signed in here,
 * and this page never asks for a password. Somebody who opens the link on a
 * phone that has never seen this account confirms the address and is then
 * invited to sign in — which is the honest shape, because reading an email is
 * not the same as being the person who owns the account.
 *
 * The token is spent at most once whatever React does with this component. A
 * development double-render or a refresh would otherwise turn a working link
 * into "no longer valid", which from the outside is indistinguishable from the
 * link having failed.
 */

type State =
  | { status: 'working' }
  | { status: 'confirmed'; message: string }
  | { status: 'failed'; message: string }

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [state, setState] = useState<State>({ status: 'working' })
  const spent = useRef(false)

  useEffect(() => {
    if (spent.current) return
    spent.current = true

    if (!token) {
      setState({ status: 'failed', message: 'That link is missing its confirmation code.' })
      return
    }

    api<{ message: string }>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then((answer) =>
        setState({ status: 'confirmed', message: answer.message }),
      )
      .catch((caught: unknown) => {
        /*
         * Shown as the server wrote it. Unknown, expired and already-used are
         * one sentence on purpose, and rewording it here is how that would
         * quietly be lost.
         */
        const message =
          caught instanceof ApiError && typeof (caught.body as { error?: string })?.error === 'string'
            ? ((caught.body as { error: string }).error)
            : 'That link could not be confirmed. Ask for a new one from your account.'
        setState({ status: 'failed', message })
      })
  }, [token])

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        {state.status === 'working' ? (
          <p className={styles.body} role="status">
            Confirming your email address…
          </p>
        ) : (
          <>
            <h1 className={styles.title}>
              {state.status === 'confirmed' ? 'Email confirmed' : 'That link did not work'}
            </h1>
            <p className={styles.body} role="status">
              {state.message}
            </p>
            {state.status === 'confirmed' ? (
              <p className={styles.body}>You can share reflections with other people now.</p>
            ) : null}
            <p>
              <Link className="btn btn-primary" to="/">
                Go to C.H.A.T.
              </Link>
            </p>
          </>
        )}
      </section>
    </main>
  )
}
