/*
 * The one property these pages have to hold: they are readable by someone with
 * no account.
 *
 * A privacy policy, terms, a deletion route and a support contact are read by
 * people deciding whether to sign up at all, and by a platform reviewer
 * checking the URLs before approving sign-in with Google, Facebook or Apple.
 * Behind the login they would be published in name only — and the failure is
 * silent, because a signed-in developer never sees it.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { App } from '../app/App.tsx'
import { LEGAL_PAGES } from './pages.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Signed out: /auth/me refuses, exactly as it does for a stranger. */
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

test.each(LEGAL_PAGES.map((page) => [page.slug, page.title]))(
  '/%s is readable without signing in',
  async (slug, title) => {
    renderAt(`/${slug}`)
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull()
  },
)

test('About is readable without signing in, and is where the documents are linked', async () => {
  renderAt('/about')
  expect(await screen.findByRole('heading', { name: 'About C.H.A.T.' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull()

  for (const { slug, title } of LEGAL_PAGES) {
    expect(screen.getByRole('link', { name: title })).toHaveAttribute('href', `/${slug}`)
  }
})

/*
 * Until the wording arrives these pages must not read as policy. The notice is
 * what stops an empty page being mistaken for a published one.
 */
test('a document with no text says so rather than looking finished', async () => {
  renderAt('/privacy')
  await screen.findByRole('heading', { name: 'Privacy Policy' })
  expect(screen.getByRole('status')).toHaveTextContent(/has not been written yet/i)
})
