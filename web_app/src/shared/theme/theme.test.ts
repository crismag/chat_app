import { beforeEach, expect, test } from 'vitest'
import { THEMES } from '@chat/shared'

import { applyTheme, resolvePalette } from './theme.ts'

test('only Default asks the operating system', () => {
  expect(resolvePalette(THEMES.DEFAULT, true)).toBe('dark')
  expect(resolvePalette(THEMES.DEFAULT, false)).toBe('light')

  /* A chosen appearance is a decision, and is honoured whatever the device says. */
  expect(resolvePalette(THEMES.LIGHT, true)).toBe('light')
  expect(resolvePalette(THEMES.DARK, false)).toBe('dark')
})

test('a named theme brings its own colours and borrows no palette', () => {
  for (const theme of [THEMES.FORMAL, THEMES.ZEN, THEMES.LADIES, THEMES.RETRO, THEMES.TECHNO]) {
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
