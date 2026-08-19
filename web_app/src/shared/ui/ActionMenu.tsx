import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { NARROW_QUERY, useMediaQuery } from './useMediaQuery.ts'
import styles from './ActionMenu.module.css'

/*
 * One list of actions, in whichever shape the screen can hold.
 *
 * A popover anchored to its trigger is right on a desktop and wrong on a
 * phone: a control near the left edge of a narrow window put half its own
 * labels off the screen, and the result was a menu reading "a title", "from
 * conversation", "sual". Clamping the width would only have wrapped the
 * problem; the menu has to stop being anchored to the control at all.
 *
 * So below the width where this application swaps its columns for drawers,
 * the same items come up as a sheet from the bottom of the screen — no edge to
 * fall off, and where a thumb already is. Above it, the popover stays.
 *
 * Both are real menus: Escape closes and returns focus, the arrows walk the
 * items, a press elsewhere dismisses. A disabled item keeps its reason, and on
 * the sheet the reason is written out, because a phone has no hover and a
 * `title` attribute there is an explanation nobody can reach.
 */
export type ActionItem = {
  label: string
  onSelect: () => void
  /** Why it cannot be chosen, in words. `null` or absent means it can. */
  reason?: string | null
  danger?: boolean
  icon?: ReactNode
}

export function ActionMenu({
  label,
  trigger,
  triggerClassName,
  items,
  busy = false,
}: {
  /** Names the trigger and the menu. A sparkle or a ⋯ is not a word. */
  label: string
  trigger: ReactNode
  triggerClassName?: string
  items: ActionItem[]
  busy?: boolean
}) {
  const [open, setOpen] = useState(false)
  const narrow = useMediaQuery(NARROW_QUERY)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  function close(returnFocus = true) {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    surfaceRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (surfaceRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function onMenuKeyDown(event: React.KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const walkable = [
      ...(surfaceRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    ]
    if (walkable.length === 0) return
    const current = walkable.indexOf(document.activeElement as HTMLElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    walkable[(current + step + walkable.length) % walkable.length]?.focus()
  }

  /*
   * Every item that cannot be chosen says why, and says it to everybody.
   *
   * The reason is a real element the item is described by, not a `title`: a
   * tooltip is invisible to a touch screen, which has no hover, and a greyed
   * control with no explanation is the failure this application already fixed
   * once for Suggest title. On the sheet the same words are simply shown,
   * because there is room and the person is looking straight at them.
   *
   * It sits OUTSIDE the button. Inside, its text joins the item's accessible
   * name, and "Improve wording" becomes "Improve wording Write something in
   * Heart first…" — which is how the control would then be announced and
   * searched for.
   */
  const renderedItems = items.map((item, index) => {
    const reasonId = `${menuId}-reason-${index}`
    return (
      <div className={styles.itemRow} role="none" key={item.label}>
        <button
          type="button"
          role="menuitem"
          className={`${styles.item} ${item.danger ? styles.danger : ''}`}
          disabled={Boolean(item.reason)}
          title={narrow ? undefined : (item.reason ?? undefined)}
          aria-describedby={item.reason ? reasonId : undefined}
          onClick={() => {
            close(false)
            item.onSelect()
          }}
        >
          {item.icon}
          {item.label}
        </button>
        {item.reason ? (
          <span className={narrow ? styles.reason : 'sr-only'} id={reasonId}>
            {item.reason}
          </span>
        ) : null}
      </div>
    )
  })

  return (
    <span className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        data-busy={busy ? 'true' : 'false'}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {trigger}
      </button>

      {open && !narrow ? (
        <div
          ref={surfaceRef}
          id={menuId}
          role="menu"
          aria-label={label}
          className={styles.popover}
          onKeyDown={onMenuKeyDown}
        >
          {renderedItems}
        </div>
      ) : null}

      {open && narrow ? (
        <div className={styles.scrim} onClick={() => close()}>
          <div
            ref={surfaceRef}
            id={menuId}
            role="menu"
            aria-label={label}
            className={styles.sheet}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={onMenuKeyDown}
          >
            <span className={styles.handle} aria-hidden="true" />
            <p className={styles.sheetTitle}>{label}</p>
            {renderedItems}
            <button type="button" className={`btn btn-ghost btn-sm ${styles.close}`} onClick={() => close()}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </span>
  )
}
