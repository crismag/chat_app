import {
  APPROVAL_POLICY,
  COMMUNITY_ROLES,
  canApproveMembers,
  canModerate,
  readCommunityRole,
  type ApprovalPolicy,
  type CommunityRole,
} from '@chat/shared'

/** The role as the rest of the product speaks it. */
export function communityRole(value: string | null | undefined): CommunityRole {
  return readCommunityRole(value)
}

export function isOwner(value: string | null | undefined): boolean {
  return communityRole(value) === COMMUNITY_ROLES.OWNER
}

export function isManager(value: string | null | undefined): boolean {
  return canModerate(communityRole(value))
}

/**
 * Whether this person may decide on a join request.
 *
 * Ownership is not the only answer: a community may open approvals to every
 * member, and until it says so the default stays with the owner and admins.
 */
export function canDecideJoins(
  role: string | null | undefined,
  policy: ApprovalPolicy | null | undefined,
): boolean {
  return canApproveMembers(communityRole(role), policy ?? APPROVAL_POLICY.OWNER_ADMIN)
}

/** Plain language, never permission terminology. */
export function roleLabel(value: string | null | undefined): string {
  const role = communityRole(value)
  if (role === COMMUNITY_ROLES.OWNER) return 'Owner'
  if (role === COMMUNITY_ROLES.ADMIN) return 'Admin'
  return 'Member'
}
