/*
 * The reflection gallery card, and the small pieces it is made of.
 *
 * Extracted from `ReflectionsPage` rather than reimplemented, because the
 * public profile shows a person's shared reflections and the brief is
 * explicit that it shows *the same* cards. Two cards claiming to be the same
 * card is how a product starts looking like two products.
 *
 * What moved is presentation only: the tile, the section marks, the C/H/A/T
 * progress and the publication badge. Reflections keeps its grids, its list
 * rows, its search and its data fetching — nothing about how a card is
 * *obtained* is in here, which is what lets the profile feed it server-decided
 * public data and Reflections feed it the owner's own.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router'
import {
  CHAT_FORMATS,
  CHAT_SECTION_TYPES,
  type ChatFormat,
  type ChatSectionType,
  type Visibility,
} from '@chat/shared'
import styles from './ReflectionCard.module.css'

/** The four letters, in order, with the names their markers are announced by. */
export const SECTIONS: { type: ChatSectionType; letter: string; label: string }[] = [
  { type: CHAT_SECTION_TYPES.CONTENT, letter: 'C', label: 'Content' },
  { type: CHAT_SECTION_TYPES.HEART, letter: 'H', label: 'Heart' },
  { type: CHAT_SECTION_TYPES.APPLICATION, letter: 'A', label: 'Application' },
  { type: CHAT_SECTION_TYPES.TESTIMONY, letter: 'T', label: 'Testimony' },
]

const DAY = 24 * 60 * 60 * 1000

const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const longDate = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

export function formatDate(iso: string, now: number): string {
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return ''
  return now - value.getTime() > 300 * DAY ? longDate.format(value) : shortDate.format(value)
}

/**
 * Which sections exist, as colour.
 *
 * Decorative on purpose: every fact it carries is also in `ChatProgress`,
 * which has an accessible name. Nothing here is conveyed by colour alone.
 */
export function SectionMarks({
  written,
  variant,
}: {
  written: ChatSectionType[] | undefined
  variant: 'strip' | 'thumb'
}) {
  return (
    <span className={styles.marks} data-variant={variant} aria-hidden="true">
      {SECTIONS.map((section) => (
        <span
          key={section.type}
          data-section={section.type}
          data-written={written?.includes(section.type) ? 'true' : 'false'}
        />
      ))}
    </span>
  )
}

export function ChatProgress({
  format,
  written,
}: {
  format: ChatFormat | undefined
  written: ChatSectionType[] | undefined
}) {
  /*
   * A Condensed C.H.A.T. is a format of its own, not a Full one with sections
   * missing, so it must never be shown against a four-section scale.
   */
  if (format === CHAT_FORMATS.CONDENSED) {
    return <span className={styles.formatMark}>Condensed C.H.A.T.</span>
  }

  const done = written?.length ?? 0
  return (
    <span className={styles.progress}>
      <span
        className={styles.markers}
        role="img"
        aria-label={`C.H.A.T. progress: ${done} of 4 sections written`}
      >
        {SECTIONS.map((section) => (
          <span
            key={section.type}
            className={styles.marker}
            data-section={section.type}
            data-written={written?.includes(section.type) ? 'true' : 'false'}
            aria-hidden="true"
          >
            {section.letter}
          </span>
        ))}
      </span>
      <span className={styles.progressCount}>{done} of 4</span>
    </span>
  )
}

export function StateBadge({ state }: { state: Visibility }) {
  const shared = state === 'shared'
  return (
    <span className={`badge ${shared ? styles.shared : styles.private}`}>
      <span aria-hidden="true">{shared ? '◉' : '◆'}</span>
      {shared ? 'Shared' : 'Private'}
    </span>
  )
}

export type ReflectionCardItem = {
  id: string
  title: string
  scriptureReference: string | null
  format?: ChatFormat
  updatedAt: string
}

/**
 * One reflection as a card.
 *
 * `href` is optional, and its absence is a real state rather than an oversight:
 * on someone else's public profile there is nowhere for a card to go, because
 * a reader may not open another person's reflection. A card with no destination
 * renders as what it is — something to read — instead of a link that would 404.
 */
export function ReflectionCard({
  item,
  excerpt,
  written,
  now,
  href,
  featured,
  state,
  emptyExcerpt = 'Nothing written yet.',
  badge,
  actions,
  meta,
  footer,
  dateLabel = 'Last updated ',
  progress,
}: {
  item: ReflectionCardItem
  /*
   * A string for a plain excerpt, or nodes when the card carries several
   * section excerpts with their C/H/A/T markers — which is what a Community
   * publication shows. Widening this was the alternative to a second card that
   * differed from this one only in its middle.
   */
  excerpt: ReactNode | undefined
  written: ChatSectionType[] | undefined
  now: number
  href?: string
  featured?: boolean
  state?: Visibility
  emptyExcerpt?: string
  badge?: ReactNode
  actions?: ReactNode
  /**
   * An identity line above the Scripture reference — author, audience, time.
   *
   * Community needs it and Reflections does not: on your own shelf, every
   * reflection is yours and saying so on each card would be noise. It sits
   * above the reference because the reference is the strong contextual anchor,
   * and metadata stays visually secondary to the reflection.
   */
  meta?: ReactNode
  /** A row under the foot — hashtags, Encouraged, Save, Share, overflow. */
  footer?: ReactNode
  dateLabel?: string
  /** Replaces the C.H.A.T. progress, for a card where completion is not the point. */
  progress?: ReactNode
}) {
  return (
    <li
      className={featured ? `${styles.tile} ${styles.featured}` : styles.tile}
      data-interactive={href ? 'true' : 'false'}
      data-has-meta={meta ? 'true' : 'false'}
      data-has-footer={footer ? 'true' : 'false'}
    >
      <SectionMarks written={written} variant="strip" />
      {meta ? <div className={styles.meta}>{meta}</div> : null}
      <div className={styles.tileTop}>
        <span className={`eyebrow ${styles.reference}`}>
          {item.scriptureReference || 'No Scripture reference'}
        </span>
        {state ? <StateBadge state={state} /> : badge}
      </div>
      <h3 className={styles.tileTitle}>
        {href ? <Link to={href}>{item.title}</Link> : item.title}
      </h3>
      <div className={styles.excerpt}>{excerpt || emptyExcerpt}</div>
      <div className={styles.tileFoot}>
        {progress ?? <ChatProgress format={item.format} written={written} />}
        <span className={styles.date}>
          <span className="sr-only">{dateLabel}</span>
          {formatDate(item.updatedAt, now)}
        </span>
        {actions}
      </div>
      {footer ? <div className={styles.tileExtra}>{footer}</div> : null}
    </li>
  )
}

/** A card-shaped placeholder, so the first paint does not shift the layout. */
export function ReflectionCardSkeleton() {
  return <li className={`${styles.tile} ${styles.skeleton}`} />
}
