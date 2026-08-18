import type { CapacitorConfig } from '@capacitor/cli'

/*
 * Capacitor packages the Vite web build. Product behaviour stays in
 * `web_app/`; these native projects are hosts, not a second application.
 *
 * `CAP_LIVE_RELOAD_URL` points the WebView at the Vite dev server so `/api`
 * still goes through the proxy and the session cookie stays first-party. Leave
 * it unset for a packaged build; that build needs `VITE_API_BASE_URL` aimed at
 * a reachable API host.
 */
const liveReload = process.env.CAP_LIVE_RELOAD_URL?.trim()

const config: CapacitorConfig = {
  appId: 'app.crismag.chat',
  appName: 'C.H.A.T.',
  webDir: 'web_app/dist',
  android: {
    allowMixedContent: Boolean(liveReload),
  },
  server: {
    androidScheme: 'https',
    ...(liveReload ? { url: liveReload, cleartext: true } : {}),
  },
  plugins: {
    CapacitorCookies: {
      enabled: true,
    },
    CapacitorHttp: {
      enabled: true,
    },
    Keyboard: {
      resize: 'native',
      resizeOnFullScreen: true,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#f7f1e6',
    },
  },
}

export default config
