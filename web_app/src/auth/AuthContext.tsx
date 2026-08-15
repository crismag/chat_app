import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../shared/api/client.ts'
import { AuthContext, type AuthContextValue, type AuthUser } from './auth-context.ts'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    api<AuthUser>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setReady(true))
  }, [])

  const value: AuthContextValue = {
    user,
    ready,
    async login(email, password) {
      setUser(await api<AuthUser>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }))
    },
    async register(email, password) {
      setUser(await api<AuthUser>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }))
    },
    async logout() {
      await api('/auth/logout', { method: 'POST' })
      setUser(null)
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
