import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { useAuth } from '../../auth/useAuth.ts'
import { BackIcon, ChatIcon, CommunityIcon, LibraryIcon, PlusIcon } from '../ui/icons.tsx'
import { NotesIcon } from '../../notes/icons.tsx'
import { MessagesIcon } from '../../messaging/icons.tsx'
import { badgeLabel, badgeText, useWaiting } from '../../messaging/useWaiting.ts'
import { ProfileMenu } from '../ui/ProfileMenu.tsx'
import { InfoMenu } from '../ui/InfoMenu.tsx'
import { useSoftKeyboard } from '../ui/useSoftKeyboard.ts'
import { MobileBarProvider, useMobileBarConfig } from '../mobile/MobileBar.tsx'
import { NARROW_QUERY, useMediaQuery } from '../ui/useMediaQuery.ts'
import styles from './AppShell.module.css'

/*
 * Five destinations. Create stays an action on a finished reflection, reached
 * from the card and the account menu. Community is in the shell because a
 * published entry now has its own address and can be opened from the feed.
 */
const navItems = [
  { to: '/', label: 'Reflect', end: true, Icon: ChatIcon },
  { to: '/reflections', label: 'Reflections', end: false, Icon: LibraryIcon },
  { to: '/notes', label: 'Notes', end: false, Icon: NotesIcon },
  { to: '/messages', label: 'Messages', end: false, Icon: MessagesIcon },
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
  /*
   * The provider wraps the shell rather than sitting inside it, because the
   * shell is what reads the configuration a screen writes.
   */
  return (
    <MobileBarProvider>
      <Shell />
    </MobileBarProvider>
  )
}

function Shell() {
  const { user, ready, logout, forgetThisBrowser } = useAuth()
  /*
   * The phone's bar is rendered only on a phone, rather than rendered always
   * and hidden with CSS.
   *
   * Hiding it was enough to look right and not enough to be right: the bar and
   * the desktop header both hold the editor's title field, so at desktop
   * widths the document contained two inputs both labelled "Reflection title",
   * one of them permanently invisible. A screen reader finds both. The test
   * suite found both too, about one run in three.
   */
  const narrow = useMediaQuery(NARROW_QUERY)
  const described = useMobileBarConfig()
  const bar = narrow ? described : null
  /*
   * What is waiting in Messages, for the badge in both navs.
   *
   * Read once here and used twice: the desktop header and the phone bar are
   * two renderings of one set of destinations, and two hooks would be two
   * requests answering the same question.
   */
  const waiting = useWaiting()
  /*
   * One place watches for the software keyboard and marks the body; the
   * layout reads that attribute. Three components each deciding for
   * themselves would give three answers to one question.
   */
  useSoftKeyboard()
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
    <div className={styles.shell} data-immersive={bar?.immersive ? 'true' : 'false'}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>

      <header className={styles.header} data-mobile-bar={bar ? 'true' : 'false'}>
        {/*
          The phone's bar, when the screen showing has described one. It is a
          sibling of the desktop header rather than a replacement for it: CSS
          shows exactly one, so neither can be rendered twice and the desktop
          layout is untouched.
        */}
        {bar ? (
          <div className={styles.mobileBar}>
            {bar.replace ?? (
              <>
                {bar.onBack ? (
                  <button
                    type="button"
                    className={styles.barBack}
                    aria-label={bar.backLabel ?? 'Back'}
                    onClick={bar.onBack}
                  >
                    <BackIcon className={styles.barIcon} />
                  </button>
                ) : null}
                {bar.titleIsHeading === false ? (
                  <p className={styles.barTitle}>{bar.title}</p>
                ) : (
                  <h1 className={styles.barTitle}>{bar.title}</h1>
                )}
                {bar.actions ? <div className={styles.barActions}>{bar.actions}</div> : null}
              </>
            )}
          </div>
        ) : null}

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
                {/*
                  The count rides on the icon, not beside the word: it belongs
                  to the thing it is counting, and on the phone bar below there
                  is no word for it to sit beside.
                */}
                <span className={styles.iconSlot}>
                  <Icon className={styles.navIcon} />
                  {to === '/messages' && waiting.total > 0 ? (
                    <span className={styles.badge} aria-hidden="true">
                      {badgeText(waiting.total)}
                    </span>
                  ) : null}
                </span>
                <span>{label}</span>
                {to === '/messages' && waiting.total > 0 ? (
                  <span className="sr-only">, {badgeLabel(waiting)}</span>
                ) : null}
              </NavLink>
            ))}
          </nav>

          <div className={styles.meta}>
            {/*
              Intro and About, reachable without an account and without
              opening the account menu — which does not even render until
              somebody is recognised as a guest or a registered person. A
              first-time visitor with neither yet still has a way to read
              either page. Unconditional on purpose: this is the one control
              in `.meta` that does not change with `user`.
            */}
            <InfoMenu />
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
      {/*
        Hidden on an immersive screen, not removed from the application. The
        editor supplies its own way back, so this would be a second navigation
        competing with it.
      */}
      <nav
        className={styles.mobileNav}
        aria-label="Primary phone"
        data-immersive={bar?.immersive ? 'true' : 'false'}
      >
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
            <span className={styles.iconSlot}>
              <Icon className={styles.mobileIcon} />
              {to === '/messages' && waiting.total > 0 ? (
                <span className={styles.badge} aria-hidden="true">
                  {badgeText(waiting.total)}
                </span>
              ) : null}
            </span>
            <span className={styles.mobileLabel}>{label}</span>
            {to === '/messages' && waiting.total > 0 ? (
              <span className="sr-only">, {badgeLabel(waiting)}</span>
            ) : null}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
