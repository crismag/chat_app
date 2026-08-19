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
import { Link, useSearchParams } from 'react-router'
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
type Enrichment = {
  excerpt: string
  written: ChatSectionType[]
  /** Every written section, for when the reader asks to see them in full. */
  sections: { type: ChatSectionType; letter: string; label: string; content: string }[]
}

/*
 * Two view questions, not one.
 *
 * `Display` is the shape — cards or a list — and the responsive behaviour
 * inside each is CSS's job rather than a third option somebody has to choose.
 * `Density` is how much of each reflection is shown, which is a different
 * question and used to be a permanent pair of buttons.
 */
type Display = 'cards' | 'list'
type Density = 'compact' | 'preview' | 'full'
type Status = 'all' | 'draft' | 'complete'
type Visibility = 'all' | 'private' | 'shared'
type Sort = 'recent' | 'title'
type DatePreset = 'any' | 'today' | 'week' | 'month' | 'year' | 'custom'
type TagFacet = { tag: string; label: string; count: number }
type BookFacet = { usfm: string; name: string; count: number }

type ReflectionsPayload = {
  items: ReflectionSummary[]
  tags: TagFacet[]
  books: BookFacet[]
  /** The whole matching set, not this page — the pager needs both. */
  total: number
  page: number
  pageCount: number
}


const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'any', label: 'Any time' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
  { id: 'custom', label: 'Custom' },
]

function utcDay(offset = 0): string {
  const value = new Date()
  value.setUTCDate(value.getUTCDate() + offset)
  return value.toISOString().slice(0, 10)
}

function rangeFor(preset: DatePreset): { from: string; to: string } {
  const to = utcDay()
  if (preset === 'today') return { from: to, to }
  if (preset === 'week') return { from: utcDay(-6), to }
  if (preset === 'month') return { from: utcDay(-29), to }
  if (preset === 'year') return { from: utcDay(-364), to }
  return { from: '', to: '' }
}

function readPayload(body: unknown): ReflectionsPayload {
  if (Array.isArray(body)) {
    const items = body as ReflectionSummary[]
    return { items, tags: [], books: [], total: items.length, page: 1, pageCount: 1 }
  }
  const record = (body ?? {}) as Partial<ReflectionsPayload>
  const items = Array.isArray(record.items) ? record.items : []
  return {
    items,
    tags: Array.isArray(record.tags) ? record.tags : [],
    books: Array.isArray(record.books) ? record.books : [],
    /* Falling back to the page's own length keeps an older API readable. */
    total: typeof record.total === 'number' ? record.total : items.length,
    page: typeof record.page === 'number' ? record.page : 1,
    pageCount: typeof record.pageCount === 'number' ? record.pageCount : 1,
  }
}

const DISPLAY_KEY = 'chat.reflections.display'

const DISPLAYS: { id: Display; label: string; hint: string }[] = [
  { id: 'cards', label: 'Cards', hint: 'Reflections as cards' },
  { id: 'list', label: 'List', hint: 'A compact list' },
]

const DENSITIES: { id: Density; label: string; hint: string }[] = [
  { id: 'compact', label: 'Compact', hint: 'Title, reference and progress only' },
  { id: 'preview', label: 'Preview', hint: 'A line of what it says' },
  { id: 'full', label: 'Full C.H.A.T.', hint: 'Every written section' },
]

/*
 * Nothing here says "shared".
 *
 * A reflection is shared with an audience or it is private; "shared" was
 * the old word and it implied a public act the product does not have. The API
 * uses the same two words.
 */
const STATUSES: { id: Status; label: string }[] = [
  { id: 'all', label: 'Any' },
  { id: 'draft', label: 'Draft' },
  { id: 'complete', label: 'Complete' },
]

const VISIBILITIES: { id: Visibility; label: string }[] = [
  { id: 'all', label: 'Any' },
  { id: 'private', label: 'Private' },
  { id: 'shared', label: 'Shared' },
]


/** Detail is fetched for what a person can plausibly scan, not for everything. */
/*
 * How many reflections are on a page.
 *
 * 100 is the ceiling rather than a round number: every item on a page has its
 * detail fetched so the C/H/A/T markers and excerpts are true, and a page of
 * 100 is already 100 requests.
 */
