import { expect, test } from 'vitest'
import { previewFor, stripReferencePrefix } from './preview.ts'

const full = {
  content: 'John 3:16 (NIV) — For God so loved the world that he gave his one and only Son.',
  heart: 'I had stopped hearing it. Today the word “gave” stopped me.',
  application: 'I will read it slowly each morning.',
  testimony: 'He kept me awake for this one.',
}
const wrap = (s: Record<string, string>) =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { content: v }]))

test('the author’s own words come before the passage they pasted', () => {
  expect(previewFor(wrap(full), 'full', 'John 3:16')).toBe(
    'I had stopped hearing it. Today the word “gave” stopped me.',
  )
})

test('the order falls through Heart, then Application, then Testimony', () => {
  const { heart: _heart, ...noHeart } = full
  expect(previewFor(wrap(noHeart), 'full', 'John 3:16')).toBe('I will read it slowly each morning.')
  expect(previewFor(wrap({ content: full.content, testimony: full.testimony }), 'full', 'John 3:16')).toBe(
    'He kept me awake for this one.',
  )
})

test('Content is the fallback, with the reference the card already shows removed', () => {
  expect(previewFor(wrap({ content: full.content }), 'full', 'John 3:16')).toBe(
    'For God so loved the world that he gave his one and only Son.',
  )
})

test('a Short reflection previews its Reflection field, not its Verse', () => {
  const condensed = wrap({
    verse: 'Micah 6:8 (NIV) — Act justly, love mercy.',
    reflection: 'Mercy is the one I withhold from everyone else.',
  })
  expect(previewFor(condensed, 'condensed', 'Micah 6:8')).toBe(
    'Mercy is the one I withhold from everyone else.',
  )
})

test('nothing written is an empty preview rather than a guess', () => {
  expect(previewFor(wrap({}), 'full', 'John 3:16')).toBe('')
  expect(previewFor(undefined, 'full', 'John 3:16')).toBe('')
})

/* --- the strip, which must be conservative ------------------------------- */

test('a reference is only removed when it is used as a prefix', () => {
  /* A real pasted passage: removed. */
  expect(stripReferencePrefix('John 3:16 (NIV) — For God so loved', 'John 3:16')).toBe(
    'For God so loved',
  )
  expect(stripReferencePrefix('John 3:16 - For God so loved', 'John 3:16')).toBe('For God so loved')
  expect(stripReferencePrefix('John 3:16 NIV: For God so loved', 'John 3:16')).toBe(
    'For God so loved',
  )
  /* Prose that merely starts with the reference: kept whole. */
  expect(stripReferencePrefix('John 3:16 is the verse I keep returning to', 'John 3:16')).toBe(
    'John 3:16 is the verse I keep returning to',
  )
})

test('stripping never empties the preview', () => {
  expect(stripReferencePrefix('John 3:16 —', 'John 3:16')).toBe('John 3:16 —')
})

test('no reference means nothing to strip', () => {
  expect(stripReferencePrefix('For God so loved', null)).toBe('For God so loved')
})
