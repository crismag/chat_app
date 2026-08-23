/*
 * What the word list refuses, and — more importantly — what it must not.
 *
 * A filter like this fails in two directions and only one of them is visible.
 * Letting a word through is embarrassing; refusing `assessment`, `classic` or
 * `Song of Songs` is the thing people actually complain about, and nobody
 * reports it because the message deliberately does not say why. So the
 * false-positive half of this file is the longer half on purpose.
 */
import { describe, expect, test } from 'vitest';
import { canonicalHashtag } from '@chat/shared';
import { bannedWordCount, isTagAllowed } from './moderation.ts';

function allowed(raw: string): boolean {
  return isTagAllowed(raw, canonicalHashtag(raw));
}

test('the list is actually loaded', () => {
  /* A missing file degrades to allowing everything, which would make every
   * assertion below pass for the wrong reason. */
  expect(bannedWordCount()).toBeGreaterThan(300);
});

describe('what it refuses', () => {
  test('a listed word as the whole tag', () => {
    expect(allowed('#shit')).toBe(false);
  });

  test('case and a leading hash change nothing', () => {
    for (const raw of ['SHIT', '#Shit', '  shit  ', '#SHIT']) {
      expect(allowed(raw)).toBe(false);
    }
  });

  /*
   * The reason `tagWords` exists. The fold removes separators, so the canonical
   * form of this is one run of letters that is not itself on the list — a
   * check against the folded tag alone would let it through.
   */
  test('a listed word as one word of a longer tag', () => {
    expect(allowed('#prayer-shit')).toBe(false);
    expect(allowed('#shit_happens')).toBe(false);
  });

  test('a multi-word entry, which folds to one run of letters', () => {
    expect(allowed('#alabamahotpocket')).toBe(false);
    expect(allowed('#alabama-hot-pocket')).toBe(false);
  });
});

describe('what it must not refuse', () => {
  /*
   * Each of these contains the letters of a listed word. Substring matching —
   * the obvious implementation — refuses every one.
   */
  test('innocent words that contain a listed word', () => {
    for (const raw of [
      'assessment',
      'assembly',
      'class',
      'classic',
      'passage',
      'compassion',
      'grape',
      'scunthorpe',
      'analysis',
      'buttress',
      'cockburn',
      'shittim',
    ]) {
      expect(allowed(raw), raw).toBe(true);
    }
  });

  /*
   * The collision this application is most exposed to. A generic profanity list
   * is not written with Scripture, hymnody or church vocabulary in mind, and a
   * tag input that refuses these is worse than no tag input.
   */
  test('ordinary religious and Biblical vocabulary', () => {
    for (const raw of [
      'prayer',
      'god',
      'jesus',
      'christ',
      'hell',
      'sin',
      'lust',
      'flesh',
      'blood',
      'circumcision',
      'concubine',
      'songofsongs',
      'nativity',
      'passion',
      'gospel',
      'psalms',
      'faith',
      'bible-study',
      'alabaré',
    ]) {
      expect(allowed(raw), raw).toBe(true);
    }
  });

  test('accented and non-Latin tags are not refused for being unfamiliar', () => {
    for (const raw of ['oración', 'gebet', '祈り', 'молитва']) {
      expect(allowed(raw), raw).toBe(true);
    }
  });
});

/*
 * Stated rather than assumed. V1 does not chase disguised words, and writing
 * that down as a test means the limitation is a decision somebody made and can
 * find, not a gap that looks like an oversight.
 */
test('running words together defeats it, and that is the accepted V1 limit', () => {
  expect(allowed('#prayerandshittalk')).toBe(true);
});
