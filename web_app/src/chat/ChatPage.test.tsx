import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ChatPage } from './ChatPage.tsx'
import { AuthProvider } from '../auth/AuthContext.tsx'

/*
 * The Scripture reference that lost what was typed into it.
 *
 * The report was that a reference typed straight after the first message —
 * the message that CREATES the reflection — kept only its first character, and
 * the next AI turn asked which book "R" was. Typed before the first message it
 * was fine.
 *
 * The cause was not focus. Creating a reflection looked, to `openConversation`,
 * exactly like switching to a different one, so it ran the reset that throws
 * away every unsaved draft on the page: the reference, the title and the
 * section edits. Whatever had been typed during the round trip was written over
 * with the server's value, and what survived was whichever fragment happened to
 * be typed on the far side of the wipe.
 *
 * The test recreates the only condition that matters — the author types WHILE
 * the create request is still in flight — by holding that request open. On a
 * developer's loopback the window is a few milliseconds wide, which is why this
 * survived so long; held open, it is deterministic.
 */

const REFERENCE = 'Romans 8:28'

const emptySections = {
  content: { type: 'content', content: '', authorOrigin: 'user' },
  heart: { type: 'heart', content: '', authorOrigin: 'user' },
  application: { type: 'application', content: '', authorOrigin: 'user' },
  testimony: { type: 'testimony', content: '', authorOrigin: 'user' },
}

/** A promise this test decides when to settle. */
function deferred<T>() {
  let settle: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

type Server = {
  /** Held open until the test releases it, so typing can overlap creation. */
  create: ReturnType<typeof deferred<void>>
  /** What POST /conversations was actually asked to store. */
  createdWith: Record<string, unknown> | null
  /** What PATCH /conversations/:id was asked to store, in order. */
  patched: Record<string, unknown>[]
  reference: string
  sections: typeof emptySections
  title: string
}

function mockServer(server: Server) {
  return vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const ok = (value: unknown) => ({ ok: true, json: async () => value })

    if (url.includes('/communities')) {
      return ok({ communities: [] })
    }
    if (url.includes('/bible/translations')) {
      return ok({
        translations: [
          {
            id: 111,
            abbreviation: 'NIV',
            name: 'New International Version',
            language: 'en',
            languageName: 'English',
          },
        ],
        defaultTranslationId: 111,
      })
    }
    if (url.includes('/bible/passages')) {
      const reference = new URL(url, 'http://test').searchParams.get('reference') ?? 'John 3:16'
      return ok({
        passage: {
          provider: 'youversion',
          translationId: 111,
          abbreviation: 'NIV',
          name: 'New International Version',
          passageId: 'JHN.3.16',
          reference,
          content: 'For God so loved the world.',
          retrievedAt: '2026-08-18T12:00:00.000Z',
        },
        verses: 1,
      })
    }
    if (url.includes('/bible/reflections') && url.includes('/passage')) {
      if (method === 'DELETE') return { ok: true, status: 204, json: async () => ({}) }
      if (method === 'PUT') return ok({ passage: body })
      return ok({ passage: null })
    }
    if (url.includes('/ai/status')) {
      /* No provider: a reply is not what this test is about. */
      return ok({ enabled: true, provider: 'none', capabilities: {} })
    }
    if (url.endsWith('/conversations') && method === 'POST') {
      server.createdWith = body
      server.reference = String(body['scriptureReference'] ?? '')
      await server.create.promise
      return ok({
        id: 'c1',
        format: 'full',
        title: server.title,
        scriptureReference: server.reference,
        visibility: 'private',
        tags: [],
        updatedAt: new Date().toISOString(),
      })
    }
    if (url.endsWith('/conversations') && method === 'GET') {
      return ok([])
    }
    if (url.includes('/conversations/c1') && method === 'PATCH') {
      server.patched.push(body)
      if (typeof body['scriptureReference'] === 'string') {
        server.reference = body['scriptureReference']
      }
      return ok({ id: 'c1' })
    }
    if (url.includes('/messages')) {
      return ok({ id: 'm1' })
    }
    if (url.includes('/conversations/c1')) {
      return ok({
        id: 'c1',
        format: 'full',
        title: server.title,
        scriptureReference: server.reference,
        visibility: 'private',
        tags: [],
        updatedAt: new Date().toISOString(),
        messages: [{ id: 'm1', role: 'user', content: 'Starting a reflection.' }],
        sections: server.sections,
        condensed: {
          verse: { type: 'verse', content: '', authorOrigin: 'user' },
          reflection: { type: 'reflection', content: '', authorOrigin: 'user' },
        },
      })
    }
    return ok({})
  })
}

