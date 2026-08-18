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
import { ApiError } from '../shared/api/client.ts'
import { ReflectionCardSkeleton } from '../shared/ui/ReflectionCard.tsx'
import { PublicationCard } from './PublicationCard.tsx'
import {
  acceptInvitation,
  createCommunity,
  deletePublication,
  fetchCommunities,
  fetchFeed,
  inviteToCommunity,
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
  kind: 'unavailable' | 'unauthorised' | 'community-gone' | 'removed' | 'offline'
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
  const [destination, setDestination] = useState<Destination>('shared')
  const [items, setItems] = useState<Publication[]>([])
  const [hashtags, setHashtags] = useState<Hashtag[]>([])
  const [reportReasons, setReportReasons] = useState<ReportReason[]>([])
  const [communities, setCommunities] = useState<CommunitiesResponse | null>(null)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [now] = useState(() => Date.now())

  const load = useCallback(async () => {
    setLoading(true)
    setFailure(null)
    try {
      if (destination === 'communities') {
        setCommunities(await fetchCommunities())
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
  }, [destination, query, tag])

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

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className="eyebrow">Community</p>
          <h1 className={styles.title}>{current?.heading}</h1>
          <p className={styles.description}>{current?.description}</p>
        </div>
      </header>

      {/*
        Destinations, as tabs. Three, all of them live — the interface must not
        display disabled or placeholder controls for things that do not exist.
      */}
      <div className={styles.controls}>
        <div className={styles.tabs} role="tablist" aria-label="Community destinations">
          {DESTINATIONS.map((entry) => (
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
            <label className="sr-only" htmlFor="community-search">
              Search Scripture, reflections, authors or tags
            </label>
            <input
              id="community-search"
              className={`input ${styles.search}`}
              type="search"
              placeholder="Search Scripture, reflections, authors or tags"
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
                  void act(async () => {
                    const result = await setEncouraged(publication.id, next)
                    replace(publication.id, (item) => ({
                      ...item,
                      encouraged: result.encouraged,
                    }))
                    return result.message
                  })
                }
                onSave={(next) =>
                  void act(async () => {
                    const result = await setSaved(publication.id, next)
                    replace(publication.id, (item) => ({ ...item, saved: result.saved }))
                    return result.message
                  })
                }
                onReport={(reason) =>
                  void act(async () => {
                    const result = await reportPublication(publication.id, reason)
                    return result.message
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
                      await navigator.clipboard?.writeText(publication.shareUrl)
                      return 'Public link copied.'
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
              void createCommunity({ name, description })
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
            <p className="hint">
              Communities are private and by invitation. Nobody can find this or ask to
              join — you invite the people who belong in it.
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