const PAGE_SIZES = [10, 20, 50, 100] as const
const DEFAULT_PAGE_SIZE = 20
const PAGE_SIZE_KEY = 'chat.reflections.pageSize'
const DENSITY_KEY = 'chat.reflections.density'

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

function fullSections(detail: ReflectionDetail) {
  return SECTIONS.map((section) => ({
    ...section,
    content: (detail.sections?.[section.type]?.content ?? '').trim(),
  })).filter((section) => section.content.length > 0)
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

/**
 * Every written section, shown in place.
 *
 * The excerpt answers "which one is this"; this answers "what does it say",
 * which is a different question and used to need the editor to answer.
 */
function FullChat({
  sections,
}: {
  sections: NonNullable<Enrichment['sections']>
}) {
  return (
    <div className={styles.fullChat}>
      {sections.map((section) => (
        <div className={styles.fullSection} data-section={section.type} key={section.type}>
          <h4 className={styles.fullHeading}>
            <span className={styles.fullLetter} aria-hidden="true">{section.letter}</span>
            {section.label}
          </h4>
          {/* The author's own line breaks, kept. */}
          <p className={styles.fullBody}>{section.content}</p>
        </div>
      ))}
    </div>
  )
}

/**
 * Moving between pages.
 *
 * It says which page of how many, because "Next" on its own tells a reader
 * nothing about where they are or whether it is worth pressing. It does not
 * repeat the total — the line under the heading already gives it, and saying
 * it twice is the kind of furniture this page is otherwise free of.
 *
 * Hidden entirely when everything fits on one page.
 */
/**
 * Every secondary filter, behind one button.
 *
 * The page used to carry four rows of chips — status, dates, written section,
 * Scripture book, tags — which is what made a personal library look like a
 * database console. These three are the ones somebody reaches for; the rest is
 * what the search is for, since it reads the whole reflection rather than one
 * field.
 */
function FiltersPopover({
  count,
  status,
  visibility,
  datePreset,
  from,
  to,
  onStatus,
  onVisibility,
  onDatePreset,
  onFrom,
  onTo,
}: {
  count: number
  status: Status
  visibility: Visibility
  datePreset: DatePreset
  from: string
  to: string
  onStatus: (next: Status) => void
  onVisibility: (next: Visibility) => void
  onDatePreset: (next: DatePreset) => void
  onFrom: (value: string) => void
  onTo: (value: string) => void
}) {
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
    <div className={styles.filtersWrap} ref={wrapper}>
      <button
        type="button"
        className={styles.filtersButton}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        Filters
        {/* Said on the button, so a narrowed list is never a mystery. */}
        {count > 0 ? <span className={styles.filtersCount}>{count}</span> : null}
      </button>

      {open ? (
        <div className={styles.filtersPanel} role="dialog" aria-label="Filters">
          <fieldset className={styles.filterGroup}>
            <legend className={styles.filterLegend}>Progress</legend>
            <div className={styles.chips} role="group">
              {STATUSES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={styles.chip}
                  aria-pressed={status === option.id}
                  onClick={() => onStatus(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.filterGroup}>
            <legend className={styles.filterLegend}>Who can see it</legend>
            <div className={styles.chips} role="group">
              {VISIBILITIES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={styles.chip}
                  aria-pressed={visibility === option.id}
                  onClick={() => onVisibility(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.filterGroup}>
            <legend className={styles.filterLegend}>Updated</legend>
            <div className={styles.chips} role="group">
              {DATE_PRESETS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={styles.chip}
                  aria-pressed={datePreset === option.id}
                  onClick={() => onDatePreset(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {datePreset === 'custom' ? (
              <div className={styles.dateRow}>
                <label className={styles.dateField}>
                  From
                  <input
                    type="date"
                    className={`input ${styles.dateInput}`}
                    value={from}
                    onChange={(event) => onFrom(event.target.value)}
                  />
                </label>
                <label className={styles.dateField}>
                  To
                  <input
                    type="date"
                    className={`input ${styles.dateInput}`}
                    value={to}
                    onChange={(event) => onTo(event.target.value)}
                  />
                </label>
              </div>
            ) : null}
          </fieldset>
        </div>
      ) : null}
    </div>
  )
}

function Pager({
  page,
  pageCount,
  onPage,
}: {
  page: number
  pageCount: number
  onPage: (next: number) => void
}) {
  if (pageCount <= 1) return null
  return (
    <nav className={styles.pager} aria-label="Pages of reflections">
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        ← Previous
      </button>
      <p className={styles.pagerCount} aria-live="polite">
        Page {page} of {pageCount}
      </p>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
      >
        Next →
      </button>
    </nav>
  )
}

function Tile({
  item,
  enrichment,
  now,
  featured,
  density,
}: {
  item: ReflectionSummary
  enrichment: Enrichment | undefined
  now: number
  featured?: boolean
  density: Density
}) {
  return (
    <ReflectionCard
      item={item}
      excerpt={
        density === 'full' && enrichment?.sections?.length
          ? <FullChat sections={enrichment.sections} />
          : density === 'compact'
            ? ''
            : enrichment?.excerpt
      }
      written={enrichment?.written}
      now={now}
      /* Reading, not editing. The editor is a press away on the reader. */
      href={`/reflections/${item.id}`}
      featured={featured}
      state={item.visibility}
      emptyExcerpt="Nothing written yet — open it and begin."
      actions={<Overflow item={item} />}
    />
  )
}

function Row({
  item,
  enrichment,
  now,
  density,
}: {
  item: ReflectionSummary
  enrichment: Enrichment | undefined
  now: number
  density: Density
}) {
  return (
    <li className={styles.row}>
      <SectionMarks written={enrichment?.written} variant="thumb" />
      <div className={styles.rowBody}>
        <div className={styles.rowHead}>
          <h3 className={styles.rowTitle}>
            <Link to={`/reflections/${item.id}`}>{item.title}</Link>
          </h3>
          <span className={`eyebrow ${styles.reference}`}>
            {item.scriptureReference || 'No Scripture reference'}
          </span>
        </div>
        {density === 'full' && enrichment?.sections?.length ? (
          <FullChat sections={enrichment.sections} />
        ) : density === 'compact' ? null : (
          <p className={styles.rowExcerpt}>{enrichment?.excerpt || 'Nothing written yet.'}</p>
        )}
      </div>
      <div className={styles.rowMeta}>
        <ChatProgress format={item.format} written={enrichment?.written} />
        <StateBadge state={item.visibility} />
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
  /*
   * Where you were, kept in the URL.
   *
   * Search, filters, sort and page live in the address rather than in state
   * alone, so opening a reflection and coming back returns you to the page you
   * were reading instead of to the top of an unfiltered list. It also makes a
   * search worth sending to yourself.
   */
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const status = (params.get('status') as Status | null) ?? 'all'
  const visibility = (params.get('visibility') as Visibility | null) ?? 'all'
  const sort = (params.get('sort') as Sort | null) ?? 'recent'
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1)

  const [query, setQuery] = useState(search)
  const [datePreset, setDatePreset] = useState<DatePreset>(from || to ? 'custom' : 'any')

  /**
   * Write one part of the address, and go back to page one unless the page is
   * what changed — a filter narrowing to three results has no page four.
   */
  const setParam = useCallback(
    (changes: Record<string, string | null>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === '') next.delete(key)
            else next.set(key, value)
          }
          if (!('page' in changes)) next.delete('page')
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const [display, setDisplay] = useState<Display>(() => {
    try {
      const stored = window.localStorage.getItem(DISPLAY_KEY)
      if (stored === 'cards' || stored === 'list') return stored
    } catch {
      /* a browser refusing storage is not a reason to fail to render */
    }
    return 'cards'
  })

  const [items, setItems] = useState<ReflectionSummary[]>([])

  /*
   * Page size is remembered, like the display choice, because it is a statement
   * about how somebody reads rather than about this visit.
   */
  const [pageSize, setPageSize] = useState<number>(() => {
    try {
      const stored = Number(window.localStorage.getItem(PAGE_SIZE_KEY))
      if ((PAGE_SIZES as readonly number[]).includes(stored)) return stored
    } catch {
      /* a browser refusing storage is not a reason to fail to render */
    }
    return DEFAULT_PAGE_SIZE
  })
  /** How much of each reflection is shown. A view preference, not a filter. */
  const [density, setDensity] = useState<Density>(() => {
    try {
      const stored = window.localStorage.getItem(DENSITY_KEY)
      if (stored === 'compact' || stored === 'preview' || stored === 'full') return stored
    } catch {
      /* a browser refusing storage is not a reason to fail to render */
    }
    return 'preview'
  })

  function remember(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      /* the choice is still honoured for this session */
    }
  }

  function choosePageSize(next: number) {
    setPageSize(next)
    remember(PAGE_SIZE_KEY, String(next))
    /* Back to the first page: page 7 of a 10-per-page list is not page 7 of 50. */
    setParam({ page: null })
  }

  function chooseDensity(next: Density) {
    setDensity(next)
    remember(DENSITY_KEY, next)
  }


  /*
   * The page comes from the server.
   *
   * It used to be cut here out of a response carrying everything, which worked
   * only while "everything" was small. `total` and `pageCount` describe the
   * whole matching set, so the pager can say where you are without the browser
   * having been sent the rest.
   */
  const [pageInfo, setPageInfo] = useState({ total: 0, page: 1, pageCount: 1 })
  const pageItems = items
  const currentPage = pageInfo.page
  const pageCount = pageInfo.pageCount
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
    const trimmed = query.trim()
    if (trimmed === search) return
    const timer = setTimeout(() => setParam({ q: trimmed || null }), 220)
    return () => clearTimeout(timer)
  }, [query, search, setParam])

  useEffect(() => {
    let live = true
    setLoading(true)
    const request = new URLSearchParams({
      q: search,
      status,
      visibility,
      sort,
      page: String(page),
      pageSize: String(pageSize),
    })
    if (from) request.set('from', from)
    if (to) request.set('to', to)
    api<unknown>(`/reflections?${request.toString()}`)
      .then((body) => {
        if (!live) return
        const payload = readPayload(body)
        setItems(payload.items)
        setPageInfo({ total: payload.total, page: payload.page, pageCount: payload.pageCount })
        setSettled(payload.items.length === 0)
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
  }, [search, status, visibility, sort, from, to, page, pageSize])

  /*
   * Excerpt and completion come from the conversation detail, keyed by the
   * updated time so an edited reflection re-reads and an untouched one does not.
   */
  useEffect(() => {
    let live = true
    /*
     * Exactly the page, which is also a fix: this used to enrich the first 24
     * of the whole list, so the 25th reflection onwards showed "Nothing
     * written yet." however much was written in it.
     */
    const wanted = pageItems.filter((item) => !enriched[`${item.id}:${item.updatedAt}`])
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
          sections: fullSections(result.value),
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
  }, [pageItems, enriched])

  const enrichmentFor = useCallback(
    (item: ReflectionSummary) => enriched[`${item.id}:${item.updatedAt}`],
    [enriched],
  )

  const searching = search.length > 0
  const narrowing =
    searching || status !== 'all' || visibility !== 'all' || Boolean(from || to)
  /** How many filters are on, so the Filters button can say so without opening. */
  const activeFilters =
    (status !== 'all' ? 1 : 0) + (visibility !== 'all' ? 1 : 0) + (from || to ? 1 : 0)

  function chooseDatePreset(next: DatePreset) {
    setDatePreset(next)
    if (next === 'any') {
      setParam({ from: null, to: null })
      return
    }
    if (next === 'custom') return
    const range = rangeFor(next)
    setParam({ from: range.from, to: range.to })
  }

  function clearFilters() {
    setQuery('')
    setDatePreset('any')
    setParams(new URLSearchParams(), { replace: true })
  }


  /*
   * Auto is width-driven for columns — that part is CSS — and content-driven
   * only here, where a long list of search results is better read as a list.
   */
  const asList = display === 'list'

  const { continuing, recent, earlier } = useMemo(() => {
    if (narrowing) {
      return { continuing: [] as ReflectionSummary[], recent: pageItems, earlier: [] as ReflectionSummary[] }
    }
    const unfinished = pageItems
      .filter((item) => {
        if (item.format === CHAT_FORMATS.CONDENSED) return false
        const done = enriched[`${item.id}:${item.updatedAt}`]?.written.length
        return done !== undefined && done > 0 && done < SECTIONS.length
      })
      .slice(0, 2)
    const held = new Set(unfinished.map((item) => item.id))
    const rest = pageItems.filter((item) => !held.has(item.id))
    return {
      continuing: unfinished,
      recent: rest.filter((item) => now - new Date(item.updatedAt).getTime() <= 30 * DAY),
      earlier: rest.filter((item) => now - new Date(item.updatedAt).getTime() > 30 * DAY),
    }
  }, [pageItems, enriched, narrowing, now])

  const grouped = useMemo(() => {
    const order: string[] = []
    const buckets = new Map<string, ReflectionSummary[]>()
    for (const item of pageItems) {
      const label = groupLabel(item.updatedAt, now)
      if (!buckets.has(label)) {
        buckets.set(label, [])
        order.push(label)
      }
      buckets.get(label)?.push(item)
    }
    return order.map((label) => ({ label, items: buckets.get(label) ?? [] }))
  }, [pageItems, now])

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
    : pageInfo.total === 0
      ? 'Return to conversations and moments that mattered.'
      : `${pageInfo.total} ${pageInfo.total === 1 ? 'reflection' : 'reflections'} · return to conversations and moments that mattered.`

  const nothingAtAll = !preparing && pageInfo.total === 0 && !narrowing

  return (
    <div className={styles.page} data-reflections-root="">
      <header className={styles.header}>
        <div>
          <p className="eyebrow">Your private writing</p>
          <h1 className={styles.title}>Reflections</h1>
          <p className={`lede ${styles.description}`}>{description}</p>
        </div>
        {/*
          No "New reflection" here. The application header carries that action
          on every page, and two of them a few centimetres apart is the kind of
          duplication that makes a library look like an admin screen.
        */}
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
            <div className={styles.rightControls}>
              {/*
                Filters live behind one button, and it says how many are on so a
                narrowed list is never a mystery. The three here are the ones
                somebody reaches for; the rest the search covers, because the
                search reads the whole reflection rather than one field.
              */}
              <FiltersPopover
                count={activeFilters}
                status={status}
                visibility={visibility}
                datePreset={datePreset}
                from={from}
                to={to}
                onStatus={(next) => setParam({ status: next === 'all' ? null : next })}
                onVisibility={(next) => setParam({ visibility: next === 'all' ? null : next })}
                onDatePreset={chooseDatePreset}
                onFrom={(value) => setParam({ from: value || null })}
                onTo={(value) => setParam({ to: value || null })}
              />

              <label className={styles.sort}>
                <span className="sr-only">Sort reflections</span>
                <select
                  className={`input ${styles.select}`}
                  value={sort}
                  onChange={(event) => setParam({ sort: event.target.value })}
                >
                  <option value="recent">Updated ↓</option>
                  <option value="title">Title ↑</option>
                </select>
              </label>

              <div className={styles.segmented} role="group" aria-label="View">
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

              <label className={styles.control}>
                <span className="sr-only">How much of each reflection to show</span>
                <select
                  className={`input ${styles.select}`}
                  value={density}
                  onChange={(event) => chooseDensity(event.target.value as Density)}
                >
                  {DENSITIES.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.control}>
                <span className="sr-only">Reflections per page</span>
                <select
                  className={`input ${styles.select}`}
                  value={pageSize}
                  onChange={(event) => choosePageSize(Number(event.target.value))}
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size} per page
                    </option>
                  ))}
                </select>
              </label>
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
            onClick={clearFilters}
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
                  <Row key={item.id} item={item} enrichment={enrichmentFor(item)} now={now} density={density} />
                ))}
              </ul>
            </section>
          ))}
          <Pager page={currentPage} pageCount={pageCount} onPage={(next) => setParam({ page: String(next) })} />
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
                    density={density}
                  />
                ))}
              </ul>
            </section>
          ) : null}
          {recent.length > 0 ? (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{narrowing ? 'Results' : 'Recent'}</h2>
              <ul className={styles.grid} data-view="tiles" data-grid="tiles">
                {recent.map((item) => (
                  <Tile key={item.id} item={item} enrichment={enrichmentFor(item)} now={now} density={density} />
                ))}
              </ul>
            </section>
          ) : null}
          {earlier.length > 0 ? (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Earlier</h2>
              <ul className={styles.grid} data-view="tiles" data-grid="tiles">
                {earlier.map((item) => (
                  <Tile key={item.id} item={item} enrichment={enrichmentFor(item)} now={now} density={density} />
                ))}
              </ul>
            </section>
          ) : null}
          <Pager page={currentPage} pageCount={pageCount} onPage={(next) => setParam({ page: String(next) })} />
        </div>
      )}
    </div>
  )
}
