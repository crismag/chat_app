/*
 * Choosing a translation, and why it is not a string comparison.
 *
 * The brief for this work said: prefer NIV, then NIRV, then AMP, then BSB, and
 * never silently substitute a translation the reader did not choose. Written
 * the obvious way — `list.find(t => t.abbreviation === 'NIV')` — those two
 * instructions contradict each other, because **there is no translation whose
 * abbreviation is `NIV`.** The provider calls it `NIV11`. The exact match
 * fails, the loop falls through to the Berean Standard Bible, and the reader is
 * handed a different Bible with no indication that anything happened. That is
 * precisely the substitution the brief forbade, produced by following it
 * literally.
 *
 * The same trap is set three more times in the same list: `NASB1995` not
 * `NASB`, `engWEBUS` not `WEB`, `NIrV` not `NIRV` (the `r` is lower case).
 *
 * So matching happens against a *family* — a normalised name a reader would
 * recognise — and every translation declares the family keys it answers to, in
 * tiers. An exact match always beats a derived one, which is what stops `NIV`
 * from resolving to `NIrV` (id 110) or the Anglicised `NIVUK11` (id 113). The
 * resolved id is asserted in the test suite: the test says 111, not "NIV",
 * because 111 is the fact and the string is a label.
 */

import type { BibleTranslation } from '@chat/shared';
import type { ProviderTranslation } from './types.ts';

/**
 * The house order, by family rather than by abbreviation.
 *
 * NIV first because it is what most readers of this application read. BSB
 * second because it is public domain, which makes it the safe fallback when a
 * licensed translation is unreachable.
 */
export const PREFERRED_FAMILIES = ['NIV', 'NIRV', 'AMP', 'BSB'] as const;

/** Upper case, letters and digits only. `NIrV` and `nirv` become `NIRV`. */
export function normaliseAbbreviation(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Trailing edition digits: `NIV11` → `NIV`, `NASB1995` → `NASB`. */
function withoutEdition(value: string): string {
  return value.replace(/\d+$/, '');
}

/** A leading ISO-639-3 style language code: `ENGWEBUS` → `WEBUS`. */
function withoutLanguagePrefix(value: string): string {
  return /^(ENG|SPA|FRA|DEU|POR)[A-Z]/.test(value) ? value.slice(3) : value;
}

/** A trailing two-letter region: `WEBUS` → `WEB`. */
function withoutRegion(value: string): string {
  return /^[A-Z]{3,}(US|UK|GB|AU|CA)$/.test(value) ? value.slice(0, -2) : value;
}

/**
 * The family keys a translation answers to, best first.
 *
 * Tier 0 is what the provider actually calls it — both the raw abbreviation and
 * the localized one, which for id 111 is exactly `NIV`. Tiers 1 and 2 are
 * derived and only ever consulted when no translation matched at a better tier.
 *
 * Exported for the tests, which pin the tier of each real abbreviation. A
 * refactor that quietly promotes a derived match to tier 0 would re-open the
 * substitution bug, and the test is what stops it.
 */
export function familyKeys(translation: ProviderTranslation): string[][] {
  const raw = normaliseAbbreviation(translation.abbreviation);
  const localized = normaliseAbbreviation(translation.localizedAbbreviation);

  const tier0 = [raw, localized];
  const tier1 = [withoutEdition(raw), withoutEdition(localized)];
  const tier2 = [
    withoutRegion(withoutEdition(withoutLanguagePrefix(raw))),
    withoutRegion(withoutEdition(localized)),
  ];

  return [tier0, tier1, tier2].map((tier) => tier.filter((key) => key.length > 0));
}

/**
 * Find the translation belonging to a family, or nothing.
 *
 * Returns `null` rather than a best guess. A caller that wanted NIV and cannot
 * have it needs to *know* that, so it can either fall through its own
 * preference list deliberately or tell the reader — never quietly hand over a
 * different Bible.
 */
export function findByFamily(
  translations: ProviderTranslation[],
  family: string,
): ProviderTranslation | null {
  const wanted = normaliseAbbreviation(family);
  for (let tier = 0; tier < 3; tier += 1) {
    const matches = translations.filter((translation) =>
      (familyKeys(translation)[tier] ?? []).includes(wanted),
    );
    if (matches.length === 0) continue;
    /*
     * More than one match inside a tier is resolved by the shorter
     * abbreviation, then by the lower id — the older, plainer edition. It does
     * not arise for any family in `PREFERRED_FAMILIES` against today's English
     * catalog (asserted in the tests), and a deterministic rule beats whatever
     * order the provider happened to return.
     */
    return (
      matches.sort((a, b) => {
        const byLength = normaliseAbbreviation(a.abbreviation).length -
          normaliseAbbreviation(b.abbreviation).length;
        return byLength !== 0 ? byLength : a.id - b.id;
      })[0] ?? null
    );
  }
  return null;
}

/**
 * The translation to offer when the reader has not chosen one.
 *
 * Order: their previous choice, then the house preferences by family, then the
 * first usable translation in the catalog. A previous choice that is no longer
 * in the catalog is NOT quietly replaced — this returns the next candidate, and
 * the caller is expected to tell the reader that their translation is
 * unavailable and let them approve the change.
 */
export function defaultTranslation(
  translations: ProviderTranslation[],
  previousId?: number,
): ProviderTranslation | null {
  if (previousId !== undefined) {
    const previous = translations.find((translation) => translation.id === previousId);
    if (previous) return previous;
  }
  for (const family of PREFERRED_FAMILIES) {
    const match = findByFamily(translations, family);
    if (match) return match;
  }
  return translations[0] ?? null;
}

/**
 * The wire shape.
 *
 * `abbreviation` is the localized one — `NIV`, not `NIV11` — because that is
 * what a reader is looking for in a picker and what belongs under a passage.
 * The provider's raw abbreviation is not sent: the browser has no use for it
 * and every field that crosses the boundary is a field the frontend can start
 * depending on.
 */
export function toWire(translation: ProviderTranslation): BibleTranslation {
  return {
    id: translation.id,
    abbreviation: translation.localizedAbbreviation,
    name: translation.name,
    language: translation.language,
    ...(translation.copyright ? { copyright: translation.copyright } : {}),
    ...(translation.publisherUrl ? { publisherUrl: translation.publisherUrl } : {}),
    ...(translation.youVersionUrl ? { youVersionUrl: translation.youVersionUrl } : {}),
  };
}
