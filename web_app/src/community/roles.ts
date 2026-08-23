import {
  COMMUNITY_ROLES,
  canModerate,
  readCommunityRole,
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

/** Plain language, never permission terminology. */
export function roleLabel(value: string | null | undefined): string {
  const role = communityRole(value)
  if (role === COMMUNITY_ROLES.OWNER) return 'Owner'
  if (role === COMMUNITY_ROLES.ADMIN) return 'Admin'
  return 'Member'
}
