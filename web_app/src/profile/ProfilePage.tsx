/*
 * The public profile.
 *
 * ── What this page is, and what it deliberately is not ─────────────────────
 *
 * It is a **small portfolio of reflections**: who wrote them, a sentence about
 * why, up to three passages they keep returning to, and the work itself. It is
 * not an identity system, and the brief is unusually specific about how that
 * goes wrong — so the absences here are decisions, not omissions:
 *
 *  - **No tabs.** Activity, Likes, Encouraged, Following, Followers and
 *    Subscriptions do not exist, and an interface must not show a disabled or
 *    placeholder control. A tab strip with one live tab is a promise of five
 *    more.
 *  - **No follower or following counts**, because there are no follow
 *    relationships to count.
 *  - **No Communities section.** Communities are not a feature yet, so the only
 *    honest options were an empty shell or nothing. The brief says to omit it,
 *    and it is omitted — there is no hidden markup waiting to be switched on.
 *  - **No private counts.** The one number on this page is the count of public
 *    C.H.A.T.s, and it is the server's count of exactly the rows it returned.
 *
 * ── Where authorisation lives ──────────────────────────────────────────────
 *
 * Not here. `GET /api/profiles/:handle` returns only published reflections,
 * decided in the query. This component renders what it is given and has no
 * filter, no `visibility` check and no way to receive a private
 * reflection in the first place. That is on purpose: a page that filters is a
 * page one refactor away from leaking.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import type { ChatFormat, ChatSectionType } from '@chat/shared'
import { ApiError, api } from '../shared/api/client.ts'
import { ReflectionCard } from '../shared/ui/ReflectionCard.tsx'
import { Avatar } from '../shared/ui/Avatar.tsx'
import styles from './ProfilePage.module.css'

/* ------------------------------------------------------------------- types */

type Share = {
  id: string
  format: ChatFormat
  title: string
  scriptureReference: string | null
  updatedAt: string
  sections: ChatSectionType[]
  excerpt: string
}

type ProfileView = {
  handle: string
  displayName: string
  tagline: string
  favouriteVerses: string[]
  publicChatCount: number | null
  /** The month the profile was made, as 2026-08. Never a full date. */
  memberSince?: string | null
  isOwner: boolean
  blocked: boolean
  shares: Share[]
  reportReasons: { id: string; label: string }[]
}

/** The owner's editable view, with the limits the server will enforce. */
type OwnProfile = {
  handle: string
  displayName: string
  tagline: string
  favouriteVerses: string[]
  limits: {
    displayName: number
    handleMin: number
    handleMax: number
    tagline: number
    favouriteVerses: number
    favouriteVerseLength: number
  }
}

/* ------------------------------------------------------------ small pieces */

/**
 * The editor for one's own profile.
 *
 * Every limit shown here comes from the server, so the counter under a field
 * and the rule that refuses the save can never disagree. The fields are
 * `maxLength`-capped as a courtesy; the refusal that matters is the one the
 * API makes, and its message is what gets shown.
 */
