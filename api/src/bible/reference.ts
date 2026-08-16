/*
 * "John 3:16–18" → `JHN.3.16-18`.
 *
 * The one job of this file is to turn what a person writes into what the
 * provider understands, and to refuse — in a sentence a human can act on —
 * when it cannot.
 *
 * Three details are worth stating, because each one caused a real failure
 * before it was handled:
 *
 *   1. **The en dash.** People paste references from Bible apps, church slides
 *      and Word documents, and those render ranges with `–` (U+2013) or `—`
 *      (U+2014), not a hyphen. A parser that only knows `-` rejects a reference
 *      that looks, on screen, exactly like one it accepts. So does one that
 *      only knows the ASCII colon: `John 3∶16` with a ratio colon exists in the
 *      wild too.
 *   2. **Non-breaking and narrow spaces.** The same paste sources use U+00A0
 *      and U+202F between the book and the chapter. They are spaces to a
 *      reader and not to `\s` in every engine, so they are normalised first.
 *   3. **A reversed range is a mistake, not a query.** `John 3:18-16` gets a
 *      404 from the provider, which would be reported as "not in this
 *      translation" — which is false and confusing. It is caught here instead
 *      and named for what it is.
 */

import { MAX_VERSE_NUMBER, findBook, type BibleBook } from './books.ts';

export interface ParsedReference {
  /** The provider's identifier: `JHN.3.16` or `JHN.3.16-18`. */
  usfm: string;
  /** What we would call it back to the reader before the provider answers. */
  human: string;
  book: BibleBook;
  chapter: number;
  verse: number;
  endVerse: number;
}

/** A refusal carrying a sentence written for the person who typed it. */
export class ReferenceError_ extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceError_';
  }
}

/**
 * How many verses we encourage in one passage.
 *
 * Not enforced as a hard limit — someone reflecting on Romans 8:28-39 has a
 * perfectly good reason — but reported, so the interface can nudge toward the
 * one-to-three verses the reflection format is built around.
 */
export const PREFERRED_MAX_VERSES = 3;

/** Everything that is a dash to a reader, and everything that is a colon. */
const DASHES = /[‐‑‒–—―−]/g;
const COLONS = /[：∶ː]/g;
const SPACES = /[     \t]+/g;

/**
 * The shape a reference has to have.
 *
 * Book, chapter, verse, optional end verse. Chapter-only references
 * ("John 3") are deliberately NOT accepted: a passage card that quietly loads
 * an entire chapter is not the one-to-three verses this feature is for, and
 * silently truncating to verse 1 would be worse. The refusal says so.
 */
const PATTERN = /^(.+?)\s*(\d{1,3})\s*:\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/;

/** A reference already in USFM form, e.g. what a saved reflection stores. */
const USFM_PATTERN = /^([1-3]?[A-Z]{2,3})\.(\d{1,3})\.(\d{1,3})(?:-(\d{1,3}))?$/;

/**
 * Quote back what somebody typed, safely.
 *
 * A refusal reads far better when it names the thing it refused — "we do not
 * know a book called 'Hesitations'" beats "invalid reference" by a mile. But
 * that means user input travels inside a message that is rendered in a browser
 * and may be logged, so it is capped and stripped of the characters that turn a
 * message into markup. React escapes it too; this is the second of the two
 * independent measures, because the first one is only as good as every future
 * component that renders this string.
 */
function echo(raw: string): string {
  const cleaned = raw.replace(/[<>&"'`]/g, '').trim();
  return cleaned.length > 30 ? `${cleaned.slice(0, 30)}…` : cleaned;
}

function normalise(raw: string): string {
  return raw
    .replace(SPACES, ' ')
    .replace(DASHES, '-')
    .replace(COLONS, ':')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a reference, or throw with something worth reading.
 *
 * Accepts both a human reference and a USFM one, because the same function is
 * used on a fresh lookup and on a passage id recovered from a saved reflection,
 * and having two parsers is having one of them be subtly wrong.
 */
export function parseReference(raw: unknown): ParsedReference {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new ReferenceError_('Enter a Bible reference, for example John 3:16.');
  }

  const text = normalise(raw);
  if (text.length > 60) {
    throw new ReferenceError_('That is longer than a Bible reference. Try something like John 3:16.');
  }

  const usfmMatch = USFM_PATTERN.exec(text.toUpperCase().replace(/\s/g, ''));
  const match = usfmMatch ?? PATTERN.exec(text);
  if (!match) {
    throw new ReferenceError_(
      `“${echo(raw)}” is not a reference we recognise. Use a book, chapter and verse — for example John 3:16 or Romans 8:28.`,
    );
  }

  const [, bookText, chapterText, verseText, endText] = match;
  const book = findBook(bookText ?? '');
  if (!book) {
    throw new ReferenceError_(
      `We do not know a book of the Bible called “${echo(bookText ?? '')}”.`,
    );
  }

  const chapter = Number.parseInt(chapterText ?? '', 10);
  const verse = Number.parseInt(verseText ?? '', 10);
  const endVerse = endText === undefined ? verse : Number.parseInt(endText, 10);

  if (!Number.isInteger(chapter) || chapter < 1) {
    throw new ReferenceError_(`Chapter numbers start at 1, so ${book.name} ${chapterText} does not exist.`);
  }
  if (chapter > book.chapters) {
    throw new ReferenceError_(
      `${book.name} has ${book.chapters} chapter${book.chapters === 1 ? '' : 's'}, so ${book.name} ${chapter} does not exist.`,
    );
  }
  if (!Number.isInteger(verse) || verse < 1) {
    throw new ReferenceError_('Verse numbers start at 1.');
  }
  /*
   * The provider is the authority on how many verses a chapter has — see the
   * note in `books.ts`. This ceiling only catches a typo that could not be a
   * verse in any versification.
   */
  if (verse > MAX_VERSE_NUMBER || endVerse > MAX_VERSE_NUMBER) {
    throw new ReferenceError_('That verse number is too high to be a verse.');
  }
  if (endVerse < verse) {
    throw new ReferenceError_(
      `${book.name} ${chapter}:${verse}-${endVerse} runs backwards. Put the lower verse first.`,
    );
  }

  const human =
    endVerse === verse
      ? `${book.name} ${chapter}:${verse}`
      : `${book.name} ${chapter}:${verse}-${endVerse}`;
  const usfm =
    endVerse === verse
      ? `${book.usfm}.${chapter}.${verse}`
      : `${book.usfm}.${chapter}.${verse}-${endVerse}`;

  return { usfm, human, book, chapter, verse, endVerse };
}

/** How many verses a parsed reference spans. */
export function verseCount(reference: ParsedReference): number {
  return reference.endVerse - reference.verse + 1;
}
