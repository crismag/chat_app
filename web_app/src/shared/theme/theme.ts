import { THEMES, type Theme } from '@chat/shared'

/*
 * Turning a chosen theme into the two attributes the stylesheets read.
 *
 * `data-theme` names the appearance. `data-palette` says whether the base
 * palette should be its light or dark form, and exists only for the three
 * appearances that are the base palette: Default, Light and Dark. The five
 * named themes define every colour themselves, so they set no palette and
 * nothing from the base can leak through.
 *
 * Keeping this in one small pure function is the point — it is called from
 * React, from the pre-paint script in index.html, and from the tests, and all
 * three must agree or a person sees one theme flash into another.
 */

/** The name under which the last chosen theme is mirrored for the next first paint. */
export const THEME_STORAGE_KEY = 'chat.theme'

export function resolvePalette(theme: Theme, systemPrefersDark: boolean): 'light' | 'dark' | null {
  if (theme === THEMES.LIGHT) return 'light'
  if (theme === THEMES.DARK) return 'dark'
  /* Default is the only one that asks the operating system what it wants. */
  if (theme === THEMES.DEFAULT) return systemPrefersDark ? 'dark' : 'light'
  return null
}

export function applyTheme(
  root: HTMLElement,
  theme: Theme,
  systemPrefersDark: boolean,
): void {
  root.dataset['theme'] = theme
  const palette = resolvePalette(theme, systemPrefersDark)
  if (palette) root.dataset['palette'] = palette
  else delete root.dataset['palette']
}
