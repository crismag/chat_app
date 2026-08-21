import { expect, test } from 'vitest'
import { daysApart, groupByDay, groupLabelFor } from './grouping.ts'

/* A fixed local evening, so "late tonight" and "just after midnight" are testable. */
const now = new Date(2026, 7, 20, 23, 30)
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString()

test('today is the local calendar day, not the last 24 hours', () => {
  /* 22:00 tonight: today, though the UTC date may already have rolled over. */
  expect(groupLabelFor(at(2026, 7, 20, 22), now)).toBe('Today')
  /* 00:30 this morning: still today, and 23 hours ago. */
  expect(groupLabelFor(at(2026, 7, 20, 0), now)).toBe('Today')
})

test('yesterday is the day before, however few hours ago that was', () => {
  /* Written at 23:00, read at 00:30 the next day — 90 minutes, but yesterday. */
  const justAfterMidnight = new Date(2026, 7, 21, 0, 30)
  expect(groupLabelFor(at(2026, 7, 20, 23), justAfterMidnight)).toBe('Yesterday')
  expect(groupLabelFor(at(2026, 7, 19), now)).toBe('Yesterday')
})

test('older reflections group by week, then by month', () => {
  expect(groupLabelFor(at(2026, 7, 17), now)).toBe('Earlier this week')
  expect(groupLabelFor(at(2026, 5, 2), now)).toBe(new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date(2026, 5, 2)))
  const older = new Date(2024, 2, 3)
  expect(groupLabelFor(older.toISOString(), now)).toBe(
    new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(older),
  )
})

test('labels come from the locale rather than from hardcoded English', () => {
  /* Whatever the runtime's locale is, the month group matches Intl exactly. */
  const june = new Date(2026, 5, 2)
  expect(groupLabelFor(june.toISOString(), now)).toBe(
    new Intl.DateTimeFormat(undefined, { month: 'long' }).format(june),
  )
})

test('day distance is counted in calendar days', () => {
  expect(daysApart(new Date(2026, 7, 20, 0, 5), now)).toBe(0)
  expect(daysApart(new Date(2026, 7, 19, 23, 55), now)).toBe(1)
})

test('grouping keeps list order and omits nothing it was given', () => {
  const items = [
    { id: 'a', at: at(2026, 7, 20) },
    { id: 'b', at: at(2026, 7, 20, 9) },
    { id: 'c', at: at(2026, 7, 19) },
  ]
  const groups = groupByDay(items, (item) => item.at, now)
  expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday'])
  expect(groups[0]?.items.map((i) => i.id)).toEqual(['a', 'b'])
  expect(groups.flatMap((g) => g.items)).toHaveLength(3)
})

test('an unreadable date does not throw or vanish', () => {
  expect(groupLabelFor('not a date', now)).toBe('Earlier')
})
