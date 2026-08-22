import { useEffect, useState, type ReactNode } from 'react'
import { PLATFORMS, type CreationSource } from '@chat/shared'
import { ApiError, api } from '../shared/api/client.ts'
import {
  AuthContext,
  type AuthContextValue,
  type AuthUser,
  type RegisterOutcome,
} from './auth-context.ts'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)

  /*
   * Asking who we are does not create anybody. A visitor gets a 401 here and
   * stays a visitor -- an account appears only when they ask for one.
   */
  useEffect(() => {
    api<AuthUser>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setReady(true))
  }, [])

  const value: AuthContextValue = {
    user,
    ready,
    async refresh() {
      /* A failure here means the session ended; that is a sign-out, not an error. */
      setUser(await api<AuthUser>('/auth/me').catch(() => null))
    },
    async login(email, password, keepSignedIn) {
      const account = await api<AuthUser & { merged?: number }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, keepSignedIn }),
      })
      setUser(account)
      /* How much of their guest work moved into this account, if any. */
      return { merged: account.merged ?? 0 }
    },
    async continueWithGoogle(credential, keepSignedIn) {
      const account = await api<AuthUser & { merged?: number }>('/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential, keepSignedIn }),
      })
      setUser(account)
      /* How much of their guest work moved into this account, if any. */
      return { merged: account.merged ?? 0 }
    },
    async register(email, password): Promise<RegisterOutcome> {
      try {
        setUser(
          await api<AuthUser>('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
          }),
        )
        return { ok: true }
      } catch (error: unknown) {
        /*
         * The collision case. That account belongs to somebody and is not
         * overwritten -- so this is not a failure to report as one, it is the
         * moment to say "you already have an account" and offer to sign in,
         * which is what moves this guest's work into it.
         */
        const body = error instanceof ApiError ? (error.body as Record<string, unknown>) : null
        if (body?.['accountExists'] === true) {
          return {
            ok: false,
            accountExists: true,
            guestReflections: Number(body['guestReflections'] ?? 0),
          }
        }
        throw error
      }
    },
    async continueAsGuest(creationSource: CreationSource) {
      const account = await api<AuthUser>('/auth/guest', {
        method: 'POST',
        body: JSON.stringify({ creationSource, platform: PLATFORMS.WEB }),
      })
      setUser(account)
      return account
    },
    async requestPasswordReset(email) {
      const { message } = await api<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      return message
    },
    async resetPassword(token, password) {
      /* It answers with the account, signed in: they have just proved it. */
      setUser(
        await api<AuthUser>('/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ token, password }),
        }),
      )
    },
    async logout() {
      await api('/auth/logout', { method: 'POST' })
      /*
       * Tell Google not to choose an account for us next time.
       *
       * Signing out of CHAT is not signing out of Google, and it should not
       * be. But if Google is left free to select an account automatically,
       * the next visit signs the person straight back in — which makes
       * "sign out" a button that appears not to work. This is harmless when
       * the library was never loaded.
       */
      try {
        window.google?.accounts?.id?.disableAutoSelect()
      } catch {
        /* Google's script is not ours to depend on; failing here changes nothing. */
      }
      setUser(null)
    },
    async forgetThisBrowser() {
      await api('/auth/forget-installation', { method: 'POST' })
      setUser(null)
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
