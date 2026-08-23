import { HASHTAG_LIMITS, canonicalHashtag, displayHashtag } from './community.ts';

/*
 * What a tag is, said once for both sides of the wire.
 *
 * The folding itself is not here — `canonicalHashtag` in `community.ts` has
 * done it since hashtags existed, and a second normaliser beside it is how two
 * parts of one application come to disagree about whether `#young-adults` and
 * `#youngadults` are the same word. This module is the registry's vocabulary:
 * how many suggestions there may be, what makes a tag acceptable at all, and
 * the one sentence shown when one is refused.
 */

/**
 * How many suggestions a person may be offered.
 *
 * Five, and the server enforces it — a client asking for five hundred gets
 * five. A list longer than this is a panel rather than a hint, and on a phone
 * it covers the thing being written.
 */
export const TAG_SUGGEST_LIMIT = 5;

/**
 * The shortest a tag may be once folded.
 *
 * One character is not a tag anybody searches by, and a registry that
 * accumulates `a`, `b` and `c` fills the top of every suggestion list with
 * them. The maximum is `HASHTAG_LIMITS.canonicalMax`, which the fold already
 * enforces by truncating.
 */
export const TAG_MIN_LENGTH = 2;

/**
 * Why a tag was refused.
 *
 * Codes are for us — logs, tests, and a client deciding which field to mark.
 * None of them is shown to anybody: `TAG_REFUSED_MESSAGE` is what a person
 * reads, and it is the same sentence for every code on purpose. A message that
 * distinguished "too short" from "not allowed" would, over a few attempts,
 * describe the contents of the word list.
 */
export const TAG_REFUSALS = {
  EMPTY: 'tag_empty',
  TOO_SHORT: 'tag_too_short',
  NOT_ALLOWED: 'tag_not_allowed',
} as const;

export type TagRefusal = (typeof TAG_REFUSALS)[keyof typeof TAG_REFUSALS];

/** The one sentence a person sees. Neutral, and never says which rule it was. */
export const TAG_REFUSED_MESSAGE = "This tag isn't allowed. Please choose another.";

export type TagCandidate = { tag: string; label: string };

export type TagCheck =
  | { ok: true; tag: string; label: string }
  | { ok: false; refusal: TagRefusal };

/**
 * Fold what somebody typed, and say whether it can be a tag at all.
 *
 * Syntax only. Whether the word is *allowed* is a separate question answered
 * against the word list on the server, because that list is not something a
 * browser should be given a copy of.
 */
export function checkTagSyntax(raw: string): TagCheck {
  const tag = canonicalHashtag(raw);
  if (!tag) return { ok: false, refusal: TAG_REFUSALS.EMPTY };
  if (tag.length < TAG_MIN_LENGTH) return { ok: false, refusal: TAG_REFUSALS.TOO_SHORT };
  return { ok: true, tag, label: displayHashtag(raw) || tag };
}

/**
 * The words a moderation check should look at, from what was typed.
 *
 * Two forms, because the fold destroys the boundaries a word list needs. The
 * canonical tag is one run of letters — `prayerandfasting` — so comparing a
 * list against it alone can only ever match a tag that IS a listed word, and
 * `#prayer-<slur>` would pass. The separators are still there in the raw text,
 * so the pieces are recovered from it and each is checked as a word.
 *
 * This is not obfuscation detection and is not trying to be: someone who runs
 * two words together defeats it. It is the difference between checking words
 * and checking substrings, and the substring version refuses `assessment`.
 */
export function tagWords(raw: string): string[] {
  const words = raw
    .normalize('NFC')
    .toLowerCase()
    .replace(/^#+/, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
  return words;
}

/** The most tags one reflection may carry, so a caller need not reach for two modules. */
export const TAGS_PER_REFLECTION = HASHTAG_LIMITS.perPublication;
