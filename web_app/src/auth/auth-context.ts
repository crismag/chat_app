import { createContext } from 'react'
import type { Account, CreationSource } from '@chat/shared'

/*
 * Who the interface is for: a guest, a registered user, or nobody.
 *
 * One type for the first two, because they are one kind of thing. A guest has
 * no email and a name like `QuietCedar-14`; somebody who registered has an
 * email and, if they were a guest first, still has that name. `null` is a
 * visitor -- nobody, with nothing stored for them -- which is a real state and
 * not an error.
 */
export type AuthUser = Account

/** What happened when a guest tried to register with an email already in use. */
export type RegisterOutcome =
  | { ok: true }
  | { ok: false; accountExists: true; guestReflections: number }

export type AuthContextValue = {
  user: AuthUser | null
  ready: boolean
  login: (email: string, password: string) => Promise<{ merged: number }>
  /**
   * Claim the account this person already has.
   *
   * For a guest this upgrades their existing user, so everything they have
   * written stays theirs without moving. For a visitor it makes a new one.
   */
  register: (email: string, password: string) => Promise<RegisterOutcome>
  /** Take the guest option, explicitly, at the moment it was offered. */
  continueAsGuest: (creationSource: CreationSource) => Promise<AuthUser>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
