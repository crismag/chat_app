import { Link } from 'react-router'

import styles from './ProfileTabs.module.css'

/*
 * The profile's sections, for the person who owns it.
 *
 * ── Why this is links and not a tablist ─────────────────────────────────────
 *
 * Each section is a place, so each one has an address. `?tab=communities` can
 * be linked to, opened in a new tab, reloaded, and reached with Back — none of
 * which is true of a `role="tablist"` holding state in a component. The ARIA
 * tab pattern is for panels inside one document location; this is navigation,
 * so it is a nav, and the current one is marked with `aria-current`.
 *
 * ── Why a visitor does not see this ─────────────────────────────────────────
 *
 * Four of these five are private: the communities somebody belongs to, what
 * they have encouraged, and their settings are theirs. A stranger sees a name
 * and public shares, which is one thing and therefore needs no tab strip —
 * a row of tabs over a single section is what makes a portfolio look like an
 * abandoned social profile.
 */

export const PROFILE_TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'shared', label: 'Shared' },
  { id: 'communities', label: 'Communities' },
  /*
   * "Encouraged", not "Likes". Encouragement is the word this product uses
   * for the gesture, and it is the only one — introducing a second name for
   * one action would leave the same button called two things on two screens.
   */
  { id: 'encouraged', label: 'Encouraged' },
  { id: 'settings', label: 'Settings' },
] as const

export type ProfileTab = (typeof PROFILE_TABS)[number]['id']

export function isProfileTab(value: string | null): value is ProfileTab {
  return PROFILE_TABS.some((tab) => tab.id === value)
}

export function ProfileTabs({ handle, current }: { handle: string; current: ProfileTab }) {
  return (
    <nav className={styles.tabs} aria-label="Profile sections">
      <ul className={styles.list}>
        {PROFILE_TABS.map((tab) => (
          <li key={tab.id}>
            <Link
              className={styles.tab}
              to={`/profile/${handle}?tab=${tab.id}`}
              /*
               * `page`, because these are locations. The current one is also
               * marked visually — but never only visually.
               */
              aria-current={tab.id === current ? 'page' : undefined}
              replace
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
