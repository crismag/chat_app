import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { accountLabel, isGuest, type Account } from '@chat/shared'
import { CreateIcon, ProfileIcon, SignOutIcon } from './icons.tsx'
import { Avatar } from './Avatar.tsx'
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
  onForgetThisBrowser,
}: {
  account: Account
  onSignOut: () => void
  /** Destructive, and never behind the ordinary sign-out control. */
  onForgetThisBrowser: () => void
}) {
  const [open, setOpen] = useState(false)
  const [forgetting, setForgetting] = useState(false)
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
        {/*
          The same face this person has everywhere else. Hidden from the
          reader because the button beside it already names what it opens —
          two announcements for one control is one too many.
        */}
        <span aria-hidden="true">
          <Avatar
            name={label}
            /*
              Keyed on the handle when there is one, so the face here is the
              same face the profile page and every shared reflection show. The
              account id is the fallback for somebody with no profile yet.
            */
            identity={account.handle ?? account.id}
            size="small"
          />
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
          {/*
            A guest has nothing to sign out of, and signing them out would be
            the one thing that could destroy their account: their credential is
            how they are recognised, and it is all they have. So what is
            offered instead is the destructive action, named as such, behind a
            confirmation that says what it costs.
          */}
          {guest ? (
            <button
              type="button"
              role="menuitem"
              className={`${styles.item} ${styles.destructive}`}
              onClick={() => {
                close(false)
                setForgetting(true)
              }}
            >
              <SignOutIcon className={styles.itemIcon} />
              Forget this guest on this browser
            </button>
          ) : (
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

      {forgetting ? (
        <ForgetGuestConfirmation
          guestName={account.guestName}
          onCancel={() => setForgetting(false)}
          onConfirm={() => {
            setForgetting(false)
            onForgetThisBrowser()
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * The warning that has to be read before a guest is forgotten.
 *
 * An unregistered guest has no email and no second credential, so this really
 * is the end of their access to what they wrote. Saying that plainly, and
 * offering the alternative that avoids it, is the whole job of this dialog --
 * which is why it is not the confirmation on an ordinary "sign out".
 */
function ForgetGuestConfirmation({
  guestName,
  onCancel,
  onConfirm,
}: {
  guestName: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const headingId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className={styles.scrim} onClick={onCancel}>
      <div
        className={styles.confirm}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className={styles.confirmTitle} id={headingId}>
          Forget {guestName ?? 'this guest'} on this browser?
        </h2>
        <p className={styles.confirmBody}>
          This browser is the only thing that identifies you. There is no email and no password on
          this account yet, so forgetting it here means <strong>losing access to everything you
          have written</strong> — permanently, and for us as well as for you.
        </p>
        <p className={styles.confirmBody}>
          If you want to reach your reflections from somewhere else instead, create an account
          first: it keeps the same reflections and adds a way back to them.
        </p>
        <div className={styles.confirmActions}>
          <button ref={cancelRef} type="button" className="btn btn-primary btn-sm" onClick={onCancel}>
            Keep them
          </button>
          <button type="button" className={`btn btn-sm ${styles.destructiveButton}`} onClick={onConfirm}>
            Forget and lose them
          </button>
        </div>
      </div>
    </div>
  )
}
