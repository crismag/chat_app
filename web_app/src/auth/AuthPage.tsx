import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { ApiError } from '../shared/api/client.ts'
import { useAuth } from './useAuth.ts'
import styles from './AuthPage.module.css'

/*
 * The four letters, as the first thing anyone reads about this.
 *
 * C's blurb used to say "what the passage is saying, and what is happening
 * around it" — the commentary framing the section was renamed away from. In
 * roughly thirty real reflections the C section is the verse, usually with its
 * reference and translation, and frequently nothing else; see
 * `docs/examples/REAL_CHAT_SAMPLES.md`. Explanation, where it appears at all,
 * appears under Heart, which is where H's blurb now admits it.
 */
const LETTERS = [
  {
    letter: 'C',
    word: 'Content',
    blurb: 'The passage itself — the verse, its reference and its translation.',
    tone: 'content',
  },
  {
    letter: 'H',
    word: 'Heart',
    blurb: 'What it means to you, and how it touched, convicted or encouraged you.',
    tone: 'heart',
  },
  {
    letter: 'A',
    word: 'Application',
    blurb: 'What you will actually do about it.',
    tone: 'application',
  },
  {
    letter: 'T',
    word: 'Testimony',
    blurb: 'The conviction, prayer or declaration you want to keep.',
    tone: 'testimony',
  },
] as const

/**
 * Which field a failure belongs to.
 *
 * Only one of them is attributable. A 409 is the email — that address is
 * taken, and nothing about the password is in question. A failed sign-in is
 * deliberately *not* attributable: the server answers "Invalid email or
 * password." without saying which half was wrong, and marking one field
 * invalid would give away exactly what that wording withholds. So a failure
 * with no field marks both, which is the truthful reading of it.
 */
type ErrorField = 'email' | null

function fieldOf(caught: unknown): ErrorField {
  return caught instanceof ApiError && caught.status === 409 ? 'email' : null
}

export function AuthPage() {
  const { user, ready, login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<{ message: string; field: ErrorField } | null>(null)
  /*
   * In flight. The submit button was previously always enabled, so a second
   * press on a slow network sent a second registration — which came back 409,
   * telling someone the account they had just successfully created already
   * existed.
   */
  const [pending, setPending] = useState(false)

  const errorId = 'auth-error'
  const emailRef = useRef<HTMLInputElement>(null)
  const alertRef = useRef<HTMLParagraphElement>(null)

  /*
   * Take the caret to the problem. An announcement alone leaves a keyboard or
   * screen-reader user where they were, with no idea what to correct.
   */
  useEffect(() => {
    if (!error) return
    if (error.field === 'email') emailRef.current?.focus()
    else alertRef.current?.focus()
  }, [error])

  if (ready && user) {
    return <Navigate to="/" replace />
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    /*
     * The guard, as well as the disabled attribute. `disabled` stops the
     * pointer; this stops everything else — a repeated Enter, a form submitted
     * programmatically, a double event before React has re-rendered.
     */
    if (pending) return
    setPending(true)
    setError(null)
    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        await register(email, password)
      }
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : 'Unable to continue',
        field: fieldOf(caught),
      })
    } finally {
      setPending(false)
    }
  }

  /** A field is implicated when the failure names it, or names neither. */
  const implicated = (field: 'email' | 'password') =>
    error !== null && (error.field === null || error.field === field)

  return (
    <div className={styles.page}>
      {/*
        The framework, before the form. Someone arriving here has no idea what
        the four letters mean, and the sign-in screen is the only place there is
        room to say so without getting in the way later.
      */}
      <aside className={styles.aside}>
        <p className={styles.wordmark}>
          <span className={styles.content}>C.</span>
          <span className={styles.heart}>H.</span>
          <span className={styles.application}>A.</span>
          <span className={styles.testimony}>T.</span>
        </p>
        <h2 className={styles.asideTitle}>
          Keep the conversation that changed your mind.
        </h2>
        <dl className={styles.letters}>
          {LETTERS.map(({ letter, word, blurb, tone }) => (
            <div key={letter} className={styles.letterRow}>
              <dt className={`${styles.letterMark} ${styles[tone]}`}>{letter}</dt>
              <dd>
                <strong>{word}</strong>
                <span>{blurb}</span>
              </dd>
            </div>
          ))}
        </dl>
      </aside>

      <section className={styles.panel}>
        <p className="eyebrow">Private by default</p>
        <h1>{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
        <p className={styles.lead}>
          Your conversations stay private unless you explicitly publish one
          C.H.A.T.
        </p>

        <form className={styles.form} onSubmit={onSubmit}>
          <div className="field">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              ref={emailRef}
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              aria-invalid={implicated('email') || undefined}
              aria-describedby={implicated('email') ? errorId : undefined}
              onChange={(event) => {
                setEmail(event.target.value)
                setError(null)
              }}
              required
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode === 'login' ? 'Your password' : 'At least 8 characters'}
              value={password}
              minLength={8}
              aria-invalid={implicated('password') || undefined}
              aria-describedby={implicated('password') ? errorId : undefined}
              onChange={(event) => {
                setPassword(event.target.value)
                setError(null)
              }}
              required
            />
          </div>

          {error ? (
            <p
              ref={alertRef}
              id={errorId}
              className={styles.error}
              role="alert"
              tabIndex={-1}
            >
              {error.message}
            </p>
          ) : null}

          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending
              ? mode === 'login'
                ? 'Signing in…'
                : 'Creating account…'
              : mode === 'login'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>

        <p className={styles.switch}>
          {mode === 'login' ? 'New here?' : 'Already have an account?'}{' '}
          <button
            type="button"
            className={styles.link}
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? 'Create an account' : 'Sign in instead'}
          </button>
        </p>
      </section>
    </div>
  )
}
