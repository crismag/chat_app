import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { BookIcon, InfoIcon } from './icons.tsx'
import styles from './InfoMenu.module.css'

/*
 * The way in to Intro and About that does not require an account, a session,
 * or knowing the account menu exists.
 *
 * Both pages already had an address and already asked for no account — the
 * problem was never that they were hidden behind a login, it was that the
 * only door to either of them was the avatar menu, which does not render at
 * all until somebody is recognised as *somebody*, guest or otherwise. A
 * first-time visitor who has not written anything yet has no avatar to open.
 *
 * So this is unconditional: rendered in the header regardless of `user`,
 * next to the account control rather than folded into it. It is deliberately
 * small — one icon, two items — because the two things it needs to do are
 * "be found" and "not compete with New reflection or the account itself" and
 * a third destination would start to be a second navigation.
 */
export function InfoMenu() {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  function close(returnFocus = true) {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
    first?.focus()

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
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
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    if (items.length === 0) return
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
        <InfoIcon className={styles.triggerIcon} />
        <span className="sr-only">Intro and About</span>
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Intro and About"
          className={styles.menu}
          onKeyDown={onMenuKeyDown}
        >
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              close(false)
              void navigate('/intro')
            }}
          >
            <BookIcon className={styles.itemIcon} />
            Intro
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              close(false)
              void navigate('/about')
            }}
          >
            <InfoIcon className={styles.itemIcon} />
            About
          </button>
        </div>
      ) : null}
    </div>
  )
}
