/*
 * Reflections — the place a person returns to what they have already written.
 *
 * Two decisions in here are worth stating, because they are the reason the page
 * is shaped the way it is.
 *
 * First, the layout adapts to the *container*, not the viewport. The shell has a
 * collapsible sidebar, so the space this page actually gets can halve without
 * the window changing size at all; a viewport media query would give the wrong
 * answer exactly when the layout matters most. So the column count lives in
 * `@container` rules in the stylesheet and there is no width in this file.
 *
 * Second, the list endpoint returns a summary — id, title, Scripture reference,
 * publication state, updated time. It carries no excerpt and no C.H.A.T.
 * completion, and those are the two things that make a tile worth looking at.
 * So the cards render immediately from the summary and enrich themselves
 * afterwards from the conversation detail. Nothing waits on that; a tile with no
 * excerpt yet is a tile with no excerpt yet, not a spinner.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  CHAT_FORMATS,
  type ChatFormat,
  type ChatSection,
  type ChatSectionType,
  type ConversationSummary,
} from '@chat/shared'
import { api } from '../shared/api/client.ts'
import {
  ChatProgress,
  ReflectionCard,
  ReflectionCardSkeleton,
  SECTIONS,
  SectionMarks,
  StateBadge,
  formatDate,
} from '../shared/ui/ReflectionCard.tsx'
import styles from './ReflectionsPage.module.css'

/* ------------------------------------------------------------------- types */

type ReflectionSummary = ConversationSummary & { format?: ChatFormat }

type ReflectionDetail = ReflectionSummary & {
  messages: { id: string; role: string; content: string }[]
  sections: Record<ChatSectionType, ChatSection>
}

/**
 * What the detail request adds to a summary, once it arrives. `written` is the
 * set of sections that actually have content — not a count — because the C/H/A/T
 * markers say *which* parts of the reflection exist, and filling the first n of
 * them would tell the reader something untrue about their own writing.
 */
type Enrichment = { excerpt: string; written: ChatSectionType[] }

type Display = 'auto' | 'tiles' | 'list'
type Filter = 'all' | 'drafts' | 'completed' | 'published'
type Sort = 'recent' | 'title'

const DISPLAY_KEY = 'chat.reflections.display'

const DISPLAYS: { id: Display; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Layout follows the space available' },
  { id: 'tiles', label: 'Tiles', hint: 'Always show reflection tiles' },
  { id: 'list', label: 'List', hint: 'Always show a compact list' },
]

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'completed', label: 'Completed' },
  { id: 'published', label: 'Published' },
]

/*
 * Beyond this many results an active search stops being browsing and starts
 * being looking-for-one-thing, and Auto switches to the denser list.
 */
const DENSE_SEARCH_THRESHOLD = 8

/** Detail is fetched for what a person can plausibly scan, not for everything. */
const ENRICH_LIMIT = 24

/*
 * How long the first paint will wait for enrichment before giving up and
 * rendering anyway. "Continue reflecting" can only be decided once completion
 * counts are known, so painting before then makes cards visibly jump between
 * sections; waiting forever would hold the page hostage to a slow request.
 */
const FIRST_PASS_GRACE = 900

/* ------------------------------------------------------------------- dates */

const DAY = 24 * 60 * 60 * 1000

const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

/** Today · This week · August 2026 · Older — the grouping the list uses. */
export function groupLabel(iso: string, now: number): string {
  const value = new Date(iso)
  if (Number.isNaN(value.getTime())) return 'Older'
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  if (value.getTime() >= startOfToday.getTime()) return 'Today'
  if (value.getTime() >= startOfToday.getTime() - 6 * DAY) return 'This week'
  if (now - value.getTime() <= 365 * DAY) return monthLabel.format(value)
  return 'Older'
}

/* -------------------------------------------------------------- enrichment */

function excerptFrom(detail: ReflectionDetail): string {
  const fromSections = SECTIONS.map((section) => detail.sections?.[section.type]?.content ?? '')
    .map((content) => content.trim())
    .find((content) => content.length > 0)
  if (fromSections) return fromSections
  const fromMessages = (detail.messages ?? [])
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .find((content) => content.length > 0)
  return fromMessages ?? ''
}

