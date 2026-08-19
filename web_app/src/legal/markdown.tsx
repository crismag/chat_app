import type { ReactNode } from 'react'

/*
 * A renderer for the legal documents, and nothing else.
 *
 * It handles exactly the syntax those four files use — headings, paragraphs,
 * unordered lists, blockquotes, horizontal rules, and inline bold, italic and
 * code. They contain no links, images, tables, code fences or ordered lists,
 * which is what makes a purpose-built renderer reasonable instead of a
 * dependency: adding one would mean a package, a licence, and an entry in the
 * third-party notices for a closed set of markup we control.
 *
 * It returns React elements rather than HTML. There is no
 * `dangerouslySetInnerHTML` anywhere in it, so this cannot become an injection
 * route if it is ever pointed at something a person wrote.
 */

/** Marks a hard line break through the block stage without inventing syntax. */
const BREAK = '\u0000br\u0000'

type Block =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'rule' }

/*
 * A backslash-escaped character stands for itself.
 *
 * The documents use `\*` three times, in the joke about a policy growing an
 * asterisk and a footnote. Without this the escape prints as a backslash and
 * the surrounding emphasis parses around it, which turns the punchline into
 * stray syntax. Held as a marker through the emphasis pass and restored after.
 */
const ESCAPED = '\u0001'

function protectEscapes(text: string): string {
  return text.replace(/\\([*_`\\])/g, (_, char: string) => `${ESCAPED}${char.charCodeAt(0)};`)
}

function restoreEscapes(text: string): string {
  return text.replace(/\u0001(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
}

/** Split `**bold**`, `*italic*` and `` `code` `` out of one line. */
/** Turn the break marker into <br /> once emphasis has already been matched. */
function withBreaks(text: string, key: string): ReactNode[] {
  const parts = restoreEscapes(text).split(BREAK)
  return parts.flatMap((part, i) => [
    part,
    ...(i < parts.length - 1 ? [<br key={`${key}-br${i}`} />] : []),
  ])
}

/*
 * Emphasis is matched across the whole paragraph, breaks and all, and only
 * then split. The other way round — splitting on breaks first — leaves bold
 * that opens on one line and closes six lines later showing its asterisks,
 * which is exactly what the Data Deletion page does.
 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const source = protectEscapes(text)
  const out: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let last = 0
  let match: RegExpExecArray | null
  let index = 0
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > last) out.push(...withBreaks(source.slice(last, match.index), `${keyPrefix}-t${index}`))
    const token = match[0]
    const key = `${keyPrefix}-${index}`
    index += 1
    if (token.startsWith('**')) out.push(<strong key={key}>{withBreaks(token.slice(2, -2), key)}</strong>)
    else if (token.startsWith('`')) out.push(<code key={key}>{restoreEscapes(token.slice(1, -1))}</code>)
    else out.push(<em key={key}>{withBreaks(token.slice(1, -1), key)}</em>)
    last = match.index + token.length
  }
  if (last < source.length) out.push(...withBreaks(source.slice(last), `${keyPrefix}-end`))
  return out
}

function toBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  const lines = markdown.split('\n')
  let paragraph: string[] = []
  let list: string[] = []
  let quote: string[] = []

  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ').replaceAll(`${BREAK} `, BREAK) })
    if (list.length) blocks.push({ kind: 'list', items: [...list] })
    /* Parsed rather than pushed as lines: these documents put `### ` headings
     * inside blockquotes, and a quote that only understands text renders the
     * hashes. */
    if (quote.length) blocks.push({ kind: 'quote', blocks: toBlocks(quote.join('\n')) })
    paragraph = []
    list = []
    quote = []
  }

  for (const raw of lines) {
    /* Two trailing spaces is a hard break in markdown, and these documents
     * lean on it: contact blocks and the short stacked statements at the top
     * of each file read as one run-on sentence without it. Marked here and
     * turned into a <br /> at render, rather than dropped with the rest of the
     * trailing whitespace. */
    const hardBreak = /  $/.test(raw)
    const line = raw.replace(/\s+$/, '') + (hardBreak ? BREAK : '')
    if (line.trim() === '') { flush(); continue }
    if (/^---+$/.test(line.trim())) { flush(); blocks.push({ kind: 'rule' }); continue }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      /* Everything below the document title reads as a section, and anything
       * deeper than one level of subsection is flattened rather than shrunk
       * into illegibility. */
      const level = heading[1]!.length <= 2 ? 2 : 3
      blocks.push({ kind: 'heading', level: level as 2 | 3, text: heading[2]!.trim() })
      continue
    }
    if (line.startsWith('> ') || line === '>') {
      if (paragraph.length || list.length) flush()
      quote.push(line.replace(/^>\s?/, ''))
      continue
    }
    if (/^[-*]\s+/.test(line)) {
      if (paragraph.length || quote.length) flush()
      list.push(line.replace(/^[-*]\s+/, ''))
      continue
    }
    if (list.length || quote.length) flush()
    paragraph.push(line.trim())
  }
  flush()
  return blocks
}

function render(blocks: Block[], prefix: string): ReactNode {
  return (
    <>
      {blocks.map((block, i) => {
        const key = `${prefix}b${i}`
        switch (block.kind) {
          case 'rule':
            return <hr key={key} />
          case 'heading':
            return block.level === 2
              ? <h2 key={key}>{inline(block.text, key)}</h2>
              : <h3 key={key}>{inline(block.text, key)}</h3>
          case 'list':
            return (
              <ul key={key}>
                {block.items.map((item, j) => <li key={`${key}-${j}`}>{inline(item, `${key}-${j}`)}</li>)}
              </ul>
            )
          case 'quote':
            return <blockquote key={key}>{render(block.blocks, key)}</blockquote>
          default:
            return <p key={key}>{inline(block.text, key)}</p>
        }
      })}
    </>
  )
}

export function Markdown({ markdown }: { markdown: string }) {
  return render(toBlocks(markdown), '')
}

export interface ParsedDocument {
  /** The `# ` title, so the page and the document cannot disagree. */
  title: string
  /** The date the document states, rather than one kept beside it. */
  updated: string
  body: string
  /**
   * Square-bracket placeholders still in the text — an operator's legal name,
   * a contact address, a governing jurisdiction. Their presence is what tells
   * the page it is not finished; nobody has to remember to flip a flag.
   */
  placeholders: string[]
}

export function parseDocument(markdown: string): ParsedDocument {
  const lines = markdown.split('\n')
  let title = ''
  let updated = ''
  let start = 0

  for (let i = 0; i < lines.length && i < 8; i += 1) {
    const line = lines[i]!.trim()
    if (!title) {
      const heading = /^#\s+(.*)$/.exec(line)
      if (heading) { title = heading[1]!.trim(); start = i + 1; continue }
    }
    const stamp = /^\*\*Last updated:\s*(.+?)\*\*$/i.exec(line)
    if (stamp) { updated = stamp[1]!.trim(); start = i + 1 }
  }

  const body = lines.slice(start).join('\n').replace(/^\s*(---\s*)?\n/, '')
  const placeholders = [...markdown.matchAll(/\[([^\]\n]{3,80})\]/g)].map((m) => m[1]!)
  return { title, updated, body, placeholders: [...new Set(placeholders)] }
}
