/*
 * Community — the vocabulary the web app, the API and the store must agree on.
 *
 * These names are here rather than in either caller for the same reason the
 * format thresholds are: an audience the browser calls `community` and the
 * database calls `private` is a bug that only shows up as a leak. One
 * implementation, several callers.
 *
 * The rules encoded in this file, in the order they are most often got wrong:
 *
 *  1. **Exactly one audience per publication.** `AUDIENCES` has three values
 *     and a publication carries one. Reaching more than one audience means
 *     more than one publication — which is why nothing here is a set, a list
 *     or a bitmask. The shape refuses the mistake.
 *  2. **A community is not a hashtag.** `canonicalHashtag` folds a tag to a
 *     comparison key, and that key is used for *filtering only*. No function
 *     in this file takes a tag and returns a permission, because no such
 *     function may exist.
 *  3. **Hidden and deleted are different states.** `MODERATION_STATES` covers
 *     visibility; deletion is a separate timestamp on the row. A moderator can
 *     reach the first and not the second while a report is open.
 */

/* --------------------------------------------------------------- audiences */

/**
 * Who a publication is for. Exactly one of these, always.
 *
 * `ONLY_ME` is not "unpublished" — it is a publication the author made for
 * themselves, with its own caption and date, which no URL reaches for anyone
 * else. That is what makes "separate publications for separate audiences"
 * expressible rather than aspirational.
 */
export const AUDIENCES = {
  ONLY_ME: 'only_me',
  PUBLIC: 'public',
  COMMUNITY: 'community',
} as const;

export type Audience = (typeof AUDIENCES)[keyof typeof AUDIENCES];

export const AUDIENCE_VALUES = Object.values(AUDIENCES) as readonly Audience[];

export function isAudience(value: unknown): value is Audience {
  return AUDIENCE_VALUES.includes(value as Audience);
}

/* ------------------------------------------------------------------- roles */

/*
 * Three roles, and deliberately no fourth.
 *
 * `ADMIN` was called `moderator`, which quietly claimed more than it is:
 * community management is not platform moderation, and somebody who can remove
 * a member from their study group cannot remove anybody from C.H.A.T. The
 * stored value is unchanged — rows say `moderator` — and `readCommunityRole`
 * is what keeps that from being a second meaning.
 */
export const COMMUNITY_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
} as const;

export type CommunityRole = (typeof COMMUNITY_ROLES)[keyof typeof COMMUNITY_ROLES];

export const COMMUNITY_ROLE_VALUES = Object.values(
  COMMUNITY_ROLES,
) as readonly CommunityRole[];

export function isCommunityRole(value: unknown): value is CommunityRole {
  return COMMUNITY_ROLE_VALUES.includes(value as CommunityRole);
}

/** Rows written before the role was called Admin say `moderator`. */
export function readCommunityRole(value: unknown): CommunityRole {
  if (value === 'moderator') return COMMUNITY_ROLES.ADMIN;
  return isCommunityRole(value) ? value : COMMUNITY_ROLES.MEMBER;
}

/**
 * Owners and admins may hide, invite, approve and remove. Members may not.
 *
 * What this does NOT gate is sharing. Membership includes the right to
 * participate: there is no owner-only posting, no approved-author list and no
 * broadcast mode, because a community here is a shared space and the moment
 * one person can speak and the others can only listen it has become something
 * else. Ownership carries responsibility for the space, not exclusive use of
 * it.
 */
export function canModerate(role: CommunityRole | null | undefined): boolean {
  return role === COMMUNITY_ROLES.OWNER || role === COMMUNITY_ROLES.ADMIN;
}

/**
 * Whether this person may decide on a join request.
 *
 * Two inputs, because the answer is not a property of the role alone: a
 * community may open approvals to its members, and until it says so the
 * default is the safer one.
 */
