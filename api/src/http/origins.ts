/*
 * Browser and Capacitor WebView origins that may call the API with cookies.
 *
 * The Vite origins are the local web app. The localhost / capacitor schemes are
 * the packaged WebView. Anything else (a deployed web origin, a LAN Vite URL)
 * arrives through CHAT_WEB_ORIGINS so a new host is configuration, not a code
 * edit.
 */

export const DEFAULT_WEB_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'ionic://localhost',
] as const

export const NATIVE_WEBVIEW_ORIGINS = new Set([
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'ionic://localhost',
])

export function webOrigins(env: NodeJS.Dict<string> = process.env): string[] {
  const extra = (env.CHAT_WEB_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  return [...new Set([...DEFAULT_WEB_ORIGINS, ...extra])]
}

export function isNativeWebViewOrigin(origin: string | undefined): boolean {
  return Boolean(origin && NATIVE_WEBVIEW_ORIGINS.has(origin))
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1'
  } catch {
    return true
  }
}

/**
 * Where a password-reset email may point.
 *
 * Never the request Origin: that header is whoever asked, and a reset link
 * built from it is a link the recipient will open. Production needs a
 * configured public origin. Development may fall back to the local Vite host
 * so a checkout without CHAT_WEB_ORIGINS still produces a usable link.
 */
export function publicWebOrigin(env: NodeJS.Dict<string> = process.env): string | null {
  const dedicated = env.CHAT_PUBLIC_WEB_ORIGIN?.trim()
  if (dedicated) return dedicated.replace(/\/$/, '')

  const extras = (env.CHAT_WEB_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  const deployed = extras.find((origin) => !isLoopbackOrigin(origin) && !isNativeWebViewOrigin(origin))
  if (deployed) return deployed.replace(/\/$/, '')

  if (env.NODE_ENV === 'production') return null
  const fallback = extras[0] ?? DEFAULT_WEB_ORIGINS[0]
  return fallback.replace(/\/$/, '')
}
