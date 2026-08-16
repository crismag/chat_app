/*
 * The small rules that turn a list of conversations into a history someone can
 * read: which bucket a reflection falls in, what it is called when it has no
 * name yet, and how a Scripture book survives being shown in 56 pixels.
 *
 * They live apart from the components because they are pure, testable and used
 * by more than one of them.
 */

/*
 * Today / This week / Earlier.
 *
 * A flat list of forty conversations tells you nothing about which one you were
 * in an hour ago. Three buckets are enough to answer that and few enough that
 * nobody has to read a heading twice.
 */
export function bucketOf(iso: string, now = new Date()): 'Today' | 'This week' | 'Earlier' {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return 'Earlier'
  if (time >= startOfToday) return 'Today'
  if (time >= startOfToday - 6 * 24 * 60 * 60 * 1000) return 'This week'
  return 'Earlier'
}

/*
 * A Scripture book, in two characters.
 *
 * The collapsed rail is 56px wide, which is room for a mark and nothing else.
 * "1 Corinthians 13" has to survive as `1C` — the leading number carries as
 * much meaning as the letter after it — and anything untitled falls back to the
 * first letters of whatever the reflection is called.
 */
export function bookInitials(reference: string | null, fallback: string): string {
  const source = (reference ?? '').trim() || fallback.trim()
  if (!source) return '·'
  const words = source.split(/\s+/).filter(Boolean)
  const first = words[0] ?? ''
  if (/^\d/.test(first)) {
    const second = words[1] ?? ''
    return (first.charAt(0) + (second.charAt(0) || '')).toUpperCase()
  }
  return first.slice(0, 2).toUpperCase()
}

/*
 * A reflection begun without a title is named after its passage, which means
 * the title and the reference are the same string. Printing both reads as a
 * bug, so the title says plainly that there is not one yet.
 */
export function displayTitle(title: string, reference: string | null): string {
  const ref = (reference ?? '').trim()
  if (ref && title.trim().toLowerCase() === ref.toLowerCase()) {
    return 'Untitled reflection'
  }
  return title
}

/*
 * A temporary name, taken from the first thing written.
 *
 * The API will settle for "New reflection" when nothing is supplied, which is
 * true and useless — a history of eleven identical rows. The opening clause of
 * what someone actually wrote is a far better handle, and it is temporary:
 * renaming stays available once the reflection knows what it is about.
 */
export function deriveTitle(message: string): string {
  const firstSentence = message.trim().split(/(?<=[.!?])\s|\n/)[0] ?? ''
  const source = (firstSentence || message).trim().replace(/\s+/g, ' ')
  if (source.length <= 60) return source
  const cut = source.slice(0, 60)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > 24 ? lastSpace : 60).trimEnd()}…`
}
