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
    publicationState: 'private',
    updatedAt: new Date(now - 60_000).toISOString(),
  },
  {
    id: 'r2',
    format: 'full',
    title: 'Be still and know',
    scriptureReference: 'Psalm 46:10',
    publicationState: 'published',
    updatedAt: new Date(now - 200 * DAY).toISOString(),
  },
]

function mockFetch(items: unknown[] = reflections) {
  return vi.fn((input: RequestInfo) => {
    const url = String(input)
    if (url.includes('/reflections')) {
      const query = new URL(url, 'http://localhost').searchParams.get('q') ?? ''
      return Promise.resolve({
        ok: true,
        json: async () =>
          query
            ? items.filter((item) =>
                (item as { title: string }).title.toLowerCase().includes(query.toLowerCase()),
              )
            : items,
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

test('lists reflections with the specified search placeholder', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderPage()
  expect(await screen.findByText('Trusting while I cannot see')).toBeInTheDocument()
  expect(
    screen.getByPlaceholderText('Search reflections, Scripture or words you wrote'),
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
    screen.queryByPlaceholderText('Search reflections, Scripture or words you wrote'),
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
