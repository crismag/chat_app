import type { CookieOptions } from 'hono/utils/cookie'
import { SESSION_TTL_MS } from '../db.ts'
import { isNativeWebViewOrigin } from '../http/origins.ts'

/**
 * Cookie flags for one login, chosen from the request Origin.
 *
 * Browser Vite stays `SameSite=Lax` so a local HTTP session still works.
 * A packaged Capacitor WebView is a different site from the API, so the
 * cookie has to be `SameSite=None; Secure` or the WebView will store it and
 * never send it back. That only works when the API itself is HTTPS.
 */
export function sessionCookieOptions(
  origin: string | undefined,
  env: NodeJS.Dict<string> = process.env,
): CookieOptions {
  const native = isNativeWebViewOrigin(origin)
  return {
    httpOnly: true,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    sameSite: native ? 'None' : 'Lax',
    secure: native || env.NODE_ENV === 'production',
  }
}
