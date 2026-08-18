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

  test('a tag that folds to nothing is not a tag', () => {
    expect(canonicalHashtag('#')).toBe('');
    expect(canonicalHashtag('---')).toBe('');
    expect(canonicalHashtag('   ')).toBe('');
  });
});

describe('parseHashtags', () => {

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
