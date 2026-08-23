/*
 * Community.
 *
 * ── The destinations, and the one that is missing ──────────────────────────
 *
 * **Shared · Public · Communities.** Not "For You" — there is no
 * personalisation behind this page, and a tab named for one would be a claim
 * the software cannot keep. "Shared" and "Public" describe the content
 * honestly: what people you are in community with have shared, and what anyone
 * may read.
 *
 * ── Where authorisation is not ─────────────────────────────────────────────
 *
 * Not here. `GET /api/publications` applies the visibility predicate inside the
 * query that produces the rows, and this component renders what it is given.
 * There is no `.filter()` on audience, no membership check, and no way for an
 * unauthorised publication to arrive in the first place. A page that filters is
 * a page one refactor away from leaking.
 *
 * ── What this page deliberately is not ─────────────────────────────────────
 *
 * No composer, generic or otherwise — sharing starts from a reflection, in
 * Reflect. No comment threads, no follower counts, no activity feed, no
 * trending, no "Most liked", and no disabled controls standing in for any of
 * them. An editorial gallery of controlled card formats with consistent
 * heights, and no masonry: uneven heights make chronological scanning harder,
 * and this is meant to be read rather than grazed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  APPROVAL_POLICY,
  COMMUNITY_PRESETS,
  REFLECTION_VISIBILITY,
  type ApprovalPolicy,
  type CommunityPreset,
  type ReflectionVisibility,
} from '@chat/shared'
import { ApiError } from '../shared/api/client.ts'
import { shareWithPlatform } from '../shared/native/share.ts'
import { useMobileBar } from '../shared/mobile/MobileBar.tsx'
import { PageMenu } from '../shared/mobile/PageMenu.tsx'
import { useAccountRequired } from '../shared/mobile/AccountRequired.tsx'
import { NARROW_QUERY, useMediaQuery } from '../shared/ui/useMediaQuery.ts'
import { MoreIcon } from '../shared/ui/icons.tsx'
import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import { ReflectionCardSkeleton } from '../shared/ui/ReflectionCard.tsx'
import { PublicationCard } from './PublicationCard.tsx'
import {
  acceptInvitation,
  createCommunity,
  decideJoinRequest,
  deletePublication,
  discoverCommunities,
  fetchJoinRequests,
  joinCommunity,
  fetchCommunities,
  fetchFeed,
  inviteToCommunity,
  hidePublicationForMe,
  muteAuthorOf,
  reportPublication,
  setEncouraged,
  setHidden,
  setSaved,
  type CommunitiesResponse,
  type Destination,
  type Hashtag,
  type Publication,
  type ReportReason,
} from './api.ts'
import { AuthorLink } from '../shared/ui/AuthorLink.tsx'
import styles from './CommunityPage.module.css'

const DESTINATIONS: {
  id: Destination
  label: string
  heading: string
  description: string
}[] = [
  {
    id: 'shared',
    label: 'Shared',
    heading: 'Shared C.H.A.T.s',
    description: 'C.H.A.T.s shared with the communities you belong to.',
  },
  {
    id: 'public',
    label: 'Public',
    heading: 'Public C.H.A.T.s',
    description: 'Reflections anyone using C.H.A.T. may read.',
  },
  {
    id: 'communities',
    label: 'Communities',
    heading: 'Your communities',
    description: 'The communities you belong to, and invitations waiting for you.',
  },
]

/**
 * How a failure is described.
 *
 * Four different things go wrong here and they need four different sentences,
 * because the recovery differs: retrying helps a network failure and does
 * nothing at all for a membership that ended. "Something went wrong" collapses
 * all four into the one message that helps with none of them.
 */
type Failure = {
  kind:
    | 'unavailable'
    | 'unauthorised'
    | 'account-required'
    | 'community-gone'
    | 'removed'
    | 'offline'
  message: string
  action: string
}

