import type { ReactNode, RefObject } from 'react'
import { BulletListIcon, TaskListIcon } from './icons.tsx'
import { UNDERLINE, toggleBullets, toggleTasks, wrapSelection, type Edit } from './format.ts'
import styles from './FormatBar.module.css'

/*
 * The formatting buttons above a note.
 *
 * ── Why they edit text rather than a document ───────────────────────────────
 *
 * Each button reads what is in the textarea and the caret positions, computes
 * the new text with a pure function from `format.ts`, and puts the caret back
 * where the function said it should go. There is no editor model, no
 * contenteditable and no second representation of the note that could drift
 * from the one being saved: what is in the box is the note.
 *
 * The caret restoration is the part that has to be right. Setting the value
 * without it drops the caret to the end, so pressing Bold in the middle of a
 * paragraph would move somebody to the bottom of their note — and they would
 * only notice after typing the next word in the wrong place.
 *
 * ── Why the shortcuts are here and not on the textarea ──────────────────────
 *
 * They are the same three actions, so defining them anywhere else would mean
 * two answers to what Ctrl-B does. `formatShortcut` is the keydown handler the
 * textarea carries, and it calls `runFormat` exactly as the buttons do.
 */

export type FormatAction = 'bold' | 'italic' | 'underline' | 'bullets' | 'tasks'

function applyAction(text: string, start: number, end: number, action: FormatAction): Edit {
  if (action === 'bold') return wrapSelection(text, start, end, '**')
  if (action === 'italic') return wrapSelection(text, start, end, '*')
  if (action === 'underline') return wrapSelection(text, start, end, UNDERLINE)
  if (action === 'tasks') return toggleTasks(text, start, end)
  return toggleBullets(text, start, end)
}

/**
 * Run one action against the live textarea and hand back the new text.
 *
 * Exported because the keyboard shortcuts and the buttons must do the same
 * thing, including where they leave the caret.
 */
export function runFormat(
  field: HTMLTextAreaElement | null,
  action: FormatAction,
  onChange: (next: string) => void,
): void {
  if (!field) return
  const edit = applyAction(field.value, field.selectionStart, field.selectionEnd, action)
  onChange(edit.text)
  /*
   * After React has written the new value. Setting selection before that is
   * setting it on the old string, which the re-render then discards.
   */
  requestAnimationFrame(() => {
    field.focus()
    field.setSelectionRange(edit.start, edit.end)
  })
}

/*
 * B, I and U are letters on purpose — they are the letters, styled as what they
 * do, which is what every editor has used for forty years. The two list buttons
 * are drawn icons rather than `•` and `☑`: a glyph takes its size and weight
 * from the font, and `☑` arrives as a colour emoji that ignores the theme.
 */
const BUTTONS: { action: FormatAction; label: string; hint: string; mark: ReactNode }[] = [
  { action: 'bold', label: 'Bold', hint: 'Bold (Ctrl+B)', mark: <span aria-hidden="true">B</span> },
  {
    action: 'italic',
    label: 'Italic',
    hint: 'Italic (Ctrl+I)',
    mark: <span aria-hidden="true">I</span>,
  },
  {
    action: 'underline',
    label: 'Underline',
    hint: 'Underline (Ctrl+U)',
    mark: <span aria-hidden="true">U</span>,
  },
  {
    action: 'bullets',
    label: 'Bulleted list',
    hint: 'Bulleted list',
    mark: <BulletListIcon className={styles.icon} />,
  },
  {
    action: 'tasks',
    label: 'Task list',
    hint: 'Task list',
    mark: <TaskListIcon className={styles.icon} />,
  },
]

export function FormatBar({
  field,
  onChange,
  preview,
  onTogglePreview,
  onSwitchToRichText,
}: {
  field: RefObject<HTMLTextAreaElement | null>
  onChange: (next: string) => void
  preview: boolean
  onTogglePreview: () => void
  /** Back to the default surface. Absent only in tests exercising this bar alone. */
  onSwitchToRichText?: () => void
}) {
  return (
    <div className={styles.bar} role="toolbar" aria-label="Formatting">
      <div className={styles.group}>
        {BUTTONS.map(({ action, label, hint, mark }) => (
          <button
            key={action}
            type="button"
            className={styles.button}
            data-action={action}
            aria-label={label}
            title={hint}
            disabled={preview}
            /*
             * Before focus leaves the textarea, so the selection the action is
             * about still exists. On click it would already be gone.
             */
            onMouseDown={(event) => {
              event.preventDefault()
              runFormat(field.current, action, onChange)
            }}
          >
            {mark}
          </button>
        ))}
      </div>

      {/*
        Preview is where task lists can be ticked. It is a toggle rather than a
        second pane because a note is written on a phone as often as not, and
        two columns at that width is one column of each, too narrow to use.
      */}
      <div className={styles.trailing}>
        <button
          type="button"
          className={styles.preview}
          aria-pressed={preview}
          onClick={onTogglePreview}
        >
          {preview ? 'Edit' : 'Preview'}
        </button>

        {/*
          The way back to the default surface. Markdown mode is for somebody
          who asked for it — typing raw syntax on purpose, or somebody who
          already knows it — so the way out is a press away rather than a
          setting to go and find.
        */}
        {onSwitchToRichText ? (
          <button type="button" className={styles.mode} onClick={onSwitchToRichText}>
            Rich text
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** Ctrl/Cmd-B, I and U, defined once, in terms of the same actions. */
export function formatShortcut(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  onChange: (next: string) => void,
): void {
  if (!event.ctrlKey && !event.metaKey) return
  const action: FormatAction | null =
    event.key === 'b' || event.key === 'B'
      ? 'bold'
      : event.key === 'i' || event.key === 'I'
        ? 'italic'
        : event.key === 'u' || event.key === 'U'
          ? 'underline'
          : null
  if (!action) return
  event.preventDefault()
  runFormat(event.currentTarget, action, onChange)
}
