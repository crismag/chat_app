import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { ReflectionsPage, groupLabel } from './ReflectionsPage.tsx'

const now = Date.now()
const DAY = 24 * 60 * 60 * 1000

const reflections = [
  {
    id: 'r1',
    format: 'full',
    title: 'Trusting while I cannot see',
    scriptureReference: 'Romans 8:28',
    visibility: 'private',
    tags: [],
    updatedAt: new Date(now - 60_000).toISOString(),
    excerpt: 'Paul writes to a suffering church.',
    preview: 'It met my fear.',
    written: ['content', 'heart'],
  },
  {
    id: 'r2',
    format: 'full',
    title: 'Be still and know',
    scriptureReference: 'Psalm 46:10',
    visibility: 'shared',
    tags: [],
    updatedAt: new Date(now - 200 * DAY).toISOString(),
    excerpt: 'Paul writes to a suffering church.',
    preview: 'It met my fear.',
    written: ['content', 'heart'],
  },
]

function mockFetch(items: unknown[] = reflections) {
  return vi.fn((input: RequestInfo) => {
    const url = String(input)
    if (url.includes('/reflections')) {
      const query = new URL(url, 'http://localhost').searchParams.get('q') ?? ''
      const rows = query
        ? items.filter((item) =>
            (item as { title: string }).title.toLowerCase().includes(query.toLowerCase()),
          )
        : items
      /* Paginated here because the server paginates: the page never sees more. */
      const search = new URL(url, 'http://localhost').searchParams
      const pageSize = Number(search.get('pageSize') ?? 20)
      const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
      const page = Math.min(Math.max(1, Number(search.get('page') ?? 1)), pageCount)
      const start = (page - 1) * pageSize
      return Promise.resolve({
        ok: true,
        json: async () => ({
          items: rows.slice(start, start + pageSize),
          total: rows.length,
          page,
          pageCount,
          pageSize,
          tags: [],
          books: [
            { usfm: 'ROM', name: 'Romans', count: 1 },
            { usfm: 'PSA', name: 'Psalm', count: 1 },
          ],
        }),
      })
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({
        messages: [{ id: 'm1', role: 'user', content: 'Today this passage reminded me…' }],
        sections: {
          content: { type: 'content', content: 'Paul writes to a suffering church.' },
          heart: { type: 'heart', content: 'It met my fear.' },
          application: { type: 'application', content: '' },
          testimony: { type: 'testimony', content: '' },
        },
      }),
    })
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <ReflectionsPage />
    </MemoryRouter>,
  )
}

/*
 * Short, because a placeholder is not documentation. The long version — which
 * listed what the search covers — was three lines of instruction inside the
 * field on a phone, and the field is the one place a person is about to type.
 */
test('lists reflections with the specified search placeholder', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderPage()
  expect(await screen.findByText('Trusting while I cannot see')).toBeInTheDocument()
  expect(
    screen.getByPlaceholderText('Search reflections…'),
  ).toBeInTheDocument()
  // Completion is read from the conversation detail, not guessed.
  expect(await screen.findAllByLabelText(/C\.H\.A\.T\. progress: 2 of 4 sections written/)).toHaveLength(2)
})

/*
 * The markers say *which* sections exist, so a reflection with Content and
 * Heart written must light C and H — not the first two boxes in the row. The
 * mocked detail leaves application and testimony empty, which is a case a bare
 * count cannot tell apart from any other 2 of 4.
 */
test('fills the C.H.A.T. markers for the sections actually written', async () => {
  vi.stubGlobal('fetch', mockFetch())
  const { container } = renderPage()
  await screen.findByText('Trusting while I cannot see')
  await waitFor(() => {
    const markers = [...container.querySelectorAll('[data-section][data-written]')]
    expect(markers.length).toBeGreaterThan(0)
    const written = new Set(
      markers
        .filter((node) => node.getAttribute('data-written') === 'true')
        .map((node) => node.getAttribute('data-section')),
    )
    expect([...written].sort()).toEqual(['content', 'heart'])
  })
})

test('writes the empty state rather than an oversized search container', async () => {
  vi.stubGlobal('fetch', mockFetch([]))
  renderPage()
  expect(await screen.findByText('Your reflections will appear here')).toBeInTheDocument()
  expect(
    screen.queryByPlaceholderText('Search reflections…'),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Start your first reflection' })).toBeInTheDocument()
})

test('remembers the display preference', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'List' }))
  await waitFor(() => expect(window.localStorage.getItem('chat.reflections.display')).toBe('list'))
})

test('groups by Today, This week and month', () => {
  expect(groupLabel(new Date(now).toISOString(), now)).toBe('Today')
  expect(groupLabel(new Date(now - 3 * DAY).toISOString(), now)).toBe('This week')
  expect(groupLabel(new Date(now - 400 * DAY).toISOString(), now)).toBe('Older')
})


/* ------------------------------------------------------- pages and views */

/** Enough reflections that one page cannot hold them. */
function many(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    format: 'full',
    title: `Reflection number ${i}`,
    scriptureReference: 'Romans 8:28',
    visibility: 'private',
    tags: [],
    updatedAt: new Date(now - i * 60_000).toISOString(),
  }))
}

test('a title opens the reader, not the editor', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderPage()
  const link = await screen.findByRole('link', { name: 'Trusting while I cannot see' })
  expect(link).toHaveAttribute('href', '/reflections/r1')
})

