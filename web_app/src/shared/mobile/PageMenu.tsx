import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { accountLabel, isGuest } from '@chat/shared'
import { useAuth } from '../../auth/useAuth.ts'
import { Sheet } from './Sheet.tsx'
import styles from './PageMenu.module.css'

/*
 * The page's own menu, and the account, in one place on every screen.
 *
 * On a desktop the account lives in the header, behind an avatar. A phone's
 * app bar has room for a title and three controls, and on the busiest screen
 * all three are already spoken for — so an avatar would be a fifth thing in a
 * row that must not wrap.
 *
 * It goes here instead: the same sheet, opened from the same ⋮, in the same
 * position, on all four screens. An account control that sits in the bar on
 * one screen and in a menu on the next is one nobody can find twice.
 *
 * Each screen may add its own rows above the account block; what is below the
 * rule is identical everywhere.
 */

export type PageMenuItem = {
  label: string
  onSelect: () => void
  /** Why it cannot be chosen, in words. Absent means it can. */
  reason?: string | null
  hint?: string
  danger?: boolean
}

/**
 * Who this is, and what can be done about it.
 *
 * Its own component so that reading the account happens only while the sheet
 * is open — which is not a tidiness point but the fix for a real defect.
 *
 * `PageMenu` has to stay mounted. A sheet mounted only while open mounts with
 * `open` already true; React's strict mode double-invokes its effects, and the
 * cleanup between the two runs pops the history entry the first run pushed.
 * The resulting `popstate` reaches the second run's listener and closes the
 * sheet a moment after it opened — so the menu never appeared. Filters never
 * showed this because its sheet is always mounted and only its `open` prop
 * changes.
 *
 * Staying mounted would otherwise mean reading the account on every render of
 * every screen, and requiring an auth context merely to render a list. `Sheet`
 * renders nothing while closed, so a child's hooks do not run — which gives
 * both properties at once.
 */
function AccountBlock({ onClose }: { onClose: () => void }) {
  const { user, logout, forgetThisBrowser } = useAuth()
  const navigate = useNavigate()
  const guest = user ? isGuest(user) : false

  const go = (to: string) => {
    onClose()
    void navigate(to)
  }

  return (
    <section className={styles.account} aria-label="Account">
      {/*
        Who this is, said plainly. A guest is told they are a guest rather than
        left to infer it from what is missing — and never described as signed
        out, which they are not.
      */}
      <p className={styles.identity}>
        <span className={styles.name}>{user ? accountLabel(user) : 'Not signed in'}</span>
        <span className={styles.state}>
          {user
            ? guest
              ? 'Guest · saved on this device only'
              : 'Account · saved to your account'
            : 'Nothing is being saved yet'}
        </span>
      </p>

      <div className={styles.rows}>
        {user ? (
          <button type="button" className={styles.row} onClick={() => go('/profile')}>
            Profile
          </button>
        ) : null}

        {guest ? (
          <>
            <button type="button" className={styles.row} onClick={() => go('/login?create=1')}>
              Create an account
              <small>Keeps your reflections, and lets you take part in Community</small>
            </button>
            {/*
              Destructive, and set apart. It removes the way back to a guest's
              writing on this browser, which is not a thing to press by
              accident on the way to Profile.
            */}
            <button
              type="button"
              className={`${styles.row} ${styles.danger}`}
              onClick={() => {
                onClose()
                void forgetThisBrowser()
              }}
            >
              Forget this guest on this browser
            </button>
          </>
        ) : null}

        {user && !guest ? (
          <button
            type="button"
            className={`${styles.row} ${styles.danger}`}
            onClick={() => {
              onClose()
              void logout()
            }}
          >
            Sign out
          </button>
        ) : null}

        {!user ? (
          <button type="button" className={styles.row} onClick={() => go('/login')}>
            Sign in
          </button>
        ) : null}
      </div>
    </section>
  )
}

export function PageMenu({
  open,
  onClose,
  items = [],
  children,
}: {
  open: boolean
  onClose: () => void
  /** This screen's actions, above the account block. */
  items?: PageMenuItem[]
  /** This screen's own settings, above the actions. */
  children?: ReactNode
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Menu">
      {children}

      {items.length > 0 ? (
        <div className={styles.rows}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`${styles.row} ${item.danger ? styles.danger : ''}`}
              disabled={Boolean(item.reason)}
              onClick={() => {
                onClose()
                item.onSelect()
              }}
            >
              {item.label}
              {/*
                The reason is written out rather than left in a `title`. A
                phone has no hover, so a tooltip there is an explanation
                nobody can reach.
              */}
              {item.reason ? <small>{item.reason}</small> : null}
              {!item.reason && item.hint ? <small>{item.hint}</small> : null}
            </button>
          ))}
        </div>
      ) : null}

      <AccountBlock onClose={onClose} />
    </Sheet>
  )
}
