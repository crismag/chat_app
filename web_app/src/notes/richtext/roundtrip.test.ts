/*
 * A note's Markdown, through the rich-text document and back.
 *
 * This is the property that matters most: a note nobody has touched in rich
 * mode must not change the moment somebody opens it there and switches back.
 * `markdownToDoc` and `docToMarkdown` are tested here as a pair rather than
 * separately, because a bug that is exactly undone by the other direction is
 * invisible to either half alone and would still corrupt a note that visited
 * rich mode twice.
 */
import { describe, expect, test } from 'vitest'
import { markdownToDoc } from './toDoc.ts'
import { docToMarkdown } from './toMarkdown.ts'

function roundTrip(markdown: string): string {
  return docToMarkdown(markdownToDoc(markdown))
}

describe('plain text and single marks', () => {
  test('a bare sentence is unchanged', () => {
    expect(roundTrip('Milk, eggs, bread')).toBe('Milk, eggs, bread')
  })

  test('bold, italic, underline and code each round-trip', () => {
    expect(roundTrip('**bold**')).toBe('**bold**')
    expect(roundTrip('*italic*')).toBe('*italic*')
    expect(roundTrip('++underline++')).toBe('++underline++')
    expect(roundTrip('`code`')).toBe('`code`')
  })

  test('a mark in the middle of a sentence keeps its surroundings', () => {
    expect(roundTrip('Buy **milk** today')).toBe('Buy **milk** today')
  })
})

describe('combined and nested marks', () => {
  test('two marks on the same run survive together', () => {
    expect(roundTrip('**++both++**')).toBe('**++both++**')
  })

  test('marks nest in a fixed order regardless of how they were typed', () => {
    /*
     * The source nests underline outside bold; `MARK_ORDER` puts bold
     * outside underline. The output following the fixed order rather than
     * the source's is what proves the order is enforced, not merely
     * preserved on input that already happened to match it.
     */
    expect(roundTrip('++**text**++')).toBe('**++text++**')
  })

  test('a mark that opens partway through a bold run reopens correctly', () => {
    expect(roundTrip('**bold and *italic* mixed**')).toBe('**bold and *italic* mixed**')
  })
})

describe('lists', () => {
  test('a bulleted list', () => {
    const markdown = '- Milk\n- Eggs\n- Bread'
    expect(roundTrip(markdown)).toBe(markdown)
  })

  test('a numbered list renumbers from one, as any editor would', () => {
    expect(roundTrip('5. Wash\n6. Dry\n7. Fold')).toBe('1. Wash\n2. Dry\n3. Fold')
  })

  test('a task list keeps which items are ticked', () => {
    const markdown = '- [ ] Call the plumber\n- [x] Pay the invoice'
    expect(roundTrip(markdown)).toBe(markdown)
  })

  test('formatting survives inside a list item', () => {
    expect(roundTrip('- **Urgent**: call back')).toBe('- **Urgent**: call back')
  })
})

describe('headings and quotes', () => {
  test('level 1 and level 2 headings round-trip', () => {
    expect(roundTrip('# Groceries')).toBe('# Groceries')
    expect(roundTrip('## This week')).toBe('## This week')
  })

  test('a quote, including a multi-line one', () => {
    const markdown = '> Line one\n> Line two'
    expect(roundTrip(markdown)).toBe(markdown)
  })
})

describe('paragraphs and blank lines', () => {
  test('a line break inside one paragraph is kept as a break, not a new paragraph', () => {
    const markdown = 'First line\nSecond line'
    expect(roundTrip(markdown)).toBe(markdown)
  })

  test('two paragraphs stay two paragraphs, not merged into one', () => {
    const markdown = 'First paragraph.\n\nSecond paragraph.'
    expect(roundTrip(markdown)).toBe(markdown)
    /*
     * The failure this guards against: joining blocks with a single '\n'
     * instead of a blank line would make `toBlocks` read this back as ONE
     * paragraph of two lines, silently merging what were two distinct ones
     * every time a note passed through rich mode.
     */
    const blocksAfterOneJoin = markdown.split('\n\n').join('\n')
    expect(blocksAfterOneJoin).not.toBe(roundTrip(markdown))
  })

  test('a whole note with several block types together', () => {
    const markdown = [
      '# Sunday plan',
      '',
      'Bring **snacks** and the *good* speaker.',
      '',
      '- [ ] Charge the speaker',
      '- [x] Buy snacks',
      '',
      '> Arrive by nine.',
    ].join('\n')
    expect(roundTrip(markdown)).toBe(markdown)
  })
})

describe('an empty note', () => {
  test('produces a document with one empty paragraph, not an error', () => {
    const doc = markdownToDoc('')
    expect(doc).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
  })

  test('and serializes back to an empty note', () => {
    expect(docToMarkdown(markdownToDoc(''))).toBe('')
  })
})

describe('idempotence', () => {
  test('a second trip through changes nothing further', () => {
    const once = roundTrip('# Plan\n\n**Bring** the *good* speaker.\n\n- [ ] Charge it')
    const twice = roundTrip(once)
    expect(twice).toBe(once)
  })
})
