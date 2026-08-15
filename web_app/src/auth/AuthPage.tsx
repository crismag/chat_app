import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from './useAuth.ts'
import styles from './AuthPage.module.css'

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
    <section className={styles.page}>
      <p className={styles.kicker}>Private by default</p>
      <h1>{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
      <p className={styles.lead}>
        Your conversations stay private unless you explicitly publish one C.H.A.T.
      </p>
      <form className={styles.form} onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error ? <p className={styles.error}>{error}</p> : null}
        <button type="submit">{mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <button
        type="button"
        className={styles.link}
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
      >
        {mode === 'login' ? 'Need an account?' : 'Already have an account?'}
      </button>
    </section>
  )
}
