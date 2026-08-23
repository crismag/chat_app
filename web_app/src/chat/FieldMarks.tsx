/*
 * The small marks that sit under a field: how far it has got, whose words are
 * in it, and whether it is written down.
 *
 * All of these used to be sentences on the face of the card — "Not yet",
 * "Written", "Your words", "Unsaved", and a Save button beside them. Four
 * fields' worth of that is a page of labels around a page of writing, and the
 * writing is the point. Each one became a mark; then the marks that reported
 * nothing went too.
 *
 * The traffic light was one of those. "This field is empty" and "this field
 * has writing in it" are both plainly visible in the field itself, so a circle
 * saying so was a second opinion on something nobody had asked about. What is
 * left is one mark: whether there is anything unsaved.
 *
 * The provenance mark went too, and for a different reason than clutter. How
 * somebody arrived at their own words is theirs — a reader has no use for it,
 * and a writer has every reason not to be labelled by it. What is still
 * labelled is a suggestion *before* it is accepted, which is not the same
 * thing: that text is not theirs yet, and saying so is what makes taking it a
 * choice rather than a default.
 *
 * Text-free is a visual claim, not an accessibility one. Every mark here keeps
 * a real accessible name, and every mark shows its wording on hover *and* on
 * keyboard focus rather than only to a mouse.
 */

import type { ReactNode } from 'react'
import { CheckIcon, SaveIcon } from '../shared/ui/icons.tsx'
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
        {/*
          Two states, and only one of them is a control worth finding.
          Unsaved says "press me and this is kept"; saved is a tick that
          confirms and then gets out of the way, which is why it stays quiet
          while the other does not.
        */}
        {dirty ? (
          <SaveIcon className={styles.markGlyph} />
        ) : (
          <CheckIcon className={styles.markGlyph} />
        )}
      </button>
    </Hint>
  )
}
