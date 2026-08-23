import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { TAG_SUGGEST_LIMIT, canonicalHashtag } from '@chat/shared'
import { api } from '../shared/api/client.ts'
import styles from './TagInput.module.css'

/*
 * The tags field, with suggestions.
 *
 * It is still one text input holding a comma-separated line, because that is
 * what it was and what the reflection stores. What is new is that the word
 * being typed — the part after the last comma — is looked up, and at most five
 * existing tags are offered under it.
 *
 * ── Why the suggestions are for the last word only ──────────────────────────
 *
 * Somebody types `prayer, fast`. The query is `fast`, not the whole line.
 * Choosing a suggestion replaces that last fragment and leaves everything
 * before it exactly as they typed it, which is the difference between a hint
 * and an autocorrect.
 *
 * ── Why so little happens per keystroke ─────────────────────────────────────
 *
 * A 200 ms debounce, one request in flight, and an AbortController on the
 * previous one. Without the last of those, a fast typist gets answers out of
 * order and the list ends up showing suggestions for a prefix they have already
 * moved past — which looks like a bug in the ranking and is not.
 *
 * ── Mobile ──────────────────────────────────────────────────────────────────
 *
 * Five is the maximum the server will return, and five short rows is a hint
 * rather than a panel. The list is anchored under the field, scrolls rather
 * than growing, and closes on Escape, on blur and on a chosen suggestion.
 */

const DEBOUNCE_MS = 200

type Suggestion = { tag: string; label: string }

/** The fragment being typed: everything after the last separator. */
export function activeFragment(value: string): string {
  const parts = value.split(',')
  return (parts[parts.length - 1] ?? '').trim()
}

/** Put a chosen suggestion where the fragment was, and leave the rest alone. */
export function replaceFragment(value: string, chosen: string): string {
  const parts = value.split(',')
  parts[parts.length - 1] = ` ${chosen}`
  return `${parts.join(',').trimStart()}, `
}

export function TagInput({
  value,
  onChange,
  onCommit,
  onCancel,
  error,
  onDismissError,
  className,
}: {
  value: string
  onChange: (next: string) => void
  /** Enter or blur: the caller saves. */
  onCommit: () => void
  onCancel: () => void
  /** The refusal sentence, when the last save refused a tag. */
  error?: string | null
  onDismissError?: () => void
  className?: string
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listId = useId()
  const inFlight = useRef<AbortController | null>(null)
  /*
   * Set while a suggestion is being chosen. A press on the list blurs the
   * input, and blur commits — without this the save happens before the chosen
   * word has been put into the field, so it saves the fragment instead.
   */
  const choosing = useRef(false)

  const fragment = canonicalHashtag(activeFragment(value))

  useEffect(() => {
    if (!fragment) {
      setSuggestions([])
      setOpen(false)
      return
    }
    const timer = setTimeout(() => {
      inFlight.current?.abort()
      const controller = new AbortController()
      inFlight.current = controller
      api<{ suggestions: Suggestion[] }>(
        `/tags/suggest?q=${encodeURIComponent(fragment)}&limit=${TAG_SUGGEST_LIMIT}`,
        { signal: controller.signal },
      )
        .then((found) => {
          if (controller.signal.aborted) return
          setSuggestions(found.suggestions)
          setActive(-1)
          setOpen(found.suggestions.length > 0)
        })
        /*
         * A failed lookup is not an error anybody needs to see. The field still
         * works: suggestions are a convenience, and typing a new tag was always
         * the other half of this control.
         */
        .catch(() => {
          if (!controller.signal.aborted) setSuggestions([])
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [fragment])

  useEffect(() => () => inFlight.current?.abort(), [])

  const choose = useCallback(
    (suggestion: Suggestion) => {
      onChange(replaceFragment(value, suggestion.label))
      setSuggestions([])
      setOpen(false)
      setActive(-1)
      choosing.current = false
    },
    [onChange, value],
  )

  return (
    <div className={styles.field}>
      <input
        className={className}
        value={value}
        placeholder="Tags"
        aria-label="Tags"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(event) => {
          onDismissError?.()
          onChange(event.target.value)
        }}
        onBlur={() => {
          if (choosing.current) return
          setOpen(false)
          onCommit()
        }}
        onKeyDown={(event) => {
          if (open && suggestions.length > 0) {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActive((at) => (at + 1) % suggestions.length)
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((at) => (at <= 0 ? suggestions.length - 1 : at - 1))
              return
            }
            /* Enter takes the active suggestion, when one has been moved to. */
            if (event.key === 'Enter' && active >= 0) {
              event.preventDefault()
              const chosen = suggestions[active]
              if (chosen) choose(chosen)
              return
            }
            if (event.key === 'Escape') {
              /* First Escape dismisses the list; a second cancels the edit. */
              event.preventDefault()
              setOpen(false)
              return
            }
          }
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') onCancel()
        }}
      />

      {open && suggestions.length > 0 ? (
        <ul className={styles.suggestions} id={listId} role="listbox" aria-label="Tag suggestions">
          {suggestions.map((suggestion, at) => (
            <li key={suggestion.tag} role="none">
              <button
                type="button"
                id={`${listId}-${at}`}
                role="option"
                aria-selected={at === active}
                className={styles.suggestion}
                data-active={at === active}
                /* Before blur, so the choice survives the field losing focus. */
                onMouseDown={() => {
                  choosing.current = true
                }}
                onTouchStart={() => {
                  choosing.current = true
                }}
                onClick={() => choose(suggestion)}
              >
                #{suggestion.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        The refusal. `role="status"` rather than an alert: it is information
        about one tag, not an interruption, and the person is expected to carry
        on typing the others. It says nothing about which rule refused the word.
      */}
      {error ? (
        <p className={styles.error} role="status">
          {error}
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => onDismissError?.()}
            aria-label="Dismiss"
          >
            ×
          </button>
        </p>
      ) : null}
    </div>
  )
}
