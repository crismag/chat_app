import type { ReactNode } from 'react'
import styles from './NoteMarkdown.module.css'

/*
 * A note, rendered.
 *
 * Separate from the legal renderer in `legal/markdown.tsx` on purpose. That one
 * exists for four files this project writes and is explicit that it handles
 * their syntax and nothing else; this one handles what people type into notes,
 * which is a different and less predictable set — task lists above all, which
 * no legal document will ever contain.
 *
 * The property both share, and the one that matters: **it returns React
 * elements.** There is no `dangerouslySetInnerHTML` here, so a note's body can
 * never become markup the browser is asked to trust, however it was written or
 * wherever it was pasted from.
 *
 * ── What is supported ───────────────────────────────────────────────────────
 *
 *   # and ##       headings
 *   -              bulleted list
 *   - [ ] / - [x]  task list, tickable
 *   1.             numbered list
 *   >              quote
 *   ```            fenced code block
 *   ---            horizontal rule
 *   | a | b |      table (GFM: header row, then a --- delimiter row)
 *   **bold**  *italic*  ++underline++  ~~strike~~  `code`  [text](url)
 *
 * Underline is `++`, because Markdown has none: `__x__` is bold in every
 * flavour, and quietly redefining it would mean somebody's bold turns into
 * underline the day they paste a note in from elsewhere.
 *
 * A table has no counterpart in rich text mode — see `richtext/toDoc.ts` for
 * what happens to one there — so it is the one thing here that is markdown-
 * mode-only by design rather than an oversight.
 */

type Inline = { text: string; key: string }

/**
 * A `javascript:`/`data:`/`vbscript:` URL is the one thing a link's `href`
 * must never become — that would make typing a note a way to run script in
 * whoever reads it. Everything else (`https:`, `mailto:`, a bare relative
 * path) is passed through unchanged.
 */
function isSafeHref(url: string): boolean {
  return !/^\s*(javascript|data|vbscript):/i.test(url)
}

/** Split one line into text and emphasis, innermost last so nesting works. */
function inline({ text, key }: Inline): ReactNode[] {
  const out: ReactNode[] = []
  /*
   * One pass, one expression. Alternation ordered longest-first so `**` is
   * matched as bold before `*` can match it as italic — the other order leaves
   * bold rendering as an italic asterisk on each side.
   */
  const pattern =
    /(\*\*(.+?)\*\*|\+\+(.+?)\+\+|~~(.+?)~~|\*(.+?)\*|`([^`]+?)`|\[([^\]]+?)\]\(([^)\s]+)\))/g
  let at = 0
  let match: RegExpExecArray | null
  let n = 0

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > at) out.push(text.slice(at, match.index))
    const id = `${key}-i${n}`
    n += 1
    if (match[2] !== undefined) {
      out.push(<strong key={id}>{inline({ text: match[2], key: id })}</strong>)
    } else if (match[3] !== undefined) {
      out.push(
        <u key={id} className={styles.underline}>
          {inline({ text: match[3], key: id })}
        </u>,
      )
    } else if (match[4] !== undefined) {
      out.push(<s key={id}>{inline({ text: match[4], key: id })}</s>)
    } else if (match[5] !== undefined) {
      out.push(<em key={id}>{inline({ text: match[5], key: id })}</em>)
    } else if (match[6] !== undefined) {
      /* Code is literal: no emphasis is parsed inside it. */
      out.push(<code key={id}>{match[6]}</code>)
    } else if (match[7] !== undefined) {
      const url = match[8] ?? ''
      /* Link text is literal too, matching code — one fewer thing that can nest wrongly. */
      out.push(
        isSafeHref(url) ? (
          <a key={id} href={url} target="_blank" rel="noreferrer noopener">
            {match[7]}
          </a>
        ) : (
          match[7]
        ),
      )
    }
    at = pattern.lastIndex
  }

  if (at < text.length) out.push(text.slice(at))
  return out
}

export type Block =
  | { kind: 'heading'; level: 1 | 2; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbers'; items: string[] }
  | { kind: 'tasks'; items: { text: string; done: boolean; index: number }[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'codeBlock'; lang: string; lines: string[] }
  | { kind: 'hr' }
  | { kind: 'table'; header: string[]; rows: string[][] }

const TASK = /^\s*- \[([ xX])\] ?(.*)$/
const BULLET = /^\s*[-*] (?!\[[ xX]\] )(.*)$/
const NUMBER = /^\s*\d+[.)] (.*)$/
const HEADING = /^(#{1,2}) +(.*)$/
const QUOTE = /^> ?(.*)$/
const FENCE = /^```(\S*)\s*$/
const HR = /^ {0,3}([-*_])(?: *\1){2,} *$/

