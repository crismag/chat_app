/*
 * The small marks that sit under a field: how far it has got, whose words are
 * in it, and whether it is written down.
 *
 * All three used to be sentences on the face of the card — "Not yet",
 * "Written", "Your words", "Unsaved", and a Save button beside them. Four
 * fields' worth of that is a page of labels around a page of writing, and the
 * writing is the point. Each one is a mark now.
 *
 * Text-free is a visual claim, not an accessibility one. Every mark here keeps
 * a real accessible name, and every mark shows its wording on hover *and* on
 * keyboard focus rather than only to a mouse. Nothing is carried by hue alone
 * either: the traffic light changes shape — hollow, half, solid — because
 * roughly one man in twelve cannot separate its red from its green.
 */

import type { ReactNode } from 'react'
import { CheckIcon, PencilIcon, SparkIcon, AssistedIcon } from '../shared/ui/icons.tsx'
import { ORIGIN_CLASSES, ORIGIN_LABELS } from './sections.ts'
import styles from './ChatPage.module.css'

/**
 * A mark with its wording attached.
 *
 * The tooltip is `aria-hidden` on purpose: the control it wraps carries the
 * same sentence as its accessible name, and a description repeating the name
 * makes a screen reader say everything twice. This is the visual half — and it
 * opens on `:focus-within` as well as `:hover`, so a keyboard reaches it.
 */
function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className={styles.hint}>
      {children}
      <span className={styles.hintText} aria-hidden="true">
        {text}
      </span>
    </span>
  )
}

/** Where a field has got to. Three states, three shapes, three colours. */
export type FieldStatus = 'empty' | 'long' | 'written'

const STATUS_GLYPHS: Record<FieldStatus, ReactNode> = {
  /* Hollow: nothing in it yet. */
  empty: <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />,
  /* Half: written, and past the length this format suggests. */
  long: (
    <>
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 1.5a6.5 6.5 0 0 0 0 13z" fill="currentColor" />
    </>
  ),
  /* Solid, with a check cut out of it: written, and within its length. */
  written: (
    <>
      <circle cx="8" cy="8" r="6.5" fill="currentColor" />
      <path
        d="m5.2 8.3 2 2.1 3.6-4"
        fill="none"
        stroke="var(--surface)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
}

/**
 * The traffic light.
 *
 * It also names its section, which is what makes dropping the C/H/A/T heading
 * safe: the section's name is one focus or one hover away rather than printed
 * on the card forever.
 */
export function StatusLight({ name, status }: { name: string; status: FieldStatus }) {
  const label = {
    empty: `${name} — nothing written yet`,
    long: `${name} — written, and longer than suggested`,
    written: `${name} — written`,
  }[status]

  return (
    <Hint text={label}>
      <span
        className={styles.mark}
        data-status={status}
        role="img"
        aria-label={label}
        /* Focusable so the wording is reachable without a pointer. */
        tabIndex={0}
      >
        <svg className={styles.markGlyph} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          {STATUS_GLYPHS[status]}
        </svg>
      </span>
    </Hint>
  )
}

/**
 * Whose words these are.
 *
 * The claim itself is unchanged — the data model records it and the interface
 * still states it. It is a hand, a hand with a spark, or a spark, in the three
 * provenance colours, with the sentence kept for anything reading the page
 * rather than looking at it.
 */
export function OriginMark({ origin }: { origin: string }) {
  const label = ORIGIN_LABELS[origin] ?? origin
  const Icon =
    origin === 'user' ? PencilIcon : origin === 'ai_assisted' ? AssistedIcon : SparkIcon

  return (
    <Hint text={label}>
      <span
        className={`badge ${ORIGIN_CLASSES[origin] ?? 'badge-user'} ${styles.mark} ${styles.originMark}`}
        role="img"
        aria-label={label}
        tabIndex={0}
      >
        <Icon className={styles.markGlyph} />
        {/* Kept in the DOM so what the page says can still be read back. */}
        <span className="sr-only">{label}</span>
      </span>
    </Hint>
  )
}

/**
 * One control where a status and a button used to sit.
 *
 * Pressed means written down. It stays enabled when there is nothing to save,
 * because a toggle that reports a state has to be reachable in both states —
 * and saving nothing costs nothing.
 */
export function SaveToggle({
  name,
  dirty,
  onSave,
}: {
  name: string
  dirty: boolean
  onSave: () => void
}) {
  const label = dirty ? `Save ${name} — unsaved changes` : `${name} is saved`

  return (
    <Hint text={label}>
      <button
        type="button"
        className={styles.mark}
        data-save={dirty ? 'dirty' : 'saved'}
        aria-pressed={!dirty}
        aria-label={label}
        onClick={onSave}
      >
        {dirty ? (
          <svg
            className={styles.markGlyph}
            viewBox="0 0 16 16"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="8" cy="8" r="4" fill="currentColor" />
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        ) : (
          <CheckIcon className={styles.markGlyph} />
        )}
      </button>
    </Hint>
  )
}
