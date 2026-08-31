/*
 * The live editor, not just `toDoc`/`toMarkdown` in isolation. Those two are
 * proven correct as a pair by `richtext/roundtrip.test.ts`; what this checks
 * is the piece they can't — that `schema.ts` actually wires the matching
 * Tiptap extensions in, so a note opens showing the same thing the converter
 * says it should rather than erroring or silently dropping content.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, test, expect } from 'vitest'
import { RichTextEditor } from './RichTextEditor.tsx'

afterEach(cleanup)

test('a note with strike, code block, hr and a link opens correctly in rich text', () => {
  const markdown = [
    '~~done~~',
    '',
    '```js',
    'const x = 1',
    '```',
    '',
    '---',
    '',
    '[site](https://example.com)',
  ].join('\n')
  const { container } = render(
    <RichTextEditor noteId="n1" value={markdown} onChange={() => {}} onSwitchToMarkdown={() => {}} />,
  )
  expect(container.querySelector('s')?.textContent).toBe('done')
  expect(container.querySelector('pre code')?.textContent).toBe('const x = 1')
  expect(container.querySelector('hr')).not.toBeNull()
  expect(container.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
})

test('a note with a table opens without crashing, table shown as literal text', () => {
  const markdown = '| Name | Qty |\n| --- | --- |\n| Milk | 2 |'
  const { container } = render(
    <RichTextEditor noteId="n1" value={markdown} onChange={() => {}} onSwitchToMarkdown={() => {}} />,
  )
  expect(container.querySelector('table')).toBeNull()
  expect(container.textContent).toContain('Milk')
})