function ProfileEditor({
  own,
  onSaved,
  onCancel,
}: {
  own: OwnProfile
  onSaved: (saved: OwnProfile) => void
  onCancel: () => void
}) {
  const [handle, setHandle] = useState(own.handle)
  const [displayName, setDisplayName] = useState(own.displayName)
  const [tagline, setTagline] = useState(own.tagline)
  const [verses, setVerses] = useState<string[]>(() => {
    const next = [...own.favouriteVerses]
    while (next.length < own.limits.favouriteVerses) next.push('')
    return next.slice(0, own.limits.favouriteVerses)
  })
  const [error, setError] = useState<{ message: string; field?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const ids = useId()
  const firstField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstField.current?.focus()
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const saved = await api<OwnProfile>('/profiles/me', {
        method: 'PATCH',
        body: JSON.stringify({
          handle,
          displayName,
          tagline,
          favouriteVerses: verses.map((verse) => verse.trim()).filter(Boolean),
        }),
      })
      onSaved(saved)
    } catch (caught) {
      const field =
        caught instanceof ApiError
          ? (caught.body as { field?: string } | null)?.field
          : undefined
      setError({
        message: caught instanceof Error ? caught.message : 'That could not be saved.',
        ...(field ? { field } : {}),
      })
    } finally {
      setSaving(false)
    }
  }

  const invalid = (field: string) => (error?.field === field ? true : undefined)

  return (
    <form className={styles.editor} onSubmit={(event) => void submit(event)} noValidate>
      <h2 className={styles.editorTitle}>Edit your profile</h2>

      {/*
        The error is announced, sits above the fields, and names its field.
        A message that only appears in red beside an input is information
        conveyed by colour and position alone.
      */}
      {error ? (
        <p className={styles.formError} role="alert">
          {error.message}
        </p>
      ) : null}

      <div className="field">
        <label className="label" htmlFor={`${ids}-name`}>
          Display name
        </label>
        <input
          ref={firstField}
          id={`${ids}-name`}
          className="input"
          value={displayName}
          maxLength={own.limits.displayName}
          aria-invalid={invalid('displayName')}
          aria-describedby={`${ids}-name-hint`}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <p className="hint" id={`${ids}-name-hint`}>
          {displayName.length} of {own.limits.displayName} characters.
        </p>
      </div>

      <div className="field">
        <label className="label" htmlFor={`${ids}-handle`}>
          Handle
        </label>
        <div className={styles.handleField}>
          <span className={styles.handlePrefix} aria-hidden="true">
            @
          </span>
          <input
            id={`${ids}-handle`}
            className={`input ${styles.handleInput}`}
            value={handle}
            maxLength={own.limits.handleMax}
            aria-invalid={invalid('handle')}
            aria-describedby={`${ids}-handle-hint`}
            onChange={(event) => setHandle(event.target.value)}
          />
        </div>
        <p className="hint" id={`${ids}-handle-hint`}>
          {own.limits.handleMin}–{own.limits.handleMax} characters. Lowercase letters, numbers,
          hyphens and underscores. This is your profile address.
        </p>
      </div>

      <div className="field">
        <label className="label" htmlFor={`${ids}-tagline`}>
          Tagline
        </label>
        <textarea
          id={`${ids}-tagline`}
          className="textarea"
          rows={2}
          value={tagline}
          maxLength={own.limits.tagline}
          aria-invalid={invalid('tagline')}
          aria-describedby={`${ids}-tagline-hint`}
          onChange={(event) => setTagline(event.target.value)}
        />
        <p className="hint" id={`${ids}-tagline-hint`}>
          A short line or a quote. {tagline.length} of {own.limits.tagline} characters.
        </p>
      </div>

      <fieldset className={styles.fieldset}>
        <legend className="label">
          Favourite Scripture — up to {own.limits.favouriteVerses}
        </legend>
        <div className={styles.verseFields}>
          {verses.map((verse, index) => (
            <div key={index} className={styles.verseField}>
              <label className="sr-only" htmlFor={`${ids}-verse-${index}`}>
                Favourite Scripture reference {index + 1}
              </label>
              <input
                id={`${ids}-verse-${index}`}
                className="input"
                value={verse}
                maxLength={own.limits.favouriteVerseLength}
                /* One example is a hint; three identical ones read as a bug. */
                {...(index === 0 ? { placeholder: 'Romans 8:28' } : {})}
                aria-invalid={invalid('favouriteVerses')}
                onChange={(event) =>
                  setVerses((previous) =>
                    previous.map((value, position) =>
                      position === index ? event.target.value : value,
                    ),
                  )
                }
              />
            </div>
          ))}
        </div>
      </fieldset>

      <div className={styles.editorActions}>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** Reporting a profile. Records a report; removes nothing for anyone. */
function ReportForm({
  handle,
  reasons,
  onDone,
  onCancel,
}: {
  handle: string
  reasons: { id: string; label: string }[]
  onDone: (message: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  const [detail, setDetail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const ids = useId()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSending(true)
    setError(null)
    try {
      const result = await api<{ message: string }>(`/profiles/${handle}/report`, {
        method: 'POST',
        body: JSON.stringify({ reason, detail }),
      })
      onDone(result.message)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That report could not be sent.')
    } finally {
      setSending(false)
    }
  }

  return (
    <form className={styles.editor} onSubmit={(event) => void submit(event)}>
      <h2 className={styles.editorTitle}>Report @{handle}</h2>
      <p className="hint">
        Reports are reviewed before any action is taken. Reporting does not remove anything for
        other people.
      </p>
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}

      <fieldset className={styles.fieldset}>
        <legend className="label">Why are you reporting this profile?</legend>
        <div className={styles.reasons}>
          {reasons.map((option) => (
            <label key={option.id} className={styles.reason} htmlFor={`${ids}-${option.id}`}>
              <input
                id={`${ids}-${option.id}`}
                type="radio"
                name={`${ids}-reason`}
                value={option.id}
                checked={reason === option.id}
                onChange={() => setReason(option.id)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label className="label" htmlFor={`${ids}-detail`}>
          Anything else we should know? Optional.
        </label>
        <textarea
          id={`${ids}-detail`}
          className="textarea"
          rows={3}
          value={detail}
          maxLength={500}
          onChange={(event) => setDetail(event.target.value)}
        />
      </div>

      <div className={styles.editorActions}>
        <button type="submit" className="btn btn-primary" disabled={sending || reason === ''}>
          {sending ? 'Sending…' : 'Send report'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={sending}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/* ---------------------------------------------------------------- the page */

type Panel = 'none' | 'edit' | 'report'

export function ProfilePage() {
  const { handle } = useParams()
  const navigate = useNavigate()

  const [profile, setProfile] = useState<ProfileView | null>(null)
  const [own, setOwn] = useState<OwnProfile | null>(null)
  const [panel, setPanel] = useState<Panel>('none')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())

  /*
   * `/profile` with no handle is "my profile". It resolves the signed-in
   * person's handle and moves to their real address, so a profile always has
   * one URL that can be shared — rather than one address that means different
   * people depending on who is looking.
   */
  useEffect(() => {
    if (handle) return
    let live = true
    api<OwnProfile>('/profiles/me')
      .then((mine) => {
        if (!live) return
        setOwn(mine)
        void navigate(`/profile/${mine.handle}`, { replace: true })
      })
      .catch((caught: unknown) => {
        if (!live) return
        setLoading(false)
        setError(caught instanceof Error ? caught.message : 'Could not load your profile.')
      })
    return () => {
      live = false
    }
  }, [handle, navigate])

  const load = useCallback(async (): Promise<void> => {
    if (!handle) return
    try {
      const view = await api<ProfileView>(`/profiles/${encodeURIComponent(handle)}`)
      setProfile(view)
      setNow(Date.now())
      setError(null)
    } catch (caught) {
      setProfile(null)
      setError(
        caught instanceof ApiError && caught.status === 404
          ? `There is no profile at @${handle}.`
          : caught instanceof Error
            ? caught.message
            : 'Could not load this profile.',
      )
    } finally {
      setLoading(false)
    }
  }, [handle])

  useEffect(() => {
    if (!handle) return
    setLoading(true)
    void load()
  }, [handle, load])

  async function openEditor() {
    setNotice('')
    try {
      setOwn(await api<OwnProfile>('/profiles/me'))
      setPanel('edit')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open the editor.')
    }
  }

  async function setBlocked(blocked: boolean) {
    if (!profile) return
    try {
      await api(`/profiles/${encodeURIComponent(profile.handle)}/block`, {
        method: blocked ? 'POST' : 'DELETE',
      })
      setNotice(
        blocked
          ? `You blocked @${profile.handle}. Their profile is hidden from you.`
          : `You unblocked @${profile.handle}.`,
      )
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That could not be saved.')
    }
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <p className={styles.loading} role="status">
          Loading profile…
        </p>
      </div>
    )
  }

  if (error && !profile) {
    return (
      <div className={styles.page}>
        <section className={styles.empty}>
          <h1 className={styles.emptyTitle}>Profile unavailable</h1>
          <p className={styles.emptyBody}>{error}</p>
        </section>
      </div>
    )
  }

  if (!profile) return null

  /*
   * "2026-08" is not something to show a person.
   *
   * `Intl` turns it into words in whatever language the reader's browser is
   * set to, rather than this file deciding that everybody reads English
   * month names.
   */
  const memberSince = (() => {
    const raw = profile.memberSince
    if (!raw) return null
    const [year, month] = raw.split('-').map(Number)
    if (!year || !month) return null
    /*
     * Local, not UTC. A UTC midnight formatted in a behind-UTC zone lands in
     * the previous month, so a member since 2026-08 would read "July 2026".
     */
    return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
      new Date(year, month - 1, 1),
    )
  })()

  return (
    <div className={styles.page}>
      {/* Announcements for actions whose result is a change elsewhere. */}
      <div aria-live="polite" className="sr-only">
        {notice}
      </div>

      {/*
        A month, written the reader's way.
        The API sends 2026-08 rather than a date, because the exact day
        somebody joined is a fact nothing needs; this turns it into words in
        whatever language the reader's browser is set to.
      */}
      <header className={styles.header}>
        <div className={styles.identity}>
          <Avatar name={profile.displayName} identity={profile.handle} size="large" />
          <div className={styles.names}>
            <h1 className={styles.displayName}>{profile.displayName}</h1>
            <p className={styles.handle}>@{profile.handle}</p>
          </div>
        </div>

        {profile.blocked ? null : (
          <>
            {profile.tagline ? <p className={styles.tagline}>{profile.tagline}</p> : null}

            {profile.favouriteVerses.length > 0 ? (
              <section className={styles.favourites} aria-labelledby="favourite-scripture">
                <h2 className="eyebrow" id="favourite-scripture">
                  Favourite Scripture
                </h2>
                <ul className={styles.verseList}>
                  {profile.favouriteVerses.map((verse) => (
                    <li key={verse} className={styles.verse}>
                      {verse}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/*
              One quiet line of facts rather than a row of big numbers. The
              brief is explicit that this should not become a social-network
              header, and a count of shares is interesting where a scoreboard
              is not.
            */}
            <p className={styles.count}>
              <span>
                {profile.publicChatCount === 1
                  ? '1 public C.H.A.T.'
                  : `${profile.publicChatCount ?? 0} public C.H.A.T.s`}
              </span>
              {memberSince ? (
                <>
                  <span aria-hidden="true"> · </span>
                  <span>Here since {memberSince}</span>
                </>
              ) : null}
            </p>
          </>
        )}

        <div className={styles.actions}>
          {profile.isOwner ? (
            <button type="button" className="btn btn-secondary" onClick={() => void openEditor()}>
              Edit profile
            </button>
          ) : profile.blocked ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void setBlocked(false)}
            >
              Unblock @{profile.handle}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setNotice('')
                  setPanel('report')
                }}
              >
                Report profile
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void setBlocked(true)}
              >
                Block user
              </button>
            </>
          )}
        </div>
      </header>

      {error && profile ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}

      {panel === 'edit' && own ? (
        <ProfileEditor
          own={own}
          onCancel={() => setPanel('none')}
          onSaved={(saved) => {
            setOwn(saved)
            setPanel('none')
            setNotice('Your profile has been saved.')
            /* The handle is the address, so a changed handle changes the URL. */
            if (saved.handle !== profile.handle) {
              void navigate(`/profile/${saved.handle}`, { replace: true })
            } else {
              void load()
            }
          }}
        />
      ) : null}

      {panel === 'report' ? (
        <ReportForm
          handle={profile.handle}
          reasons={profile.reportReasons}
          onCancel={() => setPanel('none')}
          onDone={(message) => {
            setPanel('none')
            setNotice(message)
          }}
        />
      ) : null}

      {profile.blocked ? (
        <section className={styles.empty}>
          <h2 className={styles.emptyTitle}>You blocked this person</h2>
          <p className={styles.emptyBody}>
            Nothing they have shared is shown to you. Unblock them to see their profile again.
          </p>
        </section>
      ) : (
        /*
         * Shares, and only Shares.
         *
         * One section, one heading, no tab strip — because there is exactly one
         * thing here and pretending otherwise is what turns a portfolio into an
         * empty social profile.
         */
        <section className={styles.shares} aria-labelledby="shares-heading">
          <h2 className={styles.sectionTitle} id="shares-heading">
            Shares
          </h2>
          {profile.shares.length === 0 ? (
            <div className={styles.empty}>
              <h3 className={styles.emptyTitle}>
                {profile.isOwner
                  ? 'You have not shared a C.H.A.T. yet'
                  : `${profile.displayName} has not shared a C.H.A.T. yet`}
              </h3>
              <p className={styles.emptyBody}>
                {profile.isOwner
                  ? 'When you share a reflection publicly it appears here, as a small portfolio of your work.'
                  : 'When they share a reflection publicly, it will appear here.'}
              </p>
            </div>
          ) : (
            <ul className={styles.grid}>
              {profile.shares.map((share) => (
                <ReflectionCard
                  key={share.id}
                  item={share}
                  excerpt={share.excerpt}
                  written={share.sections}
                  now={now}
                  /*
                   * Only the author can open the underlying reflection. For
                   * anyone else the card is the reading surface, not a link
                   * to a page they would be refused.
                   */
                  {...(profile.isOwner ? { href: `/?c=${share.id}` } : {})}
                  emptyExcerpt="Shared without a written section."
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
