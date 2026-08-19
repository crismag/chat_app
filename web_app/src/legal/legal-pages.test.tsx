/*
 * The properties these pages have to hold.
 *
 * They are read by people deciding whether to sign up at all, and by a
 * platform reviewer checking the URLs before approving sign-in with Google,
 * Facebook or Apple. Behind the login they would be published in name only —
 * and the failure is silent, because a signed-in developer never sees it.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { App } from '../app/App.tsx'
import { LEGAL_PAGES } from './pages.ts'
import { Markdown, parseDocument } from './markdown.tsx'

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

test.each(LEGAL_PAGES.map((page) => [page.slug, page.label]))(
  '/%s is readable without signing in',
  async (slug) => {
    renderAt(`/${slug}`)
    expect(await screen.findByRole('main')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull()
  },
)

test('About is where the documents are linked, and needs no account either', async () => {
  renderAt('/about')
  expect(await screen.findByRole('heading', { name: 'About Reflections' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull()
  for (const { slug, label } of LEGAL_PAGES) {
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', `/${slug}`)
  }
})

test('every document links to the others, so none is a dead end', async () => {
  renderAt('/privacy')
  const nav = within(await screen.findByRole('navigation', { name: 'Policies' }))
  for (const { slug, label } of LEGAL_PAGES.filter((p) => p.slug !== 'privacy')) {
    expect(nav.getByRole('link', { name: label })).toHaveAttribute('href', `/${slug}`)
  }
  expect(nav.getByRole('link', { name: 'Back to Reflections' })).toHaveAttribute('href', '/')
})

test('the document supplies its own title and date, so the page cannot contradict it', async () => {
  renderAt('/privacy')
  expect(await screen.findByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument()
  expect(screen.getByText(/Last updated August 19, 2026/)).toBeInTheDocument()
  /* And the body actually rendered, rather than the page being a shell. */
  expect(screen.getByRole('heading', { level: 2, name: /^8\. .*Sell Your Personal Information/i })).toBeInTheDocument()
})

/*
 * Every document is finished now, so this asserts that rather than asserting
 * that an unfinished one admits it — which is what it used to do, back when
 * there was one to point at.
 *
 * It is the more useful assertion anyway: it fails the moment a blank is
 * reintroduced, wherever it is, instead of watching one known page.
 */
test('no document still has a blank in it', () => {
  for (const { label, markdown } of LEGAL_PAGES) {
    const blanks = parseDocument(markdown!).placeholders
    expect(blanks, `${label} still has ${blanks.join(', ')}`).toEqual([])
  }
})

test('and none of them shows the unfinished notice', async () => {
  for (const { slug, label } of LEGAL_PAGES) {
    cleanup()
    renderAt(`/${slug}`)
    await screen.findByRole('main')
    expect(screen.queryByRole('status'), `${label} shows a notice`).toBeNull()
  }
})

/*
 * The notice itself still works, and is tested on text written for the purpose
 * rather than on a real document. That way filling in the last blank could not
 * quietly delete the guard along with its last example.
 */
test('a document that did have a blank would say so', () => {
  const parsed = parseDocument('# Draft\n\nOperator: **[Legal name]**\n')
  expect(parsed.placeholders).toEqual(['Legal name'])
})

test('every page has a document now, and each one renders it', async () => {
  for (const { slug } of LEGAL_PAGES) {
    expect(LEGAL_PAGES.find((p) => p.slug === slug)!.markdown).toBeTruthy()
  }
  renderAt('/support')
  expect(await screen.findByRole('heading', { level: 1, name: 'Support' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /Found a Bug/i })).toBeInTheDocument()
})

/*
 * Support is the page a reader is sent to when something is already wrong, so
 * the way back to the others has to be on it.
 */
test('support reaches the policies it refers to', async () => {
  renderAt('/support')
  const nav = within(await screen.findByRole('navigation', { name: 'Policies' }))
  expect(nav.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
  expect(nav.getByRole('link', { name: 'Data Deletion' })).toHaveAttribute('href', '/data-deletion')
})

describe('the renderer', () => {
  test('reads the title and date out of the file and leaves them out of the body', () => {
    const parsed = parseDocument('# Terms\n\n**Last updated: August 19, 2026**\n\n---\n\nFirst line.\n')
    expect(parsed.title).toBe('Terms')
    expect(parsed.updated).toBe('August 19, 2026')
    expect(parsed.body).toContain('First line.')
    expect(parsed.body).not.toContain('Last updated')
  })

  /*
   * Section 17 of the Privacy Policy turns on an escaped asterisk — a policy
   * growing a footnote that says "except for money". Rendered literally, the
   * joke becomes stray syntax.
   */
  test('an escaped asterisk is an asterisk, not markup', () => {
    render(<Markdown markdown={'*\\* except for money*'} />)
    expect(screen.getByText('* except for money')).toBeInTheDocument()
  })

  test('a hard line break is kept, so an address does not become a sentence', () => {
    const { container } = render(<Markdown markdown={'Reflections  \nreflections.crishub.com'} />)
    expect(container.querySelectorAll('br')).toHaveLength(1)
  })

  test('finds the blanks, and finds nothing when there are none', () => {
    expect(parseDocument('Operator: **[Legal/business name]**').placeholders).toEqual([
      'Legal/business name',
    ])
    expect(parseDocument('Operator: **Someone Real**').placeholders).toEqual([])
  })
})

/*
 * The front door, and the reason it exists: one address from which every other
 * page can be reached, by somebody with no account — a reader deciding whether
 * to use this, or a reviewer checking what it claims before approving a
 * sign-in provider.
 */
describe('the welcome page', () => {
  test('carries the banner, the four letters, and a way in', () => {
    renderAt('/welcome')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('C.H.A.T.')
    for (const word of ['Content', 'Heart', 'Application', 'Testimony']) {
      expect(screen.getByText(word)).toBeInTheDocument()
    }
    /* Straight into writing, not into a sign-up form. */
    expect(screen.getByRole('link', { name: 'Start writing' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })

  test('links to every document, About and the licences', () => {
    renderAt('/welcome')
    for (const path of ['/about', '/privacy', '/terms', '/disclaimer', '/data-deletion', '/support', '/open-source-licenses']) {
      expect(
        screen.getAllByRole('link').some((link) => link.getAttribute('href') === path),
      ).toBe(true)
    }
  })

  test('needs no account, like the documents it links to', () => {
    renderAt('/welcome')
    /*
     * Outside the application shell: no navigation, no account menu, nothing
     * that asks who is reading it. A page a reviewer has to sign in to reach
     * is a page they will report as unreachable.
     */
    expect(screen.queryByRole('button', { name: /New reflection/i })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Reflections' })).toBeNull()
  })
})
