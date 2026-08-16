/*
 * Choosing a Bible from about fifty of them.
 *
 * Its own component because it has its own job, its own keyboard contract and
 * its own tests, and because the passage card was getting long enough that the
 * picker's behaviour was hiding inside it.
 *
 * ── What it must never do ───────────────────────────────────────────────────
 *
 * Show a translation the key cannot reach, or change the selection on its own.
 * Everything it renders came from the catalog the server returned, and the
 * value that leaves is always a NUMERIC ID — never an abbreviation. The
 * abbreviation is a label: the provider calls the New International Version
 * `NIV11`, there is no translation whose abbreviation is `NIV`, and code that
 * routes on that string selects the wrong Bible. That mistake has been made
 * once in this feature already; it does not get made in the browser too.
 *
 * ── Why every row shows a language ──────────────────────────────────────────
 *
 * `NVI` is a real abbreviation in Spanish and another in Portuguese, and they
 * are different Bibles. `CCB` is Chinese while the Cebuano Bible is `APD`. A
 * list of bare abbreviations makes those indistinguishable, and picking wrong
 * means reading a Bible in a language you may not speak.
 *
 * ── Keyboard ────────────────────────────────────────────────────────────────
 *
 * Arrows move, Home and End jump, Enter chooses, Escape closes. `aria-activedescendant`
 * rather than roving focus, so the caret stays in the search box while the
 * active row moves — which is what lets somebody type, refine and choose without
 * their hands leaving the keys. Nothing here depends on hover: the active row is
 * marked with an attribute the stylesheet reads, so a touch user and a keyboard
 * user see the same marker.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { BibleTranslation } from '@chat/shared'
import { searchTranslations } from './search.ts'
import styles from './ScripturePassage.module.css'

export interface TranslationPickerProps {
  translations: BibleTranslation[]
  value: number | null
  onChange: (id: number) => void
  /** Ids this person has used before, most recent first. */
  recentIds?: number[]
  /** The label the input is described by. */
  label?: string
}

/**
 * The short list offered before anybody searches.
 *
 * Deliberately small. Fifty rows is a catalog; five is a suggestion, and a
 * picker that opens onto a suggestion is faster to use than one that opens onto
 * an inventory. Everything else is one keystroke or one click away.
 */
const RECOMMENDED_LIMIT = 5

interface Row {
  translation: BibleTranslation
  /** Which group it appears under, for the heading above it. */
  group: string
}

