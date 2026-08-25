import type { Editor } from '@tiptap/react'
import { BulletListIcon, TaskListIcon } from './icons.tsx'
import styles from './FormatBar.module.css'

/*
 * The same five buttons `FormatBar` offers in Markdown mode, wired to a live
 * editor instead of a textarea and a pure function.
 *
 * Two toolbars rather than one branching on mode, because the thing a button
 * *is* differs by mode in a way a shared component would have to know about
 * either way: in Markdown mode a button computes the next string from text
 * and a caret; here it asks the editor to toggle a mark or a list and the
 * editor decides the rest, including where the caret ends up. Sharing the
 * five entries — the actions, the labels, the icons — would mean sharing
 * almost nothing, since what each one *does* is the part that differs.
 */
export function RichToolbar({
  editor,
  onSwitchToMarkdown,
}: {
  editor: Editor | null
  onSwitchToMarkdown: () => void
}) {
  return (
    <div className={styles.bar} role="toolbar" aria-label="Formatting">
      <div className={styles.group}>
        <button
          type="button"
          className={styles.button}
          data-action="bold"
          aria-label="Bold"
          aria-pressed={editor?.isActive('bold') ?? false}
          title="Bold (Ctrl+B)"
          disabled={!editor}
          onMouseDown={(event) => {
            event.preventDefault()
            editor?.chain().focus().toggleBold().run()
          }}
        >
          <span aria-hidden="true">B</span>
        </button>
        <button
          type="button"
          className={styles.button}
          data-action="italic"
          aria-label="Italic"
          aria-pressed={editor?.isActive('italic') ?? false}
          title="Italic (Ctrl+I)"
          disabled={!editor}
          onMouseDown={(event) => {
            event.preventDefault()
            editor?.chain().focus().toggleItalic().run()
          }}
        >
          <span aria-hidden="true">I</span>
        </button>
        <button
          type="button"
          className={styles.button}
          data-action="underline"
          aria-label="Underline"
          aria-pressed={editor?.isActive('underline') ?? false}
          title="Underline (Ctrl+U)"
          disabled={!editor}
          onMouseDown={(event) => {
            event.preventDefault()
            editor?.chain().focus().toggleUnderline().run()
          }}
        >
          <span aria-hidden="true">U</span>
        </button>
        <button
          type="button"
          className={styles.button}
          data-action="bullets"
          aria-label="Bulleted list"
          aria-pressed={editor?.isActive('bulletList') ?? false}
          title="Bulleted list"
          disabled={!editor}
          onMouseDown={(event) => {
            event.preventDefault()
            editor?.chain().focus().toggleBulletList().run()
          }}
        >
          <BulletListIcon className={styles.icon} />
        </button>
        <button
          type="button"
          className={styles.button}
          data-action="tasks"
          aria-label="Task list"
          aria-pressed={editor?.isActive('taskList') ?? false}
          title="Task list"
          disabled={!editor}
          onMouseDown={(event) => {
            event.preventDefault()
            editor?.chain().focus().toggleTaskList().run()
          }}
        >
          <TaskListIcon className={styles.icon} />
        </button>
      </div>

      <div className={styles.trailing}>
        {/*
          Markdown is the option, not the default — offered here rather than
          hidden in a settings sheet, for whoever already knows the syntax
          and would rather type it directly.
        */}
        <button type="button" className={styles.mode} onClick={onSwitchToMarkdown}>
          Markdown
        </button>
      </div>
    </div>
  )
}
