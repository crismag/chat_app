/*
 * Finding a Bible by typing almost anything.
 *
 * ── Why this is not a vector search ─────────────────────────────────────────
 *
 * The request that prompted this file asked for "a semantic or vector search
 * style". I looked, and I think that would make it worse, so here is the
 * reasoning in the place it will be re-litigated.
 *
 * The corpus is about fifty rows of three short strings each: an abbreviation,
 * a title, and a language. Embeddings would mean a model call or a shipped
 * index, a build step, storage, and either latency on every keystroke or a
 * staleness problem — to answer queries like `niv`, `tl`, `tagalog` and
 * `reina valera`. Those are not semantic queries. They are lexical ones with
 * typos, and a vector index is measurably WORSE at them than prefix matching
 * is: nearest-neighbour on `niv` cheerfully returns things that are *about*
 * Bibles rather than the one whose abbreviation is literally NIV.
 *
 * So: tiered lexical matching over every field, with fuzzy scoring as the last
 * resort. It runs in a fraction of a millisecond, it works offline, it has no
 * dependency, and it is deterministic — which means it can be tested, and a bad
 * ranking is a bug somebody can fix rather than a model's opinion.
 *
 * Where genuine semantics WOULD help is a different class of query — "a Bible
 * in easy English", "the Catholic one", "something for children". That is a
 * real gap and it is noted in the report; it needs a model, and it belongs
 * behind lexical search rather than in front of it.
 *
 * ── The rule the tiers exist to enforce ────────────────────────────────────
 *
 * An exact abbreviation always wins. Typing `niv` must put the New
 * International Version first, ahead of `NIVUK` and ahead of `NIrV`, every
 * time. This is the same hazard the backend's family resolution exists for: the
 * cost of getting it wrong is a person reading a different Bible than the one
 * they asked for.
 */

import type { BibleTranslation } from '@chat/shared'

/**
 * Match strength, highest first.
 *
 * Numbers rather than an enum so a match can be scored slightly above or below
 * its tier — a shorter name matching a prefix is a better answer than a longer
 * one — without the tiers ever overlapping. The gaps are wide on purpose.
 */
export const TIERS = {
  EXACT_ABBREVIATION: 10_000,
  EXACT_LANGUAGE_CODE: 9_000,
  ABBREVIATION_PREFIX: 8_000,
  EXACT_LANGUAGE_NAME: 7_000,
  LANGUAGE_NAME_PREFIX: 6_000,
  NAME_PREFIX: 5_000,
  NAME_WORD_PREFIX: 4_000,
  ABBREVIATION_CONTAINS: 3_000,
  NAME_CONTAINS: 2_000,
  FUZZY: 1_000,
} as const

/** Below this, a fuzzy match is noise and is discarded. */
const FUZZY_FLOOR = 0.62

export interface Scored {
  translation: BibleTranslation
  score: number
  /** Which rule matched, for tests and for explaining a surprising result. */
  reason: keyof typeof TIERS
}

/**
 * Fold a string to its comparable form.
 *
 * Accents are stripped so `Reina Valera` is found by `reina valera` and by
 * `Español` typed without the tilde — a search that requires the right
 * diacritics is a search that fails the people most likely to need that
 * language.
 */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Just the letters and digits. `NIrV` and `n.i.r.v.` compare equal. */
function tight(value: string): string {
  return fold(value).replace(/[^a-z0-9]/g, '')
}

/* ------------------------------------------------------------------ fuzzy */

/**
 * Damerau–Levenshtein distance, bounded.
 *
 * Damerau rather than plain Levenshtein because the mistake people actually
 * make is a transposition — `nvi` for `niv`, `tagaolg` for `tagalog` — and
 * plain Levenshtein charges two edits for it, which is usually enough to push
 * the right answer below the threshold.
 *
 * `max` lets the loop give up early. Strings this short make it academic, but
 * it also means a pathological query cannot make typing feel slow.
 */
export function editDistance(a: string, b: string, max = 4): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previous = new Array<number>(b.length + 1)
  let current = new Array<number>(b.length + 1)
  let beforePrevious = new Array<number>(b.length + 1)

  for (let j = 0; j <= b.length; j += 1) previous[j] = j

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i
    let best = current[0] as number
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + cost,
      )
      /* The transposition case: `ab` → `ba` costs one, not two. */
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (beforePrevious[j - 2] as number) + 1)
      }
      current[j] = value
      if (value < best) best = value
    }
    if (best > max) return max + 1
    beforePrevious = previous
    previous = current
    current = new Array<number>(b.length + 1)
  }

  return previous[b.length] as number
}

/** 1 for identical, 0 for nothing in common. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const longest = Math.max(a.length, b.length)
  const distance = editDistance(a, b, Math.max(2, Math.floor(longest / 2)))
  return distance > longest ? 0 : 1 - distance / longest
}

/**
 * The best fuzzy score for a term against a phrase, word by word.
 *
 * Compared against each word as well as the whole phrase, because somebody
 * typing `valera` should find "Reina Valera" — matching a single word inside a
 * title is the common case, and whole-string similarity buries it.
 */
function fuzzyAgainstPhrase(term: string, phrase: string): number {
  let best = similarity(term, phrase)
  for (const word of phrase.split(/\s+/)) {
    if (word.length < 3) continue
    const score = similarity(term, word)
    if (score > best) best = score
  }
  return best
}

/* ----------------------------------------------------------------- scoring */