let server: Server

beforeEach(() => {
  server = {
    create: deferred<void>(),
    createdWith: null,
    patched: [],
    reference: '',
    sections: { ...emptySections },
    title: 'A reflection',
  }
  vi.stubGlobal('fetch', mockServer(server))
  server.create.settle()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

function renderPage() {
  /* The page asks who is signed in — to decide whether Share can act — so it
   * needs the provider that answers, exactly as the application supplies. */
  return render(
    <MemoryRouter>
      <AuthProvider>
        <ChatPage />
      </AuthProvider>
    </MemoryRouter>,
  )
}

/** Type character by character, the way the defect was met. */
function type(field: HTMLElement, text: string) {
  let value = (field as HTMLInputElement).value
  for (const character of text) {
    value += character
    fireEvent.change(field, { target: { value } })
  }
}

/*
 * Nothing is saved for a page nobody has written a word on.
 *
 * A title typed and blurred, a passage looked up, a tag committed: on their
 * own none of these used to need a section — each one silently created an
 * untitled, sectionless conversation the moment it was touched. The value
 * typed is not lost in any of these — it stays exactly where it was typed —
 * only the premature row in the reflections table is gone.
 */
test('a title on a blank page is kept, not saved, until a section has something in it', async () => {
  renderPage()

  const title = screen.getByLabelText('Reflection title')
  type(title, 'Quiet morning')
  fireEvent.blur(title)

  /* Given a moment to (not) reach the server. */
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(server.createdWith).toBeNull()
  /* And the words typed are still exactly there, not reverted to the placeholder. */
  expect((screen.getByLabelText('Reflection title') as HTMLInputElement).value).toBe(
    'Quiet morning',
  )

  /* The first real sentence is what actually creates it — title included. */
  const content = screen.getByLabelText(/Content — the passage itself/i)
  fireEvent.change(content, { target: { value: 'He is the vine.' } })
  await waitFor(() => expect(server.createdWith).not.toBeNull(), { timeout: 2000 })
  expect(server.createdWith?.['title']).toBe('Quiet morning')
})

test('a passage picked before any writing is shown, not saved, until a section has content', async () => {
  renderPage()

  fireEvent.click(await screen.findByRole('button', { name: 'Add Bible passage' }))
  const sheet = await screen.findByRole('dialog', { name: 'Bible passage' })
  fireEvent.click(await within(sheet).findByRole('button', { name: /choose bible passage/i }))
  const passageField = await within(sheet).findByPlaceholderText('John 3:16-18')
  fireEvent.change(passageField, { target: { value: 'John 3:16' } })
  await waitFor(() =>
    expect(within(sheet).getByRole('button', { name: 'Load passage' })).toBeEnabled(),
  )
  fireEvent.click(within(sheet).getByRole('button', { name: 'Load passage' }))

  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(server.createdWith).toBeNull()

  /* Closing the sheet, the button reads the passage that was picked. */
  fireEvent.click(within(sheet).getByRole('button', { name: 'Close Bible passage' }))
  expect(await screen.findByRole('button', { name: /John 3:16/i })).toBeInTheDocument()

  /* And it is what the eventual first save actually creates the reflection with. */
  const content = screen.getByLabelText(/Content — the passage itself/i)
  fireEvent.change(content, { target: { value: 'For God so loved the world.' } })
  await waitFor(() => expect(server.createdWith).not.toBeNull(), { timeout: 2000 })
  expect(server.createdWith?.['scriptureReference']).toBe('John 3:16')
})

test('tags set on a blank page are kept, not saved, until a section has something in it', async () => {
  renderPage()

  const tags = await screen.findByLabelText('Tags')
  type(tags, 'prayer')
  fireEvent.blur(tags)

  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(server.createdWith).toBeNull()
  expect((screen.getByLabelText('Tags') as HTMLInputElement).value).toBe('prayer')
})

test('a title typed while the first message is creating the reflection survives whole', async () => {
  server.create = deferred()
  renderPage()

  const composer = await screen.findByLabelText('Write your reflection')
  fireEvent.change(composer, { target: { value: 'Starting a reflection.' } })
  fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true })

  await waitFor(() => expect(server.createdWith).not.toBeNull())

  const title = screen.getByLabelText('Reflection title')
  type(title, REFERENCE)
  expect((title as HTMLInputElement).value).toBe(REFERENCE)

  server.create.settle()

  await waitFor(() =>
    expect((screen.getByLabelText('Reflection title') as HTMLInputElement).value).toBe(REFERENCE),
  )

  fireEvent.blur(screen.getByLabelText('Reflection title'))
  await waitFor(() =>
    expect(server.patched.some((body) => body['title'] === REFERENCE)).toBe(true),
  )
})

