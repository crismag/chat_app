import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { richTextExtensions } from './richtext/schema.ts'
import { markdownToDoc } from './richtext/toDoc.ts'
import { docToMarkdown } from './richtext/toMarkdown.ts'
import { RichToolbar } from './RichToolbar.tsx'
import styles from './RichTextEditor.module.css'

/*
 * A note, edited as what it looks like rather than as the Markdown that
 * stores it. The toolbar and the editable surface live together here rather
 * than as two components `NoteEditor` wires up separately, because both need
 * the same live `editor` instance and there is nothing else either one does
 * that the other needs to know about.
 *
 * `value`/`onChange` are Markdown in and Markdown out — the same contract
 * the plain textarea in Markdown mode already has, so `NoteEditor` saves
 * this exactly the way it saves that: one string, on the same debounce, to
 * the same field. Nothing downstream of this component has to know a rich
 * text editor exists.
 *
 * ── Why content is only reset by `noteId`, not by `value` ───────────────────
 *
 * `onUpdate` fires `onChange` with newly-serialized Markdown on every
 * keystroke, which flows back here as a new `value` prop — and if that were
 * fed back into `setContent`, every keystroke would replace the document
 * that keystroke had just produced, one render behind itself, and the caret
 * would jump to the start on every character. `noteId` changing is the one
 * signal that means "this is a different note, throw the document away and
 * parse the new one" rather than "the document you already have just
 * changed a little."
 */
export function RichTextEditor({
  noteId,
  value,
  onChange,
  placeholder,
  onSwitchToMarkdown,
}: {
  noteId: string
  value: string
  onChange: (markdown: string) => void
  placeholder?: string
  onSwitchToMarkdown: () => void
}) {
  const editor = useEditor({
    extensions: richTextExtensions(placeholder ?? ''),
    content: markdownToDoc(value),
    editorProps: {
      attributes: {
        class: styles.content ?? '',
        'aria-label': 'Note',
      },
    },
    onUpdate: ({ editor: current }) => {
      onChange(docToMarkdown(current.getJSON()))
    },
  })

  useEffect(() => {
    if (!editor) return
    editor.commands.setContent(markdownToDoc(value))
    // Only `noteId` and `editor` — see the note above on why `value` is not here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, editor])

  return (
    <div className={styles.wrap}>
      <RichToolbar editor={editor} onSwitchToMarkdown={onSwitchToMarkdown} />
      <div className={styles.scroll}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
