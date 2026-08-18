/*
 * Looser Scripture matching for Reflections search.
 *
 * Passage lookup refuses a chapter without a verse, because loading John 3
 * whole is not what that feature is for. Search is the opposite problem: a
 * person looking for "John 15" or "Psalm" should find every reflection they
 * filed under that book, including ones stored as "Jn 15:5".
 */

import { findBook } from '../bible/books.ts';
import { parseReference } from '../bible/reference.ts';

export type ScriptureLocator = {
  book: string;
  chapter?: number;
  verse?: number;
  endVerse?: number;
};

const DASHES = /[‐‑‒–—―−]/g;
const COLONS = /[：∶ː]/g;
const SPACES = /[     \t]+/g;
const CHAPTER_ONLY = /^(.+?)\s+(\d{1,3})$/;

function normalise(raw: string): string {
  return raw
    .replace(SPACES, ' ')
    .replace(DASHES, '-')
    .replace(COLONS, ':')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse a search term or a stored reference into a book, and maybe a chapter/verse. */
export function parseScriptureQuery(raw: string): ScriptureLocator | null {
  const text = normalise(raw);
  if (!text) return null;

  try {
    const parsed = parseReference(text);
    return {
      book: parsed.book.usfm,
      chapter: parsed.chapter,
      verse: parsed.verse,
      endVerse: parsed.endVerse,
    };
  } catch {
    /* A chapter without a verse, or a book name, is a valid *search*. */
  }

  const chapterOnly = CHAPTER_ONLY.exec(text);
  if (chapterOnly) {
    const book = findBook(chapterOnly[1] ?? '');
    const chapter = Number.parseInt(chapterOnly[2] ?? '', 10);
    if (book && Number.isInteger(chapter) && chapter >= 1 && chapter <= book.chapters) {
      return { book: book.usfm, chapter };
    }
  }

  const book = findBook(text);
  return book ? { book: book.usfm } : null;
}

export function scriptureMatches(stored: string | null, query: ScriptureLocator): boolean {
  const have = stored ? parseScriptureQuery(stored) : null;
  if (!have || have.book !== query.book) return false;
  if (query.chapter != null && have.chapter !== query.chapter) return false;
  if (query.verse == null) return true;
  const from = have.verse ?? 1;
  const to = have.endVerse ?? from;
  const wantFrom = query.verse;
  const wantTo = query.endVerse ?? wantFrom;
  return wantFrom <= to && wantTo >= from;
}
