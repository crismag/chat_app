import { expect, test } from 'vitest'
import { formatClusterTime, formatListTime, shouldShowClusterTime } from './time.ts'

const now = new Date('2026-08-24T15:00:00')

test('a list row from today is a clock time, not a full date', () => {
  const date = new Date('2026-08-24T14:05:00')
  expect(formatListTime(date.toISOString(), now)).toBe(
    date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  )
})

test('a list row from earlier this week is a weekday', () => {
  const date = new Date('2026-08-22T10:00:00')
  expect(formatListTime(date.toISOString(), now)).toBe(
    date.toLocaleDateString(undefined, { weekday: 'short' }),
  )
})

test('older list rows keep a short date', () => {
  const date = new Date('2026-07-02T10:00:00')
  expect(formatListTime(date.toISOString(), now)).toBe(
    date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  )
})

test('a pause of five minutes or more gets a cluster stamp', () => {
  expect(shouldShowClusterTime('2026-08-24T15:00:00', '2026-08-24T14:54:59')).toBe(true)
  expect(shouldShowClusterTime('2026-08-24T15:00:00', '2026-08-24T14:55:01')).toBe(false)
})

test('the first message in a log always has a stamp', () => {
  expect(shouldShowClusterTime('2026-08-24T15:00:00', undefined)).toBe(true)
})

test('a cluster stamp on another day keeps the weekday and the time', () => {
  const date = new Date('2026-08-22T10:05:00')
  const weekday = date.toLocaleDateString(undefined, { weekday: 'short' })
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  expect(formatClusterTime(date.toISOString(), now)).toBe(`${weekday} ${time}`)
})
