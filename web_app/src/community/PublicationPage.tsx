/*
 * One shared C.H.A.T., at its own address.
 *
 * This is the URL the membership rule is tested against: a member opens it and
 * reads the reflection; someone who was removed from the community opens the
 * *same* URL and is told it is not available. Neither outcome is decided here.
 * The component asks the server for the publication and renders whichever
 * answer it gets, because possessing this URL is not a permission and there is
 * nothing on this page that could turn it into one.
 *
 * The "no longer available" state deliberately says the same thing whether the
 * publication never existed, was unshared, was hidden, or belongs to a
 * community the reader has left. Distinguishing them would confirm a private
 * community's contents to someone who is no longer entitled to know.
 */

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { CHAT_FORMATS, audienceLabel } from '@chat/shared'
import { ApiError } from '../shared/api/client.ts'
import { SECTIONS } from '../shared/ui/ReflectionCard.tsx'
import { fetchPublication, setEncouraged, setSaved, type Publication } from './api.ts'
import styles from './CommunityPage.module.css'

const SECTION_LABEL = new Map(SECTIONS.map((section) => [section.type as string, section]))

const CONDENSED_LABELS: Record<string, string> = {
  verse: 'Verse',
  reflection: 'Reflection',
}

const ORIGIN_LABELS: Record<string, string> = {
  ai_assisted: 'Written with AI help',
  ai_generated: 'Written by AI, kept by the author',
}

const when = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

export function PublicationPage() {
  const { id = '' } = useParams()
  const [publication, setPublication] = useState<Publication | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'error'>('loading')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    fetchPublication(id)
      .then((found) => {
        if (cancelled) return
        setPublication(found)
        setState('ready')
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        /* 404 covers every reason equally, and so does this. */
        setState(caught instanceof ApiError && caught.status === 404 ? 'gone' : 'error')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (state === 'loading') {
    return (
      <section className={styles.detail} aria-busy="true">
        <div className={styles.detailSkeleton} />
      </section>
    )
  }

  if (state !== 'ready' || !publication) {
    return (
      <section className={styles.detail}>
        <h1 className={styles.detailTitle}>
          {state === 'gone' ? 'This reflection is not available' : 'That could not be loaded'}
        </h1>
        <p className={styles.description}>
          {state === 'gone'
            ? 'It may have been unshared by its author, or it may belong to a community you are not part of.'
            : 'Something went wrong reaching the server. It is worth trying again.'}
        </p>
        <Link className={`btn btn-secondary ${styles.recover}`} to="/community">
          Return to Community
        </Link>
      </section>
    )
  }

  const condensed = publication.format === CHAT_FORMATS.CONDENSED

  return (
    <article className={styles.detail}>
      <p className="eyebrow">
        {publication.scriptureReference || 'No Scripture reference'}
      </p>
      <h1 className={styles.detailTitle}>{publication.title}</h1>

      <p className={styles.detailMeta}>
        <span className={styles.author}>
          <span className={styles.avatar} aria-hidden="true">
            {publication.author.displayName.trim().charAt(0).toUpperCase() || '?'}
          </span>
          {publication.author.displayName}
        </span>
        <span aria-hidden="true">·</span>
        {/* The audience, in words, never by colour alone. */}
        <span>{audienceLabel(publication.audience, publication.community?.name)}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={publication.createdAt}>
          {when.format(new Date(publication.createdAt))}
        </time>
      </p>

      {publication.caption ? (
        <p className={styles.detailCaption}>{publication.caption}</p>
      ) : null}

      <div className={styles.sections}>
        {publication.sections.map((section) => (
          <section key={section.type} className={styles.detailSection}>
            <h2 className={styles.detailSectionHead}>
              {condensed ? null : (
                <span
                  className={styles.sectionLetter}
                  data-section={section.type}
                  aria-hidden="true"
                >
                  {SECTION_LABEL.get(section.type)?.letter ?? '·'}
                </span>
              )}
              {condensed
                ? (CONDENSED_LABELS[section.type] ?? section.type)
                : (SECTION_LABEL.get(section.type)?.label ?? section.type)}

              {/*
                Provenance travels into published content, and is visible there.
                The guidelines require that AI wording is never presented as
                another person's own experience, and a badge only the private
                editor showed would not keep that promise.
              */}
              {ORIGIN_LABELS[section.authorOrigin] ? (
                <span className={`badge badge-${section.authorOrigin.replace('_', '-')}`}>
                  {ORIGIN_LABELS[section.authorOrigin]}
                </span>
              ) : null}
            </h2>
            <p className={styles.detailSectionBody}>{section.content}</p>
          </section>
        ))}
      </div>

      {publication.hashtags.length > 0 ? (
        <p className={styles.hashtags}>
          {publication.hashtags.map((hashtag) => (
            <span key={hashtag.tag} className={styles.hashtag}>
              #{hashtag.label}
            </span>
          ))}
        </p>
      ) : null}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.encourage}
          aria-pressed={publication.encouraged.byViewer}
          onClick={() => {
            void setEncouraged(publication.id, !publication.encouraged.byViewer).then(
              (result) => {
                setPublication({ ...publication, encouraged: result.encouraged })
                setNotice(result.message)
              },
            )
          }}
        >
          <span aria-hidden="true">{publication.encouraged.byViewer ? '♥' : '♡'}</span>
          Encouraged
          {publication.encouraged.count > 0 ? (
            <span className={styles.count}>{publication.encouraged.count}</span>
          ) : null}
        </button>

        <button
          type="button"
          className={styles.save}
          aria-pressed={publication.saved}
          onClick={() => {
            void setSaved(publication.id, !publication.saved).then((result) => {
              setPublication({ ...publication, saved: result.saved })
              setNotice(result.message)
            })
          }}
        >
          <span aria-hidden="true">{publication.saved ? '★' : '☆'}</span>
          {publication.saved ? 'Saved' : 'Save'}
        </button>

        {/* Absent, not disabled, where sharing is not permitted. */}
        {publication.shareUrl ? (
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              void navigator.clipboard?.writeText(publication.shareUrl ?? '')
              setNotice('Public link copied.')
            }}
          >
            Copy public link
          </button>
        ) : null}
      </div>

      <p className={styles.notice} role="status" aria-live="polite">
        {notice}
      </p>

      <Link className={styles.back} to="/community">
        Back to Community
      </Link>
    </article>
  )
}