function writtenSections(detail: ReflectionDetail): ChatSectionType[] {
  return SECTIONS.filter((section) => (detail.sections?.[section.type]?.content ?? '').trim()).map(
    (section) => section.type,
  )
}

/* ------------------------------------------------------------ small pieces */

function Overflow({ item }: { item: ReflectionSummary }) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onPointer(event: MouseEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={styles.overflow} ref={wrapper}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${item.title}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">···</span>
      </button>
      {open ? (
        <div className={styles.menu} role="menu">
          <Link role="menuitem" to={`/?c=${item.id}`} className={styles.menuItem}>
            Open reflection
          </Link>
          <Link role="menuitem" to={`/create?c=${item.id}`} className={styles.menuItem}>
            Create image
          </Link>
        </div>
      ) : null}
    </div>
  )
}

function Tile({
  item,
  enrichment,
  now,
  featured,
}: {
  item: ReflectionSummary
  enrichment: Enrichment | undefined
  now: number
  featured?: boolean
}) {
  return (
    <ReflectionCard
      item={item}
      excerpt={enrichment?.excerpt}
      written={enrichment?.written}
      now={now}
      href={`/?c=${item.id}`}
      featured={featured}
      state={item.publicationState}
      emptyExcerpt="Nothing written yet — open it and begin."
      actions={<Overflow item={item} />}
    />
  )
}

function Row({
  item,
  enrichment,
  now,
}: {
  item: ReflectionSummary
  enrichment: Enrichment | undefined
  now: number
}) {
  return (
    <li className={styles.row}>
      <SectionMarks written={enrichment?.written} variant="thumb" />
      <div className={styles.rowBody}>
        <div className={styles.rowHead}>
          <h3 className={styles.rowTitle}>
            <Link to={`/?c=${item.id}`}>{item.title}</Link>
          </h3>
          <span className={`eyebrow ${styles.reference}`}>
            {item.scriptureReference || 'No Scripture reference'}
          </span>
        </div>
        <p className={styles.rowExcerpt}>{enrichment?.excerpt || 'Nothing written yet.'}</p>
      </div>
      <div className={styles.rowMeta}>
        <ChatProgress format={item.format} written={enrichment?.written} />
        <StateBadge state={item.publicationState} />
        <span className={styles.date}>
          <span className="sr-only">Last updated </span>
          {formatDate(item.updatedAt, now)}
        </span>
      </div>
      <Overflow item={item} />
    </li>
  )
}

/* -------------------------------------------------------------- the page */