test('the Send button path keeps a title typed during creation', async () => {
  server.create = deferred()
  renderPage()

  const composer = await screen.findByLabelText('Write your reflection')
  fireEvent.change(composer, { target: { value: 'Starting a reflection.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))

  await waitFor(() => expect(server.createdWith).not.toBeNull())

  type(screen.getByLabelText('Reflection title'), REFERENCE)
  server.create.settle()

  await waitFor(() =>
    expect((screen.getByLabelText('Reflection title') as HTMLInputElement).value).toBe(REFERENCE),
  )

  fireEvent.blur(screen.getByLabelText('Reflection title'))
  await waitFor(() =>
    expect(server.patched.some((body) => body['title'] === REFERENCE)).toBe(true),
  )
})

test('opening a different reflection still discards the drafts of the one left behind', async () => {
  renderPage()

  const composer = await screen.findByLabelText('Write your reflection')
  fireEvent.change(composer, { target: { value: 'Starting a reflection.' } })
  fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true })
  await waitFor(() => expect(server.createdWith).not.toBeNull())
  server.create.settle()
  await waitFor(() => expect(screen.getByLabelText('Reflection title')).toBeEnabled())

  type(screen.getByLabelText('Reflection title'), 'Jonah 2:2')

  fireEvent.click(screen.getByRole('button', { name: 'New reflection' }))

  await waitFor(() =>
    expect(screen.getByLabelText('Reflection title')).toHaveAttribute('placeholder', 'New reflection'),
  )
  expect((screen.getByLabelText('Reflection title') as HTMLInputElement).value).toBe('')
})

test('?new=1 is acted on once and does not come back', async () => {
  render(
    <MemoryRouter initialEntries={['/?new=1']}>
        <AuthProvider>
          <ChatPage />
        </AuthProvider>
      </MemoryRouter>,
  )

  const title = await screen.findByLabelText('Reflection title')
  type(title, 'Quiet morning')

  await new Promise((resolve) => setTimeout(resolve, 250))
  expect((screen.getByLabelText('Reflection title') as HTMLInputElement).value).toBe(
    'Quiet morning',
  )
})

test('a brand-new reflection shows every C.H.A.T. field and a writable title', async () => {
  renderPage()

  expect(await screen.findByRole('heading', { name: /content/i })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /heart/i })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /application/i })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /testimony/i })).toBeInTheDocument()
  expect(screen.getByLabelText('Reflection title')).toBeEnabled()
  expect(screen.getByLabelText('Tags')).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Add Bible passage' })).toBeInTheDocument()
  /* The connector is behind that press and nowhere on the page until then. */
  expect(screen.queryByPlaceholderText('John 3:16-18')).toBeNull()
  expect(screen.queryByRole('combobox', { name: 'Translation' })).toBeNull()
  expect(screen.queryByLabelText('Scripture reference')).toBeNull()
  expect(screen.queryByPlaceholderText('Reference')).toBeNull()
  /*
   * Not offered at all on an empty page. It used to sit here permanently
   * greyed, proposing to name a reflection nobody had written yet.
   */
  expect(screen.queryByRole('button', { name: /Suggest a title for this reflection/i })).toBeNull()
})

