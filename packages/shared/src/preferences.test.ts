import { describe, expect, test } from 'vitest'

import { CHAT_FORMATS } from './formats.ts'
import { DEFAULT_PREFERENCES, THEMES, normalisePreferences } from './preferences.ts'

describe('normalisePreferences', () => {
  test('nothing at all is the defaults', () => {
    expect(normalisePreferences(undefined)).toEqual(DEFAULT_PREFERENCES)
    expect(normalisePreferences(null)).toEqual(DEFAULT_PREFERENCES)
    expect(normalisePreferences({})).toEqual(DEFAULT_PREFERENCES)
  })

  test('a theme this release no longer has falls back rather than breaking', () => {
    /* The default, whatever it currently is — not the appearance keyed `default`. */
    expect(normalisePreferences({ theme: 'neon-1998' }).theme).toBe(DEFAULT_PREFERENCES.theme)
  })

  test('a chosen theme survives', () => {
    expect(normalisePreferences({ theme: THEMES.TECHNO }).theme).toBe(THEMES.TECHNO)
  })

  test('a translation is an id, because an abbreviation names more than one Bible', () => {
    expect(normalisePreferences({ bibleTranslationId: 111 }).bibleTranslationId).toBe(111)
    /* 'NIV' is not a translation. Storing one would silently pick another Bible. */
    expect(normalisePreferences({ bibleTranslationId: 'NIV' }).bibleTranslationId).toBeNull()
    expect(normalisePreferences({ bibleTranslationId: -3 }).bibleTranslationId).toBeNull()
  })

  test('null means no preference, and is not confused with absent', () => {
    const base = { ...DEFAULT_PREFERENCES, bibleTranslationId: 111 }
    expect(normalisePreferences({ bibleTranslationId: null }, base).bibleTranslationId).toBeNull()
    /* Absent leaves what was already chosen alone. */
    expect(normalisePreferences({}, base).bibleTranslationId).toBe(111)
  })

  test('a partial change keeps everything it did not mention', () => {
    const base = {
      theme: THEMES.RETRO,
      bibleTranslationId: 206,
      defaultChatFormat: CHAT_FORMATS.CONDENSED,
    }
    expect(normalisePreferences({ theme: THEMES.ZEN }, base)).toEqual({ ...base, theme: THEMES.ZEN })
  })

  test('a nonsense format falls back instead of writing an unusable reflection shape', () => {
    expect(normalisePreferences({ defaultChatFormat: 'epic' }).defaultChatFormat).toBe(
      CHAT_FORMATS.FULL,
    )
  })

  test('a string cannot be smuggled in where an id belongs', () => {
    expect(normalisePreferences({ bibleTranslationId: 'X'.repeat(500) }).bibleTranslationId).toBeNull()
  })
})