export function ReflectionsPage() {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('recent')
  const [display, setDisplay] = useState<Display>(() => {
    try {
      const stored = window.localStorage.getItem(DISPLAY_KEY)
      if (stored === 'auto' || stored === 'tiles' || stored === 'list') return stored
    } catch {
      /* a browser refusing storage is not a reason to fail to render */
    }
    return 'auto'
  })

  const [items, setItems] = useState<ReflectionSummary[]>([])
  const [enriched, setEnriched] = useState<Record<string, Enrichment>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /*
   * True once enrichment for the current results has landed (or given up).
   * Only the very first paint waits on it; a later search must never flash a
   * skeleton back over results the person is already reading, which is what
   * `painted` remembers.
   */
  const [settled, setSettled] = useState(false)
  const painted = useRef(false)
  /* Fixed at load time so "Today" cannot shift under a card mid-render. */
  const [now, setNow] = useState(() => Date.now())

  function chooseDisplay(next: Display) {
    setDisplay(next)
    try {
      window.localStorage.setItem(DISPLAY_KEY, next)
    } catch {
      /* the choice is still honoured for this session */
    }
  }

  // Results update while typing, but not on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 220)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let live = true
    setLoading(true)
    const params = new URLSearchParams({ q: search, filter, sort })
    api<ReflectionSummary[]>(`/reflections?${params.toString()}`)
      .then((next) => {
        if (!live) return
        // A malformed or unexpected body is an empty page, never a crash.
        const rows = Array.isArray(next) ? next : []
        setItems(rows)
        // Results with nothing to enrich are already as complete as they get.
        setSettled(rows.length === 0)
        setNow(Date.now())
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!live) return
        setItems([])
        setSettled(true)
        setError(caught instanceof Error ? caught.message : 'Could not load your reflections.')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [search, filter, sort])

  /*
   * Excerpt and completion come from the conversation detail, keyed by the
   * updated time so an edited reflection re-reads and an untouched one does not.
   */
  useEffect(() => {
    let live = true
    const wanted = items.slice(0, ENRICH_LIMIT).filter((item) => !enriched[`${item.id}:${item.updatedAt}`])
    if (wanted.length === 0) {
      setSettled(true)
      return
    }
    const grace = setTimeout(() => setSettled(true), FIRST_PASS_GRACE)
    void Promise.allSettled(
      wanted.map((item) => api<ReflectionDetail>(`/conversations/${item.id}`)),
    ).then((results) => {
      if (!live) return
      setSettled(true)
      const additions: Record<string, Enrichment> = {}
      results.forEach((result, index) => {
        const item = wanted[index]
        if (result.status !== 'fulfilled' || !item) return
        additions[`${item.id}:${item.updatedAt}`] = {
          excerpt: excerptFrom(result.value),
          written: writtenSections(result.value),
        }
      })
      if (Object.keys(additions).length > 0) {
        setEnriched((previous) => ({ ...previous, ...additions }))
      }
    })
    return () => {
      live = false
      clearTimeout(grace)
    }
  }, [items, enriched])

  const enrichmentFor = useCallback(
    (item: ReflectionSummary) => enriched[`${item.id}:${item.updatedAt}`],
    [enriched],
  )

  const searching = search.length > 0

  /*
   * Auto is width-driven for columns — that part is CSS — and content-driven
   * only here, where a long list of search results is better read as a list.
   */
  const asList =
    display === 'list' ||
    (display === 'auto' && searching && items.length > DENSE_SEARCH_THRESHOLD)

  const { continuing, recent, earlier } = useMemo(() => {
    if (searching) {
      return { continuing: [] as ReflectionSummary[], recent: items, earlier: [] as ReflectionSummary[] }
    }
    const unfinished = items
      .filter((item) => {
        if (item.format === CHAT_FORMATS.CONDENSED) return false
        const done = enriched[`${item.id}:${item.updatedAt}`]?.written.length
        return done !== undefined && done > 0 && done < SECTIONS.length
      })
      .slice(0, 2)
    const held = new Set(unfinished.map((item) => item.id))
    const rest = items.filter((item) => !held.has(item.id))
    return {
      continuing: unfinished,
      recent: rest.filter((item) => now - new Date(item.updatedAt).getTime() <= 30 * DAY),
      earlier: rest.filter((item) => now - new Date(item.updatedAt).getTime() > 30 * DAY),
    }
  }, [items, enriched, searching, now])

  const grouped = useMemo(() => {
    const order: string[] = []
    const buckets = new Map<string, ReflectionSummary[]>()
    for (const item of items) {
      const label = groupLabel(item.updatedAt, now)
      if (!buckets.has(label)) {
        buckets.set(label, [])
        order.push(label)
      }
      buckets.get(label)?.push(item)
    }
    return order.map((label) => ({ label, items: buckets.get(label) ?? [] }))
  }, [items, now])

  /*
   * The first paint waits for completion counts; every later fetch does not,
   * because by then the sections are already on screen and swapping them for a
   * skeleton on each keystroke would be worse than a moment's stale count.
   */
  const preparing = loading || (!painted.current && !settled)

  useEffect(() => {
    if (!preparing) painted.current = true
  }, [preparing])

  const description = loading
    ? 'Gathering what you have written.'
    : items.length === 0
      ? 'Return to conversations and moments that mattered.'
      : `${items.length} ${items.length === 1 ? 'reflection' : 'reflections'} · return to conversations and moments that mattered.`

  const nothingAtAll = !preparing && items.length === 0 && !searching && filter === 'all'

  return (
    <div className={styles.page} data-reflections-root="">
      <header className={styles.header}>
        <div>
          <p className="eyebrow">Your private writing</p>
          <h1 className={styles.title}>Reflections</h1>
          <p className={`lede ${styles.description}`}>{description}</p>
        </div>
        <Link to="/" className="btn btn-primary">
          + New reflection
        </Link>
      </header>

      {nothingAtAll ? null : (
        <div className={styles.controls}>
          <div className={styles.searchRow}>
            <label className="sr-only" htmlFor="reflections-search">
              Search reflections
            </label>
            <input
              id="reflections-search"
              type="search"
              className={`input ${styles.search}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search reflections, Scripture or words you wrote"
            />
          </div>
          <div className={styles.controlRow}>
            <div className={styles.chips} role="group" aria-label="Filter reflections">
              {FILTERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={styles.chip}
                  aria-pressed={filter === option.id}
                  onClick={() => setFilter(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className={styles.rightControls}>
              <label className={styles.sort}>
                <span className="sr-only">Sort reflections</span>
                <select
                  className={`input ${styles.select}`}
                  value={sort}
                  onChange={(event) => setSort(event.target.value as Sort)}
                >
                  <option value="recent">Recently updated</option>
                  <option value="title">Title</option>
                </select>
              </label>
              <div className={styles.segmented} role="group" aria-label="Display">
                {DISPLAYS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={styles.segment}
                    aria-pressed={display === option.id}
                    title={option.hint}
                    onClick={() => chooseDisplay(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div aria-live="polite" className="sr-only">
        {loading ? 'Loading reflections' : `${items.length} reflections`}
      </div>

      {preparing ? (
        <ul className={styles.grid} aria-hidden="true">
          {[0, 1, 2].map((key) => (
            <ReflectionCardSkeleton key={key} />
          ))}
        </ul>
      ) : nothingAtAll ? (
        <section className={styles.empty}>
          <h2 className={styles.emptyTitle}>Your reflections will appear here</h2>
          <p className={styles.emptyBody}>
            Begin with a Scripture, a question or something that touched your heart.
          </p>
          <Link to="/" className="btn btn-primary">
            Start your first reflection
          </Link>
        </section>
      ) : items.length === 0 ? (
        <p className={styles.noResults}>
          Nothing matches {searching ? <strong>“{search}”</strong> : 'this filter'}.{' '}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setQuery('')
              setFilter('all')
            }}
          >
            Clear search and filters
          </button>
        </p>
      ) : asList ? (
        <div className={styles.sections}>
          {grouped.map((group) => (
            <section key={group.label} className={styles.section}>
              <h2 className={styles.sectionTitle}>{group.label}</h2>
              <ul className={styles.list} data-view="list">
                {group.items.map((item) => (
                  <Row key={item.id} item={item} enrichment={enrichmentFor(item)} now={now} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className={styles.sections}>
          {continuing.length > 0 ? (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Continue reflecting</h2>
              <ul className={styles.featuredGrid} data-view="tiles" data-grid="featured">
                {continuing.map((item) => (
                  <Tile
                    key={item.id}
                    item={item}
                    enrichment={enrichmentFor(item)}
                    now={now}
                    featured
                  />
                ))}
              </ul>
            </section>
          ) : null}
          {recent.length > 0 ? (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{searching ? 'Results' : 'Recent'}</h2>
              <ul className={styles.grid} data-view="tiles" data-grid="tiles">
                {recent.map((item) => (
                  <Tile key={item.id} item={item} enrichment={enrichmentFor(item)} now={now} />
                ))}
              </ul>
            </section>
          ) : null}
          {earlier.length > 0 ? (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Earlier</h2>
              <ul className={styles.grid} data-view="tiles" data-grid="tiles">
                {earlier.map((item) => (
                  <Tile key={item.id} item={item} enrichment={enrichmentFor(item)} now={now} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  )
}
