/*
 * What Community asks the server for, and the shapes it gets back.
 *
 * These types mirror what the API serves rather than what the database holds,
 * and the difference matters in two places:
 *
 *  - **`shareUrl` is optional and its absence is the rule**, not a loading
 *    state. Another member's community publication arrives with no share URL at
 *    all, so a component cannot render one by mistake — there is nothing to
 *    render.
 *  - **There is no save count anywhere in this file**, because there is none in
 *    the payload. `saved` is the reader's own bookmark. The author must never
 *    learn who saved their work or how many did, and a type that cannot express
 *    the number is one fewer place for it to appear.
 *
 * Nothing here filters. Authorisation happened in the query that produced these
 * rows; a client-side filter would be a second, weaker copy of a rule that is
 * already enforced where it counts.
 */

import type { ChatFormat } from '@chat/shared'
import { api } from '../shared/api/client.ts'

export type Destination = 'shared' | 'public' | 'communities'

/** The scope names the API knows. `communities` is a page, not a feed. */
export type FeedScope = 'shared' | 'public' | 'mine'

export type PublicationSection = {
  type: string
  content: string
  authorOrigin: string
}

export type Hashtag = { tag: string; label: string }

export type Publication = {
  id: string
  audience: 'only_me' | 'public' | 'community'
  community: { id: string; name: string } | null
  author: { handle: string; displayName: string }
  isAuthor: boolean
  format: ChatFormat
  title: string
  scriptureReference: string | null
  caption: string
  sections: PublicationSection[]
  hashtags: Hashtag[]
  encouraged: { count: number; byViewer: boolean }
  saved: boolean
  canShareExternally: boolean
  /** Present only when an external link may be handed out. */
  shareUrl?: string
  canModerate: boolean
  moderationState: 'visible' | 'hidden'
  createdAt: string
  updatedAt: string
}

export type ReportReason = { id: string; label: string }

export type FeedResponse = {
  scope: string
  items: Publication[]
  hashtags: Hashtag[]
  reportReasons: ReportReason[]
}

export type CommunitySummary = {
  id: string
  name: string
  description: string
  role: 'owner' | 'moderator' | 'member'
  memberCount: number
  closed: boolean
}

export type Invitation = {
  id: string
  name: string
  description: string
  invitedAt: string
}

export type CommunitiesResponse = {
  communities: CommunitySummary[]
  invitations: Invitation[]
}

export function fetchFeed(options: {
  scope: FeedScope
  query?: string
  tag?: string
  communityId?: string
}): Promise<FeedResponse> {
  const params = new URLSearchParams({ scope: options.scope })
  if (options.query) params.set('q', options.query)
  if (options.tag) params.set('tag', options.tag)
  if (options.communityId) params.set('community', options.communityId)
  return api<FeedResponse>(`/publications?${params.toString()}`)
}

export function fetchPublication(id: string): Promise<Publication> {
  return api<Publication>(`/publications/${id}`)
}

export function fetchCommunities(): Promise<CommunitiesResponse> {
  return api<CommunitiesResponse>('/communities')
}

export function createCommunity(input: {
  name: string
  description: string
}): Promise<CommunitySummary> {
  return api<CommunitySummary>('/communities', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function acceptInvitation(communityId: string): Promise<{ ok: boolean }> {
  return api(`/communities/${communityId}/invitations/accept`, { method: 'POST' })
}

export function inviteToCommunity(
  communityId: string,
  email: string,
): Promise<{ ok: boolean }> {
  return api(`/communities/${communityId}/invitations`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export function setEncouraged(
  id: string,
  encouraged: boolean,
): Promise<{ encouraged: { count: number; byViewer: boolean }; message: string }> {
  return api(`/publications/${id}/encouraged`, {
    method: 'POST',
    body: JSON.stringify({ encouraged }),
  })
}

export function setSaved(
  id: string,
  saved: boolean,
): Promise<{ saved: boolean; message: string }> {
  return api(`/publications/${id}/save`, {
    method: 'POST',
    body: JSON.stringify({ saved }),
  })
}

export function reportPublication(
  id: string,
  reason: string,
  detail = '',
): Promise<{ ok: boolean; hidden: boolean; message: string }> {
  return api(`/publications/${id}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason, detail }),
  })
}

export function setHidden(
  id: string,
  hidden: boolean,
): Promise<{ moderationState: string; message: string }> {
  return api(`/publications/${id}/hide`, {
    method: 'POST',
    body: JSON.stringify({ hidden }),
  })
}

export function deletePublication(id: string): Promise<{ deleted: boolean }> {
  return api(`/publications/${id}`, { method: 'DELETE' })
}
