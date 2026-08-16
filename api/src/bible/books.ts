/*
 * The canon, as USFM book codes with the names people actually type.
 *
 * Two things live here and nothing else: the mapping from what someone writes
 * ("1 Cor", "Psalm", "Song of Songs") to the provider's book code, and how many
 * chapters each book has.
 *
 * ── Why chapter counts and NOT verse counts ──────────────────────────────────
 *
 * A per-chapter verse table for the whole Bible is 1,189 numbers. Written from
 * memory it would contain mistakes, and a mistake in that table is the worst
 * kind of bug this feature can have: it rejects a real verse and tells the
 * person their Bible reference is wrong. There is no user-facing recovery from
 * being confidently contradicted about Scripture.
 *
 * The provider already answers that question correctly and cheaply — a request
 * for `JHN.3.999` comes back 404 — so verse existence is checked by asking it,
 * and the 404 is translated into "That passage is not in this translation."
 * Chapter counts are 66 numbers, they are checked in the test suite against
 * their well-known totals, and they let the obvious mistakes ("John 99:1") be
 * caught without a network call at all.
 *
 * Verse *numbers* are still bounded locally at a sane ceiling, because a
 * six-digit verse is a typo rather than a lookup, and there is no reason to
 * spend a round trip discovering that.
 */

export interface BibleBook {
  /** The provider's identifier, and the first segment of a USFM reference. */
  usfm: string;
  name: string;
  chapters: number;
  /** Everything a person might reasonably type for this book, lower-cased. */
  aliases: string[];
}

/*
 * The highest verse number in any chapter of the Bible is Psalm 119's 176. A
 * little headroom is left above it rather than pinning the constant to exactly
 * that, so a translation with a different versification is not cut off by our
 * arithmetic — the provider remains the authority on what exists.
 */
export const MAX_VERSE_NUMBER = 200;

