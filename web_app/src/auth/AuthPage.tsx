import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { ACCOUNT_TYPES } from '@chat/shared'
import { ApiError } from '../shared/api/client.ts'
import { ChatLetters, ChatWordmark } from '../shared/ui/ChatLetters.tsx'
import { useAuth } from './useAuth.ts'
import styles from './AuthPage.module.css'

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
  const [params] = useSearchParams()
  /*
   * A guest arriving here is claiming the account they already have, so the
   * page opens on the form that does that rather than on sign-in.
   *
   * Derived rather than initialised, because who is asking is not known on the
   * first render -- `/auth/me` is still in flight -- and a mode fixed before
   * the answer arrives would show a guest the wrong form.
   */
  const guest = user?.accountType === ACCOUNT_TYPES.ANONYMOUS ? user : null
  const [chosenMode, setChosenMode] = useState<'login' | 'register' | null>(null)
  const mode = chosenMode ?? (guest ? 'register' : 'login')
  const setMode = setChosenMode
  /*
   * Said after a guest tried an email that already has an account. Their work
   * is not moved by registering -- that account is somebody's and is not
   * overwritten -- so what they are told is to sign in, which is what moves it.
   */
  const [collision, setCollision] = useState<{ reflections: number } | null>(null)
  /*
   * Off by default, because the safe answer on a computer somebody does not
   * own is the one that leaves nothing behind. Whether a computer is shared is
   * never guessed at -- the person knows, and this is how they say so.
   */
  const [keepSignedIn, setKeepSignedIn] = useState(false)
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

  /*
   * A guest is somebody, but not somebody who has finished: they came here on
   * purpose, so they stay. Only a registered user is sent away.
   */
  if (ready && user && user.accountType === ACCOUNT_TYPES.REGISTERED) {
    return <Navigate to={params.get('next') ?? '/'} replace />
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
        await login(email, password, keepSignedIn)
      } else {
        const outcome = await register(email, password)
        if (!outcome.ok) {
          /*
           * Not an error to shout about: they have an account, and one sign-in
           * away is everything they have written since, in it.
           */
          setCollision({ reflections: outcome.guestReflections })
          setMode('login')
          setPassword('')
        }
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
        <ChatWordmark />
        <h2 className={styles.asideTitle}>
          Keep the conversation that changed your mind.
        </h2>
        <ChatLetters />
      </aside>

      <section className={styles.panel}>
        <p className="eyebrow">Private by default</p>
        <h1>
          {mode === 'login' ? 'Sign in' : guest ? 'Create your account' : 'Create account'}
        </h1>
        <p className={styles.lead}>
          {guest && mode === 'register'
            ? `You are writing as ${guest.guestName ?? 'a guest'}. Adding an email and a password keeps the same account — every reflection you have written stays exactly where it is, and you can reach it from any device.`
            : 'Your reflections stay private unless you choose to share one.'}
        </p>

        {collision ? (
          <p className={styles.notice} role="status">
            You already have an account with that email. Sign in and
            {collision.reflections === 1
              ? ' the reflection you have written here moves into it.'
              : collision.reflections > 0
                ? ` the ${collision.reflections} reflections you have written here move into it.`
                : ' you can carry on there.'}
          </p>
        ) : null}

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

          {mode === 'login' ? (
            <label className={styles.keepSignedIn} htmlFor="keep-signed-in">
              <input
                id="keep-signed-in"
                type="checkbox"
                checked={keepSignedIn}
                onChange={(event) => setKeepSignedIn(event.target.checked)}
              />
              <span>
                Keep me signed in on this device
                <span className={styles.keepNote}>
                  Leave this off on a shared or public computer — you will be signed out when the
                  browser closes.
                </span>
              </span>
            </label>
          ) : null}

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
            onClick={() => {
              setCollision(null)
              setMode(mode === 'login' ? 'register' : 'login')
            }}
          >
            {mode === 'login' ? 'Create an account' : 'Sign in instead'}
          </button>
        </p>
      </section>
    </div>
  )
}
