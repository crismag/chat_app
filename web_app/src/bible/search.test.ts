/*
 * What the translation search has to find.
 *
 * The catalog below is real — the awkward parts of it especially. `NVI` exists
 * twice, in Spanish and in Portuguese; `CCB` is Chinese while the Cebuano Bible
 * is `APD`; the New International Version sits between `NIrV` and `NIVUK`, all
 * three of which begin with the same three letters when folded.
 *
 * Every test here is a query somebody would actually type.
 */

import { describe, expect, test } from 'vitest'
import { editDistance, fold, searchTranslations, similarity } from './search.ts'
import type { BibleTranslation } from '@chat/shared'

function entry(
  id: number,
  abbreviation: string,
  name: string,
  language: string,
  languageName: string,
  languageAliases?: string[],
): BibleTranslation {
  return {
    id,
    abbreviation,
    name,
    language,
    languageName,
    ...(languageAliases ? { languageAliases } : {}),
  }
}

const CATALOG: BibleTranslation[] = [
  entry(12, 'ASV', 'American Standard Version', 'en', 'English'),
  entry(110, 'NIrV', 'New International Reader’s Version 2014', 'en', 'English'),
  entry(111, 'NIV', 'New International Version', 'en', 'English'),
  entry(113, 'NIVUK', 'New International Version (Anglicised) 2011', 'en', 'English'),
  entry(206, 'WEBUS', 'World English Bible, American English Edition', 'en', 'English'),
  entry(2079, 'EASY', 'EasyEnglish Bible 2024', 'en', 'English'),
  entry(3034, 'BSB', 'Berean Standard Bible', 'en', 'English'),
  entry(1290, 'TLAB', 'Ang Biblia 1978', 'tl', 'Filipino', ['Tagalog', 'Pilipino']),
  entry(1291, 'ASD', 'Ang Salita ng Dios', 'tl', 'Filipino', ['Tagalog', 'Pilipino']),
  entry(1396, 'APD', 'Ang Pulong Sa Dios', 'ceb', 'Cebuano', ['Bisaya', 'Binisaya', 'Visayan']),
  entry(128, 'RVES', 'Reina Valera 1960', 'es', 'Spanish', ['Castilian', 'Espanol', 'Español']),
  entry(103, 'NVI', 'Nueva Versión Internacional', 'es', 'Spanish', ['Castilian', 'Espanol']),
  entry(129, 'NVI-PT', 'Nova Versão Internacional', 'pt', 'Portuguese', ['Portugues', 'Brazilian']),
  entry(37, 'BDS', 'La Bible du Semeur 2015', 'fr', 'French', ['Francais', 'Français']),
  entry(51, 'Hfa', 'Hoffnung für Alle', 'de', 'German', ['Deutsch']),
  entry(36, 'CCB', '当代译本', 'zh', 'Chinese', ['Mandarin', 'Putonghua']),
]

const idsFor = (query: string) =>
  searchTranslations(CATALOG, query).map((hit) => hit.translation.id)

const top = (query: string) => searchTranslations(CATALOG, query)[0]

describe('finding a translation by what it is called', () => {
  /*
   * The single most important assertion in this file, and the same hazard the
   * backend's family resolution exists for. `niv` must be the New International
   * Version — not the Reader's Version, not the Anglicised edition — because
   * the cost of getting it wrong is somebody reading a different Bible than the
   * one they asked for.
   */
  test('an exact abbreviation always ranks first', () => {
    const hit = top('niv')
    expect(hit?.translation.id).toBe(111)
    expect(hit?.reason).toBe('EXACT_ABBREVIATION')
    /* The near-misses are still offered, just behind it. */
    expect(idsFor('niv')).toContain(113)
  })

  test('case and punctuation do not matter', () => {
    expect(top('NIV')?.translation.id).toBe(111)
    expect(top('N.I.V.')?.translation.id).toBe(111)
    expect(top('nirv')?.translation.id).toBe(110)
    expect(top('NIrV')?.translation.id).toBe(110)
  })

  test('an abbreviation prefix finds the shortest match first', () => {
    expect(top('tla')?.translation.id).toBe(1290)
    expect(top('bs')?.translation.id).toBe(3034)
  })

  test('finds a translation by its full name', () => {
    expect(top('berean')?.translation.id).toBe(3034)
    expect(top('Berean Standard Bible')?.translation.id).toBe(3034)
    /* A word from the middle of the title, not just the start. */
    expect(idsFor('standard')).toContain(3034)
  })

  test('finds Reina Valera, accents or no accents', () => {
    expect(top('reina')?.translation.id).toBe(128)
    expect(top('reina valera')?.translation.id).toBe(128)
    expect(top('valera')?.translation.id).toBe(128)
    expect(top('Nueva Version')?.translation.id).toBe(103)
    expect(top('Nueva Versión')?.translation.id).toBe(103)
  })
})

