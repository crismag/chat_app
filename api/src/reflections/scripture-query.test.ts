import { expect, test } from 'vitest';
import { parseScriptureQuery, scriptureMatches } from './scripture-query.ts';

test('a full reference, a chapter and a book name all parse', () => {
  expect(parseScriptureQuery('John 15:5')).toEqual({
    book: 'JHN',
    chapter: 15,
    verse: 5,
    endVerse: 5,
  });
  expect(parseScriptureQuery('Jn 15')).toEqual({ book: 'JHN', chapter: 15 });
  expect(parseScriptureQuery('Psalm')).toEqual({ book: 'PSA' });
});

test('Jn 15 finds a reflection stored as John 15:5', () => {
  expect(scriptureMatches('John 15:5', parseScriptureQuery('Jn 15')!)).toBe(true);
  expect(scriptureMatches('John 15:5', parseScriptureQuery('John')!)).toBe(true);
  expect(scriptureMatches('John 15:5', parseScriptureQuery('John 3:16')!)).toBe(false);
  expect(scriptureMatches('Romans 8:28', parseScriptureQuery('John')!)).toBe(false);
});

test('verse ranges overlap rather than requiring an exact string', () => {
  expect(scriptureMatches('Romans 8:28-30', parseScriptureQuery('Romans 8:29')!)).toBe(true);
  expect(scriptureMatches('Romans 8:28-30', parseScriptureQuery('Romans 8:31')!)).toBe(false);
});
