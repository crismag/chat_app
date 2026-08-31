/*
 * A note's Markdown, as the document the rich-text editor edits.
 *
 * Built on `toBlocks`, the same block parser `NoteMarkdown.tsx` reads a note
 * with — deliberately, so a note that renders one way on a card renders the
 * same way in the editor that opens it. What this adds is the inline pass:
 * `toBlocks` leaves bold, italic, underline and code as literal text inside
 * each block, exactly as `NoteMarkdown.tsx`'s own `inline()` does, because
 * ticking a task or grouping list items does not require reading them yet.
 *
 * ── Marks stack, they do not nest a second document ─────────────────────────
 *
 * `**bold and *italic* mixed**` is one bold run with a shorter italic run
 * inside it in the *source text*, but ProseMirror represents that as three
 * text nodes in a row — "bold and ", "italic", " mixed" — where the middle
 * one alone carries both marks. `inlineNodes` builds exactly that by carrying
 * the marks collected so far into each recursive call, rather than nesting
 * React elements the way `NoteMarkdown.tsx`'s `inline()` does; the two
 * functions parse the same syntax and disagree only in what shape they hand
 * back, which is the one thing allowed to differ between a reader and an
 * editor for the same text.
 */

import type { JSONContent } from '@tiptap/core'
import { toBlocks, type Block } from '../NoteMarkdown.tsx'

type MarkName = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'link'
type TextMark = { type: MarkName; attrs?: { href: string } }
type TextNode = { type: 'text'; text: string; marks?: TextMark[] }
type HardBreak = { type: 'hardBreak' }
type Inline = TextNode | HardBreak
/** `JSONContent` is what `useEditor({ content })` and `setContent` actually take. */
type DocNode = JSONContent

function inlineNodes(text: string, marks: TextMark[] = []): TextNode[] {
  if (text === '') return []
  const out: TextNode[] = []
  const push = (value: string, extra?: TextMark[]) => {
    if (value === '') return
    out.push(extra?.length ? { type: 'text', text: value, marks: extra } : { type: 'text', text: value })
  }

  /*
   * Local to the call, not module-level. This function recurses — a bold run
   * containing an italic run calls itself on the inner text — and a `g`-flag
   * regex carries its scan position (`lastIndex`) on the pattern object
   * itself, not on the string. Shared at module scope, the inner call's scan
   * would overwrite the outer call's position mid-loop; fresh here, each call
   * gets its own, exactly as `NoteMarkdown.tsx`'s own `inline()` does.
   */
  const pattern =
    /(\*\*(.+?)\*\*|\+\+(.+?)\+\+|~~(.+?)~~|\*(.+?)\*|`([^`]+?)`|\[([^\]]+?)\]\(([^)\s]+)\))/g
  let at = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > at) push(text.slice(at, match.index), marks)
    if (match[2] !== undefined) {
      out.push(...inlineNodes(match[2], [...marks, { type: 'bold' }]))
    } else if (match[3] !== undefined) {
      out.push(...inlineNodes(match[3], [...marks, { type: 'underline' }]))
    } else if (match[4] !== undefined) {
      out.push(...inlineNodes(match[4], [...marks, { type: 'strike' }]))
    } else if (match[5] !== undefined) {
      out.push(...inlineNodes(match[5], [...marks, { type: 'italic' }]))
    } else if (match[6] !== undefined) {
      /* Code is literal: no emphasis is parsed inside it, matching the reader. */
      push(match[6], [...marks, { type: 'code' }])
    } else if (match[7] !== undefined) {
      /* A link's text is literal too, matching the reader — one fewer thing to nest. */
      push(match[7], [...marks, { type: 'link', attrs: { href: match[8] ?? '' } }])
    }
    at = pattern.lastIndex
  }
  if (at < text.length) push(text.slice(at), marks)
  return out
}

function paragraphContent(lines: string[]): Inline[] {
  const content: Inline[] = []
  lines.forEach((line, index) => {
    if (index > 0) content.push({ type: 'hardBreak' })
    content.push(...inlineNodes(line))
  })
  return content
}

function withContent(type: string, content: Inline[], attrs?: Record<string, unknown>): DocNode {
  const node: DocNode = { type, ...(attrs ? { attrs } : {}) }
  if (content.length > 0) node.content = content as DocNode[]
  return node
}

function listItem(text: string): DocNode {
  return { type: 'listItem', content: [withContent('paragraph', inlineNodes(text))] }
}

function blockToNode(block: Block): DocNode {
  if (block.kind === 'heading') {
    return withContent('heading', inlineNodes(block.text), { level: block.level })
  }
  if (block.kind === 'bullets') {
    return { type: 'bulletList', content: block.items.map(listItem) }
  }
  if (block.kind === 'numbers') {
    return { type: 'orderedList', content: block.items.map(listItem) }
  }
  if (block.kind === 'tasks') {
    return {
      type: 'taskList',
      content: block.items.map((item) => ({
        type: 'taskItem',
        attrs: { checked: item.done },
        content: [withContent('paragraph', inlineNodes(item.text))],
      })),
    }
  }
  if (block.kind === 'quote') {
    return {
      type: 'blockquote',
      content: block.lines.map((line) => withContent('paragraph', inlineNodes(line))),
    }
  }
  if (block.kind === 'codeBlock') {
    const attrs = block.lang ? { language: block.lang } : undefined
    const text = block.lines.join('\n')
    const node: DocNode = { type: 'codeBlock', ...(attrs ? { attrs } : {}) }
    if (text.length > 0) node.content = [{ type: 'text', text }]
    return node
  }
  if (block.kind === 'hr') {
    return { type: 'horizontalRule' }
  }
  if (block.kind === 'table') {
    /*
     * No table node exists in this schema (see the header comment) — a table
     * still has to become *something*, so it becomes its own literal source
     * text, as one paragraph. That keeps it lossless: switching back to
     * Markdown mode without touching it in rich mode reproduces the same
     * table, just not through a route that renders it as one here.
     */
    return withContent('paragraph', paragraphContent(tableSourceLines(block)))
  }
  return withContent('paragraph', paragraphContent(block.lines))
}

function tableSourceLines(block: Extract<Block, { kind: 'table' }>): string[] {
  const row = (cells: string[]) => `| ${cells.join(' | ')} |`
  return [
    row(block.header),
    row(block.header.map(() => '---')),
    ...block.rows.map(row),
  ]
}

/** A note's Markdown body, as the JSON document `useEditor({ content })` takes. */
export function markdownToDoc(markdown: string): DocNode {
  const blocks = toBlocks(markdown).map(blockToNode)
  return { type: 'doc', content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }] }
}
