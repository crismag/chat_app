import { Navigate, Outlet } from 'react-router'
import { useAuth } from '../../auth/useAuth.ts'
import { ApiHealth } from '../api/ApiHealth.tsx'
import { NavLink } from 'react-router'
import styles from './AppShell.module.css'

const navItems = [
  { to: '/', label: 'C.H.A.T.', end: true },
  { to: '/library', label: 'Library', end: false },
  { to: '/community', label: 'Community', end: false },
  { to: '/create', label: 'Create', end: false },
] as const

export function AppShell() {
  const { user, ready, logout } = useAuth()

  if (!ready) {
    return <p className={styles.loading}>Loading C.H.A.T.…</p>
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <p className={styles.wordmark}>C.H.A.T.</p>
          <p className={styles.tagline}>
            Context · Heart · Application · Testimony
          </p>
        </div>
        <nav className={styles.desktopNav} aria-label="Primary">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                isActive ? `${styles.navLink} ${styles.active}` : styles.navLink
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.meta}>
          <ApiHealth />
          <button type="button" className={styles.signOut} onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>

      <nav className={styles.mobileNav} aria-label="Primary">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              isActive ? `${styles.navLink} ${styles.active}` : styles.navLink
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
