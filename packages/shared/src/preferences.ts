import { CHAT_FORMATS, type ChatFormat } from './formats.ts';

/*
 * What a person has chosen about how the application looks and behaves.
 *
 * ── Why these live on the server ────────────────────────────────────────────
 *
 * Everything of this kind was in `localStorage`, which means a preference is
 * really a property of a browser: set the theme on a phone and the laptop
 * still looks the way it did. These three are properties of a *person* — how
 * they want to read, which translation they read in, and which shape of
 * reflection they write — so they belong to the account.
 *
 * View state that genuinely is per-device (a collapsed sidebar, a list
 * density) is deliberately not here and stays local.
 */

/**
 * The eight appearances.
 *
 * `default` is the only one that follows the operating system's light/dark
 * setting; the rest are a decision the person has made and are honoured
 * whatever the system says. That is the point of choosing one.
 */
export const THEMES = {
  DEFAULT: 'default',
  FORMAL: 'formal',
  ZEN: 'zen',
  LADIES: 'ladies',
  RETRO: 'retro',
  TECHNO: 'techno',
  LIGHT: 'light',
  DARK: 'dark',
} as const;

export type Theme = (typeof THEMES)[keyof typeof THEMES];

export const THEME_LIST: readonly Theme[] = Object.values(THEMES);

/** What each one is called, and what it is for. Shown as written. */
export const THEME_LABELS: Record<Theme, { name: string; description: string }> = {
  [THEMES.DEFAULT]: {
    name: 'Default',
    description: 'Warm and quiet. Follows your device’s light or dark setting.',
  },
  [THEMES.FORMAL]: { name: 'Formal', description: 'Restrained, high contrast, serif.' },
  [THEMES.ZEN]: { name: 'Zen', description: 'Soft, airy and unhurried.' },
  [THEMES.LADIES]: { name: 'Ladies', description: 'Rose and plum, with a lighter hand.' },
  [THEMES.RETRO]: { name: 'Retro', description: 'Paper, ink and amber.' },
  [THEMES.TECHNO]: { name: 'Techno', description: 'Dark, cool and precise.' },
  [THEMES.LIGHT]: { name: 'Light', description: 'Always light, whatever your device says.' },
  [THEMES.DARK]: { name: 'Dark', description: 'Always dark, whatever your device says.' },
};

export type Preferences = {
  theme: Theme;
  /**
   * A translation *id*, or null for "no preference".
   *
   * An id, never an abbreviation. `catalog.ts` is explicit about why: no
   * translation is actually called `NIV` — the provider calls that edition
   * `NIV11` — so a preference stored as a string and matched back by
   * abbreviation silently selects a different Bible. The server resolves ids;
   * this stores what it resolved.
   *
   * Not checked against the catalogue here. That list is live, and a
   * translation being withdrawn should leave somebody with "no preference"
   * rather than an unloadable settings page.
   */
  bibleTranslationId: number | null;
  /** The shape a new reflection starts in. */
  defaultChatFormat: ChatFormat;
};

export const DEFAULT_PREFERENCES: Preferences = {
  theme: THEMES.DEFAULT,
  bibleTranslationId: null,
  defaultChatFormat: CHAT_FORMATS.FULL,
};

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && THEME_LIST.includes(value as Theme);
}

export function isChatFormat(value: unknown): value is ChatFormat {
  return value === CHAT_FORMATS.FULL || value === CHAT_FORMATS.CONDENSED;
}

/**
 * Read whatever arrived and produce something usable.
 *
 * Every field falls back rather than throwing. Preferences are cosmetic by
 * nature: a stored value from an older release, or a field somebody typed
 * into a request by hand, should leave the person looking at a working
 * application with a default, never at an error page.
 */
export function normalisePreferences(input: unknown, base = DEFAULT_PREFERENCES): Preferences {
  const raw = (input ?? {}) as Partial<Record<keyof Preferences, unknown>>;

  /*
   * A positive integer or nothing. Explicit null means "no preference" and is
   * distinct from absent, which leaves whatever was already chosen alone.
   */
  const translation =
    raw.bibleTranslationId === null
      ? null
      : Number.isInteger(raw.bibleTranslationId) && Number(raw.bibleTranslationId) > 0
        ? Number(raw.bibleTranslationId)
        : base.bibleTranslationId;

  return {
    theme: isTheme(raw.theme) ? raw.theme : base.theme,
    bibleTranslationId: translation,
    defaultChatFormat: isChatFormat(raw.defaultChatFormat)
      ? raw.defaultChatFormat
      : base.defaultChatFormat,
  };
}
