import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from './useAuth.ts'
import styles from './AuthPage.module.css'

const LETTERS = [
  {
    letter: 'C',
    word: 'Content',
    blurb: 'What the passage is saying, and what is happening around it.',
    tone: 'content',
  },
  {
    letter: 'H',
    word: 'Heart',
    blurb: 'How it touched, convicted or encouraged you. Yours, never invented.',
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

export function AuthPage() {
  const { user, ready, login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (ready && user) {
    return <Navigate to="/" replace />
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        await register(email, password)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to continue')
    }
  }

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
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
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
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn btn-primary">
            {mode === 'login' ? 'Sign in' : 'Create account'}
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