export function canApproveMembers(
  role: CommunityRole | null | undefined,
  policy: ApprovalPolicy,
): boolean {
  if (canModerate(role)) return true;
  return policy === APPROVAL_POLICY.MEMBERS && role === COMMUNITY_ROLES.MEMBER;
}

/* ------------------------------------------------------ community settings */

/*
 * What a community is, expressed as four independent settings rather than one
 * `isPrivate` flag.
 *
 * A single flag looks simpler right up until somebody wants a church small
 * group that strangers can *find* and ask to join while everything written
 * inside it stays members-only. With one flag that group has to be called
 * "semi-private", and the next request invents "semi-public", and the meaning
 * of the flag is then whatever the last person to touch it assumed.
 *
 * So: who can find it, who can join it, who can read what is shared there, and
 * who decides on requests. Public and Private remain the two things a person
 * chooses at creation — they are presets over these four, not a field.
 */
export const DISCOVERABILITY = {
  /** Listed, searchable, and readable *as a community* by anyone. */
  PUBLIC: 'public',
  /** Reachable only by people who already know it exists. */
  HIDDEN: 'hidden',
} as const;

export type Discoverability = (typeof DISCOVERABILITY)[keyof typeof DISCOVERABILITY];

export const JOIN_POLICY = {
  /** Any registered person may join, immediately. */
  OPEN: 'open',
  /** They may ask; somebody has to say yes. */
  APPROVAL: 'approval',
  /** They cannot ask. Somebody has to invite them. */
  INVITE: 'invite',
} as const;

export type JoinPolicy = (typeof JOIN_POLICY)[keyof typeof JOIN_POLICY];

/**
 * Who can read what is shared into this community.
 *
 * This is the *default for new shares*, and deliberately not a description of
 * the shares that already exist. Every share carries its own copy of this,
 * fixed at the moment it was made, so that changing the setting here can never
 * reach backwards into something somebody wrote when the answer was different.
 */
export const REFLECTION_VISIBILITY = {
  PUBLIC: 'public',
  MEMBERS: 'members',
} as const;

export type ReflectionVisibility =
  (typeof REFLECTION_VISIBILITY)[keyof typeof REFLECTION_VISIBILITY];

/**
 * Who may approve a join request.
 *
 * Defaults to owner and admins, and that default matters: with every member
 * able to approve, one approved person can let in everybody they know, and the
 * membership control the community was created for is gone in an afternoon.
 * A community may choose otherwise, but it has to choose it.
 */
export const APPROVAL_POLICY = {
  OWNER_ADMIN: 'owner_admin',
  MEMBERS: 'members',
} as const;

export type ApprovalPolicy = (typeof APPROVAL_POLICY)[keyof typeof APPROVAL_POLICY];

export type CommunitySettings = {
  discoverability: Discoverability;
  joinPolicy: JoinPolicy;
  reflectionVisibility: ReflectionVisibility;
  approvalPolicy: ApprovalPolicy;
};

/**
 * The two things somebody actually chooses when they make a community.
 *
 * Presets over the settings above, not a stored kind. Nothing reads a
 * community back and asks "is this the Public preset?" — it asks the four
 * questions, which is why a community can later sit between the presets
 * without needing a third name.
 */
export const COMMUNITY_PRESETS = {
  PUBLIC: 'public',
  PRIVATE: 'private',
} as const;

export type CommunityPreset = (typeof COMMUNITY_PRESETS)[keyof typeof COMMUNITY_PRESETS];

export const PRESET_SETTINGS: Record<CommunityPreset, CommunitySettings> = {
  [COMMUNITY_PRESETS.PUBLIC]: {
    discoverability: DISCOVERABILITY.PUBLIC,
    joinPolicy: JOIN_POLICY.OPEN,
    reflectionVisibility: REFLECTION_VISIBILITY.PUBLIC,
    approvalPolicy: APPROVAL_POLICY.OWNER_ADMIN,
  },
  /*
   * Discoverable, because a group nobody can find is a different and rarer
   * thing than a group not everybody can join. Hidden remains available; it is
   * not what "Private" means by default.
   */
  [COMMUNITY_PRESETS.PRIVATE]: {
    discoverability: DISCOVERABILITY.PUBLIC,
    joinPolicy: JOIN_POLICY.APPROVAL,
    reflectionVisibility: REFLECTION_VISIBILITY.MEMBERS,
    approvalPolicy: APPROVAL_POLICY.OWNER_ADMIN,
  },
};