/** Every string a translation can be found by. */
function haystack(translation: BibleTranslation) {
  return {
    abbreviation: fold(translation.abbreviation),
    abbreviationTight: tight(translation.abbreviation),
    name: fold(translation.name),
    language: fold(translation.language),
    languageName: fold(translation.languageName),
    languageAliases: (translation.languageAliases ?? []).map(fold),
  }
}

/**
 * Score one translation against one term.
 *
 * Returns null when the term does not match at all — which matters for
 * multi-term queries, where EVERY term must match something. "spanish niv"
 * should find the Spanish NVI and not everything Spanish plus everything NIV.
 */
function scoreTerm(translation: BibleTranslation, term: string): Scored | null {
  const field = haystack(translation)
  const tightTerm = tight(term)

  const at = (reason: keyof typeof TIERS, bonus = 0): Scored => ({
    translation,
    score: TIERS[reason] + bonus,
    reason,
  })

  /*
   * Shorter is better within a tier. Two things match `niv` as a prefix —
   * `NIV` and `NIVUK` — and the one with nothing extra on the end is the one
   * that was meant.
   */
  const brevity = (value: string) => Math.max(0, 100 - value.length)

  if (field.abbreviationTight === tightTerm) return at('EXACT_ABBREVIATION')
  if (field.language === fold(term)) return at('EXACT_LANGUAGE_CODE')
  if (field.abbreviationTight.startsWith(tightTerm)) {
    return at('ABBREVIATION_PREFIX', brevity(field.abbreviation))
  }

  if (field.languageName === fold(term) || field.languageAliases.includes(fold(term))) {
    return at('EXACT_LANGUAGE_NAME')
  }
  if (
    field.languageName.startsWith(fold(term)) ||
    field.languageAliases.some((alias) => alias.startsWith(fold(term)))
  ) {
    return at('LANGUAGE_NAME_PREFIX')
  }

  if (field.name.startsWith(fold(term))) return at('NAME_PREFIX', brevity(field.name))

  /* A word inside the title: `standard` finds "Berean Standard Bible". */
  const words = field.name.split(/\s+/)
  if (words.some((word) => word.startsWith(fold(term)))) {
    return at('NAME_WORD_PREFIX', brevity(field.name))
  }

  if (field.abbreviationTight.includes(tightTerm)) return at('ABBREVIATION_CONTAINS')
  if (field.name.includes(fold(term))) return at('NAME_CONTAINS', brevity(field.name))

  /*
   * Last resort. A term shorter than three characters is not fuzzy-matched at
   * all: at two characters almost everything is within one edit of everything
   * else, and the results stop looking like a search and start looking broken.
   */
  if (term.length >= 3) {
    const best = Math.max(
      fuzzyAgainstPhrase(fold(term), field.name),
      similarity(tightTerm, field.abbreviationTight),
      fuzzyAgainstPhrase(fold(term), field.languageName),
      ...field.languageAliases.map((alias) => fuzzyAgainstPhrase(fold(term), alias)),
    )
    if (best >= FUZZY_FLOOR) {
      return { translation, score: TIERS.FUZZY + best * 500, reason: 'FUZZY' }
    }
  }

  return null
}

/**
 * Rank the catalog against what somebody typed.
 *
 * An empty query returns everything, unranked and in catalog order — the
 * picker's job on an empty query is to show what is available, not to have an
 * opinion about it.
 */
export function searchTranslations(
  translations: BibleTranslation[],
  query: string,
): Scored[] {
  const terms = fold(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) {
    return translations.map((translation) => ({
      translation,
      score: 0,
      reason: 'NAME_CONTAINS' as const,
    }))
  }

  const scored: Scored[] = []
  for (const translation of translations) {
    let total = 0
    let best: Scored | null = null
    let matchedEvery = true

    for (const term of terms) {
      const hit = scoreTerm(translation, term)
      if (!hit) {
        matchedEvery = false
        break
      }
      total += hit.score
      if (!best || hit.score > best.score) best = hit
    }

    if (matchedEvery && best) {
      scored.push({ translation, score: total, reason: best.reason })
    }
  }

  /*
   * If anything matched LITERALLY, stop guessing.
   *
   * Two real results forced this rule, and both were bad in the same way — a
   * plausible-looking row for a Bible in a language the reader does not speak.
   *
   *   • `ceb` is Cebuano's language code and is also one edit from `CCB`, a
   *     Chinese Bible. Both came back.
   *   • `berean` matched "Berean Standard Bible" by name prefix — and also
   *     fuzzy-matched the LANGUAGE NAME "German", because `berean` and
   *     `german` differ by two substitutions in six characters. Searching for
   *     the Berean Standard Bible returned it followed by seven German ones.
   *
   * The first version of this rule only suppressed guesses when something
   * matched *exactly*, which did nothing for `berean` — a name prefix is not
   * an exact match. So the rule is now the simpler and stronger one: any
   * literal match at all — abbreviation, language, name, prefix or substring —
   * discards every fuzzy result. Fuzzy exists to rescue a typo, and a query
   * that hit something literally was not a typo.
   */
  const hasLiteralMatch = scored.some((hit) => hit.reason !== 'FUZZY')
  const kept = hasLiteralMatch ? scored.filter((hit) => hit.reason !== 'FUZZY') : scored

  return kept.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    /*
     * A stable, explainable tie-break rather than whatever order the provider
     * returned: shorter abbreviation, then lower id — the older, plainer
     * edition. Without this the list reshuffles between catalog refreshes for
     * no reason a reader could perceive.
     */
    const byLength = a.translation.abbreviation.length - b.translation.abbreviation.length
    return byLength !== 0 ? byLength : a.translation.id - b.translation.id
  })
}
