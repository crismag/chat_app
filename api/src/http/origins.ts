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
