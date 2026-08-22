/*
 * "Your address is not confirmed yet", and the way to fix it.
 *
 * ── Why it is here and nowhere else ────────────────────────────────────────
 *
 * Being unverified is not an error, so it is not announced where errors are.
 * It is a fact about somebody's own account that only matters when they try to
 * do one of two things — share a reflection, or send a message — and both
 * refusals say "confirm your address" without offering a way to. This is that
 * way, on the one page that is already about their account.
 *
 * ── Why only they can see it ───────────────────────────────────────────────
 *
 * The unverified fact comes from `/api/auth/me` — their own session — and
 * never from the profile payload. `GET /api/profiles/:handle` does not carry
 * `emailVerified` and must not start to: whether somebody has confirmed their
 * address is between them and the server, and a public payload holding it
 * would be a way to ask about anybody. The caller gates on `isOwner` as well,
 * but the reason this cannot leak is that the answer is not in the response.
 *
 * ── Why the reply is not read for meaning ──────────────────────────────────
 *
 * The route answers the same sentence whether a link was sent, the address was
 * already confirmed, or the hourly ceiling refused it — on purpose, because it
 * is reachable without an account and a varying answer would be a way to ask
 * whether an address is verified here. So this shows what the server said and
 * does not decide anything from it.
 */

import { useState } from 'react'

import { api } from '../shared/api/client.ts'
import styles from './ConfirmEmailNotice.module.css'

export function ConfirmEmailNotice({ email }: { email: string | null }) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState('')
  const [failed, setFailed] = useState('')

  async function resend() {
    setSending(true)
    setSent('')
    setFailed('')
    try {
      const answer = await api<{ message?: string }>('/auth/send-verification', { method: 'POST' })
      setSent(answer.message ?? 'If that address needs confirming, a link is on its way to it.')
    } catch (caught) {
      setFailed(
        caught instanceof Error
          ? caught.message
          : 'The link could not be sent just now. Try again in a moment.',
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <section className={styles.notice} aria-labelledby="confirm-email-heading">
      <h2 className={styles.title} id="confirm-email-heading">
        Confirm your email address
      </h2>
      <p className={styles.body}>
        {email ? (
          <>
            We sent a link to <span className={styles.address}>{email}</span>. Opening it confirms
            the address and nothing else — it does not sign anybody in.{' '}
          </>
        ) : (
          <>
            Opening the link we sent confirms the address and nothing else — it does not sign
            anybody in.{' '}
          </>
        )}
        Until then everything still works for writing privately. This only affects the places your
        words reach somebody else: sharing a reflection, and sending a message.
      </p>

      <div className={styles.actions}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void resend()}
          disabled={sending}
        >
          {sending ? 'Sending…' : 'Send the link again'}
        </button>
      </div>

      {/*
        Present from the start rather than added on success: a live region the
        browser only meets at the moment its text arrives is one a screen
        reader can miss entirely.
      */}
      <p className={styles.result} role="status">
        {sent}
      </p>
      {failed ? (
        <p className={styles.failed} role="alert">
          {failed}
        </p>
      ) : null}
    </section>
  )
}
