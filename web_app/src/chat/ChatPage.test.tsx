import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ChatPage } from './ChatPage.tsx'

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
}

function mockServer(server: Server) {
  return vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const ok = (value: unknown) => ({ ok: true, json: async () => value })

    if (url.endsWith('/ai/status')) {
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
        title: 'A reflection',
        scriptureReference: server.reference,
        publicationState: 'private',
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
        title: 'A reflection',
        scriptureReference: server.reference,
        publicationState: 'private',
        updatedAt: new Date().toISOString(),
        messages: [{ id: 'm1', role: 'user', content: 'Starting a reflection.' }],
        sections: emptySections,
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
  }
  vi.stubGlobal('fetch', mockServer(server))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <ChatPage />
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

test('a reference typed while the first message is creating the reflection survives whole', async () => {
  renderPage()

  const composer = await screen.findByLabelText('Write your reflection')
  fireEvent.change(composer, { target: { value: 'Starting a reflection.' } })
  fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true })

  /* The create request is now in flight and will not answer until we say so. */
  await waitFor(() => expect(server.createdWith).not.toBeNull())

  const reference = screen.getByLabelText('Scripture reference')
  type(reference, REFERENCE)
  expect((reference as HTMLInputElement).value).toBe(REFERENCE)

  /* Now the reflection comes into existence, under the author's hands. */
  server.create.settle()

  await waitFor(() =>
    expect((screen.getByLabelText('Scripture reference') as HTMLInputElement).value).toBe(
      REFERENCE,
    ),
  )

  /* And it is what gets written down, not a fragment of it. */
  fireEvent.blur(screen.getByLabelText('Scripture reference'))
  await waitFor(() =>
    expect(server.patched.some((body) => body['scriptureReference'] === REFERENCE)).toBe(true),
  )
})

test('opening a different reflection still discards the drafts of the one left behind', async () => {
  /*
   * The other half of the same rule. `continuing` must not become a licence to
   * carry one reflection's unsaved reference into another — which would be a
   * worse bug than the one it fixes, because it would attribute a passage to a
   * reflection nobody chose it for.
   */
  renderPage()

  const composer = await screen.findByLabelText('Write your reflection')
  fireEvent.change(composer, { target: { value: 'Starting a reflection.' } })
  fireEvent.keyDown(composer, { key: 'Enter', ctrlKey: true })
  await waitFor(() => expect(server.createdWith).not.toBeNull())
  server.create.settle()
  await waitFor(() => expect(screen.getByLabelText('Reflection title')).not.toBeDisabled())

  type(screen.getByLabelText('Scripture reference'), 'Jonah 2:2')

  /* A brand new blank reflection is a move away, so the draft goes with it. */
  const fresh = screen.getByLabelText(/new reflection/i)
  fireEvent.click(fresh)

  await waitFor(() =>
    expect((screen.getByLabelText('Scripture reference') as HTMLInputElement).value).toBe(''),
  )
})

/*
 * The other half of the same bug, and the half the first fix missed.
 *
 * `?new=1` asks for a blank reflection. Clearing that flag used to race two
 * other URL updates — `startNew` removing `c`, and `openConversation` adding it
 * — and one of the three wrote back a captured snapshot, so the flag kept
 * reappearing: `?new=1&c=…` → `?c=…` → `?new=1` → round again. Every lap
 * re-ran `startNew`, which clears the Scripture reference draft and pulls focus
 * into the composer. That is why the loss was not one wipe but a stutter, and
 * why a reference came back as "Psalm23" with a character gone from the middle.
 *
 * Nine trials in a browser lost characters nine times; `reference-race.mjs`
 * covers it there. This pins the invariant that made it possible.
 */
test('?new=1 is acted on once and does not come back', async () => {
  render(
    <MemoryRouter initialEntries={['/?new=1']}>
      <ChatPage />
    </MemoryRouter>,
  )

  const reference = await screen.findByLabelText('Scripture reference')
  type(reference, 'Psalm 23:1')

  /*
   * Long enough for a second lap to have happened. A loop cleared the field
   * roughly once a second; this asserts nothing clears it at all.
   */
  await new Promise((resolve) => setTimeout(resolve, 250))
  expect((screen.getByLabelText('Scripture reference') as HTMLInputElement).value).toBe(
    'Psalm 23:1',
  )
})