export const BOOKS: BibleBook[] = [
  { usfm: 'GEN', name: 'Genesis', chapters: 50, aliases: ['gen', 'ge', 'gn', 'genesis'] },
  { usfm: 'EXO', name: 'Exodus', chapters: 40, aliases: ['exo', 'ex', 'exod', 'exodus'] },
  { usfm: 'LEV', name: 'Leviticus', chapters: 27, aliases: ['lev', 'le', 'lv', 'leviticus'] },
  { usfm: 'NUM', name: 'Numbers', chapters: 36, aliases: ['num', 'nu', 'nm', 'nb', 'numbers'] },
  {
    usfm: 'DEU',
    name: 'Deuteronomy',
    chapters: 34,
    aliases: ['deu', 'dt', 'deut', 'deuteronomy'],
  },
  { usfm: 'JOS', name: 'Joshua', chapters: 24, aliases: ['jos', 'josh', 'jsh', 'joshua'] },
  { usfm: 'JDG', name: 'Judges', chapters: 21, aliases: ['jdg', 'judg', 'jg', 'judges'] },
  { usfm: 'RUT', name: 'Ruth', chapters: 4, aliases: ['rut', 'ru', 'rth', 'ruth'] },
  {
    usfm: '1SA',
    name: '1 Samuel',
    chapters: 31,
    aliases: ['1sa', '1sam', '1s', '1samuel', 'isamuel', 'firstsamuel'],
  },
  {
    usfm: '2SA',
    name: '2 Samuel',
    chapters: 24,
    aliases: ['2sa', '2sam', '2s', '2samuel', 'iisamuel', 'secondsamuel'],
  },
  {
    usfm: '1KI',
    name: '1 Kings',
    chapters: 22,
    aliases: ['1ki', '1kg', '1kgs', '1k', '1kings', 'ikings', 'firstkings'],
  },
  {
    usfm: '2KI',
    name: '2 Kings',
    chapters: 25,
    aliases: ['2ki', '2kg', '2kgs', '2k', '2kings', 'iikings', 'secondkings'],
  },
  {
    usfm: '1CH',
    name: '1 Chronicles',
    chapters: 29,
    aliases: ['1ch', '1chr', '1chron', '1chronicles', 'ichronicles', 'firstchronicles'],
  },
  {
    usfm: '2CH',
    name: '2 Chronicles',
    chapters: 36,
    aliases: ['2ch', '2chr', '2chron', '2chronicles', 'iichronicles', 'secondchronicles'],
  },
  { usfm: 'EZR', name: 'Ezra', chapters: 10, aliases: ['ezr', 'ezra'] },
  { usfm: 'NEH', name: 'Nehemiah', chapters: 13, aliases: ['neh', 'ne', 'nehemiah'] },
  { usfm: 'EST', name: 'Esther', chapters: 10, aliases: ['est', 'es', 'esth', 'esther'] },
  { usfm: 'JOB', name: 'Job', chapters: 42, aliases: ['job', 'jb'] },
  {
    usfm: 'PSA',
    name: 'Psalms',
    chapters: 150,
    /* "Psalm 23" is how almost everyone writes it, singular. */
    aliases: ['psa', 'ps', 'psalm', 'psalms', 'psm', 'pss'],
  },
  { usfm: 'PRO', name: 'Proverbs', chapters: 31, aliases: ['pro', 'pr', 'prov', 'proverbs'] },
  {
    usfm: 'ECC',
    name: 'Ecclesiastes',
    chapters: 12,
    aliases: ['ecc', 'ec', 'eccl', 'eccles', 'qoh', 'ecclesiastes'],
  },
  {
    usfm: 'SNG',
    name: 'Song of Solomon',
    chapters: 8,
    aliases: [
      'sng',
      'so',
      'sos',
      'song',
      'songs',
      'songofsolomon',
      'songofsongs',
      'canticles',
      'cant',
    ],
  },
  { usfm: 'ISA', name: 'Isaiah', chapters: 66, aliases: ['isa', 'is', 'isaiah'] },
  { usfm: 'JER', name: 'Jeremiah', chapters: 52, aliases: ['jer', 'je', 'jeremiah'] },
  { usfm: 'LAM', name: 'Lamentations', chapters: 5, aliases: ['lam', 'la', 'lamentations'] },
  {
    usfm: 'EZK',
    name: 'Ezekiel',
    chapters: 48,
    /* `EZK`, not `EZE`. A reader who types "Eze" still means this book. */
    aliases: ['ezk', 'eze', 'ezek', 'ezekiel'],
  },
  { usfm: 'DAN', name: 'Daniel', chapters: 12, aliases: ['dan', 'da', 'dn', 'daniel'] },
  { usfm: 'HOS', name: 'Hosea', chapters: 14, aliases: ['hos', 'ho', 'hosea'] },
  { usfm: 'JOL', name: 'Joel', chapters: 3, aliases: ['jol', 'joe', 'jl', 'joel'] },
  { usfm: 'AMO', name: 'Amos', chapters: 9, aliases: ['amo', 'am', 'amos'] },
  { usfm: 'OBA', name: 'Obadiah', chapters: 1, aliases: ['oba', 'ob', 'obad', 'obadiah'] },
  { usfm: 'JON', name: 'Jonah', chapters: 4, aliases: ['jon', 'jnh', 'jonah'] },
  { usfm: 'MIC', name: 'Micah', chapters: 7, aliases: ['mic', 'mc', 'micah'] },
  { usfm: 'NAM', name: 'Nahum', chapters: 3, aliases: ['nam', 'na', 'nah', 'nahum'] },
  { usfm: 'HAB', name: 'Habakkuk', chapters: 3, aliases: ['hab', 'hb', 'habakkuk'] },
  { usfm: 'ZEP', name: 'Zephaniah', chapters: 3, aliases: ['zep', 'zeph', 'zp', 'zephaniah'] },
  { usfm: 'HAG', name: 'Haggai', chapters: 2, aliases: ['hag', 'hg', 'haggai'] },
  { usfm: 'ZEC', name: 'Zechariah', chapters: 14, aliases: ['zec', 'zech', 'zc', 'zechariah'] },
  { usfm: 'MAL', name: 'Malachi', chapters: 4, aliases: ['mal', 'ml', 'malachi'] },
  { usfm: 'MAT', name: 'Matthew', chapters: 28, aliases: ['mat', 'mt', 'matt', 'matthew'] },
  {
    usfm: 'MRK',
    name: 'Mark',
    chapters: 16,
    /* `MRK`, but nobody types that. */
    aliases: ['mrk', 'mk', 'mar', 'mark'],
  },
  { usfm: 'LUK', name: 'Luke', chapters: 24, aliases: ['luk', 'lk', 'luke'] },
  {
    usfm: 'JHN',
    name: 'John',
    chapters: 21,
    /*
     * `jn` and `joh` are John; `jn` must NOT collide with Jonah (`jnh`) or with
     * the letters of John, which carry their number. The lookup is exact
     * against this list, so there is no prefix ambiguity to resolve.
     */
    aliases: ['jhn', 'jn', 'joh', 'john'],
  },
  { usfm: 'ACT', name: 'Acts', chapters: 28, aliases: ['act', 'ac', 'acts'] },
  { usfm: 'ROM', name: 'Romans', chapters: 16, aliases: ['rom', 'ro', 'rm', 'romans'] },
  {
    usfm: '1CO',
    name: '1 Corinthians',
    chapters: 16,
    aliases: ['1co', '1cor', '1corinthians', 'icorinthians', 'firstcorinthians'],
  },
  {
    usfm: '2CO',
    name: '2 Corinthians',
    chapters: 13,
    aliases: ['2co', '2cor', '2corinthians', 'iicorinthians', 'secondcorinthians'],
  },
  { usfm: 'GAL', name: 'Galatians', chapters: 6, aliases: ['gal', 'ga', 'galatians'] },
  { usfm: 'EPH', name: 'Ephesians', chapters: 6, aliases: ['eph', 'ephes', 'ephesians'] },
  {
    usfm: 'PHP',
    name: 'Philippians',
    chapters: 4,
    /* `PHP` for Philippians, `PHM` for Philemon. "Phil" means Philippians. */
    aliases: ['php', 'phil', 'phili', 'philippians'],
  },
  { usfm: 'COL', name: 'Colossians', chapters: 4, aliases: ['col', 'colossians'] },
  {
    usfm: '1TH',
    name: '1 Thessalonians',
    chapters: 5,
    aliases: ['1th', '1thes', '1thess', '1thessalonians', 'ithessalonians'],
  },
  {
    usfm: '2TH',
    name: '2 Thessalonians',
    chapters: 3,
    aliases: ['2th', '2thes', '2thess', '2thessalonians', 'iithessalonians'],
  },
  {
    usfm: '1TI',
    name: '1 Timothy',
    chapters: 6,
    aliases: ['1ti', '1tim', '1timothy', 'itimothy', 'firsttimothy'],
  },
  {
    usfm: '2TI',
    name: '2 Timothy',
    chapters: 4,
    aliases: ['2ti', '2tim', '2timothy', 'iitimothy', 'secondtimothy'],
  },
  { usfm: 'TIT', name: 'Titus', chapters: 3, aliases: ['tit', 'ti', 'titus'] },
  { usfm: 'PHM', name: 'Philemon', chapters: 1, aliases: ['phm', 'phlm', 'philem', 'philemon'] },
  { usfm: 'HEB', name: 'Hebrews', chapters: 13, aliases: ['heb', 'hebrews'] },
  { usfm: 'JAS', name: 'James', chapters: 5, aliases: ['jas', 'jm', 'jam', 'james'] },
  {
    usfm: '1PE',
    name: '1 Peter',
    chapters: 5,
    aliases: ['1pe', '1pet', '1pt', '1peter', 'ipeter', 'firstpeter'],
  },
  {
    usfm: '2PE',
    name: '2 Peter',
    chapters: 3,
    aliases: ['2pe', '2pet', '2pt', '2peter', 'iipeter', 'secondpeter'],
  },
  {
    usfm: '1JN',
    name: '1 John',
    chapters: 5,
    aliases: ['1jn', '1jo', '1joh', '1john', 'ijohn', 'firstjohn'],
  },
  {
    usfm: '2JN',
    name: '2 John',
    chapters: 1,
    aliases: ['2jn', '2jo', '2joh', '2john', 'iijohn', 'secondjohn'],
  },
  {
    usfm: '3JN',
    name: '3 John',
    chapters: 1,
    aliases: ['3jn', '3jo', '3joh', '3john', 'iiijohn', 'thirdjohn'],
  },
  { usfm: 'JUD', name: 'Jude', chapters: 1, aliases: ['jud', 'jd', 'jude'] },
  {
    usfm: 'REV',
    name: 'Revelation',
    chapters: 22,
    /* Singular. "Revelations" is common enough that refusing it is pedantry. */
    aliases: ['rev', 're', 'rv', 'revelation', 'revelations', 'apocalypse'],
  },
];

