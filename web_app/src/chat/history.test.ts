import { expect, test } from 'vitest'
import { bookInitials, bucketOf, deriveTitle, displayTitle } from './history.ts'

// Local dates throughout: the buckets are about the reader's day, not UTC's.
const now = new Date(2026, 7, 15, 12, 0, 0)
const at = (...parts: [number, number, number, number?]) => new Date(...parts).toISOString()

test('reflections fall into today, this week or earlier', () => {
  expect(bucketOf(at(2026, 7, 15, 1), now)).toBe('Today')
  expect(bucketOf(at(2026, 7, 12, 9), now)).toBe('This week')
  expect(bucketOf(at(2026, 5, 1, 9), now)).toBe('Earlier')
  // A date the API never sends still has to land somewhere sensible.
  expect(bucketOf('not a date', now)).toBe('Earlier')
})

test('a Scripture book survives the 56px rail in two characters', () => {
  expect(bookInitials('Romans 8:28', 'anything')).toBe('RO')
  // The leading number carries as much meaning as the letter after it.
  expect(bookInitials('1 Corinthians 13', 'anything')).toBe('1C')
  expect(bookInitials(null, 'Trusting while I cannot see')).toBe('TR')
  expect(bookInitials(null, '')).toBe('·')
})

test('a reflection named after its own passage is shown as untitled', () => {
  expect(displayTitle('Romans 8:28', 'Romans 8:28')).toBe('Untitled reflection')
  expect(displayTitle('Trusting while I cannot see', 'Romans 8:28')).toBe(
    'Trusting while I cannot see',
  )
  expect(displayTitle('Trusting', null)).toBe('Trusting')
})

test('a temporary title comes from the first sentence written', () => {
  expect(deriveTitle('Romans 8:28 keeps meeting me. I cannot see how.')).toBe(
    'Romans 8:28 keeps meeting me.',
  )
  expect(deriveTitle('  a  short   thought  ')).toBe('a short thought')

  const long = deriveTitle(
    'This is one very long unbroken opening clause that runs well past the limit',
  )
  expect(long.length).toBeLessThanOrEqual(61)
  expect(long.endsWith('…')).toBe(true)
  // It breaks at a word, never mid-word.
  expect(long.slice(0, -1).trim().split(' ').at(-1)).toBe('runs')
})
