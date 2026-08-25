/*
 * The document shape rich-text mode may produce, in one place.
 *
 * It exists because two files have to agree on it and must not drift: this
 * one configures the editor, and `toDoc.ts`/`toMarkdown.ts` convert to and
 * from it. A node or mark either of those does not know about is a note that
 * silently loses content the moment somebody switches modes.
 *
 * ── Why it is smaller than the editor could support ─────────────────────────
 *
 * `@tiptap/starter-kit` ships strikethrough, fenced code blocks and a
 * horizontal rule; none of those exist in `NoteMarkdown.tsx`'s reader, so a
 * note that used them in rich mode would render as something else — or
 * nothing — the moment it was opened in Markdown mode or on a card. Every
 * node and mark enabled here is one `NoteMarkdown.tsx` already reads.
 *
 * Headings are capped at two levels for the same reason `NoteMarkdown.tsx`
 * caps them: `HEADING = /^(#{1,2})/` does not recognise `###`, so a level-3
 * heading typed in rich mode would stop being a heading the moment the note
 * was reopened. Capping what can be *created* here is what keeps that true.
 */

import StarterKit from '@tiptap/starter-kit'
import Heading from '@tiptap/extension-heading'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Placeholder } from '@tiptap/extensions'
import { Mark } from '@tiptap/core'

/*
 * h3/h4, not h1/h2 — the same substitution `NoteMarkdown.tsx` makes and the
 * same reason: the page around a note already owns the top of its own
 * heading outline, and a note whose first line is `# Shopping` must not
 * introduce a second document heading into it. `level` still only ever
 * reaches 1 or 2, so the choice between the two stays exactly what the
 * reader draws.
 */
const NoteHeading = Heading.extend({
  renderHTML({ node, HTMLAttributes }) {
    const tag = node.attrs['level'] === 1 ? 'h3' : 'h4'
    return [tag, HTMLAttributes, 0]
  },
})

/*
 * Underline, by hand.
 *
 * `@tiptap/extension-underline` exists, but pulling it in for one fifteen-line
 * mark is a second package for something with no decisions left to make: the
 * tag is `<u>`, matching `NoteMarkdown.tsx`'s own rendering, and the command
 * name matches the official extension's so nothing else has to know this one
 * is homemade.
 */
export const Underline = Mark.create({
  name: 'underline',
  parseHTML() {
    return [{ tag: 'u' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['u', HTMLAttributes, 0]
  },
  addCommands() {
    return {
      toggleUnderline:
        () =>
        ({ commands }: { commands: { toggleMark: (name: string) => boolean } }) =>
          commands.toggleMark(this.name),
    }
  },
})

/** A fresh list every call — an `Editor` takes ownership of its extensions. */
export function richTextExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      /* Replaced below by `NoteHeading`, which renders h3/h4 instead of h1/h2. */
      heading: false,
      strike: false,
      codeBlock: false,
      horizontalRule: false,
    }),
    NoteHeading.configure({ levels: [1, 2] }),
    Underline,
    TaskList,
    TaskItem.configure({ nested: false }),
    Placeholder.configure({ placeholder }),
  ]
}
