/*
 * The default a person actually meets when they open a note.
 *
 * Rich text mode existed to fix one thing: raw Markdown syntax on a blank
 * textarea is not something most people arrive already knowing. What this
 * file asserts is therefore about *defaults* and the *way out* — that rich
 * text is what a new note opens in, that the way to Markdown mode is there
 * for whoever wants it, and that the choice is remembered rather than asked
 * again on every note.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { NoteEditor } from './NoteEditor.tsx'
import type { Note } from './api.ts'

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    title: 'Groceries',
    body: '',
    pinned: false,
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function mockFetch(note: Note) {
  return vi.fn((input: RequestInfo, init?: RequestInit) => {
    const url = String(input)
    if (url.includes(`/notes/${note.id}`) && init?.method === 'PATCH') {
      const patch = JSON.parse(String(init.body)) as Partial<Note>
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...note, ...patch, updatedAt: new Date().toISOString() }),
      })
    }
    return Promise.resolve({ ok: true, json: async () => note })
  })
}

const noop = () => {}

function renderEditor(note: Note) {
  return render(
    <NoteEditor
      note={note}
      view="active"
      onClose={noop}
      onSaved={noop}
      onPin={noop}
      onArchive={noop}
      onDelete={noop}
      onRestore={noop}
    />,
  )
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

test('a note opens in rich text, not on a raw Markdown textarea', () => {
  vi.stubGlobal('fetch', mockFetch(makeNote()))
  renderEditor(makeNote())

  expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument()
  /* The way out is offered, not the mode itself. */
  expect(screen.getByRole('button', { name: 'Markdown' })).toBeInTheDocument()
  expect(screen.queryByPlaceholderText('Write a note…')).toBeNull()
})

test('an existing task list opens as a real, tickable checkbox', () => {
  vi.stubGlobal('fetch', mockFetch(makeNote({ body: '- [ ] Buy milk\n- [x] Buy eggs' })))
  renderEditor(makeNote({ body: '- [ ] Buy milk\n- [x] Buy eggs' }))

  const boxes = screen.getAllByRole('checkbox')
  expect(boxes).toHaveLength(2)
  expect(boxes[0]).not.toBeChecked()
  expect(boxes[1]).toBeChecked()
})

test('switching to Markdown mode shows the raw textarea, and back again', () => {
  vi.stubGlobal('fetch', mockFetch(makeNote({ body: '**Bold already.**' })))
  renderEditor(makeNote({ body: '**Bold already.**' }))

  fireEvent.click(screen.getByRole('button', { name: 'Markdown' }))
  const textarea = screen.getByPlaceholderText('Write a note…') as HTMLTextAreaElement
  expect(textarea).toBeInTheDocument()
  /* The raw syntax is visible now — the whole point of offering this mode. */
  expect(textarea.value).toBe('**Bold already.**')

  fireEvent.click(screen.getByRole('button', { name: 'Rich text' }))
  expect(screen.queryByPlaceholderText('Write a note…')).toBeNull()
  expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument()
})

test('the mode choice is remembered for the next note opened, not asked again', () => {
  vi.stubGlobal('fetch', mockFetch(makeNote()))
  const first = renderEditor(makeNote())
  fireEvent.click(screen.getByRole('button', { name: 'Markdown' }))
  expect(screen.getByPlaceholderText('Write a note…')).toBeInTheDocument()
  first.unmount()
  cleanup()

  vi.stubGlobal('fetch', mockFetch(makeNote({ id: 'n2', title: 'Second note' })))
  renderEditor(makeNote({ id: 'n2', title: 'Second note' }))
  /* A different note, opened fresh — still in the mode chosen a moment ago. */
  expect(screen.getByPlaceholderText('Write a note…')).toBeInTheDocument()
})

test('ticking a task in rich mode saves the change as Markdown', async () => {
  const note = makeNote({ body: '- [ ] Buy milk' })
  const fetcher = mockFetch(note)
  vi.stubGlobal('fetch', fetcher)
  renderEditor(note)

  /*
   * A real click on the checkbox Tiptap's own task-item node view renders —
   * a genuine transaction through the editor, unlike simulating raw typing
   * into a ProseMirror-managed contenteditable, which jsdom's input-event
   * model cannot drive reliably. The conversion itself — that this ends up
   * as `- [x]` — is `richtext/roundtrip.test.ts`'s job; what matters here is
   * that a real interaction reaches `onChange` and the ordinary save follows.
   */
  await act(async () => {
    fireEvent.click(screen.getByRole('checkbox'))
  })

  await waitFor(
    () => {
      const patchCall = fetcher.mock.calls.find(
        ([, init]) => init && (init as RequestInit).method === 'PATCH',
      )
      expect(patchCall).toBeDefined()
      const body = patchCall?.[1] ? JSON.parse(String((patchCall[1] as RequestInit).body)) : null
      expect(body?.body).toContain('[x]')
    },
    { timeout: 2000 },
  )
})
