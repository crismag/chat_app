import { Navigate, NavLink, Outlet } from 'react-router'
import { useAuth } from '../../auth/useAuth.ts'
import { ApiHealth } from '../api/ApiHealth.tsx'
import {
  ChatIcon,
  CommunityIcon,
  CreateIcon,
  LibraryIcon,
  SignOutIcon,
} from '../ui/icons.tsx'
import styles from './AppShell.module.css'

const navItems = [
  { to: '/', label: 'Reflect', end: true, Icon: ChatIcon },
  { to: '/library', label: 'Library', end: false, Icon: LibraryIcon },
  { to: '/community', label: 'Community', end: false, Icon: CommunityIcon },
  { to: '/create', label: 'Create', end: false, Icon: CreateIcon },
] as const

/*
 * The four letters, shown once in the header.
 *
 * The framework is the product, so it is on screen rather than in the docs —
 * each letter in its own colour, the same colour that section carries wherever
 * it appears. It is the cheapest possible way to teach the structure.
 */
const letters = [
  { letter: 'C', word: 'Context', className: styles.context },
  { letter: 'H', word: 'Heart', className: styles.heart },
  { letter: 'A', word: 'Application', className: styles.application },
  { letter: 'T', word: 'Testimony', className: styles.testimony },
] as const

export function AppShell() {
  const { user, ready, logout } = useAuth()

  if (!ready) {
    return (
      <div className={styles.loading} role="status">
        <span className={styles.spinner} aria-hidden="true" />
        <p>Loading C.H.A.T.…</p>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <NavLink to="/" className={styles.brand}>
            <span className={styles.wordmark}>
              {letters.map(({ letter, word, className }) => (
                <span key={letter} className={className} title={word}>
                  {letter}
                  <span aria-hidden="true">.</span>
                </span>
              ))}
            </span>
            <span className={styles.tagline}>
              {letters.map(({ word }) => word).join(' · ')}
            </span>
          </NavLink>

          <nav className={styles.desktopNav} aria-label="Primary">
            {navItems.map(({ to, label, end, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  isActive ? `${styles.navLink} ${styles.active}` : styles.navLink
                }
              >
                <Icon className={styles.navIcon} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className={styles.meta}>
            <ApiHealth />
            <span className={styles.who} title={user.email}>
              {user.email}
            </span>
            <button
              type="button"
              className={`btn btn-ghost btn-sm ${styles.signOut}`}
              onClick={() => void logout()}
            >
              <SignOutIcon className={styles.navIcon} />
              <span className={styles.signOutLabel}>Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className={styles.main} id="main">
        <Outlet />
      </main>

      {/*
        A bottom bar on phones, because the top of a tall screen is the hardest
        place to reach. It carries the same four destinations as the header, and
        icons let the labels stay legible instead of shrinking to fit.
      */}
      <nav className={styles.mobileNav} aria-label="Primary">
        {navItems.map(({ to, label, end, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              isActive
                ? `${styles.mobileLink} ${styles.active}`
                : styles.mobileLink
            }
          >
            <Icon className={styles.mobileIcon} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
