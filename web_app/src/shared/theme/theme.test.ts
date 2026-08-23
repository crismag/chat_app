import { beforeEach, expect, test } from 'vitest'
import { DEFAULT_PREFERENCES, THEMES, THEME_LABELS, THEME_LIST } from '@chat/shared'

import { applyTheme, resolvePalette } from './theme.ts'
/*
 * The two files this asserts against, imported as text.
 *
 * `?raw` rather than `node:fs`: the web workspace has no Node types, and a
 * path resolved at run time would depend on which directory the runner was
 * started from. Vite resolves these at build time, so a rename breaks the
 * import rather than the assertion.
 */
import indexHtml from '../../../index.html?raw'
import themesCss from '../../styles/themes.css?inline'

test('only Default asks the operating system', () => {
  expect(resolvePalette(THEMES.DEFAULT, true)).toBe('dark')
  expect(resolvePalette(THEMES.DEFAULT, false)).toBe('light')

  /* A chosen appearance is a decision, and is honoured whatever the device says. */
  expect(resolvePalette(THEMES.LIGHT, true)).toBe('light')
  expect(resolvePalette(THEMES.DARK, false)).toBe('dark')
})

test('a named theme brings its own colours and borrows no palette', () => {
  for (const theme of [
    THEMES.FORMAL,
    THEMES.ZEN,
    THEMES.LADIES,
    THEMES.RETRO,
    THEMES.TECHNO,
    THEMES.BLUSH,
    THEMES.AZURE,
    THEMES.LEATHER,
  ]) {
    expect(resolvePalette(theme, true)).toBeNull()
    expect(resolvePalette(theme, false)).toBeNull()
  }
})

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-palette')
})

test('switching from a base appearance to a named one removes the stale palette', () => {
  const root = document.documentElement

  applyTheme(root, THEMES.DARK, false)
  expect(root.dataset['palette']).toBe('dark')

  applyTheme(root, THEMES.RETRO, false)
  expect(root.dataset['theme']).toBe('retro')
  /*
   * Left behind, this would put Retro's warm surfaces on top of the dark
   * palette's ink and produce a theme nobody designed.
   */
  expect(root.dataset['palette']).toBeUndefined()
})

test('the system changing under Default is followed', () => {
  const root = document.documentElement

  applyTheme(root, THEMES.DEFAULT, false)
  expect(root.dataset['palette']).toBe('light')

  applyTheme(root, THEMES.DEFAULT, true)
  expect(root.dataset['palette']).toBe('dark')
})


/* --------------------------------------------------- the default, in one place */

/*
 * The default appearance is declared three times, because it has to be: the
 * server sends it, this provider falls back to it, and a script in the document
 * head applies it before any module loads. They cannot import from each other,
 * so this asserts they agree — the failure otherwise is a page that paints one
 * theme and then changes to another while somebody watches.
 */
test('the pre-paint script defaults to the same theme the server does', () => {
  const html = indexHtml
  expect(DEFAULT_PREFERENCES.theme).toBe(THEMES.RETRO)
  expect(html).toContain(`: '${DEFAULT_PREFERENCES.theme}';`)
})

test('the pre-paint script knows every theme that exists', () => {
  const html = indexHtml
  for (const theme of THEME_LIST) {
    expect(html, theme).toContain(`'${theme}'`)
  }
})

/*
 * A theme with no palette is a theme that inherits the light one — which is how
 * a dark appearance ends up with a white panel in the middle of it. Only the
 * three base appearances are allowed to have no block of their own.
 */
test('every named theme has a palette defined for it', () => {
  const css = themesCss
  const base: string[] = [THEMES.DEFAULT, THEMES.LIGHT, THEMES.DARK]
  for (const theme of THEME_LIST) {
    if (base.includes(theme)) continue
    expect(css, theme).toContain(`[data-theme='${theme}']`)
  }
})

test('every theme is named and described for the person choosing it', () => {
  for (const theme of THEME_LIST) {
    expect(THEME_LABELS[theme]?.name, theme).toBeTruthy()
    expect(THEME_LABELS[theme]?.description, theme).toBeTruthy()
  }
})

/*
 * "Default" stopped being true when Retro became what a new account gets. The
 * stored key stays `default` — renaming it would silently reset the appearance
 * of everybody who had chosen it — and only the name a person reads changed.
 */
test('the appearance that follows the device is called System Tone, and is still keyed default', () => {
  expect(THEMES.DEFAULT).toBe('default')
  expect(THEME_LABELS[THEMES.DEFAULT].name).toBe('System Tone')
})
