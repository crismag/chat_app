/**
 * Turn a Capacitor launch URL into a path React Router understands.
 *
 * The custom scheme is `chat:` — `chat://community/publications/id` and
 * `chat:///community/publications/id` both mean the same in-app route. HTTPS
 * universal links keep their pathname. Anything that is not ours is ignored
 * rather than navigated, so a stray intent cannot dump someone on a blank page.
 */
export function pathFromAppUrl(raw: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }

  if (parsed.protocol === 'chat:') {
    const combined = `${parsed.hostname}${parsed.pathname}`
    const path = combined.startsWith('/') ? combined : `/${combined}`
    return `${path.replace(/\/{2,}/g, '/')}${parsed.search}${parsed.hash}`
  }

  if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/'
  }

  return null
}