test('writing Content does not require a Bible passage first', async () => {
  renderPage()

  const content = await screen.findByLabelText(/Content — the passage itself/i)
  fireEvent.change(content, { target: { value: 'The vine is the source.' } })
  expect((content as HTMLTextAreaElement).value).toBe('The vine is the source.')
  expect(screen.getByRole('button', { name: 'Add Bible passage' })).toBeInTheDocument()
})

test('a saved reflection hydrates its title, passage control and C.H.A.T. fields', async () => {
  server.title = 'Abide'
  server.reference = 'John 15:5'
  server.sections = {
    ...emptySections,
    content: { type: 'content', content: 'He is the vine.', authorOrigin: 'user' },
    heart: { type: 'heart', content: 'I need to remain.', authorOrigin: 'user' },
    application: { type: 'application', content: 'Stay with the Word today.', authorOrigin: 'user' },
    testimony: { type: 'testimony', content: 'You have kept me.', authorOrigin: 'user' },
  }

  render(
    <MemoryRouter initialEntries={['/?c=c1']}>
        <AuthProvider>
          <ChatPage />
        </AuthProvider>
      </MemoryRouter>,
  )

  await waitFor(() =>
    expect((screen.getByLabelText('Reflection title') as HTMLInputElement).value).toBe('Abide'),
  )
  expect(await screen.findByLabelText(/Content — the passage itself/i)).toHaveValue(
    'He is the vine.',
  )
  expect(screen.getByLabelText(/Heart — What it means/i)).toHaveValue('I need to remain.')
  expect(screen.getByLabelText(/Application — How will you respond/i)).toHaveValue(
    'Stay with the Word today.',
  )
  expect(screen.getByLabelText(/Testimony — What God has done/i)).toHaveValue(
    'You have kept me.',
  )
  expect(screen.getByRole('button', { name: /John 15:5/i })).toBeInTheDocument()
})

/*
 * Tags moved below the sections, and Share is repeated beside it — the fix
 * for tags reading as an oversized, half-empty header row, and for Share
 * being the one useful control that stayed at the top of a page somebody had
 * scrolled all the way down.
 */
