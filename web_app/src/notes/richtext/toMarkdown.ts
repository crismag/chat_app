/*
 * The rich-text editor's document, back to the Markdown a note is stored as.
 *
 * The inverse of `toDoc.ts`, and the reason that file's comment about marks
 * stacking rather than nesting matters here too: this has to turn a run of
 * text nodes — some with one mark, some with two — back into correctly
 * *nested* wrapping syntax, because that is the only representation Markdown
 * has. `**bold and *italic* mixed**`, not three separate wrapped runs.
 *
 * ── Why marks close and open in one fixed order ──────────────────────────────
 *
 * Markdown syntax nests: `**a *b* c**` is bold containing italic, and there is
 * no way to write "these two marks, in no particular order" — one has to be
 * outside the other. `MARK_ORDER` is that decision, made once: bold outermost,
 * then underline, then italic. A run's wrapping is entirely determined by
 * which of its marks are new since the previous run and which have ended, so
 * the same three marks on adjacent runs always close and reopen at the same
 * points, and the result always parses back through `toDoc.ts` correctly —
 * the property every round-trip test in this pair of files exists to prove.
 *
 * Code is not part of that stack. `NoteMarkdown.tsx`'s reader never parses
 * emphasis inside `` `code` ``, so a code-marked run here is never combined
 * with another mark either — whatever else was open closes first.
 */

import type { JSONContent } from '@tiptap/core'

type MarkName = 'bold' | 'underline' | 'strike' | 'italic'
/** `JSONContent` is what `editor.getJSON()` actually returns. */
type DocNode = JSONContent

const MARK_ORDER: MarkName[] = ['bold', 'underline', 'strike', 'italic']
const MARK_SYNTAX: Record<MarkName, string> = {
  bold: '**',
  underline: '++',
  strike: '~~',
  italic: '*',
}

/** Every text/hardBreak run inside one block, as the line(s) of Markdown it is. */
function inlineMarkdown(nodes: DocNode[] | undefined): string {
  if (!nodes || nodes.length === 0) return ''
  let out = ''
  const active: MarkName[] = []

  const closeTo = (depth: number) => {
    while (active.length > depth) out += MARK_SYNTAX[active.pop() as MarkName]
  }

  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      closeTo(0)
      out += '\n'
      continue
    }
    if (node.type !== 'text' || !node.text) continue

    const names = new Set((node.marks ?? []).map((mark) => mark.type))
    if (names.has('code')) {
      closeTo(0)
      out += `\`${node.text}\``
      continue
    }
    if (names.has('link')) {
      closeTo(0)
      const link = node.marks?.find((mark) => mark.type === 'link')
      const href = typeof link?.attrs?.['href'] === 'string' ? link.attrs['href'] : ''
      out += `[${node.text}](${href})`
      continue
    }

    const wanted = MARK_ORDER.filter((name) => names.has(name))
    let common = 0
    while (common < active.length && common < wanted.length && active[common] === wanted[common]) {
      common += 1
    }
    closeTo(common)
    for (const name of wanted.slice(common)) {
      out += MARK_SYNTAX[name]
      active.push(name)
    }
    out += node.text
  }
  closeTo(0)
  return out
}

function listBlock(node: DocNode, bullet: (index: number) => string): string {
  return (node.content ?? [])
    .map((item, index) => `${bullet(index)}${inlineMarkdown(item.content?.[0]?.content)}`)
    .join('\n')
}

/** One top-level node — a heading, a list, a quote, a paragraph — as Markdown. */
function blockMarkdown(node: DocNode): string {
  if (node.type === 'heading') {
    const level = typeof node.attrs?.['level'] === 'number' ? node.attrs['level'] : 1
    return `${'#'.repeat(level)} ${inlineMarkdown(node.content)}`
  }
  if (node.type === 'bulletList') {
    return listBlock(node, () => '- ')
  }
  if (node.type === 'orderedList') {
    return listBlock(node, (index) => `${index + 1}. `)
  }
  if (node.type === 'taskList') {
    return (node.content ?? [])
      .map((item) => {
        const checked = item.attrs?.['checked'] === true
        return `- [${checked ? 'x' : ' '}] ${inlineMarkdown(item.content?.[0]?.content)}`
      })
      .join('\n')
  }
  if (node.type === 'blockquote') {
    return (node.content ?? []).map((paragraph) => `> ${inlineMarkdown(paragraph.content)}`).join('\n')
  }
  if (node.type === 'codeBlock') {
    const lang = typeof node.attrs?.['language'] === 'string' ? node.attrs['language'] : ''
    const text = (node.content ?? []).map((child) => child.text ?? '').join('')
    return ['```' + lang, text, '```'].join('\n')
  }
  if (node.type === 'horizontalRule') {
    return '---'
  }
  /* A paragraph, including an empty one — hitting Enter twice is real content. */
  return inlineMarkdown(node.content)
}

/**
 * A blank line between every top-level block.
 *
 * `toBlocks` (see `NoteMarkdown.tsx`) treats one blank line and several the
 * same way — any number collapses to the same block boundary — so an editor
 * built on it never has to count exactly how many a person had. It only has
 * to separate blocks *at all*, which a single blank line already does.
 */
export function docToMarkdown(doc: DocNode): string {
  return (doc.content ?? []).map(blockMarkdown).join('\n\n')
}