function oneOf<T extends string>(values: Record<string, T>, value: unknown, fallback: T): T {
  return Object.values(values).includes(value as T) ? (value as T) : fallback;
}

/**
 * Settings as they come back from a row or a request.
 *
 * Every fallback is the more private of the two options. A value nobody
 * recognises must never be the reason something becomes readable.
 */
export function readCommunitySettings(value: unknown): CommunitySettings {
  const source = (value ?? {}) as Record<string, unknown>;
  return {
    discoverability: oneOf(DISCOVERABILITY, source['discoverability'], DISCOVERABILITY.HIDDEN),
    joinPolicy: oneOf(JOIN_POLICY, source['joinPolicy'], JOIN_POLICY.INVITE),
    reflectionVisibility: oneOf(
      REFLECTION_VISIBILITY,
      source['reflectionVisibility'],
      REFLECTION_VISIBILITY.MEMBERS,
    ),
    approvalPolicy: oneOf(APPROVAL_POLICY, source['approvalPolicy'], APPROVAL_POLICY.OWNER_ADMIN),
  };
}

/**
 * Whether a settings change increases who can see what is already there.
 *
 * The one transition an administrator may not simply make: somebody shared
 * into a twelve-person group on the understanding that twelve people would
 * read it, and no later setting change is allowed to turn that into the open
 * internet. Reducing exposure is always allowed and needs no ceremony.
 */
export function increasesExposure(before: CommunitySettings, after: CommunitySettings): boolean {
  return (
    before.reflectionVisibility === REFLECTION_VISIBILITY.MEMBERS &&
    after.reflectionVisibility === REFLECTION_VISIBILITY.PUBLIC
  );
}

/* -------------------------------------------------------------- membership */

/**
 * The membership lifecycle.
 *
 * **`ACTIVE` is the only state that grants sight of a community publication.**
 * The specification says "currently active member" and this constant is what
 * makes that phrase mechanical: every read predicate in the store compares
 * against `MEMBERSHIP_STATES.ACTIVE` and nothing else, so an invited person, a
 * pending one, a removed one and someone who left are all equally unable to
 * see the content — including through an old URL they still have.
 *
 * Muting is deliberately *not* a state here. A mute restricts publishing, not
 * reading, so modelling it as a state would have forced a choice between two
 * wrong answers: either `muted` joins the viewing predicate and "active" stops
 * meaning active, or a muted member silently loses access they should keep.
 * It is a separate `mutedAt` timestamp on an otherwise active row.
 */
export const MEMBERSHIP_STATES = {
  INVITED: 'invited',
  PENDING: 'pending',
  ACTIVE: 'active',
  REMOVED: 'removed',
  LEFT: 'left',
  /*
   * Banned is not a stronger word for removed; it is a different fact.
   *
   * A removed person may ask again, and an invitation still reaches them —
   * removal says "not now" and often means a misunderstanding. A ban says the
   * community has decided, and it has to survive the three ways people get
   * back in: joining an open community, asking again, and being invited by
   * somebody who was not in the argument. Collapsing the two would mean either
   * removal is unforgiving or a ban is a formality.
   */
  BANNED: 'banned',
} as const;

export type MembershipState =
  (typeof MEMBERSHIP_STATES)[keyof typeof MEMBERSHIP_STATES];

/** The single predicate every access check reduces to. */
export function grantsAccess(state: MembershipState | null | undefined): boolean {
  return state === MEMBERSHIP_STATES.ACTIVE;
}