test('Tags sits after Testimony, not in the header, and Share is offered again beside it', async () => {
  render(
    <MemoryRouter initialEntries={['/?c=c1']}>
      <AuthProvider>
        <ChatPage />
      </AuthProvider>
    </MemoryRouter>,
  )

  const tags = await screen.findByLabelText('Tags')
  const testimony = screen.getByLabelText(/Testimony — What God has done/i)
  /*
   * DOM order, not just presence: `compareDocumentPosition` says which comes
   * first in the document, which is what "below the sections" actually
   * means. A CSS reorder would satisfy a screenshot and fail this.
   */
  expect(
    testimony.compareDocumentPosition(tags) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()

  const shares = screen.getAllByRole('button', { name: 'Share' })
  expect(shares).toHaveLength(2)
  /* A saved reflection with content: both are the live action, not a stub. */
  for (const share of shares) expect(share).toBeEnabled()
})

test('on a brand-new reflection both Share controls start disabled, together', async () => {
  renderPage()
  await screen.findByLabelText('Reflection title')

  const shares = screen.getAllByRole('button', { name: 'Share' })
  expect(shares).toHaveLength(2)
  for (const share of shares) expect(share).toBeDisabled()
})

test('Suggest title appears once there is something to name', async () => {
  renderPage()

  /* Absent rather than greyed: there is nothing to suggest a title from yet. */
  await screen.findByLabelText('Reflection title')
  expect(screen.queryByRole('button', { name: /Suggest a title for this reflection/i })).toBeNull()
  /* And it is still offered, with its reason, where the rest of the actions are. */
  fireEvent.click(screen.getByRole('button', { name: /More actions for this reflection/i }))
  expect(screen.getByRole('menuitem', { name: 'Suggest a title' })).toBeDisabled()
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

  fireEvent.change(screen.getByLabelText(/Heart — What it means/i), {
    target: { value: 'This verse met me in the waiting.' },
  })
  await waitFor(() => expect(screen.getByRole('button', { name: /Suggest a title for this reflection/i })).toBeEnabled())
  expect(screen.getByLabelText('Reflection title')).toBeEnabled()
})

test('the passage connector opens in a sheet, and closing it leaves C.H.A.T. writing alone', async () => {
  renderPage()

  const content = await screen.findByLabelText(/Content — the passage itself/i)
  fireEvent.change(content, { target: { value: 'The vine is the source.' } })

  /* Nothing about Bible lookup exists until the control is pressed. */
  expect(screen.queryByRole('dialog', { name: 'Bible passage' })).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: 'Add Bible passage' }))
  const sheet = await screen.findByRole('dialog', { name: 'Bible passage' })

  fireEvent.click(await within(sheet).findByRole('button', { name: /choose bible passage/i }))
  const passageField = await within(sheet).findByPlaceholderText('John 3:16-18')
  fireEvent.change(passageField, { target: { value: 'John 3:16' } })
  await waitFor(() =>
    expect(within(sheet).getByRole('button', { name: 'Load passage' })).toBeEnabled(),
  )
  fireEvent.click(within(sheet).getByRole('button', { name: 'Load passage' }))

  /* A passage the author just asked for is shown in full, not collapsed. */
  await waitFor(() =>
    expect(within(sheet).getByTestId('scripture-text')).toHaveAttribute('data-collapsed', 'false'),
  )

  fireEvent.click(screen.getByRole('button', { name: 'Close Bible passage' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bible passage' })).toBeNull())

  /* The page names the passage it is written against, and nothing more. */
  expect(await screen.findByRole('button', { name: /John 3:16/ })).toBeInTheDocument()
  expect(screen.queryByPlaceholderText('John 3:16-18')).toBeNull()
  expect(screen.getByLabelText(/Content — the passage itself/i)).toHaveValue(
    'The vine is the source.',
  )
})

test('opening Reflect does not ask which communities you are in', async () => {
  const fetcher = mockServer(server)
  vi.stubGlobal('fetch', fetcher)
  renderPage()

  await screen.findByLabelText('Write your reflection')

  /*
   * Most visits are somebody writing, and writing needs no community list.
   * It is fetched when the share sheet opens, which is the first moment the
   * answer is used.
   */
  const asked = fetcher.mock.calls.filter(([input]) => String(input).includes('/communities'))
  expect(asked).toHaveLength(0)
})

test('opening the share sheet is when the community list is fetched', async () => {
  const fetcher = mockServer(server)
  vi.stubGlobal('fetch', fetcher)

  /* `?share=1` is the app's own way in to the sheet, used by shared links. */
  render(
    <MemoryRouter initialEntries={['/?c=c1&share=1']}>
      <AuthProvider>
        <ChatPage />
      </AuthProvider>
    </MemoryRouter>,
  )

  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([input]) => String(input).includes('/communities')).length,
    ).toBeGreaterThan(0),
  )
})
