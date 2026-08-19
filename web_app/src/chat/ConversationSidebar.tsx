import { useEffect, useRef } from 'react'
import type { ConversationSummary } from '@chat/shared'
import {
  CollapseIcon,
  ExpandIcon,
  GlobeIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
} from '../shared/ui/icons.tsx'
import { bookInitials, bucketOf, displayTitle } from './history.ts'
import styles from './ChatPage.module.css'

const GROUPS = ['Today', 'This week', 'Earlier'] as const

export function ConversationSidebar({
  conversations,
  activeId,
  collapsed,
  query,
  onQuery,
  onSelect,
  onNew,
  onToggle,
  onSearchRequested,
  searchFocusToken,
}: {
  conversations: ConversationSummary[]
  activeId: string | null
  collapsed: boolean
  query: string
  onQuery: (value: string) => void
  onSelect: (id: string) => void
  onNew: () => void
  onToggle: () => void
  onSearchRequested: () => void
  searchFocusToken: number
}) {
  const searchRef = useRef<HTMLInputElement>(null)

  // Expanding from the rail's search icon should land the cursor in the field.
  useEffect(() => {
    if (searchFocusToken > 0 && !collapsed) {
      searchRef.current?.focus()
    }
  }, [searchFocusToken, collapsed])

  const matching = conversations.filter((item) => {
    const needle = query.trim().toLowerCase()
    if (!needle) return true
    return `${item.title} ${item.scriptureReference ?? ''}`.toLowerCase().includes(needle)
  })

  if (collapsed) {
    return (
      <aside className={`${styles.sidebar} ${styles.sidebarRail}`} aria-label="Reflections">
        <button
          type="button"
          className={styles.railButton}
          onClick={onNew}
          title="New reflection"
          aria-label="New reflection"
        >
          <PlusIcon className={styles.railIcon} />
        </button>
        <button
          type="button"
          className={styles.railButton}
          onClick={onSearchRequested}
          title="Search reflections"
          aria-label="Search reflections"
        >
          <SearchIcon className={styles.railIcon} />
        </button>

        <div className={styles.railDivider} aria-hidden="true" />

        <ul className={styles.railList}>
          {matching.slice(0, 12).map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={
                  item.id === activeId
                    ? `${styles.railMark} ${styles.railMarkActive}`
                    : styles.railMark
                }
                onClick={() => onSelect(item.id)}
                title={`${item.title}${item.scriptureReference ? ` · ${item.scriptureReference}` : ''}`}
                aria-current={item.id === activeId ? 'true' : undefined}
              >
                <span aria-hidden="true">{bookInitials(item.scriptureReference, item.title)}</span>
                <span className="sr-only">{item.title}</span>
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className={`${styles.railButton} ${styles.railToggle}`}
          onClick={onToggle}
          aria-label="Expand the reflections list"
          aria-expanded={false}
        >
          <ExpandIcon className={styles.railIcon} />
        </button>
      </aside>
    )
  }

  return (
    <aside className={styles.sidebar} aria-label="Reflections">
      <div className={styles.sidebarHead}>
        <button type="button" className={`btn btn-primary btn-sm ${styles.newButton}`} onClick={onNew}>
          <PlusIcon className={styles.smallIcon} />
          New reflection
        </button>
        <button
          type="button"
          className={styles.railButton}
          onClick={onToggle}
          aria-label="Collapse the reflections list"
          aria-expanded
        >
          <CollapseIcon className={styles.railIcon} />
        </button>
      </div>

      <div className={styles.searchWrap}>
        <SearchIcon className={styles.searchIcon} />
        <input
          ref={searchRef}
          className={styles.search}
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search reflections"
          aria-label="Search reflections"
        />
      </div>

      <div className={styles.sidebarScroll}>
        {matching.length === 0 ? (
          <p className={styles.sidebarEmpty}>
            {conversations.length === 0
              ? 'Your reflections will gather here as you write.'
              : 'Nothing matches that yet.'}
          </p>
        ) : null}

        {GROUPS.map((group) => {
          const items = matching.filter((item) => bucketOf(item.updatedAt) === group)
          if (items.length === 0) return null
          return (
            <section key={group} className={styles.group}>
              <h2 className={styles.groupLabel}>{group}</h2>
              <ul className={styles.list}>
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={
                        item.id === activeId
                          ? `${styles.listItem} ${styles.listItemActive}`
                          : styles.listItem
                      }
                      onClick={() => onSelect(item.id)}
                      aria-current={item.id === activeId ? 'true' : undefined}
                    >
                      <span className={styles.listTitle}>
                        {displayTitle(item.title, item.scriptureReference)}
                      </span>
                      <span className={styles.listMeta}>
                        <span className={styles.listReference}>
                          {item.scriptureReference ?? 'No passage yet'}
                        </span>
                        {/*
                          Privacy is stated in an icon and a word, never a
                          colour alone — someone has to be able to tell a
                          private reflection from a shared one in
                          greyscale.
                        */}
                        {item.visibility === 'shared' ? (
                          <span className={styles.stateChip}>
                            <GlobeIcon className={styles.tinyIcon} />
                            Shared
                          </span>
                        ) : (
                          <span className={styles.stateChip}>
                            <LockIcon className={styles.tinyIcon} />
                            Private
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </aside>
  )
}
