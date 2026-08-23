/*
 * One community, at its own address.
 *
 * Creating a community used to be the end of the story: the owner could invite
 * and approve, and that was the whole of "management". This page is the rest —
 * the name, the settings, the people, and the one decision a community cannot
 * put off forever: who is responsible for it when the person who started it
 * is ready to hand that on.
 *
 * Authorisation stays on the server. This page asks for the community and the
 * roster, and renders the controls the role it was given may use. A member
 * sees who is here and can leave. An admin can invite and remove. An owner
 * can change what the community is, and can name another owner.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  APPROVAL_POLICY,
  COMMUNITY_ROLES,
  DISCOVERABILITY,
  JOIN_POLICY,
  MEMBERSHIP_STATES,
  REFLECTION_VISIBILITY,
  type ApprovalPolicy,
  type CommunityRole,
  type Discoverability,
  type JoinPolicy,
  type ReflectionVisibility,
} from '@chat/shared'
import { ApiError } from '../shared/api/client.ts'
import { useAuth } from '../auth/useAuth.ts'
import { useMobileBar } from '../shared/mobile/MobileBar.tsx'
import { PageMenu } from '../shared/mobile/PageMenu.tsx'
import { NARROW_QUERY, useMediaQuery } from '../shared/ui/useMediaQuery.ts'
import { MoreIcon } from '../shared/ui/icons.tsx'
import { AuthorLink } from '../shared/ui/AuthorLink.tsx'
import {
  addCommunityOwner,
  deleteCommunity,
  fetchCommunity,
  fetchMembers,
  inviteToCommunity,
  leaveCommunity,
  updateCommunityDetails,
  updateCommunitySettings,
  updateMember,
  type CommunityDetail,
  type CommunityMember,
} from './api.ts'
import { JoinRequests } from './JoinRequests.tsx'
import { canDecideJoins, isManager, isOwner, roleLabel } from './roles.ts'
import styles from './CommunityPage.module.css'

type Failure = {
  kind: 'unavailable' | 'unauthorised' | 'community-gone' | 'offline'
  message: string
  action: string
}

function describe(caught: unknown): Failure {
  if (caught instanceof ApiError) {
    if (caught.status === 401) {
      return {
        kind: 'unauthorised',
        message: 'You are no longer signed in, so this cannot be shown.',
        action: 'Sign in again',
      }
    }
    if (caught.status === 403 || caught.status === 404) {
      return {
        kind: 'community-gone',
        message:
          'This community is no longer available to you. You may have left it, or it may have been closed.',
        action: 'Return to Community',
      }
    }
    if (caught.status === 503) {
      return { kind: 'unavailable', message: caught.message, action: 'Try again' }
    }
  }
  return {
    kind: 'offline',
    message: 'This community could not be loaded just now.',
    action: 'Try again',
  }
}

function stateLabel(state: string): string | null {
  if (state === MEMBERSHIP_STATES.INVITED) return 'Invited'
  if (state === MEMBERSHIP_STATES.PENDING) return 'Asking to join'
  if (state === MEMBERSHIP_STATES.REMOVED) return 'Removed'
  if (state === MEMBERSHIP_STATES.LEFT) return 'Left'
  if (state === MEMBERSHIP_STATES.BANNED) return 'Banned'
  return null
}

function matchesMember(member: CommunityMember, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const handle = (member.handle ?? '').toLowerCase()
  const name = member.displayName.toLowerCase()
  return handle.includes(needle) || name.includes(needle) || `@${handle}`.includes(needle)
}

export function CommunityManagePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const narrow = useMediaQuery(NARROW_QUERY)
  const [menuOpen, setMenuOpen] = useState(false)
  const [community, setCommunity] = useState<CommunityDetail | null>(null)
  const [members, setMembers] = useState<CommunityMember[]>([])
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setFailure(null)
    try {
      const [found, roster] = await Promise.all([fetchCommunity(id), fetchMembers(id)])
      setCommunity(found)
      setMembers(roster)
    } catch (caught: unknown) {
      setFailure(describe(caught))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useMobileBar(
    () => ({
      title: community?.name ?? 'Community',
      titleIsHeading: false,
      onBack: () => void navigate('/community'),
      backLabel: 'Back to Community',
      actions: (
        <button
          type="button"
          className={styles.barAction}
          aria-label="Menu"
          onClick={() => setMenuOpen(true)}
        >
          <MoreIcon />
        </button>
      ),
    }),
    [community?.name],
  )

  const act = useCallback(async (work: () => Promise<string | null>) => {
    setProblem(null)
    try {
      const message = await work()
      if (message) setNotice(message)
      await load()
    } catch (caught: unknown) {
      setProblem(caught instanceof Error ? caught.message : 'That could not be done.')
    }
  }, [load])

  if (loading && !community) {
    return (
      <section className={styles.manage} aria-busy="true">
        <div className={styles.detailSkeleton} />
      </section>
    )
  }

  if (failure || !community) {
    return (
      <section className={styles.manage}>
        <PageMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
        <section className={styles.failure} role="alert">
          <p>{failure?.message ?? 'This community is no longer available to you.'}</p>
          {failure?.kind === 'unauthorised' ? (
            <Link className="btn btn-primary" to="/login">
              {failure.action}
            </Link>
          ) : (
            <Link className="btn btn-secondary" to="/community">
              {failure?.action ?? 'Return to Community'}
            </Link>
          )}
        </section>
      </section>
    )
  }

  const owner = isOwner(community.role)
  const manager = isManager(community.role)
  const decidesJoins = canDecideJoins(community.role, community.settings.approvalPolicy)
  const heading = owner || manager ? `Manage ${community.name}` : community.name

  return (
    <section className={styles.manage}>
      <PageMenu open={menuOpen} onClose={() => setMenuOpen(false)} />

      {narrow ? null : (
        <header className={styles.header}>
          <div>
            <p className="eyebrow">
              <Link className={styles.back} to="/community">
                Community
              </Link>
            </p>
            <h1 className={styles.title}>{heading}</h1>
            <p className={styles.description}>
              {community.description || 'A community you belong to.'}
            </p>
            <p className={styles.communityMeta}>
              {roleLabel(community.role)}
              {' · '}
              {community.memberCount === 1 ? '1 member' : `${community.memberCount} members`}
              {community.ownerCount > 1 ? ` · ${community.ownerCount} owners` : ''}
              {community.settings.approvalPolicy === 'members'
                ? ' · any member may approve joins'
                : ''}
            </p>
          </div>
        </header>
      )}

      <p className={styles.notice} role="status" aria-live="polite">
        {notice}
      </p>
      {problem ? (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      ) : null}

      {owner ? (
        <DetailsForm
          community={community}
          onSave={(name, description) =>
            void act(async () => {
              await updateCommunityDetails(community.id, { name, description })
              return `${name} has been updated.`
            })
          }
        />
      ) : null}

      {owner ? (
        <SettingsForm
          community={community}
          onSave={(settings, message) =>
            void act(async () => {
              const result = await updateCommunitySettings(community.id, settings)
              return result.note ?? message
            })
          }
        />
      ) : null}

      <MembersPanel
        community={community}
        members={members}
        viewerId={user?.id ?? ''}
        onInvite={(email) =>
          void act(async () => {
            await inviteToCommunity(community.id, email)
            return 'Invitation sent.'
          })
        }
        onRole={(member, role) =>
          void act(async () => {
            await updateMember(community.id, member.userId, { role })
            return `${member.displayName} is now ${roleLabel(role).toLowerCase()}.`
          })
        }
        onState={(member, state) =>
          void act(async () => {
            await updateMember(community.id, member.userId, { state })
            if (state === MEMBERSHIP_STATES.BANNED) return `${member.displayName} is banned.`
            if (state === MEMBERSHIP_STATES.REMOVED) return `${member.displayName} has been removed.`
            return `${member.displayName} is back in.`
          })
        }
        onDelegate={(input) =>
          void act(async () => {
            const result = await addCommunityOwner(community.id, input)
            if (result.steppedDown) {
              return 'They are now the owner. You remain as an admin.'
            }
            if (result.invited) {
              return result.note ?? 'They have been invited as an owner. They become one when they accept.'
            }
            return 'They are now an owner of this community.'
          })
        }
      />

      {decidesJoins ? (
        <JoinRequests
          communityId={community.id}
          headingLevel="h2"
          onNotice={setNotice}
          onError={(caught) =>
            setProblem(caught instanceof Error ? caught.message : 'That could not be done.')
          }
          onChanged={() => void load()}
        />
      ) : null}

      <DangerZone
        community={community}
        onLeave={() =>
          void act(async () => {
            await leaveCommunity(community.id)
            navigate('/community')
            return 'You have left this community.'
          })
        }
        onClose={() =>
          void act(async () => {
            await deleteCommunity(community.id)
            navigate('/community')
            return 'The community is closed. Everyone’s reflections are still theirs.'
          })
        }
      />
    </section>
  )
}

function DetailsForm({
  community,
  onSave,
}: {
  community: CommunityDetail
  onSave: (name: string, description: string) => void
}) {
  const [name, setName] = useState(community.name)
  const [description, setDescription] = useState(community.description)

  useEffect(() => {
    setName(community.name)
    setDescription(community.description)
  }, [community.name, community.description])

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault()
        onSave(name, description)
      }}
    >
      <h2 className={styles.sectionHeading}>Community details</h2>
      <label className="label" htmlFor="manage-name">
        Name
      </label>
      <input
        id="manage-name"
        className="input"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
      />
      <label className="label" htmlFor="manage-description">
        What is it for?
      </label>
      <input
        id="manage-description"
        className="input"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <button type="submit" className="btn btn-primary btn-sm">
        Save details
      </button>
    </form>
  )
}

function SettingsForm({
  community,
  onSave,
}: {
  community: CommunityDetail
  onSave: (settings: CommunityDetail['settings'], message: string) => void
}) {
  const [discoverability, setDiscoverability] = useState<Discoverability>(
    community.settings.discoverability,
  )
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>(community.settings.joinPolicy)
  const [visibility, setVisibility] = useState<ReflectionVisibility>(
    community.settings.reflectionVisibility,
  )
  const [approvals, setApprovals] = useState<ApprovalPolicy>(community.settings.approvalPolicy)

  useEffect(() => {
    setDiscoverability(community.settings.discoverability)
    setJoinPolicy(community.settings.joinPolicy)
    setVisibility(community.settings.reflectionVisibility)
    setApprovals(community.settings.approvalPolicy)
  }, [community.settings])

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault()
        onSave(
          {
            discoverability,
            joinPolicy,
            reflectionVisibility: visibility,
            approvalPolicy: approvals,
          },
          'Community settings saved.',
        )
      }}
    >
      <h2 className={styles.sectionHeading}>How this community works</h2>

      <label className="label" htmlFor="manage-discoverability">
        Who can find it?
      </label>
      <select
        id="manage-discoverability"
        className="input"
        value={discoverability}
        onChange={(event) => setDiscoverability(event.target.value as Discoverability)}
      >
        <option value={DISCOVERABILITY.PUBLIC}>Anyone can find it</option>
        <option value={DISCOVERABILITY.HIDDEN}>Only people who already know it</option>
      </select>

      <label className="label" htmlFor="manage-join">
        Who can join?
      </label>
      <select
        id="manage-join"
        className="input"
        value={joinPolicy}
        onChange={(event) => setJoinPolicy(event.target.value as JoinPolicy)}
      >
        <option value={JOIN_POLICY.OPEN}>Anyone can join</option>
        <option value={JOIN_POLICY.APPROVAL}>People ask; you decide</option>
        <option value={JOIN_POLICY.INVITE}>Invitation only</option>
      </select>

      <label className="label" htmlFor="manage-visibility">
        Who can read shared reflections?
      </label>
      <select
        id="manage-visibility"
        className="input"
        value={visibility}
        onChange={(event) => setVisibility(event.target.value as ReflectionVisibility)}
      >
        <option value={REFLECTION_VISIBILITY.MEMBERS}>Members only</option>
        <option value={REFLECTION_VISIBILITY.PUBLIC}>Anyone</option>
      </select>
      <p className="hint">
        Changing this applies to what is shared from now on. Reflections already
        shared here keep the visibility they were shared with.
      </p>

      <label className="label" htmlFor="manage-approvals">
        Who can approve membership requests?
      </label>
      <select
        id="manage-approvals"
        className="input"
        value={approvals}
        onChange={(event) => setApprovals(event.target.value as ApprovalPolicy)}
      >
        <option value={APPROVAL_POLICY.OWNER_ADMIN}>You and your admins</option>
        <option value={APPROVAL_POLICY.MEMBERS}>Any member</option>
      </select>
      {approvals === APPROVAL_POLICY.MEMBERS ? (
        <p className="hint">
          Any approved member can then let people in. Most communities keep this
          with the owner and admins.
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary btn-sm">
        Save settings
      </button>
    </form>
  )
}

function MembersPanel({
  community,
  members,
  viewerId,
  onInvite,
  onRole,
  onState,
  onDelegate,
}: {
  community: CommunityDetail
  members: CommunityMember[]
  viewerId: string
  onInvite: (email: string) => void
  onRole: (member: CommunityMember, role: CommunityRole) => void
  onState: (member: CommunityMember, state: typeof MEMBERSHIP_STATES.REMOVED | typeof MEMBERSHIP_STATES.BANNED | typeof MEMBERSHIP_STATES.ACTIVE) => void
  onDelegate: (input: { userId?: string; email?: string; handle?: string; stepDown?: boolean }) => void
}) {
  const owner = isOwner(community.role)
  const manager = isManager(community.role)
  const [query, setQuery] = useState('')
  const [email, setEmail] = useState('')
  const [delegateTo, setDelegateTo] = useState('')
  const [stepDown, setStepDown] = useState(false)

  const visible = useMemo(() => members.filter((member) => matchesMember(member, query)), [members, query])
  const activeOwners = members.filter(
    (member) => isOwner(member.role) && member.state === MEMBERSHIP_STATES.ACTIVE,
  )
  const identifiable = members.filter(
    (member) =>
      member.userId !== viewerId &&
      (member.state === MEMBERSHIP_STATES.ACTIVE || member.state === MEMBERSHIP_STATES.INVITED),
  )

  return (
    <section className={styles.manageSection}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionHeading}>People</h2>
        <p className={styles.communityMeta}>
          {activeOwners.length === 1
            ? 'One owner'
            : `${activeOwners.length} owners`}
        </p>
      </div>

      <label className="sr-only" htmlFor="member-search">
        Find a member by name or handle
      </label>
      <input
        id="member-search"
        className="input"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Find someone by name or handle"
      />

      {visible.length === 0 ? (
        <p className={styles.communityBody}>Nobody matches that.</p>
      ) : (
        <ul className={styles.memberList}>
          {visible.map((member) => {
            const you = member.userId === viewerId
            const extra = stateLabel(member.state)
            return (
              <li key={member.userId} className={styles.memberRow}>
                <div>
                  <AuthorLink
                    className={styles.author}
                    author={{
                      handle: member.handle ?? '',
                      displayName: you ? `${member.displayName} (you)` : member.displayName,
                    }}
                    showHandle
                  />
                  <p className={styles.communityMeta}>
                    {roleLabel(member.role)}
                    {extra ? ` · ${extra}` : ''}
                    {member.muted ? ' · muted' : ''}
                  </p>
                </div>
                {owner && !you && member.state === MEMBERSHIP_STATES.ACTIVE ? (
                  <label className="sr-only" htmlFor={`role-${member.userId}`}>
                    Role for {member.displayName}
                  </label>
                ) : null}
                {owner && !you && member.state === MEMBERSHIP_STATES.ACTIVE ? (
                  <select
                    id={`role-${member.userId}`}
                    className={`input ${styles.roleSelect}`}
                    value={member.role}
                    onChange={(event) => onRole(member, event.target.value as CommunityRole)}
                  >
                    <option value={COMMUNITY_ROLES.MEMBER}>Member</option>
                    <option value={COMMUNITY_ROLES.ADMIN}>Admin</option>
                    <option value={COMMUNITY_ROLES.OWNER}>Owner</option>
                  </select>
                ) : null}
                {manager && !you && member.state === MEMBERSHIP_STATES.ACTIVE ? (
                  <span className={styles.memberActions}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onState(member, MEMBERSHIP_STATES.REMOVED)}
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onState(member, MEMBERSHIP_STATES.BANNED)}
                    >
                      Ban
                    </button>
                  </span>
                ) : null}
                {manager && !you && member.state === MEMBERSHIP_STATES.BANNED ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onState(member, MEMBERSHIP_STATES.ACTIVE)}
                  >
                    Lift ban
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {manager ? (
        <form
          className={styles.inviteForm}
          onSubmit={(event) => {
            event.preventDefault()
            onInvite(email)
            setEmail('')
          }}
        >
          <h3 className={styles.joinRequestsHeading}>Invite someone</h3>
          <label className="sr-only" htmlFor="manage-invite">
            Email address to invite
          </label>
          <input
            id="manage-invite"
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="their@email.address"
            required
          />
          <button type="submit" className="btn btn-primary btn-sm">
            Send invitation
          </button>
        </form>
      ) : null}

      {owner ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault()
            const named = delegateTo.trim()
            const member = identifiable.find(
              (row) =>
                row.userId === named ||
                row.handle === named.replace(/^@/, '') ||
                `@${row.handle}` === named,
            )
            if (member) {
              onDelegate({ userId: member.userId, stepDown })
            } else if (named.includes('@') && !named.startsWith('@')) {
              onDelegate({ email: named, stepDown })
            } else {
              onDelegate({ handle: named.replace(/^@/, ''), stepDown })
            }
            setDelegateTo('')
          }}
        >
          <h3 className={styles.joinRequestsHeading}>Delegate ownership</h3>
          <p className="hint">
            Name someone already in this community, or add a person by their email
            or public handle. They become responsible for the space. You can stay
            an owner, or step down once they are in.
          </p>
          <label className="label" htmlFor="delegate-person">
            Who should be an owner?
          </label>
          <input
            id="delegate-person"
            className="input"
            list="delegate-people"
            value={delegateTo}
            onChange={(event) => setDelegateTo(event.target.value)}
            placeholder="Name, @handle, or email"
            required
          />
          <datalist id="delegate-people">
            {identifiable.map((member) => (
              <option
                key={member.userId}
                value={member.handle ? `@${member.handle}` : member.displayName}
              >
                {member.displayName}
                {member.handle ? ` (@${member.handle})` : ''}
              </option>
            ))}
          </datalist>
          <label className={styles.preset}>
            <input
              type="checkbox"
              checked={stepDown}
              onChange={(event) => setStepDown(event.target.checked)}
            />
            <span>
              <strong>Step down after they are an owner</strong>
              <span className={styles.presetDetail}>
                You become an admin. There must already be another active owner —
                an invitation that has not been accepted yet is not enough.
              </span>
            </span>
          </label>
          <button type="submit" className="btn btn-primary btn-sm">
            Add as owner
          </button>
        </form>
      ) : null}
    </section>
  )
}

function DangerZone({
  community,
  onLeave,
  onClose,
}: {
  community: CommunityDetail
  onLeave: () => void
  onClose: () => void
}) {
  const lastOwner = isOwner(community.role) && community.ownerCount <= 1
  const [confirmClose, setConfirmClose] = useState(false)

  return (
    <section className={styles.danger}>
      <h2 className={styles.sectionHeading}>Leave or close</h2>
      <p className="hint">
        Leaving takes you out of this community. Closing takes the space itself.
        Nobody’s reflections are deleted either way.
      </p>
      {lastOwner ? (
        <p className="hint">
          Make someone else an owner before you leave. A community keeps at least
          one owner.
        </p>
      ) : (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onLeave}>
          Leave this community
        </button>
      )}
      {isOwner(community.role) ? (
        confirmClose ? (
          <div className={styles.closeConfirm}>
            <p className={styles.communityBody}>
              Close {community.name}? Members lose the space. Their writing stays
              with them.
            </p>
            <span className={styles.memberActions}>
              <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
                Close community
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmClose(false)}
              >
                Keep it
              </button>
            </span>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setConfirmClose(true)}
          >
            Close this community
          </button>
        )
      ) : null}
    </section>
  )
}
