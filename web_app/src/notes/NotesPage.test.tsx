import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { NotesPage } from './NotesPage.tsx'
import type { Note, NoteView } from './api.ts'

const now = new Date().toISOString()

function note(partial: Partial<Note> & Pick<Note, 'id' | 'title'>): Note {
  return {
    body: '',
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...partial,
  }
}

const grocery = note({
  id: 'n1',
  title: 'Sunday list',
  body: 'Milk and bread for the week.',
  pinned: true,
})
const idea = note({
  id: 'n2',
  title: 'A quiet thought',
  body: 'Something I do not want to lose.',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

function mockFetch(options: { items?: Note[]; view?: NoteView } = {}) {
  const items = options.items ?? [grocery, idea]
  const created = note({ id: 'n-new', title: '', body: '' })

  return vi.fn((input: RequestInfo, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()

    if (url.includes('/notes') && method === 'POST' && url.includes('/restore')) {
      const id = url.split('/notes/')[1]?.split('/')[0] ?? ''
      const existing = items.find((item) => item.id === id) ?? created
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...existing, deletedAt: null }),
      })
    }

    if (url.includes('/notes') && method === 'POST') {
      return Promise.resolve({
        ok: true,
        status: 201,
        json: async () => created,
        text: async () => JSON.stringify(created),
      })
    }

    if (url.includes('/notes') && method === 'PATCH') {
      const id = url.split('/notes/')[1] ?? ''
      const body = JSON.parse(String(init?.body ?? '{}')) as Partial<Note>
      const existing = items.find((item) => item.id === id) ?? created
      const updated = {
        ...existing,
        ...body,
        pinned: body.pinned ?? existing.pinned,
        archived: body.archived ?? existing.archived,
      }
      return Promise.resolve({
        ok: true,
        json: async () => updated,
        text: async () => JSON.stringify(updated),
      })
    }

    if (url.includes('/notes') && method === 'DELETE') {
      const id = url.split('/notes/')[1] ?? ''
      const existing = items.find((item) => item.id === id) ?? created
      const deleted = { ...existing, deletedAt: now, pinned: false }
      return Promise.resolve({
        ok: true,
        json: async () => deleted,
        text: async () => JSON.stringify(deleted),
      })
    }

    if (url.includes('/notes')) {
      const search = new URL(url, 'http://localhost').searchParams
      const q = (search.get('q') ?? '').toLowerCase()
      const view = (search.get('view') ?? options.view ?? 'active') as NoteView
      const rows = items.filter((item) => {
        if (q && !`${item.title} ${item.body}`.toLowerCase().includes(q)) return false
        if (view === 'trash') return item.deletedAt !== null
        if (item.deletedAt) return false
        return view === 'archived' ? item.archived : !item.archived
      })
      return Promise.resolve({
        ok: true,
        json: async () => ({ items: rows, view }),
        text: async () => JSON.stringify({ items: rows, view }),
      })
    }

    return Promise.resolve({
      ok: true,
      json: async () => ({}),
      text: async () => '{}',
    })
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <NotesPage />
    </MemoryRouter>,
  )
}

test('lists notes with a pinned section, and does not say "No posts"', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderPage()

  expect(await screen.findByRole('heading', { name: 'Sunday list' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'A quiet thought' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Pinned' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Others' })).toBeInTheDocument()
  expect(screen.getByText('Milk and bread for the week.')).toBeInTheDocument()
  expect(screen.queryByText(/^no posts\.?$/i)).not.toBeInTheDocument()
})

test('writes the empty state in plain language', async () => {
  vi.stubGlobal('fetch', mockFetch({ items: [] }))
  renderPage()

  expect(await screen.findByRole('heading', { name: /notes you write will appear here/i })).toBeInTheDocument()
  expect(screen.getByText(/create a note to keep something private/i)).toBeInTheDocument()
  expect(screen.queryByText(/^no posts\.?$/i)).not.toBeInTheDocument()
})

test('the toolbar offers a new note, search and the three views', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderPage()
  await screen.findByRole('heading', { name: 'Sunday list' })

  expect(screen.getByRole('button', { name: '+ New note' })).toBeInTheDocument()
  expect(screen.getByPlaceholderText('Search notes…')).toBeInTheDocument()
  const tabs = screen.getAllByRole('tab')
  expect(tabs.map((tab) => tab.textContent)).toEqual(['Active', 'Archive', 'Trash'])
})

test('creating a note opens the editor immediately', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderPage()
  await screen.findByRole('heading', { name: 'Sunday list' })

  fireEvent.click(screen.getByRole('button', { name: '+ New note' }))
  expect(await screen.findByLabelText('Note title')).toBeInTheDocument()
  expect(screen.getByLabelText('Note')).toBeInTheDocument()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

test('clicking a card opens the editor with that note', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderPage()
  fireEvent.click(await screen.findByRole('heading', { name: 'Sunday list' }))
  expect(await screen.findByLabelText('Note title')).toHaveValue('Sunday list')
  /* Opens in rich text by default, so the body is rendered content, not a value. */
  expect(screen.getByLabelText('Note')).toHaveTextContent('Milk and bread for the week.')
})

test('search asks the server with the typed query', async () => {
  const fetchMock = mockFetch()
  vi.stubGlobal('fetch', fetchMock)
  renderPage()
  await screen.findByRole('heading', { name: 'Sunday list' })

  fireEvent.change(screen.getByPlaceholderText('Search notes…'), {
    target: { value: 'quiet' },
  })

  await waitFor(() => {
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('q=quiet'))).toBe(true)
  })
})

test('pinning a note updates it', async () => {
  const fetchMock = mockFetch({ items: [idea] })
  vi.stubGlobal('fetch', fetchMock)
  renderPage()
  const pin = await screen.findByRole('button', { name: 'Pin' })
  fireEvent.click(pin)

  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some((call) => {
        const init = call[1] as RequestInit | undefined
        return init?.method === 'PATCH' && String(init.body).includes('"pinned":true')
      }),
    ).toBe(true)
  })
})

test('deleting a note and viewing trash can restore it', async () => {
  const trashed = note({
    id: 'n3',
    title: 'Thrown away',
    body: 'gone',
    deletedAt: now,
  })
  const fetchMock = mockFetch({ items: [grocery, idea, trashed] })
  vi.stubGlobal('fetch', fetchMock)
  renderPage()
  await screen.findByRole('heading', { name: 'Sunday list' })

  fireEvent.click(screen.getByRole('tab', { name: 'Trash' }))

  expect(await screen.findByRole('heading', { name: 'Thrown away' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some((call) => {
        const init = call[1] as RequestInit | undefined
        return String(call[0]).includes('/restore') && init?.method === 'POST'
      }),
    ).toBe(true)
  })
})

test('the archive empty state is written, not blank', async () => {
  vi.stubGlobal('fetch', mockFetch({ items: [] }))
  renderPage()
  await screen.findByRole('heading', { name: /notes you write will appear here/i })
  fireEvent.click(screen.getByRole('tab', { name: 'Archive' }))
  expect(await screen.findByRole('heading', { name: /nothing is archived/i })).toBeInTheDocument()
})
