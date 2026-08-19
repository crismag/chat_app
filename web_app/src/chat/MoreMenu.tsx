import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import styles from './ChatPage.module.css'

/*
 * The rest of what can be done to a reflection, out of the way until wanted.
 *
 * Delete, Create visual and Suggest from conversation each had a permanent
 * button — two of them in a footer row that existed only to hold them. None is
 * used often and none is used while writing, so persistent placement bought
 * nothing and cost a row plus three controls competing with Share, which *is*
 * the one people reach for.
 *
 * A real menu, not a div with an onClick: Escape closes it and returns focus,
 * the arrows walk it, and a press elsewhere dismisses it.
 */
export type MoreMenuItem = {
  label: string
  onSelect: () => void
  /** Why it cannot be chosen, in words. `null` means it can. */
  reason?: string | null
  danger?: boolean
  icon?: ReactNode
}

export function MoreMenu({ label, items }: { label: string; items: MoreMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  function close(returnFocus = true) {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()

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
    const walkable = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    if (walkable.length === 0) return
    const current = walkable.indexOf(document.activeElement as HTMLElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    walkable[(current + step + walkable.length) % walkable.length]?.focus()
  }

  return (
    <span className={styles.moreMenu}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.iconButton}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className={styles.morePopover}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`${styles.assistItem} ${item.danger ? styles.assistItemDanger : ''}`}
              disabled={Boolean(item.reason)}
              title={item.reason ?? undefined}
              onClick={() => {
                close(false)
                item.onSelect()
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  )
}
