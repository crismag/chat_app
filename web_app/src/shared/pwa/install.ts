import { useSyncExternalStore } from 'react'
import { isNativeApp } from '../native/platform.ts'

/*
 * Installing C.H.A.T. to a phone's home screen, from the web.
 *
 * Chrome and Edge on Android (and desktop) announce that a page can be
 * installed with `beforeinstallprompt`, once, early, and only to a listener
 * that already exists — so the event is caught here at module load and kept
 * until somebody asks to install. iOS Safari has no such event at all; the
 * only way there is Share → Add to Home Screen, so on iOS the app says so
 * instead of offering a button that cannot work.
 *
 * Inside the Capacitor app none of this applies: it is already installed.
 */

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  // iPadOS reports itself as a Mac; the touch points give it away.
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as InstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

export type InstallOffer =
  | { kind: 'none' }
  | { kind: 'prompt'; install: () => Promise<void> }
  | { kind: 'ios' }

async function install(): Promise<void> {
  const event = deferred
  if (!event) return
  deferred = null
  notify()
  await event.prompt()
  await event.userChoice.catch(() => undefined)
}

function snapshot(): InstallOffer['kind'] {
  if (isNativeApp() || isStandalone()) return 'none'
  if (deferred) return 'prompt'
  if (isIos()) return 'ios'
  return 'none'
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** What, if anything, this browser can offer for installing the app. */
export function useInstallOffer(): InstallOffer {
  const kind = useSyncExternalStore(subscribe, snapshot, () => 'none' as const)
  if (kind === 'prompt') return { kind, install }
  return { kind }
}

/*
 * The service worker, which is what lets the installed app open instantly and
 * without a connection. Production web only: in development it would cache
 * Vite's modules and hide every edit, and the native app ships its files.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || isNativeApp()) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* Not being installable is not a reason for the app to fail. */
    })
  })
}