function describe(caught: unknown): Failure {
  if (caught instanceof ApiError) {
    /*
     * A guest reaching something that needs an account. Distinct from 401 on
     * purpose: they *are* signed in, so offering a sign-in is offering them
     * what they already have. The server writes the sentence, because the
     * server is what knows the rule.
     */
    if (caught.status === 403) {
      return {
        kind: 'account-required',
        message: caught.message,
        action: 'Create an account',
      }
    }
    if (caught.status === 401) {
      return {
        kind: 'unauthorised',
        message: 'You are no longer signed in, so this cannot be shown.',
        action: 'Sign in again',
      }
    }
    if (caught.status === 404) {
      return {
        kind: 'community-gone',
        message:
          'This community is no longer available to you. You may have left it, or it may have been closed.',
        action: 'Return to Community',
      }
    }
    if (caught.status === 503) {
      return {
        kind: 'unavailable',
        message: caught.message,
        action: 'Try again',
      }
    }
  }
  return {
    kind: 'offline',
    message: 'Community could not be loaded just now.',
    action: 'Try again',
  }
}

/* ------------------------------------------------------------ empty states */

/**
 * Written empty states, never "No posts."
 *
 * Each says what the space is for and offers the next thing to do, because an
 * empty page is the first thing most people will see and it is the cheapest
 * place to teach what the product is.
 */
