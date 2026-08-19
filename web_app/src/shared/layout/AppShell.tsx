import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { useAuth } from '../../auth/useAuth.ts'
import { ChatIcon, CommunityIcon, LibraryIcon, PlusIcon } from '../ui/icons.tsx'
import { ProfileMenu } from '../ui/ProfileMenu.tsx'
import styles from './AppShell.module.css'

/*
 * Three destinations. Create stays an action on a finished reflection, reached
 * from the card and the account menu. Community is in the shell because a
 * published entry now has its own address and can be opened from the feed.
 */
const navItems = [
  { to: '/', label: 'Reflect', end: true, Icon: ChatIcon },
  { to: '/reflections', label: 'Reflections', end: false, Icon: LibraryIcon },
  { to: '/community', label: 'Community', end: false, Icon: CommunityIcon },
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
  const { user, ready, logout, forgetThisBrowser } = useAuth()
  const navigate = useNavigate()

  if (!ready) {
    return (
      <div className={styles.loading} role="status">
        <span className={styles.spinner} aria-hidden="true" />
        <p>Loading C.H.A.T.…</p>
      </div>
    )
  }

  /*
   * No wall.
   *
   * This used to send anyone without a session to /login, which meant a
   * visitor had to decide whether to trust the product before they had used
   * it. The shell renders for everybody now; what an anonymous person cannot
   * do is refused at the point they try it, with the reason, rather than at
   * the door.
   */

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
            {/*
              Somebody — guest or registered: the account menu, which says
              which they are. Nobody yet: an invitation to sign in, stated once
              and quietly. It is not a prompt and not a banner; a visitor is
              asked about an account exactly once, when they first keep
              something, and never on a screen they are only reading.
            */}
            {user ? (
              <ProfileMenu
                account={user}
                onSignOut={() => void logout()}
                onForgetThisBrowser={() => void forgetThisBrowser()}
              />
            ) : (
              /* Nobody yet, so nothing is saved yet. */
              <Link className={styles.deviceNote} to="/login" title="Sign in to reach your reflections on any device">
                <span className={styles.deviceDot} aria-hidden="true" />
                Sign in
              </Link>
            )}
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
