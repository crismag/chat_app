/*
 * Every request goes through the API base. One did not, and it broke in
 * production only.
 *
 * The web app is served from one host and the API answers on another, so a
 * request written as `/api/...` goes to the static host. That host answers
 * with its 404 *page*, `response.json()` fails on the `<` of `<!DOCTYPE`, and
 * the person who was adding a profile picture is shown a JSON parse error
 * about their photograph.
 *
 * Nothing catches it in development, because the dev server proxies `/api` to
 * the API and the bare path works perfectly. That is what makes it worth a
 * test rather than a code review note: the mistake is invisible exactly where
 * it would be found.
 */
import { expect, test } from 'vitest'

/*
 * Every source file, as text. `eager` so this is one synchronous map rather
 * than a promise per file, and `query: '?raw'` so what arrives is the source
 * and not the module's exports.
 */
const sources = import.meta.glob('../../**/*.{ts,tsx}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

/** Where a bare path is the correct thing to write. */
function exempt(path: string): boolean {
  /* The client is where the base is applied, so it is the one place allowed to
     hold a path with nothing in front of it. */
  return path.endsWith('shared/api/client.ts')
}

test('no request is written as a bare /api path', () => {
  const offenders: string[] = []
  for (const [path, source] of Object.entries(sources)) {
    if (exempt(path)) continue
    /*
     * A `fetch(` whose first argument is a literal path beginning `/api/`.
     *
     * Narrow on purpose. `/api/...` appears all over the source in prose — in
     * comments explaining routes, in fixtures holding URLs the server returned,
     * in the proxy configuration — and none of those is the mistake. The
     * mistake is a request, so the pattern matches a call.
     */
    for (const match of source.matchAll(/fetch\(\s*['"`]\/api\//g)) {
      const line = source.slice(0, match.index).split('\n').length
      offenders.push(`${path}:${line}`)
    }
  }
  expect(offenders).toEqual([])
})

test('the guard can see the files it is guarding', () => {
  /* An empty glob would make the assertion above pass for the wrong reason. */
  expect(Object.keys(sources).length).toBeGreaterThan(50)
})
