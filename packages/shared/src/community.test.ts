import { describe, expect, test } from 'vitest';
import {
  AUDIENCES,
  COMMUNITY_ROLES,
  MEMBERSHIP_STATES,
  audienceLabel,
  canModerate,
  canShareExternally,
  canonicalHashtag,
  grantsAccess,
  parseHashtags,
} from './community.ts';

describe('canonicalHashtag', () => {
  /* The example the specification gives by name. */
  test('the three spellings of one tag resolve to one value', () => {
    expect(canonicalHashtag('#young-adults')).toBe('youngadults');
    expect(canonicalHashtag('#youngadults')).toBe('youngadults');
    expect(canonicalHashtag('#young_adults')).toBe('youngadults');
  });

  test('case and surrounding whitespace do not fragment a tag', () => {
    expect(canonicalHashtag('  #Young Adults  ')).toBe('youngadults');
    expect(canonicalHashtag('YOUNGADULTS')).toBe('youngadults');
  });

  test('repeated hashes are one tag, not a different one', () => {
    expect(canonicalHashtag('##prayer')).toBe('prayer');
  });

  test('letters outside ASCII are kept, because someone chose them', () => {
    expect(canonicalHashtag('#Alabaré')).toBe('alabaré');
    expect(canonicalHashtag('#感謝')).toBe('感謝');
  });

  test('a tag that folds to nothing is not a tag', () => {
    expect(canonicalHashtag('#')).toBe('');
    expect(canonicalHashtag('---')).toBe('');
    expect(canonicalHashtag('   ')).toBe('');
  });
});

describe('parseHashtags', () => {
  test('two spellings of one tag become one tag', () => {
    const tags = parseHashtags(['#young-adults', '#youngadults', '#YoungAdults']);
    expect(tags).toHaveLength(1);
    expect(tags[0]?.tag).toBe('youngadults');
  });

  test('the label keeps what the author typed while the key does the matching', () => {
    const [tag] = parseHashtags(['#young-adults']);
    expect(tag?.tag).toBe('youngadults');
    expect(tag?.label).toBe('young-adults');
  });

  test('a free-text field splits on spaces and commas', () => {
    expect(parseHashtags('#faith, #prayer  #youth').map((t) => t.tag)).toEqual([
      'faith',
      'prayer',
      'youth',
    ]);
  });

  test('the per-publication ceiling is enforced here, not by the caller', () => {
    const many = Array.from({ length: 30 }, (_, index) => `#tag${index}`);
    expect(parseHashtags(many)).toHaveLength(8);
  });

  test('empty entries are dropped rather than stored as blank keys', () => {
    expect(parseHashtags(['', '  ', '#'])).toEqual([]);
  });
});

describe('grantsAccess', () => {
  /*
   * The load-bearing test in this file. Every state but ACTIVE must be false,
   * and adding a state to the enum without deciding this deliberately should
   * break something.
   */
  test('only an active membership grants access', () => {
    expect(grantsAccess(MEMBERSHIP_STATES.ACTIVE)).toBe(true);
    expect(grantsAccess(MEMBERSHIP_STATES.INVITED)).toBe(false);
    expect(grantsAccess(MEMBERSHIP_STATES.PENDING)).toBe(false);
    expect(grantsAccess(MEMBERSHIP_STATES.REMOVED)).toBe(false);
    expect(grantsAccess(MEMBERSHIP_STATES.LEFT)).toBe(false);
  });

  test('no membership at all is no access', () => {
    expect(grantsAccess(null)).toBe(false);
    expect(grantsAccess(undefined)).toBe(false);
  });
});

describe('canModerate', () => {
  test('owners and moderators may; members and strangers may not', () => {
    expect(canModerate(COMMUNITY_ROLES.OWNER)).toBe(true);
    expect(canModerate(COMMUNITY_ROLES.MODERATOR)).toBe(true);
    expect(canModerate(COMMUNITY_ROLES.MEMBER)).toBe(false);
    expect(canModerate(null)).toBe(false);
  });
});

describe('canShareExternally', () => {
  test("another member's community publication gets no share control", () => {
    expect(
      canShareExternally({ audience: AUDIENCES.COMMUNITY, isAuthor: false }),
    ).toBe(false);
  });

  test('anyone may share a public publication', () => {
    expect(canShareExternally({ audience: AUDIENCES.PUBLIC, isAuthor: false })).toBe(
      true,
    );
  });

  test('the author may share their own, whatever its audience', () => {
    for (const audience of Object.values(AUDIENCES)) {
      expect(canShareExternally({ audience, isAuthor: true })).toBe(true);
    }
  });
});

describe('audienceLabel', () => {
  test('a community is named in plain language, not in permission terms', () => {
    expect(audienceLabel(AUDIENCES.COMMUNITY, 'Christlikeness')).toBe(
      'Christlikeness members',
    );
    expect(audienceLabel(AUDIENCES.PUBLIC)).toBe('Public');
    expect(audienceLabel(AUDIENCES.ONLY_ME)).toBe('Only me');
  });

  test('a community whose name is withheld still reads as members-only', () => {
    expect(audienceLabel(AUDIENCES.COMMUNITY, null)).toBe('Community members');
  });
});