function Empty({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <section className={styles.empty}>
      <h2 className={styles.emptyTitle}>{title}</h2>
      <p className={styles.emptyBody}>{body}</p>
      {action ? (
        <button type="button" className="btn btn-primary" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </section>
  )
}

/** Card-shaped placeholders, so the first paint does not shift the layout. */
function Skeletons() {
  return (
    <ul className={styles.gallery} aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <ReflectionCardSkeleton key={index} />
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------- page */

export function CommunityPage() {
  const { user } = useAuth()
  /*
   * A guest has a session and no account. They may read what is public; they
   * may not publish, join, or take part. That is the whole distinction, and it
   * is applied per action rather than at the door — what was here before shut
   * the entire screen and told them, beside their own avatar, that they were
   * signed out.
   */
  const guest = user?.accountType === 'ANONYMOUS'
  /*
   * A visitor is anybody who belongs to no community: a guest, or somebody
   * with no session at all who has arrived on a link. Both are shown Public.
   *
   * "Shared" means the communities you belong to, so landing either of them
   * there is landing them on a destination that is empty by definition — and
   * for the session-less it was worse than empty, because asking for it is
   * what produced "You are no longer signed in" on a first visit.
   */
  const visitor = !user || guest
  /*
   * Encourage, Save and Report need an account. They stay on the card — the
   * product is not smaller for a visitor — but pressing one now explains
   * rather than waiting for the server to refuse it and rendering that
   * refusal as though the session had gone wrong.
   */
  const account = useAccountRequired()
  const [destination, setDestination] = useState<Destination>(
    user && user.accountType !== 'ANONYMOUS' ? 'shared' : 'public',
  )
  const [items, setItems] = useState<Publication[]>([])
  const [hashtags, setHashtags] = useState<Hashtag[]>([])
  const [reportReasons, setReportReasons] = useState<ReportReason[]>([])
  const [communities, setCommunities] = useState<CommunitiesResponse | null>(null)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const narrow = useMediaQuery(NARROW_QUERY)
  const [notice, setNotice] = useState<string | null>(null)
  const [now] = useState(() => Date.now())

  const load = useCallback(async () => {
    setLoading(true)
    setFailure(null)
    try {
      if (destination === 'communities') {
        /*
         * A visitor has no communities of their own, and asking for them is
         * what produced "You are no longer signed in" on a first visit —
         * `/communities` needs an account, while the directory does not. So
         * they are given the directory and an empty list of their own, which
         * is the truth rather than a failure.
         */
        setCommunities(visitor ? { communities: [], invitations: [] } : await fetchCommunities())
      } else {
        const feed = await fetchFeed({
          scope: destination,
          query: query.trim() || undefined,
          tag: tag ?? undefined,
        })
        setItems(feed.items)
        setHashtags(feed.hashtags)
        setReportReasons(feed.reportReasons)
      }
    } catch (caught: unknown) {
      setFailure(describe(caught))
    } finally {
      setLoading(false)
    }
  }, [destination, query, tag, visitor])

  useEffect(() => {
    /* Search updates while typing, but not on every keystroke's round trip. */
    const timer = window.setTimeout(() => void load(), query ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [load, query])

  /*
   * A local echo of one publication after an action, so a press feels
   * immediate. It replaces a row with what the server said about that row —
   * never with a guess, and never with anything the server did not return.
   */
  const replace = useCallback((id: string, change: (item: Publication) => Publication) => {
    setItems((current) => current.map((item) => (item.id === id ? change(item) : item)))
  }, [])

  /* Gone from this reader's view at once, rather than on the next load. */
  const remove = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const act = useCallback(
    async (work: () => Promise<string | null>) => {
      try {
        const message = await work()
        if (message) setNotice(message)
      } catch (caught: unknown) {
        setFailure(describe(caught))
      }
    },
    [],
  )

  /* The heading follows the destination; a page titled for one tab while
     showing another is the kind of small dishonesty that reads as a bug. */
  const current = useMemo(
    () => DESTINATIONS.find((entry) => entry.id === destination) ?? DESTINATIONS[0],
    [destination],
  )

  /*
   * The bar names the destination being read — Shared, Public, or the
   * community by name. "Community" is on the tab bar at the bottom of the
   * screen already; repeating it here would spend the one heading a phone has
   * on the word somebody just pressed to get here.
   */
  useMobileBar(
    () => ({
      title: current?.heading ?? 'Community',
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
    [current?.heading],
  )

  return (
    <section className={styles.page}>
      <PageMenu open={menuOpen} onClose={() => setMenuOpen(false)} />

      {/*
        Not rendered on a phone, rather than rendered and hidden. The bar
        already carries this heading, and a second copy behind `display: none`
        is still a second `h1` for anything that reads the document rather
        than looking at it.
      */}
      {account.sheet}

      {narrow ? null : (
      <header className={styles.header}>
        <div>
          <p className="eyebrow">Community</p>
          <h1 className={styles.title}>{current?.heading}</h1>
          <p className={styles.description}>{current?.description}</p>
        </div>
      </header>
      )}

      {/*
        Destinations, as tabs. Three, all of them live — the interface must not
        display disabled or placeholder controls for things that do not exist.
      */}
      <div className={styles.controls}>
        <div className={styles.tabs} role="tablist" aria-label="Community destinations">
          {DESTINATIONS.filter((entry) => !(visitor && entry.id === 'shared')).map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`tab-${entry.id}`}
              aria-selected={destination === entry.id}
              aria-controls="community-panel"
              className={styles.tab}
              data-active={destination === entry.id}
              onClick={() => {
                setDestination(entry.id)
                setTag(null)
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {/*
          The result of an action, announced as well as shown. It lives inside
          the control block rather than between the controls and the gallery,
          where an empty one reserved a band of nothing above the first card.
        */}
        <p className={styles.notice} role="status" aria-live="polite">
          {notice}
        </p>

        {destination === 'communities' ? null : (
          <>
            {/*
              Not offered to a guest. There is nothing here for them to search,
              and a search box above a panel explaining that they cannot read
              this yet is a control that can only disappoint.
            */}
            <label className="sr-only" htmlFor="community-search">
              Search Scripture, reflections, authors or tags
            </label>
            <input
              id="community-search"
              className={`input ${styles.search}`}
              type="search"
              /*
               * The full sentence is the label, which is what a screen reader
               * reads. The placeholder is what has to fit on a phone, and
               * "Search Scripture, reflections, authors or ta…" told nobody
               * anything the short version does not.
               */
              placeholder="Search shared reflections"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />

            {/*
              Chips come from the server, computed under the same predicate as
              the feed — so a chip can never advertise a tag that only exists on
              content the reader cannot open.
            */}
            {hashtags.length > 0 ? (
              <div className={styles.chips}>
                {hashtags.map((hashtag) => (
                  <button
                    key={hashtag.tag}
                    type="button"
                    className={styles.chip}
                    data-active={tag === hashtag.tag}
                    aria-pressed={tag === hashtag.tag}
                    onClick={() => setTag(tag === hashtag.tag ? null : hashtag.tag)}
                  >
                    #{hashtag.label}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      <div id="community-panel" role="tabpanel" aria-labelledby={`tab-${destination}`}>
        {failure ? (
          <section className={styles.failure} role="alert">
            <p>{failure.message}</p>
            {failure.kind === 'account-required' ? (
              <Link className="btn btn-primary" to="/login?create=1">
                {failure.action}
              </Link>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  if (failure.kind === 'unauthorised') {
                    window.location.assign('/login')
                    return
                  }
                  setTag(null)
                  void load()
                }}
              >
                {failure.action}
              </button>
            )}
          </section>
        ) : loading ? (
          <Skeletons />
        ) : destination === 'communities' ? (
          <CommunitiesPanel
            data={communities}
            onChanged={() => void load()}
            onNotice={setNotice}
            onFailure={setFailure}
          />
        ) : items.length === 0 ? (
          query || tag ? (
            <Empty
              title="Nothing matched that"
              body="Try a different phrase, Scripture reference or hashtag."
              action={{
                label: 'Clear filters',
                onClick: () => {
                  setQuery('')
                  setTag(null)
                },
              }}
            />
          ) : destination === 'shared' ? (
            <Empty
              title="Nothing has been shared with you yet"
              body="When someone in one of your communities shares a reflection, it will appear here. You can share one of your own from any completed reflection."
            />
          ) : (
            <Empty
              title="No public C.H.A.T.s yet"
              body="Public reflections are ones people chose to make readable by anyone. Yours could be the first — open a completed reflection and choose Share."
            />
          )
        ) : (
          <ul className={styles.gallery}>
            {items.map((publication) => (
              <PublicationCard
                key={publication.id}
                publication={publication}
                now={now}
                reportReasons={reportReasons}
                onEncourage={(next) =>
                  account.guard(() =>
                  void act(async () => {
                    const result = await setEncouraged(publication.id, next)
                    replace(publication.id, (item) => ({
                      ...item,
                      encouraged: result.encouraged,
                    }))
                    return result.message
                  }))()
                }
                onSave={(next) =>
                  account.guard(() =>
                  void act(async () => {
                    const result = await setSaved(publication.id, next)
                    replace(publication.id, (item) => ({ ...item, saved: result.saved }))
                    return result.message
                  }))()
                }
                onAccountRequired={
                  account.needsAccount ? account.guard(() => {}) : null
                }
                onReport={async (reason, note) => {
                  /* The dialog shows its own confirmation, so no notice here. */
                  await reportPublication(publication.id, reason, note)
                }}
                onHideForMe={() =>
                  void act(async () => {
                    await hidePublicationForMe(publication.id, true)
                    /* Out of sight immediately; the server agrees on the next read. */
                    remove(publication.id)
                    return 'Hidden for you. Nobody else sees any difference.'
                  })
                }
                onMuteAuthor={() =>
                  void act(async () => {
                    await muteAuthorOf(publication.id, true)
                    remove(publication.id)
                    return 'Muted. You will not see what they share; they are not told.'
                  })
                }
                onHide={(next) =>
                  void act(async () => {
                    const result = await setHidden(publication.id, next)
                    replace(publication.id, (item) => ({
                      ...item,
                      moderationState: result.moderationState as 'visible' | 'hidden',
                    }))
                    return result.message
                  })
                }
                onShare={() =>
                  void act(async () => {
                    /*
                     * Only ever reached where sharing is permitted. A public
                     * publication carries a link; the author's own community
                     * publication does not, because an external share of that
                     * is a representation of their own words rather than a way
                     * into the community.
                     */
                    if (publication.shareUrl) {
                      const result = await shareWithPlatform({
                        title: publication.title,
                        url: publication.shareUrl,
                      })
                      return result === 'copied' ? 'Public link copied.' : 'Opened the share sheet.'
                    }
                    return 'This is yours to share. Copy the words you want to send.'
                  })
                }
                onDelete={() =>
                  void act(async () => {
                    await deletePublication(publication.id)
                    setItems((current) =>
                      current.filter((item) => item.id !== publication.id),
                    )
                    return 'Unshared. The reflection it came from is untouched.'
                  })
                }
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/* --------------------------------------------------------- communities tab */

/**
 * The communities the reader belongs to, and invitations addressed to them.
 *
 * Not a directory. Nothing here lists a community the reader has no
 * relationship with, because private invitation-based communities are the whole
 * of this phase and a discoverable list would be a different product.
 */
function CommunitiesPanel({
  data,
  onChanged,
  onNotice,
  onFailure,
}: {
  data: CommunitiesResponse | null
  onChanged: () => void
  onNotice: (message: string) => void
  onFailure: (failure: Failure) => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  /*
   * Two choices, then the follow-ups only where they change anything.
   *
   * Public needs nothing else asked: open, findable, readable. Private has two
   * real questions — who can read what is shared, and who decides on requests
   * — and both have a default, so somebody who does not care can ignore them.
   */
  const [preset, setPreset] = useState<CommunityPreset>(COMMUNITY_PRESETS.PRIVATE)
  const [visibility, setVisibility] = useState<ReflectionVisibility>(REFLECTION_VISIBILITY.MEMBERS)
  const [approvals, setApprovals] = useState<ApprovalPolicy>(APPROVAL_POLICY.OWNER_ADMIN)
  const [invitingTo, setInvitingTo] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  if (!data) return null

  const nothing = data.communities.length === 0 && data.invitations.length === 0

  return (
    <div className={styles.communities}>
      {data.invitations.length > 0 ? (
        <section className={styles.invitations}>
          <h2 className={styles.sectionHeading}>Invitations</h2>
          <ul className={styles.communityList}>
            {data.invitations.map((invitation) => (
              <li key={invitation.id} className={styles.communityRow}>
                <div>
                  <h3 className={styles.communityName}>{invitation.name}</h3>
                  <p className={styles.communityBody}>
                    {invitation.description || 'You have been invited to join.'}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    void acceptInvitation(invitation.id)
                      .then(() => {
                        onNotice(`You have joined ${invitation.name}.`)
                        onChanged()
                      })
                      .catch((caught: unknown) => onFailure(describe(caught)))
                  }}
                >
                  Join
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        Finding one, which is not the same as being able to read it.
        A discoverable private group appears here with what it is for and a
        way to ask; nothing anybody wrote inside it is listed until they are in.
      */}
      <CommunityDirectory onNotice={onNotice} onFailure={onFailure} onChanged={onChanged} />

      <section>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionHeading}>My communities</h2>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setCreating((open) => !open)}
          >
            Start a community
          </button>
        </div>

        {creating ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault()
              setProblem(null)
              void createCommunity({
                name,
                description,
                preset,
                ...(preset === COMMUNITY_PRESETS.PRIVATE
                  ? { settings: { reflectionVisibility: visibility, approvalPolicy: approvals } }
                  : {}),
              })
                .then((community) => {
                  setCreating(false)
                  setName('')
                  setDescription('')
                  onNotice(`${community.name} is ready. Invite the people you want in it.`)
                  onChanged()
                })
                .catch((caught: unknown) => {
                  setProblem(
                    caught instanceof Error ? caught.message : 'That could not be created.',
                  )
                })
            }}
          >
            <label className="label" htmlFor="community-name">
              Name
            </label>
            <input
              id="community-name"
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Sunday Leaders"
              required
            />
            <label className="label" htmlFor="community-description">
              What is it for?
            </label>
            <input
              id="community-description"
              className="input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="A place for our Sunday team to share what we are reading."
            />
            <fieldset className={styles.presets}>
              <legend className="label">What kind of community is this?</legend>
              <label className={styles.preset} data-selected={preset === COMMUNITY_PRESETS.PUBLIC}>
                <input
                  type="radio"
                  name="preset"
                  checked={preset === COMMUNITY_PRESETS.PUBLIC}
                  onChange={() => setPreset(COMMUNITY_PRESETS.PUBLIC)}
                />
                <span>
                  <strong>Public</strong>
                  <span className={styles.presetDetail}>
                    Anyone can find it and join. Reflections shared here can be read publicly.
                  </span>
                </span>
              </label>
              <label className={styles.preset} data-selected={preset === COMMUNITY_PRESETS.PRIVATE}>
                <input
                  type="radio"
                  name="preset"
                  checked={preset === COMMUNITY_PRESETS.PRIVATE}
                  onChange={() => setPreset(COMMUNITY_PRESETS.PRIVATE)}
                />
                <span>
                  <strong>Private</strong>
                  <span className={styles.presetDetail}>
                    People can find it and ask to join; you decide. Choose whether what is
                    shared here is for members only.
                  </span>
                </span>
              </label>
            </fieldset>

            {/*
              Asked only where the answer changes something, and each with a
              default — creating a community should not be a settings screen.
            */}
            {preset === COMMUNITY_PRESETS.PRIVATE ? (
              <>
                <label className="label" htmlFor="community-visibility">
                  Who can read shared reflections?
                </label>
                <select
                  id="community-visibility"
                  className="input"
                  value={visibility}
                  onChange={(event) =>
                    setVisibility(event.target.value as ReflectionVisibility)
                  }
                >
                  <option value={REFLECTION_VISIBILITY.MEMBERS}>Members only</option>
                  <option value={REFLECTION_VISIBILITY.PUBLIC}>Anyone</option>
                </select>

                <label className="label" htmlFor="community-approvals">
                  Who can approve membership requests?
                </label>
                <select
                  id="community-approvals"
                  className="input"
                  value={approvals}
                  onChange={(event) => setApprovals(event.target.value as ApprovalPolicy)}
                >
                  <option value={APPROVAL_POLICY.OWNER_ADMIN}>You and your admins</option>
                  <option value={APPROVAL_POLICY.MEMBERS}>Any member</option>
                </select>
                {approvals === APPROVAL_POLICY.MEMBERS ? (
                  <p className="hint">
                    One approved member can then let in everybody they know. Most communities
                    keep this with the owner and admins.
                  </p>
                ) : null}
              </>
            ) : null}

            <p className="hint">
              Every member of a community may share reflections in it. Ownership is
              responsibility for the space, not the only voice in it.
            </p>
            {problem ? (
              <p className={styles.problem} role="alert">
                {problem}
              </p>
            ) : null}
            <button type="submit" className="btn btn-primary btn-sm">
              Create
            </button>
          </form>
        ) : null}

        {data.communities.length === 0 ? (
          nothing ? (
            <Empty
              title="You are not in a community yet"
              body="Communities are small, private circles — a church, a family, a prayer group — where reflections stay between the people in them. Start one and invite the people who belong in it, or wait for an invitation."
            />
          ) : null
        ) : (
          <ul className={styles.communityList}>
            {data.communities.map((community) => (
              <li key={community.id} className={styles.communityRow}>
                <div>
                  <h3 className={styles.communityName}>{community.name}</h3>
                  <p className={styles.communityBody}>
                    {community.description || 'A private community.'}
                  </p>
                  <p className={styles.communityMeta}>
                    {/* Plain language, not permission terminology. */}
                    Members only · {community.memberCount}{' '}
                    {community.memberCount === 1 ? 'member' : 'members'}
                    {community.role === 'member' ? '' : ` · you are an ${community.role}`}
                  </p>
                </div>
                {community.role === 'member' ? null : (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      setInvitingTo(invitingTo === community.id ? null : community.id)
                    }
                  >
                    Invite
                  </button>
                )}

                {/* Only for the people who may decide, and only when somebody is waiting. */}
                {community.role === 'member' ? null : (
                  <JoinRequests
                    communityId={community.id}
                    onNotice={onNotice}
                    onFailure={onFailure}
                  />
                )}

                {invitingTo === community.id ? (
                  <form
                    className={styles.inviteForm}
                    onSubmit={(event) => {
                      event.preventDefault()
                      setProblem(null)
                      void inviteToCommunity(community.id, email)
                        .then(() => {
                          setEmail('')
                          setInvitingTo(null)
                          onNotice('Invitation sent.')
                        })
                        .catch((caught: unknown) => {
                          setProblem(
                            caught instanceof Error
                              ? caught.message
                              : 'That invitation could not be sent.',
                          )
                        })
                    }}
                  >
                    <label className="sr-only" htmlFor={`invite-${community.id}`}>
                      Email address to invite to {community.name}
                    </label>
                    <input
                      id={`invite-${community.id}`}
                      className="input"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="their@email.address"
                      required
                    />
                    <button type="submit" className="btn btn-primary btn-sm">
                      Send
                    </button>
                    {problem ? (
                      <p className={styles.problem} role="alert">
                        {problem}
                      </p>
                    ) : null}
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------- discovery */

/**
 * Communities somebody could ask to be part of.
 *
 * Discoverability and readability are different things, and this is the first
 * place that shows it: a private group that chose to be findable is listed
 * here with its name and what it is for, and a stranger sees nothing that was
 * written inside it. Joining an open one is immediate; asking a private one
 * says so and then waits.
 */
function CommunityDirectory({
  onNotice,
  onFailure,
  onChanged,
}: {
  onNotice: (message: string) => void
  onFailure: (failure: Failure) => void
  onChanged: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Awaited<ReturnType<typeof discoverCommunities>> | null>(
    null,
  )
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void discoverCommunities(query)
      .then((found) => {
        if (!cancelled) setResults(found)
      })
      .catch((caught: unknown) => onFailure(describe(caught)))
    return () => {
      cancelled = true
    }
  }, [open, query, onFailure])

  return (
    <section className={styles.directory}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionHeading}>Find a community</h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Close' : 'Browse'}
        </button>
      </div>

      {open ? (
        <>
          <label className="sr-only" htmlFor="community-search">
            Search communities
          </label>
          <input
            id="community-search"
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name"
          />

          {results && results.communities.length === 0 ? (
            <p className={styles.communityBody}>
              Nothing matches that yet. Communities appear here only if they chose to be
              findable.
            </p>
          ) : null}

          <ul className={styles.communityList}>
            {(results?.communities ?? []).map((community) => (
              <li key={community.id} className={styles.communityRow}>
                <div>
                  <h3 className={styles.communityName}>{community.name}</h3>
                  <p className={styles.communityBody}>
                    {community.description || 'No description yet.'}
                  </p>
                  <p className={styles.communityMeta}>
                    {community.settings.joinPolicy === 'open'
                      ? 'Anyone can join'
                      : 'Ask to join'}
                    {' · '}
                    {community.settings.reflectionVisibility === 'public'
                      ? 'Reflections readable by anyone'
                      : 'Reflections for members only'}
                    {` · ${community.memberCount} ${community.memberCount === 1 ? 'member' : 'members'}`}
                  </p>
                </div>
                {community.state === 'active' ? (
                  <span className={styles.communityMeta}>You are in this one</span>
                ) : community.state === 'pending' ? (
                  <span className={styles.communityMeta}>Waiting on a decision</span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      void joinCommunity(community.id)
                        .then((result) => {
                          onNotice(
                            result.state === 'active'
                              ? `You have joined ${community.name}.`
                              : `Asked to join ${community.name}. Someone there will decide.`,
                          )
                          onChanged()
                          setResults(null)
                          void discoverCommunities(query).then(setResults)
                        })
                        .catch((caught: unknown) => onFailure(describe(caught)))
                    }}
                  >
                    {community.settings.joinPolicy === 'open' ? 'Join' : 'Ask to join'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

/**
 * People waiting on a decision, shown to whoever may make it.
 *
 * Approving is not moderation dressed up: it decides who is in a space where
 * everything shared is readable by members, so it defaults to the owner and
 * admins. Where a community has opened it to members, this appears for them
 * too — the server decides that, and a 403 here simply renders nothing.
 */
function JoinRequests({
  communityId,
  onNotice,
  onFailure,
}: {
  communityId: string
  onNotice: (message: string) => void
  onFailure: (failure: Failure) => void
}) {
  const [requests, setRequests] = useState<
    Awaited<ReturnType<typeof fetchJoinRequests>>['requests']
  >([])

  const refresh = useCallback(() => {
    void fetchJoinRequests(communityId)
      .then((found) => setRequests(found.requests))
      /* Not permitted to see them is not an error worth showing anybody. */
      .catch(() => setRequests([]))
  }, [communityId])

  useEffect(refresh, [refresh])

  if (requests.length === 0) return null

  return (
    <div className={styles.joinRequests}>
      <h4 className={styles.joinRequestsHeading}>
        {requests.length === 1 ? 'One person is asking to join' : `${requests.length} people are asking to join`}
      </h4>
      <ul className={styles.joinRequestList}>
        {requests.map((request) => (
          <li key={request.userId} className={styles.joinRequestRow}>
            {/*
              Deciding about a person is the moment you most want to see who
              they are, so the name goes to their profile when they have one.
            */}
            <AuthorLink
              className={styles.author}
              author={{
                handle: request.handle ?? '',
                displayName: request.displayName ?? request.handle ?? 'A C.H.A.T. writer',
              }}
            />
            <span className={styles.joinRequestActions}>
              {(['approve', 'decline'] as const).map((decision) => (
                <button
                  key={decision}
                  type="button"
                  className={decision === 'approve' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                  onClick={() => {
                    void decideJoinRequest(communityId, request.userId, decision)
                      .then(() => {
                        onNotice(
                          decision === 'approve'
                            ? 'They are in.'
                            : 'Declined. They can ask again later.',
                        )
                        refresh()
                      })
                      .catch((caught: unknown) => onFailure(describe(caught)))
                  }}
                >
                  {decision === 'approve' ? 'Approve' : 'Decline'}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