/** A row of a GFM table: any line containing at least one `|`. */
function isTableRow(line: string): boolean {
  return line.includes('|') && line.trim() !== ''
}

/** The `| --- | :--: |` line under a table's header — cells of dashes only. */
function isTableDelimiter(line: string): boolean {
  const cells = line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.trim()))
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/**
 * Group lines into blocks.
 *
 * Task lines are numbered here, by their position among *all* task lines in
 * the note, and that number travels to the checkbox. `toggleTaskAt` counts the
 * same way, so pressing the third checkbox toggles the third task however many
 * paragraphs, headings or blank lines sit between them.
 *
 * An index rather than a `for...of`, because a fenced code block and a table
 * are the two shapes here that are not one line each — both need to look past
 * the current line to know where they end, which a single pass over one line
 * at a time cannot do.
 */
export function toBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  const lines = markdown.split('\n')
  let taskIndex = 0
  let i = 0

  while (i < lines.length) {
    const raw = lines[i] ?? ''
    const line = raw.replace(/\s+$/, '')
    const last = blocks.at(-1)

    const fence = line.match(FENCE)
    if (fence) {
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !FENCE.test((lines[i] ?? '').replace(/\s+$/, ''))) {
        codeLines.push(lines[i] ?? '')
        i += 1
      }
      if (i < lines.length) i += 1 /* consume the closing fence */
      blocks.push({ kind: 'codeBlock', lang: fence[1] ?? '', lines: codeLines })
      continue
    }

    if (line.trim() === '') {
      /* A blank line ends whatever was open; it never becomes a block. */
      if (last) blocks.push({ kind: 'paragraph', lines: [] })
      i += 1
      continue
    }

    const nextLine = lines[i + 1]
    if (isTableRow(line) && nextLine !== undefined && isTableDelimiter(nextLine)) {
      const header = tableCells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow((lines[i] ?? '').replace(/\s+$/, ''))) {
        rows.push(tableCells(lines[i] ?? ''))
        i += 1
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    if (HR.test(line)) {
      blocks.push({ kind: 'hr' })
      i += 1
      continue
    }

    const task = line.match(TASK)
    if (task) {
      const item = { text: task[2] ?? '', done: (task[1] ?? ' ') !== ' ', index: taskIndex }
      taskIndex += 1
      if (last?.kind === 'tasks') last.items.push(item)
      else blocks.push({ kind: 'tasks', items: [item] })
      i += 1
      continue
    }

    const bullet = line.match(BULLET)
    if (bullet) {
      if (last?.kind === 'bullets') last.items.push(bullet[1] ?? '')
      else blocks.push({ kind: 'bullets', items: [bullet[1] ?? ''] })
      i += 1
      continue
    }

    const numbered = line.match(NUMBER)
    if (numbered) {
      if (last?.kind === 'numbers') last.items.push(numbered[1] ?? '')
      else blocks.push({ kind: 'numbers', items: [numbered[1] ?? ''] })
      i += 1
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length === 1 ? 1 : 2,
        text: heading[2] ?? '',
      })
      i += 1
      continue
    }

    const quote = line.match(QUOTE)
    if (quote) {
      if (last?.kind === 'quote') last.lines.push(quote[1] ?? '')
      else blocks.push({ kind: 'quote', lines: [quote[1] ?? ''] })
      i += 1
      continue
    }

    if (last?.kind === 'paragraph' && last.lines.length > 0) last.lines.push(line)
    else blocks.push({ kind: 'paragraph', lines: [line] })
    i += 1
  }

  return blocks.filter((block) => block.kind !== 'paragraph' || block.lines.length > 0)
}

