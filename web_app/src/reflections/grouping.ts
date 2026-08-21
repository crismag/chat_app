/*
 * Which day something belongs to, from the point of view of the person reading.
 *
 * "Today" is a calendar question, not an arithmetic one. Subtracting 24 hours
 * from an instant answers "in the last day", which is a different thing: a
 * reflection written at 23:30 is still today's at 23:59, and becomes
 * yesterday's the moment local midnight passes — whatever the UTC date says.
 * Somewhere west of Greenwich the two answers disagree for most of the
 * evening, and the person is always right about what day it is where they are.
 *
 * So every comparison here is made on the local calendar date, and every label
 * that is not a fixed word is produced by `Intl` in the reader's own locale.
 */

/** Local midnight at the start of the day containing `at`. */
function startOfLocalDay(at: Date): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()
}

/** Whole calendar days between two instants, counted locally. */
export function daysApart(then: Date, now: Date): number {
  const DAY = 24 * 60 * 60 * 1000
  return Math.round((startOfLocalDay(now) - startOfLocalDay(then)) / DAY)
}

const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const monthOnly = new Intl.DateTimeFormat(undefined, { month: 'long' })

/**
 * The group heading for one reflection.
 *
 * `Today` and `Yesterday` are words rather than dates because that is how
 * people say them; everything older is a real date, formatted by the reader's
 * locale rather than assembled from English month names.
 */
export function groupLabelFor(iso: string, now: Date): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return 'Earlier'

  const days = daysApart(at, now)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'Earlier this week'
  if (at.getFullYear() === now.getFullYear()) return monthOnly.format(at)
  return monthLabel.format(at)
}

/** Groups in reading order, each carrying its items, empty ones omitted. */
export function groupByDay<T>(
  items: T[],
  dateOf: (item: T) => string,
  now: Date,
): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = []
  for (const item of items) {
    const label = groupLabelFor(dateOf(item), now)
    const last = groups[groups.length - 1]
    /*
     * Appended in the order the list already has rather than bucketed by a
     * map, so a sorted list stays sorted and an unsorted one is not silently
     * reordered into something that looks sorted but is not.
     */
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}