/**
 * Alias → book, built once.
 *
 * Both the aliases and the USFM code itself are keys, so a caller that already
 * has `JHN` does not have to know it is also spelled "John".
 */
const BY_ALIAS = new Map<string, BibleBook>();
for (const book of BOOKS) {
  BY_ALIAS.set(book.usfm.toLowerCase(), book);
  BY_ALIAS.set(book.name.toLowerCase().replace(/[^a-z0-9]/g, ''), book);
  for (const alias of book.aliases) BY_ALIAS.set(alias, book);
}

/**
 * Find a book from something a person typed.
 *
 * The key is stripped of everything that is not a letter or a digit and
 * lower-cased, so "1 Cor.", "1cor", "I Corinthians" and "1CO" all arrive at the
 * same entry. Ordinal words ("first", "second", "third") and Roman numerals are
 * folded to digits first, because "First John" is a perfectly ordinary way to
 * write it and refusing it teaches nothing.
 */
export function findBook(raw: string): BibleBook | null {
  const cleaned = raw
    .toLowerCase()
    .replace(/^\s*(first|1st)\s+/, '1')
    .replace(/^\s*(second|2nd)\s+/, '2')
    .replace(/^\s*(third|3rd)\s+/, '3')
    .replace(/[^a-z0-9]/g, '');
  if (!cleaned) return null;
  return BY_ALIAS.get(cleaned) ?? null;
}