/** A ban outlives the way somebody tries to come back. */
export function isBanned(state: MembershipState | null | undefined): boolean {
  return state === MEMBERSHIP_STATES.BANNED;
}

/** Whether this person is waiting on a decision. Never two at once. */
export function isPending(state: MembershipState | null | undefined): boolean {
  return state === MEMBERSHIP_STATES.PENDING;
}

/* -------------------------------------------------------------- moderation */

/**
 * Whether a publication is shown, which is *not* whether it exists.
 *
 * Hiding is reversible, visible to moderators, and leaves the row intact for a
 * report to point at. Deletion is the author's, and is refused while a report
 * is open. Collapsing the two into one field is how evidence gets erased by
 * someone with a legitimate reason to hide something.
 */
export const MODERATION_STATES = {
  VISIBLE: 'visible',
  HIDDEN: 'hidden',
} as const;

export type ModerationState =
  (typeof MODERATION_STATES)[keyof typeof MODERATION_STATES];

export const REPORT_STATES = {
  OPEN: 'open',
  REVIEWED: 'reviewed',
} as const;

export type ReportState = (typeof REPORT_STATES)[keyof typeof REPORT_STATES];

/**
 * Why a publication may be reported.
 *
 * The platform list from the guidelines, including "not a genuine C.H.A.T.
 * reflection" — which applies to a publication where it did not apply to a
 * profile. Served to the browser from the API so there is one list, not two
 * that drift.
 */
export const PUBLICATION_REPORT_REASONS = [
  { id: 'spam', label: 'Spam or advertising' },
  { id: 'scam', label: 'Scam or suspicious link' },
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'hate', label: 'Hate or abusive content' },
  { id: 'sexual', label: 'Sexual or inappropriate content' },
  { id: 'harm', label: 'Threats or dangerous content' },
  { id: 'private_information', label: 'Reveals private information' },
  { id: 'impersonation', label: 'Impersonation' },
  { id: 'not_a_reflection', label: 'Not a genuine C.H.A.T. reflection' },
  { id: 'copyright', label: 'Copyright or ownership' },
  { id: 'other', label: 'Something else' },
] as const;

/**
 * What is deliberately not on that list, and why.
 *
 * There is no "I disagree with this", no "false teaching", no "bad theology",
 * no "wrong interpretation" and no denominational category. This application
 * is for people writing about Scripture; strong disagreement about what a
 * passage means is the ordinary substance of that, not an infraction, and a
 * report button that offers to adjudicate it would turn moderation into a
 * doctrinal court and every disagreement into a case.
 *
 * The line the categories above draw is between conduct and content: what
 * somebody does to another person, or to the platform, rather than what they
 * believe about a text.
 */
export const NOT_REPORTABLE = [
  'disagreement with an interpretation',
  'doctrine or denomination',
  'a testimony somebody finds unlikely',
  'a political opinion',
] as const;

/**
 * Whether this report can be submitted as written.
 *
 * "Something else" needs a sentence — a category that means "none of these"
 * with no explanation is a report nobody can act on, and asking for one is
 * also a small brake on reporting somebody in a temper.
 */
export function reportIsSubmittable(reason: string, note: string): boolean {
  if (!isReportReason(reason)) return false;
  return reason !== 'other' || note.trim().length >= 10;
}

export type PublicationReportReason =
  (typeof PUBLICATION_REPORT_REASONS)[number]['id'];

const REPORT_REASON_IDS: ReadonlySet<string> = new Set(
  PUBLICATION_REPORT_REASONS.map((reason) => reason.id as string),
);

export function isReportReason(value: unknown): value is PublicationReportReason {
  return typeof value === 'string' && REPORT_REASON_IDS.has(value);
}

/* ---------------------------------------------------------------- hashtags */

/**
 * The one reaction this product has.
 *
 * Named as a constant rather than written as a string in four places because
 * the rule attached to it is easy to erode: one per user per publication,
 * removable, and **no counterpart**. There is no dislike, no downvote, no
 * rating and no second reaction to add alongside it, so this is a single value
 * and not the first entry in a list that invites a second.
 */
