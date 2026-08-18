import { Navigate, NavLink, Outlet, useNavigate } from 'react-router'
import { useAuth } from '../../auth/useAuth.ts'
import { ChatIcon, LibraryIcon, PlusIcon } from '../ui/icons.tsx'
import { ProfileMenu } from '../ui/ProfileMenu.tsx'
import styles from './AppShell.module.css'

/*
 * Two destinations, not four.
 *
 * Create is an action on a finished reflection, reached from the card and the
 * account menu. Community is not in the shell until it can open a published
 * entry. What remains is the product that works: write, and revisit.
 */
const navItems = [
  { to: '/', label: 'Reflect', end: true, Icon: ChatIcon },
  { to: '/reflections', label: 'Reflections', end: false, Icon: LibraryIcon },
] as const

/*
 * The four letters, shown once in the header.
 *
 * The framework is the product, so it is on screen rather than in the docs —
 * each letter in its own colour, the same colour that section carries wherever
 * it appears. It is the cheapest possible way to teach the structure.
 */
const letters = [
  { letter: 'C', word: 'Content', className: styles.content },
  { letter: 'H', word: 'Heart', className: styles.heart },
  { letter: 'A', word: 'Application', className: styles.application },
  { letter: 'T', word: 'Testimony', className: styles.testimony },
] as const

export function AppShell() {
  const { user, ready, logout } = useAuth()
  const navigate = useNavigate()

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

          <nav className={styles.desktopNav} aria-label="Primary desktop">
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
            {/*
              The one primary action in the shell. Writing is what the product
              is for, so starting is never more than one press away — and on a
              phone it keeps the icon and drops the word rather than shrinking.
            */}
            <button
              type="button"
              className={`btn btn-primary btn-sm ${styles.newAction}`}
              aria-label="New reflection"
              onClick={() => void navigate('/?new=1')}
            >
              <PlusIcon className={styles.navIcon} />
              <span className={styles.newLabel}>New reflection</span>
            </button>
            <ProfileMenu email={user.email} onSignOut={() => void logout()} />
          </div>
        </div>
      </header>

      <main className={styles.main} id="main">
        <Outlet />
      </main>

      {/*
        A bottom bar on phones, because the top of a tall screen is the hardest
        place to reach. It carries the same destinations as the header, and
        icons let the labels stay legible instead of shrinking to fit.
      */}
      <nav className={styles.mobileNav} aria-label="Primary phone">
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
