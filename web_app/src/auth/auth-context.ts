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
  /**
   * `keepSignedIn` is the only thing that makes this browser durably
   * recognised afterwards. Left off, the session ends with the window, which
   * is the right behaviour on a shared computer.
   */
  login: (email: string, password: string, keepSignedIn: boolean) => Promise<{ merged: number }>
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
  /**
   * Destructive, and separate from signing out on purpose.
   *
   * For a guest this is the end of their access to everything they wrote:
   * there is no email to recover from and no second credential. The interface
   * says so before calling it.
   */
  forgetThisBrowser: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