describe('finding a translation by its language', () => {
  test('by language code', () => {
    expect(idsFor('tl').sort()).toEqual([1290, 1291])
    expect(idsFor('ceb')).toEqual([1396])
    expect(idsFor('es').sort()).toEqual([103, 128])
  })

  test('by language name', () => {
    expect(idsFor('filipino').sort()).toEqual([1290, 1291])
    expect(idsFor('cebuano')).toEqual([1396])
    expect(idsFor('spanish').sort()).toEqual([103, 128])
  })

  /*
   * The platform renders `tl` as "Filipino". Most people would type "Tagalog",
   * and a search that refuses them is a search that looks broken — which is
   * exactly the report that prompted this work.
   */
  test('by what people actually call the language', () => {
    expect(idsFor('tagalog').sort()).toEqual([1290, 1291])
    expect(idsFor('bisaya')).toEqual([1396])
    expect(idsFor('mandarin')).toEqual([36])
    expect(idsFor('castilian').sort()).toEqual([103, 128])
  })

  test('a language search never leaks another language in', () => {
    expect(idsFor('tagalog')).not.toContain(1396)
    expect(idsFor('cebuano')).not.toContain(1290)
    /* CCB is Chinese; the Cebuano Bible is APD. Confusing them is the bug the
     * language column on every row exists to prevent. */
    expect(idsFor('cebuano')).not.toContain(36)
  })
})

describe('forgiving what people type', () => {
  test.each([
    ['tagaolg', 1290],
    ['taglog', 1290],
    ['filipno', 1290],
    ['bereen', 3034],
    ['cebuno', 1396],
    ['spainsh', 103],
  ])('a misspelling still finds it: %s', (query, expected) => {
    expect(idsFor(query)).toContain(expected)
  })

  test('a transposition costs one edit, not two', () => {
    expect(editDistance('niv', 'nvi')).toBe(1)
    expect(editDistance('tagalog', 'tagaolg')).toBe(1)
    expect(similarity('tagalog', 'tagalog')).toBe(1)
  })

  /*
   * The result that made this rule necessary. `ceb` is Cebuano's language code
   * and is also one edit from `CCB`, a Chinese Bible. Offering both puts a
   * reader one careless click from a Bible they cannot read, in a list where
   * both rows look equally deliberate.
   */
  test('a literal match suppresses the guesses beside it', () => {
    expect(idsFor('ceb')).toEqual([1396])
    expect(idsFor('ceb')).not.toContain(36)
    /* But with nothing literal to go on, the guess is still worth offering. */
    expect(idsFor('cebuno')).toContain(1396)
  })

  /*
   * The result that made the rule stronger. `berean` matches "Berean Standard
   * Bible" by name prefix — and fuzzy-matches the LANGUAGE NAME "German",
   * which differs from it by two substitutions in six characters. Searching
   * for one English Bible returned it followed by every German one.
   */
  test('searching for a Bible by name does not drag in a whole language', () => {
    expect(idsFor('berean')).toEqual([3034])
    expect(idsFor('berean')).not.toContain(51)
    /* Sanity: German Bibles are still findable by their actual language. */
    expect(idsFor('german')).toEqual([51])
  })

  test('nonsense matches nothing rather than everything', () => {
    expect(idsFor('qqqqzzzz')).toEqual([])
    expect(idsFor('klingon')).toEqual([])
  })

  test('two-letter noise is not fuzzy-matched into the whole catalog', () => {
    /* At two characters almost everything is one edit from everything, so
     * fuzzy matching is switched off below three — otherwise a stray keystroke
     * returns the entire list and the search looks broken in the other
     * direction. */
    expect(idsFor('zz')).toEqual([])
  })
})

describe('several words at once', () => {
  test('every word must match, so the query narrows rather than widens', () => {
    const spanishInternational = idsFor('spanish internacional')
    expect(spanishInternational).toContain(103)
    expect(spanishInternational).not.toContain(129)
    expect(spanishInternational).not.toContain(111)
  })

  test('language plus name finds the one Bible meant', () => {
    expect(top('filipino biblia')?.translation.id).toBe(1290)
  })
})

describe('the empty query', () => {
  test('shows the whole catalog in its own order', () => {
    expect(idsFor('')).toEqual(CATALOG.map((entry) => entry.id))
    expect(idsFor('   ')).toHaveLength(CATALOG.length)
  })
})

describe('folding', () => {
  test('strips accents and case', () => {
    expect(fold('Español')).toBe('espanol')
    expect(fold('  Versión  ')).toBe('versión'.normalize('NFD').replace(/[̀-ͯ]/g, ''))
    expect(fold('NIrV')).toBe('nirv')
  })
})

describe('ordering is stable', () => {
  test('the same query gives the same order every time', () => {
    expect(idsFor('international')).toEqual(idsFor('international'))
    expect(idsFor('bible')).toEqual(idsFor('bible'))
  })
})
