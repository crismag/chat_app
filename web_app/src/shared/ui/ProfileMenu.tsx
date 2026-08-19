import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { accountLabel, isGuest, type Account } from '@chat/shared'
import { CreateIcon, ProfileIcon, SignOutIcon } from './icons.tsx'
import styles from './ProfileMenu.module.css'

/*
 * One control in place of the email, the sign-out button and the API status.
 *
 * The header was carrying operational information a reader never asked for. An
 * avatar is the smallest thing that still says "this is your account, and the
 * account controls are behind it" — and everything operational moves inside,
 * where it costs nothing until it is wanted.
 *
 * It is a real button opening a real menu: Escape closes and returns focus to
 * the trigger, the arrow keys walk the items, a click elsewhere dismisses it.
 * A div with an onClick would look identical and be unusable from a keyboard.
 */
export function ProfileMenu({
  account,
  onSignOut,
}: {
  account: Account
  onSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  /*
   * A guest has a menu too.
   *
   * They are a real user with real work in here, so hiding the account
   * controls from them would be hiding their own reflections' settings. What
   * differs is one line and one item: what they are called, and the way to
   * turn this into an account they can reach from anywhere.
   */
  const guest = isGuest(account)
  const label = accountLabel(account)
  // The initial is derived rather than stored; there are no avatars yet.
  const initial = (guest ? (account.guestName ?? 'G') : (account.email ?? '?'))
    .trim()
    .charAt(0)
    .toUpperCase() || '?'

  function close(returnFocus = true) {
    setOpen(false)
    if (returnFocus) {
      triggerRef.current?.focus()
    }
  }

  useEffect(() => {
    if (!open) {
      return
    }
    // Focus lands inside the menu, so the next Tab or arrow is meaningful.
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
    first?.focus()

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  function onMenuKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return
    }
    event.preventDefault()
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    if (items.length === 0) {
      return
    }
    const current = items.indexOf(document.activeElement as HTMLElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    const next = (current + step + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span className={styles.avatar} aria-hidden="true">
          {initial}
        </span>
        <span className="sr-only">Account menu for {label}</span>
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          className={styles.menu}
          onKeyDown={onMenuKeyDown}
        >
          <p className={styles.identity}>
            <span className={styles.identityLabel}>
              {guest ? 'Kept on this device' : 'Signed in as'}
            </span>
            <span className={styles.identityEmail}>{label}</span>
          </p>
          {/*
            The way out of being a guest, offered rather than insisted on. It
            claims the account they already have -- same reflections, same
            everything -- which is why it says "your account" and not "sign up".
          */}
          {guest ? (
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                close(false)
                void navigate('/login')
              }}
            >
              <ProfileIcon className={styles.itemIcon} />
              Create your account
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              close(false)
              void navigate('/profile')
            }}
          >
            <ProfileIcon className={styles.itemIcon} />
            Your profile
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              close(false)
              void navigate('/create')
            }}
          >
            <CreateIcon className={styles.itemIcon} />
            Create image
          </button>
          {/*
            About is the way in to the policies. It is listed here rather than
            the four documents themselves, so this menu does not become a legal
            index and there is one address to send someone to.
          */}
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              close(false)
              void navigate('/about')
            }}
          >
            <span className={styles.itemIcon} aria-hidden="true">i</span>
            About
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              close(false)
              void navigate('/open-source-licenses')
            }}
          >
            <span className={styles.itemIcon} aria-hidden="true">§</span>
            Open Source Licences
          </button>
          {guest ? null : (
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                close(false)
                onSignOut()
              }}
            >
              <SignOutIcon className={styles.itemIcon} />
              Sign out
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
