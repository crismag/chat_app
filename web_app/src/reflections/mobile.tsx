import { forwardRef, useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { BackIcon, CloseIcon, PlusIcon, SearchIcon } from '../shared/ui/icons.tsx'
import styles from './mobile.module.css'

/*
 * The phone's chrome for Reflections: the app bar's contents, and the one
 * floating action.
 *
 * Kept beside the page rather than in `shared/` because one screen needs it so
 * far. When Community wants the same search bar it can move, and it will move
 * knowing what two callers actually needed rather than what one caller might.
 */

/**
 * Search, which takes over the whole bar rather than adding a row under it.
 *
 * A second row costs 56px on every screen where nobody is searching. Taking
 * the bar over costs nothing when closed, and while open the title is not
 * information anybody needs — they can see what they are looking at.
 */
export function MobileSearchBar({
  value,
  onChange,
  onClear,
  onClose,
}: {
  value: string
  onChange: (next: string) => void
  onClear: () => void
  onClose: () => void
}) {
  const field = useRef<HTMLInputElement>(null)

  /* Focus goes into the field on open, so the keyboard comes up with it. */
  useEffect(() => {
    field.current?.focus()
  }, [])

  return (
    <div className={styles.searchBar}>
      <button type="button" className={styles.barButton} aria-label="Close search" onClick={onClose}>
        <BackIcon className={styles.barIcon} />
      </button>
      <label className="sr-only" htmlFor="reflections-search">
        Search reflections
      </label>
      <input
        ref={field}
        id="reflections-search"
        type="search"
        className={styles.searchField}
        value={value}
        placeholder="Search reflections"
        /* The browser's own clear affordance is suppressed; ours is a real target. */
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button
          type="button"
          className={styles.barButton}
          aria-label="Clear search"
          /*
           * Clearing empties the query and drops it from the address, and
           * leaves search open with the field still focused — clearing is a
           * step in searching, not the end of it.
           */
          onClick={() => {
            onClear()
            field.current?.focus()
          }}
        >
          <CloseIcon className={styles.barIcon} />
        </button>
      ) : null}
    </div>
  )
}

/** An icon button for the app bar, with its 44px reach and optional count. */
export const BarAction = forwardRef<
  HTMLButtonElement,
  { label: string; onClick: () => void; count?: number; children: ReactNode }
>(function BarAction({ label, onClick, count, children }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={styles.barButton}
      aria-label={label}
      onClick={onClick}
    >
      {children}
      {count && count > 0 ? (
        <span className={styles.badge} aria-hidden="true">
          {count}
        </span>
      ) : null}
    </button>
  )
})

/*
 * The search trigger, which takes focus back when it returns.
 *
 * Focusing it from the close handler did not work, and the contract check said
 * so: this button does not exist at the moment search closes — it is rendered
 * by the app bar being re-described afterwards — so the page was left with
 * focus on `<body>`. Mounting is the exact moment it exists, so mounting is
 * when it claims focus, and only when it is coming back from search rather
 * than appearing for the first time.
 */
export function SearchAction({
  onClick,
  takeFocus = false,
}: {
  onClick: () => void
  takeFocus?: boolean
}) {
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (takeFocus) button.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <BarAction ref={button} label="Search reflections" onClick={onClick}>
      <SearchIcon className={styles.barIcon} />
    </BarAction>
  )
}

/**
 * Start writing, from anywhere in the list.
 *
 * Extended rather than a bare circle: a `+` alone asks the reader to guess,
 * and the guess costs a screen change to check. It clears the bottom
 * navigation and the home indicator, and the timeline reserves matching room
 * underneath so it can never be the thing covering the last card's actions.
 */
export function NewReflectionFab() {
  return (
    <Link to="/?new=1" className={styles.fab}>
      <PlusIcon className={styles.fabIcon} />
      <span>New reflection</span>
    </Link>
  )
}
