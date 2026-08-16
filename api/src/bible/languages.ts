/*
 * Turning `tl` into "Filipino", and into everything else people call it.
 *
 * The provider states a language as a tag and nothing more. A catalog that
 * spans seven languages and shows only tags is a catalog nobody can search, so
 * the tag is expanded here.
 *
 * ── Why `Intl.DisplayNames` rather than a table ─────────────────────────────
 *
 * Node ships the full CLDR language-name data. Hand-writing a table of names
 * would be re-deriving, badly and from memory, something already present and
 * correct — and it would need editing every time a language is added to the
 * configured set, which is precisely the code change this feature exists to
 * avoid. So the names come from the platform, and this file holds only the
 * handful of ALIASES the platform does not know about.
 *
 * ── Why aliases are needed at all ───────────────────────────────────────────
 *
 * `Intl.DisplayNames` renders `tl` as "Filipino". That is the correct modern
 * name and it is not what most people would type: they would type "Tagalog".
 * Likewise "Bisaya" for Cebuano and "Mandarin" for Chinese. Each entry below is
 * a name a real person would reasonably use, not a synonym harvested for
 * completeness — an alias list padded with obscurities makes search worse by
 * matching things nobody meant.
 */

/** English display names. Built once; the constructor is not cheap. */
const DISPLAY = new Intl.DisplayNames(['en'], { type: 'language' });

/**
 * Names the platform does not supply, keyed by primary subtag.
 *
 * Deliberately short. Anything here is a claim that people search for a
 * language by this word, and each one should be defensible on those grounds.
 */
const ALIASES: Record<string, string[]> = {
  /* CLDR says "Filipino"; the language is very widely called Tagalog. */
  tl: ['Tagalog', 'Pilipino'],
  fil: ['Tagalog', 'Pilipino'],
  /* Cebuano is called Bisaya or Binisaya by most of its speakers. */
  ceb: ['Bisaya', 'Binisaya', 'Visayan'],
  /* "Mandarin" is what an English speaker looking for a Chinese Bible types. */
  zh: ['Mandarin', 'Putonghua'],
  es: ['Castilian', 'Espanol', 'Español'],
  pt: ['Portugues', 'Português', 'Brazilian'],
  de: ['Deutsch'],
  fr: ['Francais', 'Français'],
  nl: ['Flemish', 'Nederlands'],
  ar: ['Arabic'],
  he: ['Hebrew', 'Ivrit'],
  el: ['Greek'],
  id: ['Bahasa', 'Bahasa Indonesia'],
  ms: ['Bahasa Melayu', 'Malay'],
  sw: ['Kiswahili'],
  hi: ['Hindustani'],
  ko: ['Hangul'],
  ja: ['Nihongo'],
  vi: ['Tieng Viet', 'Tiếng Việt'],
  /* "Farsi" is what most English speakers call Persian. */
  fa: ['Farsi'],
};

/** The primary subtag: `zh-Hans` and `zh` are the same language for this. */
function primary(tag: string): string {
  return tag.trim().toLowerCase().split(/[-_]/)[0] ?? tag.trim().toLowerCase();
}

/**
 * The language's name in English, or the tag itself if it has none.
 *
 * Falling back to the tag rather than to "Unknown": a row reading `syr` is at
 * least honest and searchable, whereas one reading "Unknown language" tells the
 * reader nothing and hides which Bible they are looking at.
 */
export function languageName(tag: string): string {
  try {
    const resolved = DISPLAY.of(tag) ?? DISPLAY.of(primary(tag));
    /*
     * `Intl.DisplayNames` echoes the input back when it does not recognise it,
     * so an unrecognised tag is detected by the answer being the question.
     */
    if (resolved && resolved.toLowerCase() !== tag.toLowerCase()) return resolved;
  } catch {
    /* An environment with no ICU data. The tag is still better than nothing. */
  }
  return tag;
}

/** The other names for it, for search only. Never displayed. */
export function languageAliases(tag: string): string[] {
  return ALIASES[primary(tag)] ?? [];
}
