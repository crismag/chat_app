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
  type ConversationSummary,
} from '@chat/shared'
import type { BiblePassage } from '@chat/shared'
import { CONDENSED_FIELDS } from '../chat/sections.ts'
import { ApiError, api } from '../shared/api/client.ts'
import { SECTIONS, StateBadge, formatDate } from '../shared/ui/ReflectionCard.tsx'
import { MoreIcon } from '../shared/ui/icons.tsx'
import { useMobileBar } from '../shared/mobile/MobileBar.tsx'
import { PageMenu } from '../shared/mobile/PageMenu.tsx'
import styles from './ReflectionViewPage.module.css'

type Detail = ConversationSummary & {
  format?: ChatFormat
  sections: Record<string, ChatSection | undefined>
  /*
   * A Short reflection's two fields travel in their own map, beside the four
   * rather than inside them — that is what lets a format change keep both
   * drafts. Reading `sections` for a Short reflection therefore finds nothing,
   * which is why this page showed a complete Short reflection as empty.
   */
  condensed?: Record<string, ChatSection | undefined>
}

export function ReflectionViewPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  /*
   * The passage, when there is one. Its absence is not an error and is never
   * reported as one: plenty of reflections have a reference typed by hand that
   * no provider will resolve, and a red band about it would be the loudest
   * thing on a page meant for reading.
   */
  const [passage, setPassage] = useState<BiblePassage | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
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

  useEffect(() => {
    let live = true
    setPassage(null)
    api<{ passage: BiblePassage }>(`/bible/reflections/${id}/passage`)
      .then((value) => live && setPassage(value.passage))
      .catch(() => {
        /* No passage stored, or none resolvable. The page reads fine without. */
      })
    return () => {
      live = false
    }
  }, [id])

  /*
   * The bar names the passage rather than the page. "Reflection" would be
   * true of every one of them; the reference says which this is, and the
   * title is already the first thing under the bar in full.
   */
  useMobileBar(
    () => ({
      title: detail?.scriptureReference || 'Reflection',
      /* The reflection's own title is this page's heading, just below. */
      titleIsHeading: false,
      onBack: () => void navigate('/reflections'),
      backLabel: 'Back to Reflections',
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
    [detail?.id, detail?.scriptureReference],
  )

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
  /* Whichever map this format keeps its writing in. */
  const draft =
    detail.format === CHAT_FORMATS.CONDENSED ? (detail.condensed ?? {}) : (detail.sections ?? {})
  const written = fields.filter((field) => (draft[field.type]?.content ?? '').trim())

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
          {/* Whether this is shared is part of reading it, not a setting. */}
          <StateBadge state={detail.visibility} />
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

      {/*
        The reflection's own actions and the account, in the one sheet every
        screen opens from the same place. Delete lives here — on the owned
        reflection — rather than on a card in a list, where a destructive
        action sits under a thumb that is scrolling.
      */}
      <PageMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={
          detail
            ? [
                { label: 'Edit this reflection', onSelect: () => void navigate(`/?c=${detail.id}`) },
                { label: 'Create image', onSelect: () => void navigate(`/create?c=${detail.id}`) },
              ]
            : []
        }
      />

      {passage ? (
        <section className={styles.passage} aria-label={`${passage.reference}, ${passage.name}`}>
          <p className={styles.passageMeta}>
            {passage.reference} · {passage.abbreviation}
          </p>
          <p className={styles.passageBody}>{passage.content}</p>
          {passage.copyright ? (
            <p className={styles.passageCopyright}>{passage.copyright}</p>
          ) : null}
        </section>
      ) : null}

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
              <p className={styles.body}>{draft[field.type]?.content}</p>
            </section>
          ))}
        </div>
      )}
    </main>
  )
}
