import { Link, useNavigate } from 'react-router'
import type { ChatFormat, ChatSectionType, Visibility } from '@chat/shared'
import { ActionMenu } from '../shared/ui/ActionMenu.tsx'
import { ChatProgress, StateBadge, formatDate } from '../shared/ui/ReflectionCard.tsx'
import { MoreIcon } from '../shared/ui/icons.tsx'
import styles from './MobileTimeline.module.css'

/*
 * The reflections, on a phone.
 *
 * A separate component from the desktop card rather than the same one folded
 * up, because the two want different *orders*, and order is not something CSS
 * should be asked to change. The desktop card leads with the Scripture
 * reference; this leads with the title, because the author is scanning for
 * what they wrote — several reflections can share a passage, but only one has
 * that title. Reordering with `order` would have left the reading order and
 * the visual order disagreeing, which is exactly the thing a screen reader
 * would then get wrong.
 *
 * Its height is deliberately not fixed. A two-line title has to fit, and a
 * card with a rigid height would either crop it or overlap the row below.
 * Only the preview is bounded, and it is bounded by lines rather than pixels.
 */

export type TimelineItem = {
  id: string
  title: string
  scriptureReference: string | null
  updatedAt: string
  visibility: Visibility
  format: ChatFormat | undefined
}

export function MobileCard({
  item,
  preview,
  written,
  now,
}: {
  item: TimelineItem
  preview: string
  written: ChatSectionType[] | undefined
  now: number
}) {
  const navigate = useNavigate()
  return (
    <li className={styles.card}>
      {/*
        Decoration only: which sections exist is said in words by ChatProgress
        below, so nothing here is carried by colour alone.
      */}
      <span className={styles.strip} aria-hidden="true">
        {(['content', 'heart', 'application', 'testimony'] as const).map((section) => (
          <span
            key={section}
            data-section={section}
            data-written={written?.includes(section) ? 'true' : 'false'}
          />
        ))}
      </span>

      <h3 className={styles.title}>
        {/*
          The whole card opens the reflection, by stretching this link over it
          rather than by wrapping the card in an anchor — a card contains a
          button, and an anchor containing a button is invalid and behaves
          unpredictably when pressed.
        */}
        <Link to={`/reflections/${item.id}`}>{item.title}</Link>
      </h3>

      <p className={styles.meta}>
        <span className={styles.reference}>
          {item.scriptureReference || 'No Scripture reference'}
        </span>
        <span className={styles.date}>
          <span className="sr-only">Last updated </span>
          {formatDate(item.updatedAt, now)}
        </span>
      </p>

      <p className={styles.preview}>{preview || 'Nothing written yet — open it and begin.'}</p>

      <div className={styles.foot}>
        <ChatProgress format={item.format} written={written} />
        <StateBadge state={item.visibility} />
        {/*
          Raised above the stretched link, so pressing it opens the actions
          rather than the reflection underneath it.
        */}
        <span className={styles.actions}>
          <ActionMenu
            label={`Actions for ${item.title}`}
            triggerClassName={styles.overflow}
            trigger={<MoreIcon />}
            items={[
              { label: 'Open reflection', onSelect: () => void navigate(`/reflections/${item.id}`) },
              { label: 'Edit reflection', onSelect: () => void navigate(`/?c=${item.id}`) },
              { label: 'Create image', onSelect: () => void navigate(`/create?c=${item.id}`) },
            ]}
          />
        </span>
      </div>
    </li>
  )
}

export function MobileTimeline({
  groups,
  children,
}: {
  groups: { label: string; items: React.ReactNode[] }[]
  /** The pager, which belongs after every group rather than inside one. */
  children?: React.ReactNode
}) {
  return (
    <div className={styles.timeline}>
      {groups.map((group) => (
        <section key={group.label} className={styles.group}>
          <h2 className={styles.groupLabel}>{group.label}</h2>
          <ul className={styles.list}>{group.items}</ul>
        </section>
      ))}
      {children}
    </div>
  )
}