export const ENCOURAGED = 'encouraged' as const;

/* ---------------------------------------------------------------- hashtags */

export const HASHTAG_LIMITS = {
  /** The longest a tag may be once folded. */
  canonicalMax: 40,
  /** How many one publication may carry. */
  perPublication: 8,
} as const;

/** A sharing caption is not part of the C.H.A.T. and cannot extend its budget. */
export const CAPTION_MAX = 280;

export const COMMUNITY_LIMITS = {
  name: 60,
  description: 280,
} as const;

/**
 * Fold a tag to the value it is compared and stored by.
 *
 * `#young-adults`, `#youngadults`, `#Young_Adults` and ` #YOUNG ADULTS ` all
 * come back as `youngadults`, so a filter matches what a person meant rather
 * than how they happened to punctuate it. Separators are *removed* rather than
 * normalised to one character, because normalising still leaves `youngadults`
 * and `young-adults` as two different keys — which is the exact fragmentation
 * this exists to prevent.
 *
 * Accented letters are kept: `#alabaré` is a word someone chose. Only the
 * separators and the case go.
 *
 * Returns `''` for anything that folds to nothing, which callers treat as "not
 * a tag" rather than storing an empty key.
 */
export function canonicalHashtag(raw: string): string {
  return raw
    .normalize('NFC')
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, HASHTAG_LIMITS.canonicalMax);
}

/**
 * The tag as it is shown, derived from what the author typed.
 *
 * Kept beside the canonical key so `#young-adults` can still read as
 * `#young-adults` on the author's own card while matching `#youngadults` in a
 * filter. Display is cosmetic; the key is what the query uses.
 */
export function displayHashtag(raw: string): string {
  const trimmed = raw.trim().replace(/^#+/, '').replace(/\s+/g, '-');
  return trimmed.slice(0, HASHTAG_LIMITS.canonicalMax * 2);
}

/**
 * Parse whatever the author typed into a de-duplicated, bounded tag list.
 *
 * De-duplication is by canonical key, so typing `#young-adults #youngadults`
 * yields one tag and not two that will later disagree about their own count.
 */
export function parseHashtags(input: readonly string[] | string): {
  tag: string;
  label: string;
}[] {
  const raw = Array.isArray(input)
    ? input
    : String(input).split(/[\s,]+/);
  const seen = new Set<string>();
  const tags: { tag: string; label: string }[] = [];

  for (const candidate of raw) {
    const text = String(candidate).trim();
    if (!text) continue;
    const tag = canonicalHashtag(text);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push({ tag, label: displayHashtag(text) || tag });
    if (tags.length >= HASHTAG_LIMITS.perPublication) break;
  }

  return tags;
}

/* ------------------------------------------------------- sharing behaviour */

/**
 * Whether an external Share control may exist for this publication at all.
 *
 * Not "whether it is enabled" — whether it is rendered. The rule for another
 * member's community publication is *no share control*, and a disabled button
 * is still a control that tells the reader an export exists somewhere.
 *
 *  - the author's own, at any audience: yes, they own the underlying content
 *  - anyone's public publication: yes, that is what public means
 *  - another member's community publication: **no**
 *  - another person's Only Me: unreachable, so the question never arises
 */
export function canShareExternally({
  audience,
  isAuthor,
}: {
  audience: Audience;
  isAuthor: boolean;
}): boolean {
  if (isAuthor) return true;
  return audience === AUDIENCES.PUBLIC;
}

/** The quiet audience label shown on a card. Never colour alone. */
export function audienceLabel(
  audience: Audience,
  communityName?: string | null,
): string {
  if (audience === AUDIENCES.PUBLIC) return 'Public';
  if (audience === AUDIENCES.ONLY_ME) return 'Only me';
  return communityName ? `${communityName} members` : 'Community members';
}
