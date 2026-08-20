import { useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { ApiError } from '../shared/api/client.ts'
import { ChatWordmark } from '../shared/ui/ChatLetters.tsx'
import { useAuth } from './useAuth.ts'
import styles from './AuthPage.module.css'

/*
 * The two halves of getting back in.
 *
 * One page, two states, because they are one errand: ask for a link, then use
 * it. Which half is shown depends on whether there is a token in the address,
 * so the link in the email lands directly on the part that matters.
 *
 * The thing this page must not do is tell somebody whether an address has an
 * account. So the confirmation after asking is the same sentence either way,
 * and it is the server's sentence rather than one composed here — two places
 * writing that promise is one place for it to drift.
 */
export function PasswordResetPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  return token ? <ChooseNewPassword token={token} /> : <AskForLink />
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <aside className={styles.aside}>
        <ChatWordmark />
        <h2 className={styles.asideTitle}>Keep the conversation that changed your mind.</h2>
      </aside>
      <section className={styles.panel}>
        <p className="eyebrow">Your account</p>
        <h1>{title}</h1>
        {children}
      </section>
    </div>
  )
}

function AskForLink() {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setProblem(null)
    try {
      setSent(await requestPasswordReset(email))
    } catch (caught: unknown) {
      /*
       * Only a failure to reach the server can appear here. Anything about the
       * address itself is deliberately not reported — that is what keeps the
       * form from being a way to find out who has an account.
       */
      setProblem(caught instanceof ApiError ? caught.message : 'That could not be sent.')
    } finally {
      setPending(false)
    }
  }

  if (sent) {
    return (
      <Frame title="Check your email">
        <p className={styles.lead}>{sent}</p>
        <p className={styles.lead}>
          If it does not arrive, look in your spam folder — and check the address you typed.
        </p>
        <p className={styles.switch}>
          <Link className={styles.link} to="/login">
            Back to sign in
          </Link>
        </p>
      </Frame>
    )
  }

  return (
    <Frame title="Forgotten password">
      <p className={styles.lead}>
        Type the address you signed up with and we will send a link to set a new password. It
        works for one hour.
      </p>
      <form className={styles.form} onSubmit={onSubmit}>
        <div className="field">
          <label className="label" htmlFor="reset-email">
            Email
          </label>
          <input
            id="reset-email"
            className="input"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        {problem ? (
          <p className={styles.notice} role="alert">
            {problem}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Sending…' : 'Send the link'}
        </button>
      </form>
      <p className={styles.switch}>
        Remembered it?{' '}
        <Link className={styles.link} to="/login">
          Sign in
        </Link>
      </p>
    </Frame>
  )
}

function ChooseNewPassword({ token }: { token: string }) {
  const { resetPassword } = useAuth()
  const [password, setPassword] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setProblem(null)
    try {
      await resetPassword(token, password)
      setDone(true)
    } catch (caught: unknown) {
      setProblem(caught instanceof ApiError ? caught.message : 'That could not be done.')
    } finally {
      setPending(false)
    }
  }

  /* Straight in: the link was the proof, and they are already signed in. */
  if (done) return <Navigate to="/" replace />

  return (
    <Frame title="Set a new password">
      <p className={styles.lead}>
        Choose something you have not used here before. Signing in on your other devices will
        need the new one.
      </p>
      <form className={styles.form} onSubmit={onSubmit}>
        <div className="field">
          <label className="label" htmlFor="new-password">
            New password
          </label>
          <input
            id="new-password"
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
        {problem ? (
          <p className={styles.error} role="alert">
            {problem}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Setting it…' : 'Set password and sign in'}
        </button>
      </form>
      <p className={styles.switch}>
        Link expired?{' '}
        <Link className={styles.link} to="/forgot-password">
          Ask for another
        </Link>
      </p>
    </Frame>
  )
}
