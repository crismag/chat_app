/*
 * The intro's job is to carry the C.H.A.T. method without losing any of it,
 * and — new since the rename — to be the page a first-time visitor actually
 * lands on and the one thing that changes when they leave it.
 *
 * The failure worth testing for on the content side is not a blank page — it
 * is the page quietly getting shorter. Every previous copy of these
 * definitions drifted by being trimmed, so this asserts the whole of
 * `CHAT_METHOD` reaches the reader, not that four headings are present.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { CHAT_ANCHOR, CHAT_FLOW, CHAT_METHOD } from '@chat/shared'
import { App } from '../app/App.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

/** Signed out, exactly as a stranger following the link would be. */
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ error: 'Unauthenticated.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  ))
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

test('/intro is readable without signing in', async () => {
  renderAt('/intro')
  expect(await screen.findByRole('main')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull()
})

/*
 * The old address. A bookmark, a shared link or a platform reviewer's saved
 * URL should not 404 over a rename that is ours to absorb.
 */
test('/method still resolves, to the same page under its new name', async () => {
  renderAt('/method')
  expect(await screen.findByRole('main')).toBeInTheDocument()
  for (const step of CHAT_METHOD) {
    expect(screen.getByRole('heading', { name: new RegExp(step.name) })).toBeInTheDocument()
  }
})

test('every step arrives whole — name, description and its questions', async () => {
  renderAt('/intro')
  await screen.findByRole('main')
  for (const step of CHAT_METHOD) {
    expect(screen.getByRole('heading', { name: new RegExp(step.name) })).toBeInTheDocument()
    expect(screen.getByText(step.essence)).toBeInTheDocument()
    expect(screen.getByText(step.description)).toBeInTheDocument()
    for (const question of step.questions) {
      expect(screen.getByText(question)).toBeInTheDocument()
    }
  }
})

/*
 * The two clauses the short copy kept losing. Named individually rather than
 * left to the loop above, so that if either is ever softened out of the method
 * the failure says which one.
 */
test('Application keeps its warning and Testimony keeps its subject', async () => {
  renderAt('/intro')
  await screen.findByRole('main')
  expect(screen.getByText(/leads only to miscomprehension/)).toBeInTheDocument()
  expect(screen.getByText(/the Lord and His faithfulness/)).toBeInTheDocument()
})

test('the movement and the verse it comes from are both on the page', async () => {
  renderAt('/intro')
  await screen.findByRole('main')
  for (const stage of CHAT_FLOW) expect(screen.getByText(stage)).toBeInTheDocument()
  expect(screen.getByText(CHAT_ANCHOR.text)).toBeInTheDocument()
  expect(screen.getByText(`${CHAT_ANCHOR.reference} (${CHAT_ANCHOR.translation})`)).toBeInTheDocument()
})

test('About and Welcome both point at it, so it is not an orphan', async () => {
  for (const path of ['/about', '/welcome']) {
    cleanup()
    renderAt(path)
    await screen.findByRole('main')
    /*
     * By href rather than by a name matched on the word "method": the link
     * text on About and Welcome is prose describing the C.H.A.T. method, not
     * the page's own name any more, and asserting on wording that is free to
     * change would make this test the thing that breaks on a copy edit.
     */
    const links = screen.getAllByRole('link').filter((link) => link.getAttribute('href') === '/intro')
    expect(links.length).toBeGreaterThan(0)
  }
})

/*
 * The behaviour the rename exists to carry: being shown this page at all is
 * what "has seen the intro" means, whether that is the first-visit redirect
 * from `/` or someone opening it later from the header.
 */
test('visiting the intro marks it seen for this browser', async () => {
  expect(window.localStorage.getItem('chat.intro.seen')).toBeNull()
  renderAt('/intro')
  await screen.findByRole('main')
  expect(window.localStorage.getItem('chat.intro.seen')).toBe('seen')
})

test('"Start writing" leads to Reflect, not back into the intro', async () => {
  renderAt('/intro')
  const start = await screen.findByRole('link', { name: 'Start writing' })
  expect(start).toHaveAttribute('href', '/')
})
