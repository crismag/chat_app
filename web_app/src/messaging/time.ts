/*
 * Compact times for a chat list and a thread log.
 *
 * Messenger does not print a full locale datetime on every bubble. Same-day
 * rows get a clock time; this week gets a weekday; older than that gets a
 * short date. Cluster stamps in the log keep the clock time so two pauses
 * on the same afternoon stay distinguishable.
 */

const CLUSTER_MS = 5 * 60_000

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function sameDay(left: Date, right: Date): boolean {
  return startOfDay(left).getTime() === startOfDay(right).getTime()
}

function daysBetween(earlier: Date, later: Date): number {
  return Math.round((startOfDay(later).getTime() - startOfDay(earlier).getTime()) / 86_400_000)
}

function clock(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function formatListTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  if (sameDay(date, now)) return clock(date)
  const ago = daysBetween(date, now)
  if (ago > 0 && ago < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'short' })
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatClusterTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const time = clock(date)
  if (sameDay(date, now)) return time
  const ago = daysBetween(date, now)
  if (ago > 0 && ago < 7) {
    return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`
  }
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`
}

export function shouldShowClusterTime(iso: string, previousIso: string | undefined): boolean {
  if (!previousIso) return true
  const current = Date.parse(iso)
  const previous = Date.parse(previousIso)
  if (Number.isNaN(current) || Number.isNaN(previous)) return true
  return Math.abs(current - previous) >= CLUSTER_MS
}