test('results are paged, and the pager says where you are', async () => {
  vi.stubGlobal('fetch', mockFetch(many(25)))
  renderPage()
  await screen.findByText(/Page 1 of 2/)

  /* Twenty by default, so the twenty-first is on the next page. */
  expect(screen.queryByRole('link', { name: 'Reflection number 20' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: /Next/ }))
  await screen.findByText(/Page 2 of 2/)
  expect(screen.getByRole('link', { name: 'Reflection number 20' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Reflection number 0' })).toBeNull()
})

test('page size changes how many are shown, and is remembered', async () => {
  vi.stubGlobal('fetch', mockFetch(many(25)))
  const view = renderPage()
  await screen.findByText(/Page 1 of 2/)

  fireEvent.change(screen.getByLabelText('Reflections per page'), { target: { value: '10' } })
  await screen.findByText(/Page 1 of 3/)
  expect(window.localStorage.getItem('chat.reflections.pageSize')).toBe('10')

  /* A returning reader gets the size they chose. */
  view.unmount()
  renderPage()
  await screen.findByText(/Page 1 of 3/)
})

test('one page of results shows no pager at all', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderPage()
  await screen.findByRole('link', { name: 'Trusting while I cannot see' })
  expect(screen.queryByRole('navigation', { name: 'Pages of reflections' })).toBeNull()
})

/*
 * The excerpt says which reflection this is; the full view says what it says.
 * Off by default, because four sections per result turns a list you scan into
 * a page you read.
 */
test('full C.H.A.T. shows every written section, and only when asked', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderPage()
  await screen.findByRole('link', { name: 'Trusting while I cannot see' })
  await waitFor(() => expect(screen.getAllByText(/Paul writes to a suffering church/).length).toBeGreaterThan(0))
  expect(screen.queryByText('It met my fear.')).toBeNull()

  fireEvent.change(screen.getByLabelText('How much of each reflection to show'), {
    target: { value: 'full' },
  })
  await waitFor(() => expect(screen.getAllByText('It met my fear.').length).toBeGreaterThan(0))
  /* An empty section is not shown as an empty heading. */
  expect(screen.queryByRole('heading', { name: /Testimony/ })).toBeNull()
})

test('a page of reflections is one request, not one per card', async () => {
  const fetcher = mockFetch()
  vi.stubGlobal('fetch', fetcher)
  renderPage()

  await screen.findByRole('link', { name: 'Trusting while I cannot see' })
  await waitFor(() =>
    expect(screen.getAllByText(/Paul writes to a suffering church/).length).toBeGreaterThan(0),
  )

  /*
   * The card shows what was written, and nothing asked for a reflection
   * one at a time to find that out.
   */
  const detailCalls = fetcher.mock.calls.filter(([input]) =>
    /\/conversations\/[^/]+$/.test(String(input)),
  )
  expect(detailCalls).toHaveLength(0)
})

/*
 * Density, honoured on a phone.
 *
 * `DENSITY_KEY` is a stored preference read on mount regardless of screen
 * width, so a phone opening this page is not a phone that has never chosen
 * one — it usually already has, from the last time this browser used the
 * desktop layout. The phone's own card used to ignore that value entirely
 * and always show the preview line, which is what this asserts against: not
 * that Compact, Preview and Full C.H.A.T. exist, but that a phone actually
 * renders differently for each.
 */
function withDensity(value: 'compact' | 'preview' | 'full') {
  window.localStorage.setItem('chat.reflections.density', value)
}

function viewport(narrow: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: narrow,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  )
}

test('on a phone, Full C.H.A.T. density actually shows every section', async () => {
  viewport(true)
  withDensity('full')
  vi.stubGlobal('fetch', mockFetch())
  renderPage()

  await screen.findByRole('link', { name: 'Trusting while I cannot see' })
  /*
   * A section heading, not the section's own text — the list summary's
   * `preview` field happens to share wording with the detail fixture below,
   * so text alone would pass whether or not this came from `FullSections`.
   * Only the full rendering names the section it is showing. Both reflections
   * share the same detail fixture, so each heading appears twice — once per
   * card — which is itself part of what confirms this is not the desktop
   * grid rendering, where these two would be in different groups entirely.
   */
  expect(await screen.findAllByRole('heading', { name: /Content/ })).toHaveLength(2)
  expect(screen.getAllByRole('heading', { name: /Heart/ })).toHaveLength(2)
})

test('on a phone, Compact density shows no excerpt at all', async () => {
  viewport(true)
  withDensity('compact')
  vi.stubGlobal('fetch', mockFetch())
  renderPage()

  await screen.findByRole('link', { name: 'Trusting while I cannot see' })
  expect(screen.queryByText('It met my fear.')).toBeNull()
  expect(screen.queryByText('Nothing written yet — open it and begin.')).toBeNull()
})

test('full density is the one view that asks for more', async () => {
  const fetcher = mockFetch()
  vi.stubGlobal('fetch', fetcher)
  renderPage()
  await screen.findByRole('link', { name: 'Trusting while I cannot see' })

  fireEvent.change(screen.getByLabelText('How much of each reflection to show'), {
    target: { value: 'full' },
  })

  /* It renders every section's text, which a list payload should not carry. */
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([input]) => /\/conversations\/[^/]+$/.test(String(input))).length,
    ).toBeGreaterThan(0),
  )
})

test('the reflections list has no import or export control', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderPage()
  await screen.findByText('Trusting while I cannot see')
  expect(screen.queryByRole('button', { name: 'Download JSON' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Download Markdown' })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Your writing' })).toBeNull()
  expect(screen.queryByLabelText('Choose a file')).toBeNull()
})
