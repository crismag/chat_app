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
import { isGuest } from '@chat/shared'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type { ChatFormat, ChatSectionType } from '@chat/shared'
import { ApiError, api } from '../shared/api/client.ts'
import { ReflectionCard } from '../shared/ui/ReflectionCard.tsx'
import { useAuth } from '../auth/useAuth.ts'
import { ReportDialog } from '../shared/ui/ReportDialog.tsx'
import { AvatarField } from './AvatarField.tsx'
import { ConfirmEmailNotice } from './ConfirmEmailNotice.tsx'
import { useHandleAvailability } from './useHandleAvailability.ts'
import { CommunitiesPanel, EncouragedPanel } from './ProfilePanels.tsx'
import { ProfileTabs, isProfileTab, type ProfileTab } from './ProfileTabs.tsx'
import { SettingsPanel } from './SettingsPanel.tsx'
import { Avatar } from '../shared/ui/Avatar.tsx'
import { ContactButton } from '../messaging/ContactButton.tsx'
import { contactStatus } from '../messaging/api.ts'
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
  avatarUrl?: string | null
  isOwner: boolean
  blocked: boolean
  shares: Share[]
  reportReasons: { id: string; label: string }[]
}

/** The owner's editable view, with the limits the server will enforce. */
type OwnProfile = {
  handle: string
  avatarUrl?: string | null
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
  onAvatarChanged,
  onCancel,
}: {
  own: OwnProfile
  onSaved: (saved: OwnProfile) => void
  /*
   * A picture is saved the moment it is chosen, not when the form is
   * submitted, so it has to be announced separately. Without this, adding a
   * picture and then pressing Cancel leaves the page showing the old face for
   * a picture the server has already accepted.
   */
  onAvatarChanged: (avatarUrl: string | null) => void
  onCancel: () => void
}) {
  const [handle, setHandle] = useState(own.handle)
  const availability = useHandleAvailability(handle, own.handle)
  const [displayName, setDisplayName] = useState(own.displayName)
  const [tagline, setTagline] = useState(own.tagline)
  const [verses, setVerses] = useState<string[]>(() => {
    const next = [...own.favouriteVerses]
    while (next.length < own.limits.favouriteVerses) next.push('')
    return next.slice(0, own.limits.favouriteVerses)
  })
  const [avatarUrl, setAvatarUrl] = useState<string | null>(own.avatarUrl ?? null)
  const [error, setError] = useState<{
    message: string
    field?: string
  } | null>(null)
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
      onSaved({ ...saved, avatarUrl })
    } catch (caught) {
      const field =
        caught instanceof ApiError ? (caught.body as { field?: string } | null)?.field : undefined
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

      {/*
        The picture comes first because it is the part of a profile a person
        recognises before they read anything. It saves on its own rather than
        with the form: uploading bytes and patching text are different
        operations, and pretending otherwise would mean a failed picture
        discarding a name the person had already typed.
      */}
      <AvatarField
        name={displayName || own.displayName}
        identity={own.handle}
        avatarUrl={avatarUrl}
        onChanged={(next) => {
          setAvatarUrl(next)
          onAvatarChanged(next)
        }}
      />

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
            aria-describedby={`${ids}-handle-hint ${ids}-handle-status`}
            aria-invalid={availability.state === 'taken' ? true : invalid('handle')}
            onChange={(event) => setHandle(event.target.value)}
          />
        </div>
        {/*
          Announced politely as it settles, so somebody using a screen reader
          hears the answer without it interrupting their typing. It is advice:
          the save asks again, because a handle can be claimed in between.
        */}
        <p
          className={styles.handleStatus}
          id={`${ids}-handle-status`}
          role="status"
          data-state={availability.state}
        >
          {availability.state === 'checking'
            ? 'Checking…'
            : availability.state === 'free'
              ? `@${handle.trim().toLowerCase()} is available.`
              : availability.state === 'taken'
                ? availability.problem
                : ''}
        </p>
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
        <legend className="label">Favourite Scripture — up to {own.limits.favouriteVerses}</legend>
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
/* ---------------------------------------------------------------- the page */

type Panel = 'none' | 'edit' | 'report'

export function ProfilePage() {
  const { handle } = useParams()
  const { user, refresh } = useAuth()
  const [searchParams] = useSearchParams()

  /*
   * The open section lives in the URL, so it can be linked to, reloaded and
   * reached with Back. An unknown or absent one is the profile itself rather
   * than an error — a stale bookmark should open the page, not break it.
   */
  const asked = searchParams.get('tab')
  /*
   * Shared is the landing section, not Profile.
   *
   * This page exists to be somebody's portfolio — the empty state below says
   * so in as many words — and their shares are the thing worth opening on.
   * The Profile tab holds what they wrote *about* themselves, which is worth
   * a place but not the first screen.
   */
  const tab: ProfileTab = isProfileTab(asked) ? asked : 'shared'
  const navigate = useNavigate()

  const [profile, setProfile] = useState<ProfileView | null>(null)
  const [own, setOwn] = useState<OwnProfile | null>(null)
  const [panel, setPanel] = useState<Panel>('none')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  /*
   * Whether this person is in my contacts.
   *
   * Asked for separately rather than folded into the profile payload: a
   * profile is a public document and this is a private fact about the reader's
   * own address book, so it is answered by the messaging module on the
   * reader's behalf and never becomes part of what a profile *is*.
   */
  const [isContact, setIsContact] = useState(false)

  /*
   * `/profile` with no handle is "my profile". It resolves the signed-in
   * person's handle and moves to their real address, so a profile always has
   * one URL that can be shared — rather than one address that means different
   * people depending on who is looking.
   */
  useEffect(() => {
    if (!handle) return
    let live = true
    contactStatus(handle)
      .then((status) => {
        if (live) setIsContact(status.isContact)
      })
      /* Not knowing is the same as not added, which is what the button shows. */
      .catch(() => {
        if (live) setIsContact(false)
      })
    return () => {
      live = false
    }
  }, [handle])

  useEffect(() => {
    if (handle) return
    let live = true
    api<OwnProfile>('/profiles/me')
      .then((mine) => {
        if (!live) return
        setOwn(mine)
        /*
         * The query survives the redirect. /profile is an alias that resolves
         * to a handle, so dropping the search here would silently discard
         * ?tab= — and a link to somebody's own settings would open on their
         * shares instead.
         */
        void navigate(
          { pathname: `/profile/${mine.handle}`, search: window.location.search },
          { replace: true },
        )
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

  /*
   * A guest asking for their own profile is not an error.
   *
   * They have no profile because a profile is a public identity and they have
   * not chosen one — which is a thing to explain and offer, not to report as
   * "Unauthenticated." Their work is not at stake either way: signing up keeps
   * the same account, so nothing they have written moves or is lost.
   */
  if (!handle && isGuest(user)) {
    return (
      <div className={styles.page}>
        <section className={styles.empty}>
          <h1 className={styles.emptyTitle}>You do not have a profile yet</h1>
          <p className={styles.emptyBody}>
            A profile is how other people see you when you share a reflection — a name, a picture
            and the Scripture you keep returning to. Creating an account gives you one.
          </p>
          <p className={styles.emptyBody}>
            Everything you have written so far stays exactly where it is; this is the same account,
            with a name on it.
          </p>
          <p>
            <Link className="btn btn-primary" to="/login">
              Create an account
            </Link>
          </p>
        </section>
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
    return new Intl.DateTimeFormat(undefined, {
      month: 'long',
      year: 'numeric',
    }).format(new Date(year, month - 1, 1))
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
          <Avatar
            name={profile.displayName}
            identity={profile.handle}
            src={profile.avatarUrl}
            size="large"
          />
          <div className={styles.names}>
            <h1 className={styles.displayName}>{profile.displayName}</h1>
            <p className={styles.handle}>@{profile.handle}</p>
          </div>
        </div>

        {profile.blocked ? null : (
          <>
            {profile.tagline ? <p className={styles.tagline}>{profile.tagline}</p> : null}

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
              {user?.accountType === 'REGISTERED' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setNotice('')
                    void api<{ thread: { id: string } }>('/messaging/open', {
                      method: 'POST',
                      body: JSON.stringify({ handle: profile.handle }),
                    })
                      .then((opened) => navigate(`/messages/${opened.thread.id}`))
                      .catch((caught: unknown) => {
                        setError(
                          caught instanceof ApiError ? caught.message : 'Could not start a message.',
                        )
                      })
                  }}
                >
                  Message
                </button>
              ) : null}
              {/*
                Adding somebody from their profile is the point of a profile
                being public. It asks nothing of them and gives them something:
                a message from a person on your list does not join a queue.
              */}
              {user?.accountType === 'REGISTERED' ? (
                <ContactButton
                  handle={profile.handle}
                  isContact={isContact}
                  size="medium"
                  onChanged={setIsContact}
                />
              ) : null}
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
              <button type="button" className="btn btn-ghost" onClick={() => void setBlocked(true)}>
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

      {/*
        Only the person themselves, and only while it is true.
        `isOwner` says this page is theirs; the unverified fact comes from
        their own session and is not in the profile payload at all, so there
        is nothing here that could be shown to a visitor. The guest check is
        not redundant: a guest has no address, so `emailVerified` is false for
        them too, and they would otherwise be told to confirm one they never
        gave.
      */}
      {profile.isOwner && user?.accountType === 'REGISTERED' && !user.emailVerified ? (
        <ConfirmEmailNotice email={user.email} />
      ) : null}

      {panel === 'edit' && own ? (
        <ProfileEditor
          own={own}
          onCancel={() => setPanel('none')}
          onAvatarChanged={(avatarUrl) => {
            setProfile((current) => (current ? { ...current, avatarUrl } : current))
            setOwn((current) => (current ? { ...current, avatarUrl } : current))
            /* The account menu shows this face too. */
            void refresh()
          }}
          onSaved={(saved) => {
            setOwn(saved)
            setPanel('none')
            setNotice('Your profile has been saved.')
            /* The header carries this person's face too; it should not lag behind. */
            void refresh()
            /* The handle is the address, so a changed handle changes the URL. */
            if (saved.handle !== profile.handle) {
              void navigate(
                { pathname: `/profile/${saved.handle}`, search: window.location.search },
                { replace: true },
              )
            } else {
              void load()
            }
          }}
        />
      ) : null}

      {panel === 'report' ? (
        /*
         * The same dialog Community reports a reflection through. Reporting
         * somebody should not vary by where you happened to be standing, so
         * only the words differ.
         */
        <ReportDialog
          title={`Report @${profile.handle}`}
          lead="Reports are read before anything happens — reporting does not remove anything for other people."
          reasons={profile.reportReasons}
          notePlaceholder={(reason) =>
            reason === 'other'
              ? 'What is wrong with this profile?'
              : 'Anything that would help somebody understand the problem.'
          }
          onClose={() => setPanel('none')}
          onSubmit={async (reason, detail) => {
            const result = await api<{ message: string }>(
              `/profiles/${profile.handle}/report`,
              { method: 'POST', body: JSON.stringify({ reason, detail }) },
            )
            /*
             * Returned rather than pushed into the page's notice: the dialog
             * shows the confirmation, and setting both said it twice — once on
             * screen and once more to anybody listening to the live region.
             */
            return result.message
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
      ) : profile.isOwner ? (
        /*
         * The owner has five sections, so they get a tab strip. A visitor has
         * one — public shares — and gets no strip at all: a row of tabs over a
         * single section is what turns a portfolio into an empty social
         * profile, and four of the five are private anyway.
         */
        <>
          <ProfileTabs handle={profile.handle} current={tab} />
          {tab === 'profile' ? <About profile={profile} /> : null}
          {tab === 'shared' ? <Shares profile={profile} now={now} /> : null}
          {tab === 'communities' ? <CommunitiesPanel /> : null}
          {tab === 'encouraged' ? <EncouragedPanel /> : null}
          {tab === 'settings' ? <SettingsPanel /> : null}
        </>
      ) : (
        <>
          <About profile={profile} />
          <Shares profile={profile} now={now} />
        </>
      )}
    </div>
  )
}

/**
 * Favourite Scripture, and nothing else yet.
 *
 * It used to sit in the header, where three verses pushed the shares off the
 * first screen on a phone. The header is now who somebody is; this is what
 * they wanted to say.
 */
function About({ profile }: { profile: ProfileView }) {
  if (profile.favouriteVerses.length === 0) {
    return (
      <section className={styles.empty}>
        <h2 className={styles.emptyTitle}>
          {profile.isOwner ? 'Nothing here yet' : 'Nothing here yet'}
        </h2>
        <p className={styles.emptyBody}>
          {profile.isOwner
            ? 'Edit your profile to add a line about yourself and the Scripture you keep returning to.'
            : `${profile.displayName} has not added anything here.`}
        </p>
      </section>
    )
  }

  return (
    <section className={styles.favourites} aria-labelledby="favourite-scripture">
      <h2 className={styles.sectionTitle} id="favourite-scripture">
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
  )
}

function Shares({ profile, now }: { profile: ProfileView; now: number }) {
  return (
    <section className={styles.shares} aria-labelledby="shares-heading">
      <h2 className={styles.sectionTitle} id="shares-heading">
        {profile.isOwner ? 'Shared' : 'Shares'}
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
  )
}
