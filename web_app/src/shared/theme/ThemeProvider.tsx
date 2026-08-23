import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  DEFAULT_PREFERENCES,
  type Preferences,
  type Theme,
  isTheme,
  normalisePreferences,
} from '@chat/shared'

import { api } from '../api/client.ts'
import { ThemeContext, type ThemeContextValue } from './theme-context.ts'
import { THEME_STORAGE_KEY, applyTheme } from './theme.ts'

/*
 * Keeps what a person chose and what they are looking at in agreement.
 *
 * Preferences live on the server, because they belong to the person rather
 * than to one browser. But the server is a round trip away and a page must
 * paint immediately, so the chosen theme is *mirrored* into localStorage and
 * read by a small script before first paint. The mirror is a cache, never the
 * truth: when the account's preferences arrive they win, which is what makes
 * signing in on a new device bring your theme with you.
 *
 * A signed-out visitor keeps whatever is in the mirror. They are allowed a
 * preference too; it simply has nowhere to follow them to.
 */

const SYSTEM_DARK = '(prefers-color-scheme: dark)'

/**
 * The mirror of the last chosen theme, or the one nobody has chosen yet.
 *
 * The fallback is `DEFAULT_PREFERENCES.theme` rather than a literal, so this,
 * the server's default and the pre-paint script in `index.html` cannot drift
 * apart into three answers — which a person would see as the page changing
 * appearance twice while it loads.
 */
function storedTheme(): Theme {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(raw) ? raw : DEFAULT_PREFERENCES.theme
  } catch {
    /* Private mode, or storage disabled. A theme is not worth an exception. */
    return DEFAULT_PREFERENCES.theme
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(() => ({
    ...DEFAULT_PREFERENCES,
    theme: storedTheme(),
  }))
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.(SYSTEM_DARK).matches ?? false,
  )

  /* The operating system can change while the page is open — at sunset, most often. */
  useEffect(() => {
    const query = window.matchMedia?.(SYSTEM_DARK)
    if (!query) return
    const listen = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener('change', listen)
    return () => query.removeEventListener('change', listen)
  }, [])

  useEffect(() => {
    applyTheme(document.documentElement, preferences.theme, systemDark)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preferences.theme)
    } catch {
      /* The mirror is an optimisation; losing it costs one frame, not a theme. */
    }
  }, [preferences.theme, systemDark])

  /*
   * What the account says, once. A visitor gets a 401 here and keeps the
   * local mirror, which is why this failure is silent rather than reported.
   */
  const load = useCallback(async () => {
    try {
      const body = await api<{ preferences: unknown }>('/profiles/me/preferences')
      setPreferences(normalisePreferences(body.preferences))
    } catch {
      /* Signed out. Their local choice stands. */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const value = useMemo<ThemeContextValue>(
    () => ({
      preferences,
      /*
       * Applied immediately, then saved. A theme that waits for a round trip
       * before changing feels broken, and if the save fails the person is
       * still looking at the theme they asked for.
       */
      async update(changes) {
        setPreferences((current) => normalisePreferences(changes, current))
        const body = await api<{ preferences: unknown }>('/profiles/me/preferences', {
          method: 'PATCH',
          body: JSON.stringify(changes),
        })
        setPreferences(normalisePreferences(body.preferences))
      },
      reload: load,
    }),
    [preferences, load],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