export function NoteMarkdown({
  markdown,
  onToggleTask,
}: {
  markdown: string
  /**
   * Tick or untick the nth task. Absent where a note is being shown rather
   * than worked on — a preview whose checkboxes move is a preview that lies
   * about what pressing things does.
   */
  onToggleTask?: (index: number) => void
}) {
  const blocks = toBlocks(markdown)
  if (blocks.length === 0) {
    return <p className={styles.empty}>Nothing written yet.</p>
  }

  return (
    <div className={styles.note}>
      {blocks.map((block, at) => {
        const key = `b${at}`
        if (block.kind === 'heading') {
          const Tag = block.level === 1 ? 'h3' : 'h4'
          /*
           * h3/h4, not h1/h2. The page around this already owns the top of the
           * outline, and a note whose first line is `# Shopping` must not
           * introduce a second document heading into it.
           */
          return (
            <Tag className={styles.heading} key={key}>
              {inline({ text: block.text, key })}
            </Tag>
          )
        }
        if (block.kind === 'bullets') {
          return (
            <ul className={styles.bullets} key={key}>
              {block.items.map((item, i) => (
                <li key={`${key}-${i}`}>{inline({ text: item, key: `${key}-${i}` })}</li>
              ))}
            </ul>
          )
        }
        if (block.kind === 'numbers') {
          return (
            <ol className={styles.numbers} key={key}>
              {block.items.map((item, i) => (
                <li key={`${key}-${i}`}>{inline({ text: item, key: `${key}-${i}` })}</li>
              ))}
            </ol>
          )
        }
        if (block.kind === 'tasks') {
          return (
            <ul className={styles.tasks} key={key}>
              {block.items.map((item) => (
                <li className={styles.task} key={`${key}-t${item.index}`}>
                  <label className={styles.taskLabel}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={item.done}
                      disabled={!onToggleTask}
                      onChange={() => onToggleTask?.(item.index)}
                    />
                    {/*
                      Struck through *and* dimmed. Strike-through alone is a
                      colour-free signal but a weak one at small sizes, and the
                      pair is what makes a finished item obviously finished in
                      every one of the themes.
                    */}
                    <span className={styles.taskText} data-done={item.done ? 'true' : 'false'}>
                      {inline({ text: item.text, key: `${key}-t${item.index}` })}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )
        }
        if (block.kind === 'quote') {
          return (
            <blockquote className={styles.quote} key={key}>
              {block.lines.map((line, i) => (
                <p key={`${key}-${i}`}>{inline({ text: line, key: `${key}-${i}` })}</p>
              ))}
            </blockquote>
          )
        }
        if (block.kind === 'codeBlock') {
          /* Literal, like inline code: no emphasis is parsed inside a code block either. */
          return (
            <pre className={styles.codeBlock} key={key}>
              <code>{block.lines.join('\n')}</code>
            </pre>
          )
        }
        if (block.kind === 'hr') {
          return <hr className={styles.hr} key={key} />
        }
        if (block.kind === 'table') {
          return (
            <table className={styles.table} key={key}>
              <thead>
                <tr>
                  {block.header.map((cell, i) => (
                    <th key={`${key}-h${i}`}>{inline({ text: cell, key: `${key}-h${i}` })}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, ri) => (
                  <tr key={`${key}-r${ri}`}>
                    {row.map((cell, ci) => (
                      <td key={`${key}-r${ri}-c${ci}`}>
                        {inline({ text: cell, key: `${key}-r${ri}-c${ci}` })}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
        return (
          <p className={styles.paragraph} key={key}>
            {block.lines.map((line, i) => (
              <span key={`${key}-${i}`}>
                {inline({ text: line, key: `${key}-${i}` })}
                {i < block.lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}
