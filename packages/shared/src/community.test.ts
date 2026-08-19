import { describe, expect, test } from 'vitest';
import {
  APPROVAL_POLICY,
  AUDIENCES,
  COMMUNITY_PRESETS,
  DISCOVERABILITY,
  JOIN_POLICY,
  PRESET_SETTINGS,
  REFLECTION_VISIBILITY,
  canApproveMembers,
  increasesExposure,
  readCommunityRole,
  readCommunitySettings,
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
  test('owners and admins may; members and strangers may not', () => {
    expect(canModerate(COMMUNITY_ROLES.OWNER)).toBe(true);
    expect(canModerate(COMMUNITY_ROLES.ADMIN)).toBe(true);
    expect(canModerate(COMMUNITY_ROLES.MEMBER)).toBe(false);
    expect(canModerate(null)).toBe(false);
  });

  /* Rows written before the role was called Admin say `moderator`. */
  test('a row from before the rename still reads as Admin', () => {
    expect(readCommunityRole('moderator')).toBe(COMMUNITY_ROLES.ADMIN);
    expect(readCommunityRole('owner')).toBe(COMMUNITY_ROLES.OWNER);
    /* Anything unrecognised is the least powerful thing it could be. */
    expect(readCommunityRole('platform-god')).toBe(COMMUNITY_ROLES.MEMBER);
  });
});

/*
 * Moderating and approving are different questions. A community may open
 * approvals to its members, and until it says so the answer is the safer one:
 * with every member able to approve, one approved person can let in everybody
 * they know and the membership control is gone in an afternoon.
 */
describe('canApproveMembers', () => {
  test('owners and admins always may', () => {
    for (const policy of [APPROVAL_POLICY.OWNER_ADMIN, APPROVAL_POLICY.MEMBERS]) {
      expect(canApproveMembers(COMMUNITY_ROLES.OWNER, policy)).toBe(true);
      expect(canApproveMembers(COMMUNITY_ROLES.ADMIN, policy)).toBe(true);
    }
  });

  test('members may only where the community has said so', () => {
    expect(canApproveMembers(COMMUNITY_ROLES.MEMBER, APPROVAL_POLICY.OWNER_ADMIN)).toBe(false);
    expect(canApproveMembers(COMMUNITY_ROLES.MEMBER, APPROVAL_POLICY.MEMBERS)).toBe(true);
  });

  test('somebody who is not in the community never may', () => {
    expect(canApproveMembers(null, APPROVAL_POLICY.MEMBERS)).toBe(false);
  });
});

/*
 * The presets are two doors into one model. What matters is that neither
 * invents a concept: both produce the same four settings, and a community can
 * later sit between them without needing a third name.
 */
describe('the Public and Private presets', () => {
  test('Public is open, discoverable and readable', () => {
    expect(PRESET_SETTINGS[COMMUNITY_PRESETS.PUBLIC]).toEqual({
      discoverability: DISCOVERABILITY.PUBLIC,
      joinPolicy: JOIN_POLICY.OPEN,
      reflectionVisibility: REFLECTION_VISIBILITY.PUBLIC,
      approvalPolicy: APPROVAL_POLICY.OWNER_ADMIN,
    });
  });

  test('Private controls membership without hiding the community', () => {
    const settings = PRESET_SETTINGS[COMMUNITY_PRESETS.PRIVATE];
    /* Findable, so a newcomer can ask — that is not the same as joinable. */
    expect(settings.discoverability).toBe(DISCOVERABILITY.PUBLIC);
    expect(settings.joinPolicy).toBe(JOIN_POLICY.APPROVAL);
    expect(settings.reflectionVisibility).toBe(REFLECTION_VISIBILITY.MEMBERS);
  });

  test('anything unrecognised reads as the most private answer', () => {
    expect(readCommunitySettings({ discoverability: 'sort-of' })).toEqual({
      discoverability: DISCOVERABILITY.HIDDEN,
      joinPolicy: JOIN_POLICY.INVITE,
      reflectionVisibility: REFLECTION_VISIBILITY.MEMBERS,
      approvalPolicy: APPROVAL_POLICY.OWNER_ADMIN,
    });
  });
});

/*
 * The rule an administrator cannot get around: a person shared into a small
 * group on the understanding that the group would read it, and no later
 * setting change turns that into the open internet.
 */
describe('increasesExposure', () => {
  const members = PRESET_SETTINGS[COMMUNITY_PRESETS.PRIVATE];
  const open = PRESET_SETTINGS[COMMUNITY_PRESETS.PUBLIC];

  test('members-only to public increases it', () => {
    expect(increasesExposure(members, open)).toBe(true);
  });

  test('public to members-only does not — reducing exposure is always allowed', () => {
    expect(increasesExposure(open, members)).toBe(false);
  });

  test('changing who may join is not a change to who may read', () => {
    expect(
      increasesExposure(members, { ...members, joinPolicy: JOIN_POLICY.OPEN }),
    ).toBe(false);
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
