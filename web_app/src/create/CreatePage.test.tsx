import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { AUTHOR_ORIGINS, BIBLE_PROVIDERS, emptyChatSections } from '@chat/shared'
import type { CreateStudioProps } from '@crismag/create-studio'

const { captured } = vi.hoisted(() => ({
  captured: { current: null as CreateStudioProps | null },
}))

vi.mock('@crismag/create-studio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@crismag/create-studio')>()
  return {
    ...actual,
    CreateStudio: (props: CreateStudioProps) => {
      captured.current = props
      return (
        <div>
          <p>Studio document {props.document.id}</p>
          <p>{props.onRequestGeneratedAsset ? 'Generated backgrounds enabled' : 'Generated backgrounds unavailable'}</p>
          <button type="button" onClick={() => void props.onSave?.(props.document)}>Save</button>
        </div>
      )
    },
  }
})

const { CreatePage } = await import('./CreatePage.tsx')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  captured.current = null
})

test('the selected reflection opens with its exact saved passage and can be persisted', async () => {
  let savedBody: Record<string, unknown> | null = null
  const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input)
    const json = (value: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => value })
    if (url.endsWith('/conversations')) return json([
      { id: 'first', title: 'First', scriptureReference: null, publicationState: 'private', tags: [], updatedAt: '2026-08-16T10:00:00.000Z' },
      { id: 'selected', title: 'Selected reflection', scriptureReference: 'John 15:5', publicationState: 'private', tags: [], updatedAt: '2026-08-16T11:00:00.000Z' },
    ])
    if (url.endsWith('/studio-assets/status')) return json({ enabled: true })
    if (url.endsWith('/conversations/selected')) return json({
      id: 'selected',
      format: 'full',
      title: 'Selected reflection',
      scriptureReference: 'John 15:5',
      publicationState: 'private',
      tags: [],
      updatedAt: '2026-08-16T11:00:00.000Z',
      messages: [],
      sections: {
        ...emptyChatSections(),
        heart: { type: 'heart', content: 'Remain close.', authorOrigin: AUTHOR_ORIGINS.USER },
      },
      condensed: {
        verse: { type: 'verse', content: '', authorOrigin: AUTHOR_ORIGINS.USER },
        reflection: { type: 'reflection', content: '', authorOrigin: AUTHOR_ORIGINS.USER },
      },
    })
    if (url.endsWith('/bible/reflections/selected/passage')) return json({ passage: {
      provider: BIBLE_PROVIDERS.YOUVERSION,
      translationId: 111,
      abbreviation: 'NIV',
      name: 'New International Version',
      passageId: 'JHN.15.5',
      reference: 'John 15:5',
      content: 'I am the vine; you are the branches.',
      retrievedAt: '2026-08-15T12:00:00.000Z',
    } })
    if (url.endsWith('/studio-creations/selected') && init?.method === 'PUT') {
      savedBody = JSON.parse(String(init.body)) as Record<string, unknown>
      return json({ creation: savedBody })
    }
    if (url.endsWith('/studio-creations/selected')) return json({ creation: null })
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)

  render(<MemoryRouter initialEntries={['/create?c=selected']}><CreatePage /></MemoryRouter>)

  expect(await screen.findByText('Studio document chat.studio.selected')).toBeInTheDocument()
  expect(await screen.findByText('Generated backgrounds enabled')).toBeInTheDocument()
  expect(captured.current?.capabilities).toMatchObject({
    images: false,
    pages: true,
    drawing: false,
    callouts: false,
    groups: false,
    lines: false,
  })
  expect(captured.current?.templates).toEqual([])
  expect(captured.current?.onExportAll).toEqual(expect.any(Function))
  expect(captured.current?.onEditorIssue).toEqual(expect.any(Function))
  expect(await screen.findByLabelText('Layout')).toBeInTheDocument()
  expect(await screen.findByLabelText('Style')).toBeInTheDocument()
  expect(await screen.findByLabelText('Format')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/conversations/selected'), expect.anything())
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(savedBody).not.toBeNull())
  expect(JSON.stringify(savedBody)).toContain('I am the vine; you are the branches.')
  expect(JSON.stringify(savedBody)).toContain('John 15:5 · NIV')

  act(() => {
    captured.current?.onEditorIssue?.({
      severity: 'warning',
      code: 'transform-rejected',
      message: 'That move could not be applied. The previous layout was restored.',
      recoverable: true,
    })
  })
  expect(screen.getByRole('heading', { name: 'Create an image' })).toBeVisible()
  expect(screen.getByLabelText('Reflection')).toBeVisible()
  expect(screen.getByText('That move could not be applied. The previous layout was restored.')).toBeVisible()
})
