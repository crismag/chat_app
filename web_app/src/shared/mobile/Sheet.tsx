import { useEffect, useId, useRef, type ReactNode } from 'react'
import { NARROW_QUERY, useMediaQuery } from '../ui/useMediaQuery.ts'
import styles from './Sheet.module.css'

/*
 * A panel of content that comes up from the bottom of a phone.
 *
 * `ActionMenu` already covers a *list of actions* in both shapes. This is the
 * other half: filters, assistance, share destinations, view settings — things
 * with fields and prose in them rather than menu items. Keeping them separate
 * means neither has to grow a mode flag, and a caller picks by what it has.
 *
 * The things that make it a dialog rather than a div are not decoration:
 *
 *   **Focus goes in and comes back.** It moves inside on open and returns to
 *   whatever opened it on close, so a keyboard or a screen reader is never
 *   left at the top of the page wondering where the sheet went.
 *
 *   **Escape, the scrim, and the back gesture all close it.** Back especially:
 *   on a phone that is what people reach for, and a sheet that ignores it
 *   sends them to the previous screen instead of closing.
 *
 *   **It scrolls inside itself.** A tall sheet on a short screen is capped and
 *   scrolls its own body, rather than growing past the top of the window and
 *   taking its own heading with it.
 *
 * Above the width where this application stops being a phone it becomes a
 * centred dialog — the same line `ActionMenu` uses, so a person never meets a
 * sheet on one control and a popover on the next.
 */

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  /** Names the dialog. Every sheet says what it is. */
  title: string
  description?: string
  children: ReactNode
  /** Pinned below the scrolling body — Reset, Done, and the like. */
  footer?: ReactNode
}) {
  const narrow = useMediaQuery(NARROW_QUERY)
  const surface = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  /* Remembered before focus moves anywhere, so it can be given back. */
  useEffect(() => {
    if (open) opener.current = document.activeElement as HTMLElement | null
  }, [open])

  useEffect(() => {
    if (!open) return

    const panel = surface.current
    const firstStop = panel?.querySelector<HTMLElement>(FOCUSABLE)
    if (firstStop) firstStop.focus()
    else panel?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      /*
       * Tab is kept inside. Without this the next Tab lands on the page behind
       * the scrim — visibly nowhere, since the scrim covers it.
       */
      const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (node) => node.offsetParent !== null,
      )
      const first = stops[0]
      const last = stops[stops.length - 1]
      if (!first || !last) return
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
    }

    /*
     * One history entry, so the back gesture closes the sheet rather than
     * leaving the screen. Closing any other way pops that entry again, so
     * history cannot silently accumulate one dead entry per sheet opened —
     * which is how a Back button becomes a button that appears to do nothing.
     */
    window.history.pushState({ sheet: true }, '')
    const onPop = () => onClose()

    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('popstate', onPop)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('popstate', onPop)
      if (window.history.state?.sheet) window.history.back()
      opener.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className={styles.root} data-shape={narrow ? 'sheet' : 'dialog'}>
      <button
        type="button"
        className={styles.scrim}
        aria-label="Close"
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        ref={surface}
        className={styles.surface}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className={styles.head}>
          {/* Decoration; the heading is what is announced. */}
          <span className={styles.grip} aria-hidden="true" />
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className={styles.description}>
              {description}
            </p>
          ) : null}
        </div>
        <div className={styles.body}>{children}</div>
        {footer ? <div className={styles.foot}>{footer}</div> : null}
      </div>
    </div>
  )
}
