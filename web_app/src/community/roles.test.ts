import { APPROVAL_POLICY, COMMUNITY_ROLES } from '@chat/shared'
import { expect, test } from 'vitest'
import { canDecideJoins } from './roles.ts'

test('owners and admins may always decide who joins', () => {
  expect(canDecideJoins(COMMUNITY_ROLES.OWNER, APPROVAL_POLICY.OWNER_ADMIN)).toBe(true)
  expect(canDecideJoins(COMMUNITY_ROLES.ADMIN, APPROVAL_POLICY.OWNER_ADMIN)).toBe(true)
  expect(canDecideJoins(COMMUNITY_ROLES.OWNER, APPROVAL_POLICY.MEMBERS)).toBe(true)
})

test('an ordinary member may decide only when the community opened approvals', () => {
  expect(canDecideJoins(COMMUNITY_ROLES.MEMBER, APPROVAL_POLICY.OWNER_ADMIN)).toBe(false)
  expect(canDecideJoins(COMMUNITY_ROLES.MEMBER, APPROVAL_POLICY.MEMBERS)).toBe(true)
  expect(canDecideJoins('moderator', APPROVAL_POLICY.OWNER_ADMIN)).toBe(true)
})