export function TranslationPicker({
  translations,
  value,
  onChange,
  recentIds = [],
  label = 'Translation',
}: TranslationPickerProps) {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const domId = useId()
  const inputId = `${domId}-input`
  const listId = `${domId}-list`
  const listRef = useRef<HTMLUListElement | null>(null)

  const selected = useMemo(
    () => translations.find((entry) => entry.id === value) ?? null,
    [translations, value],
  )

  /**
   * What to show, grouped when idle and flat when searching.
   *
   * Searching flattens on purpose: once somebody has typed, the ranking IS the
   * order, and slicing it into "recent" and "recommended" would push the best
   * match below a heading it does not belong under.
   */
  const rows = useMemo<Row[]>(() => {
    if (query.trim()) {
      return searchTranslations(translations, query).map((hit) => ({
        translation: hit.translation,
        group: 'Results',
      }))
    }

    const seen = new Set<number>()
    const out: Row[] = []

    const push = (translation: BibleTranslation, group: string) => {
      if (seen.has(translation.id)) return
      seen.add(translation.id)
      out.push({ translation, group })
    }

    /* The one in use, first — so the list opens on the answer to "what am I
     * reading?" rather than making somebody hunt for it. */
    if (selected) push(selected, 'Current')

    for (const id of recentIds) {
      const found = translations.find((entry) => entry.id === id)
      if (found) push(found, 'Recent')
    }

    for (const translation of translations.slice(0, RECOMMENDED_LIMIT)) {
      push(translation, 'Recommended')
    }

    if (showAll) {
      for (const translation of translations) push(translation, 'All translations')
    }

    return out
  }, [translations, query, selected, recentIds, showAll])

  /* A changed result set means the old active row points at the wrong thing. */
  useEffect(() => {
    setActiveIndex(0)
  }, [query, showAll])

  /* Keep the active row in view when the arrows walk past the fold. */
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const active = list.querySelector('[data-active="true"]')
    if (active instanceof HTMLElement) active.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const move = (delta: number) => {
    if (rows.length === 0) return
    setActiveIndex((current) => {
      const next = current + delta
      if (next < 0) return rows.length - 1
      if (next >= rows.length) return 0
      return next
    })
  }

  const choose = (index: number) => {
    const row = rows[index]
    if (!row) return
    onChange(row.translation.id)
    /*
     * The query is cleared on selection. Leaving it would mean the list stays
     * filtered to one row and the next person to open the picker sees a search
     * they did not perform — which is the state that makes a picker feel stuck.
     */
    setQuery('')
  }

  const hidden = !query.trim() && !showAll ? translations.length - rows.length : 0

  return (
    <div className={styles.picker}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>

      <input
        id={inputId}
        className={styles.input}
        type="text"
        value={query}
        autoComplete="off"
        /*
         * The placeholder carries the current selection, so the field can stay
         * empty and ready to type into while still answering "which one is
         * chosen?". A field pre-filled with the selection would have to be
         * cleared before every search.
         */
        placeholder={
          selected ? `${selected.abbreviation} — ${selected.name}` : 'Search by name, code or language'
        }
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={rows[activeIndex] ? `${domId}-option-${rows[activeIndex].translation.id}` : undefined}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            move(1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            move(-1)
          } else if (event.key === 'Home') {
            event.preventDefault()
            setActiveIndex(0)
          } else if (event.key === 'End') {
            event.preventDefault()
            setActiveIndex(Math.max(0, rows.length - 1))
          } else if (event.key === 'Enter') {
            /*
             * The picker sits inside the passage form, so Enter here must not
             * submit it — choosing a translation and loading a passage are two
             * different decisions and one keystroke must not make both.
             */
            event.preventDefault()
            choose(activeIndex)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setQuery('')
          }
        }}
      />

      <span className={styles.hint} id={`${domId}-hint`}>
        Search by abbreviation, name, language or language code — “NIV”, “Reina
        Valera”, “Tagalog”, “tl”.
      </span>

      {/*
        The count, announced rather than only drawn. Somebody typing with a
        screen reader has to be told the list changed underneath them, and
        `aria-live="polite"` says it without interrupting their typing.
      */}
      <p
        className={styles.searchStatus}
        role="status"
        aria-live="polite"
        aria-label="Translation search results"
      >
        {query.trim()
          ? rows.length === 0
            ? 'No translation matches that.'
            : `${rows.length} translation${rows.length === 1 ? '' : 's'} match`
          : ''}
      </p>

      <ul className={styles.options} id={listId} role="listbox" aria-label="Translations" ref={listRef}>
        {rows.map((row, index) => {
          const previous = rows[index - 1]
          const startsGroup = !previous || previous.group !== row.group
          return (
            <li key={`${row.group}-${row.translation.id}`} className={styles.optionWrap}>
              {startsGroup && !query.trim() ? (
                /* `presentation`, so the heading is not walked as an option. */
                <span className={styles.groupHeading} role="presentation">
                  {row.group}
                </span>
              ) : null}
              <div
                id={`${domId}-option-${row.translation.id}`}
                role="option"
                aria-selected={row.translation.id === value}
                data-active={index === activeIndex ? 'true' : undefined}
                data-selected={row.translation.id === value ? 'true' : undefined}
                className={styles.option}
                /* Pointer AND touch reach the same handler; nothing here needs
                 * a hover to become usable. */
                onClick={() => choose(index)}
                onMouseMove={() => setActiveIndex(index)}
              >
                <span className={styles.optionAbbreviation}>{row.translation.abbreviation}</span>
                <span className={styles.optionName}>{row.translation.name}</span>
                <span className={styles.optionLanguage}>{row.translation.languageName}</span>
              </div>
            </li>
          )
        })}

        {/*
          No empty-state row here on purpose. The status line above already
          says "No translation matches that" and is announced; saying it twice
          made a screen reader read the same sentence twice and gave the tests
          two elements where the interface has one message.
        */}
      </ul>

      {hidden > 0 ? (
        <button
          type="button"
          className={styles.showAll}
          onClick={() => setShowAll(true)}
          aria-controls={listId}
        >
          Show all {translations.length} translations
        </button>
      ) : null}
    </div>
  )
}
