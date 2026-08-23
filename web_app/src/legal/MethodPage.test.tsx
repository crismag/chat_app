/*
 * The method page's job is to carry the method without losing any of it.
 *
 * The failure worth testing for is not a blank page — it is the page quietly
 * getting shorter. Every previous copy of these definitions drifted by being
 * trimmed, so this asserts the whole of `CHAT_METHOD` reaches the reader, not
 * that four headings are present.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { CHAT_ANCHOR, CHAT_FLOW, CHAT_METHOD } from '@chat/shared'
import { App } from '../app/App.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
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

test('/method is readable without signing in', async () => {
  renderAt('/method')
  expect(await screen.findByRole('main')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull()
})

test('every step arrives whole — name, description and its questions', async () => {
  renderAt('/method')
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
  renderAt('/method')
  await screen.findByRole('main')
  expect(screen.getByText(/leads only to miscomprehension/)).toBeInTheDocument()
  expect(screen.getByText(/the Lord and His faithfulness/)).toBeInTheDocument()
})

test('the movement and the verse it comes from are both on the page', async () => {
  renderAt('/method')
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
    const links = screen.getAllByRole('link', { name: /method/i })
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(link).toHaveAttribute('href', '/method')
  }
})
