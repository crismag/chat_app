import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { LibraryArchive } from './LibraryArchive.tsx'
import { saveTextFile } from '../shared/native/save-text.ts'

vi.mock('../shared/native/save-text.ts', () => ({
  saveTextFile: vi.fn(async () => 'downloaded'),
}))

const emptyLibrary = JSON.stringify({
  kind: 'chat.library',
  schemaVersion: 1,
  exportedAt: '2026-08-24T12:00:00.000Z',
  reflections: [],
  notes: [],
})

function mockLibraryFetch() {
  return vi.fn((input: RequestInfo, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/library/export')) {
      const params = new URL(url, 'http://localhost').searchParams
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="chat-library-2026-08-24.json"',
        }),
        text: async () => emptyLibrary,
        json: async () => JSON.parse(emptyLibrary),
        url,
        reflections: params.get('reflections'),
        notes: params.get('notes'),
        format: params.get('format'),
      } as unknown as Response)
    }
    if (url.includes('/library/import') && method === 'POST') {
      return Promise.resolve({
        ok: true,
        status: 201,
        json: async () => ({
          imported: { reflections: 1, notes: 1 },
          skipped: [],
        }),
        text: async () =>
          JSON.stringify({ imported: { reflections: 1, notes: 1 }, skipped: [] }),
      } as unknown as Response)
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found.' }),
    } as unknown as Response)
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('both collections are ticked, and both download buttons are offered', () => {
  vi.stubGlobal('fetch', mockLibraryFetch())
  render(<LibraryArchive />)

  expect(screen.getByRole('heading', { name: 'Your writing' })).toBeVisible()
  expect(screen.getByRole('checkbox', { name: /Reflections/ })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: /Notes/ })).toBeChecked()
  expect(screen.getByRole('button', { name: 'Download JSON' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Download Markdown' })).toBeEnabled()
})

test('unticking both collections disables download', () => {
  vi.stubGlobal('fetch', mockLibraryFetch())
  render(<LibraryArchive />)

  fireEvent.click(screen.getByRole('checkbox', { name: /Reflections/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: /Notes/ }))
  expect(screen.getByRole('button', { name: 'Download JSON' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Download Markdown' })).toBeDisabled()
})

test('Download JSON asks for the ticked collections', async () => {
  const fetcher = mockLibraryFetch()
  vi.stubGlobal('fetch', fetcher)
  vi.mocked(saveTextFile).mockClear()

  render(<LibraryArchive />)
  fireEvent.click(screen.getByRole('checkbox', { name: /Reflections/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }))

  await waitFor(() => expect(fetcher).toHaveBeenCalled())
  const asked = String(fetcher.mock.calls[0]?.[0])
  expect(asked).toContain('/library/export')
  expect(asked).toContain('reflections=0')
  expect(asked).toContain('notes=1')
  expect(asked).toContain('format=json')
  await waitFor(() => expect(saveTextFile).toHaveBeenCalled())
})

test('Download Markdown is a separate format', async () => {
  const fetcher = mockLibraryFetch()
  vi.stubGlobal('fetch', fetcher)

  render(<LibraryArchive />)
  fireEvent.click(screen.getByRole('button', { name: 'Download Markdown' }))

  await waitFor(() => expect(fetcher).toHaveBeenCalled())
  expect(String(fetcher.mock.calls[0]?.[0])).toContain('format=markdown')
})

test('choosing a library file shows a preview, then imports it', async () => {
  const fetcher = mockLibraryFetch()
  vi.stubGlobal('fetch', fetcher)
  render(<LibraryArchive />)

  const file = new File(
    [
      JSON.stringify({
        kind: 'chat.library',
        reflections: [{ title: 'John 15', heart: 'I remain.' }],
        notes: [{ title: 'List', body: 'Eggs.' }],
      }),
    ],
    'chat-library.json',
    { type: 'application/json' },
  )

  const input = screen.getByLabelText('Choose a file')
  fireEvent.change(input, { target: { files: [file] } })

  expect(await screen.findByText(/1 reflection and 1 note will be added as private copies/i)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Import' }))

  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(/Imported 1 reflection and 1 note/i),
  )
  const posted = fetcher.mock.calls.find((call) => String(call[0]).includes('/library/import'))
  expect(posted?.[1]?.method).toBe('POST')
})
