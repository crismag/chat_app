/*
 * One reflection, to be read.
 *
 * Reflections used to open straight into the editor, which is the only place a
 * reflection could be seen at all. That made reading and writing the same act:
 * every visit put a caret in the first box, and the way to look at something
 * you wrote a month ago was to open the thing that can change it.
 *
 * This page reads. Nothing here is a field, nothing autosaves, and the way to
 * the editor is a button somebody presses on purpose.
 */

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  CHAT_FORMATS,
  type ChatFormat,
  type ChatSection,
  type ChatSectionType,
  type ConversationSummary,
} from '@chat/shared'
import { CONDENSED_FIELDS } from '../chat/sections.ts'
import { ApiError, api } from '../shared/api/client.ts'
import { SECTIONS, formatDate } from '../shared/ui/ReflectionCard.tsx'
import styles from './ReflectionViewPage.module.css'

type Detail = ConversationSummary & {
  format?: ChatFormat
  sections: Record<string, ChatSection | undefined>
}

export function ReflectionViewPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const now = Date.now()

  useEffect(() => {
    let live = true
    setDetail(null)
    setError(null)
    api<Detail>(`/conversations/${id}`)
      .then((value) => live && setDetail(value))
      .catch((caught: unknown) => {
        if (!live) return
        /*
         * Somebody else's reflection answers 404, exactly as a missing one
         * does — the same sentence for both, because "you may not read this"
         * and "this does not exist" must not be distinguishable from outside.
         */
        setError(
          caught instanceof ApiError && caught.status === 404
            ? 'That reflection is not available.'
            : 'That reflection could not be loaded.',
        )
      })
    return () => {
      live = false
    }
  }, [id])

  if (error) {
    return (
      <main className={styles.page} id="main">
        <p className={styles.problem} role="alert">
          {error}
        </p>
        <Link className="btn btn-secondary" to="/reflections">
          Back to Reflections
        </Link>
      </main>
    )
  }

  if (!detail) {
    return (
      <main className={styles.page} id="main">
        <p className={styles.loading} role="status">
          Loading the reflection…
        </p>
      </main>
    )
  }

  /*
   * The card's SECTIONS and the editor's CONDENSED_FIELDS name their label
   * differently. Normalised here so the render below reads one shape rather
   * than branching on which format supplied it.
   */
  const fields: { type: string; letter: string; name: string }[] =
    detail.format === CHAT_FORMATS.CONDENSED
      ? CONDENSED_FIELDS.map(({ type, letter, name }) => ({ type, letter, name }))
      : SECTIONS.map(({ type, letter, label }) => ({ type, letter, name: label }))
  const written = fields.filter((field) => (detail.sections?.[field.type]?.content ?? '').trim())

  return (
    <main className={styles.page} id="main">
      <nav className={styles.breadcrumb}>
        <Link to="/reflections">← Reflections</Link>
      </nav>

      <header className={styles.header}>
        <h1 className={styles.title}>{detail.title || 'Untitled reflection'}</h1>
        <p className={styles.meta}>
          {detail.scriptureReference ? (
            <span className={styles.reference}>{detail.scriptureReference}</span>
          ) : null}
          <span>
            <span className="sr-only">Last updated </span>
            {formatDate(detail.updatedAt, now)}
          </span>
        </p>
        {detail.tags.length > 0 ? (
          <ul className={styles.tags}>
            {detail.tags.map((tag) => (
              <li key={tag.tag}>{tag.label}</li>
            ))}
          </ul>
        ) : null}
      </header>

      {/*
        The editor is a press away, not the destination. Reading is what this
        page is for, so the way to change something is stated rather than
        assumed.
      */}
      <div className={styles.actions}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void navigate(`/?c=${detail.id}`)}
        >
          Edit this reflection
        </button>
      </div>

      {written.length === 0 ? (
        <p className={styles.empty}>
          Nothing has been written in this reflection yet.
        </p>
      ) : (
        <div className={styles.sections}>
          {written.map((field) => (
            <section
              className={`${styles.section} ${styles[field.type] ?? ''}`}
              key={field.type}
              aria-labelledby={`view-${field.type}`}
            >
              <h2 className={styles.sectionHeading} id={`view-${field.type}`}>
                <span className={styles.letter} aria-hidden="true">
                  {field.letter}
                </span>
                {field.name}
              </h2>
              {/*
                `pre-wrap`, because these are the author's own line breaks and
                a paragraph they split in two was split on purpose.
              */}
              <p className={styles.body}>
                {detail.sections?.[field.type as ChatSectionType]?.content}
              </p>
            </section>
          ))}
        </div>
      )}
    </main>
  )
}
