import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { App } from './App.tsx'

const healthPayload = {
  status: 'ok',
  service: 'chat-api',
  timestamp: '2026-01-01T00:00:00.000Z',
}

function mockUnauthenticatedFetch() {
  return vi.fn((input: RequestInfo) => {
    const url = String(input)
    if (url.includes('/auth/me')) {
      return Promise.resolve({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthenticated.' }),
      })
    }
    /*
     * Community answers with an object carrying the feed, the tag chips and
     * the report reasons — the shape that lets the page render chips it did
     * not invent. The reflection endpoints still answer with a list.
     */
    return Promise.resolve({
      ok: true,
      json: async () => healthPayload,
    })
  })
}

function mockAuthenticatedFetch() {
  return vi.fn((input: RequestInfo) => {
    const url = String(input)
    if (url.includes('/auth/me')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ id: 'u1', email: 'ada@example.com' }),
      })
    }
    /*
     * Community answers with an object carrying the feed, its tag chips and
     * the report reasons — the shape that lets the page render chips it did
     * not invent. Both are matched before the looser `/community` test below,
     * which would otherwise swallow `/communities` and hand it a bare list.
     */
    if (url.includes('/publications')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ scope: 'shared', items: [], hashtags: [], reportReasons: [] }),
      })
    }
    if (url.includes('/communities')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ communities: [], invitations: [] }),
      })
    }
    if (url.includes('/bible/translations')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ translations: [], defaultTranslationId: null }),
      })
    }
    if (url.includes('/passage')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ passage: null }),
      })
    }
    if (
      url.includes('/conversations') ||
      url.includes('/community') ||
      url.includes('/reflections') ||
      url.includes('/library')
    ) {
      return Promise.resolve({
        ok: true,
        json: async () => [],
      })
    }
    return Promise.resolve({
      ok: true,
      json: async () => healthPayload,
    })
  })
}

/*
 * Vitest runs without `globals`, so Testing Library never registers its own
 * automatic cleanup — one render leaks into the next test and duplicate matches
 * look like application bugs. Unmounting explicitly keeps each test honest.
 */
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

test('unauthenticated visitors are asked to sign in', async () => {
  vi.stubGlobal('fetch', mockUnauthenticatedFetch())
  renderAt('/')
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  expect(screen.getByText(/private unless you explicitly publish/i)).toBeInTheDocument()
})

test('Reflect opens on a question, and can be written in immediately', async () => {
  vi.stubGlobal('fetch', mockAuthenticatedFetch())
  renderAt('/')
  expect(
    await screen.findByText('What passage are you reflecting on today?'),
  ).toBeInTheDocument()
  expect(screen.getByText('Content · Heart · Application · Testimony')).toBeInTheDocument()
  // No title form stands between someone and their first sentence.
  expect(screen.getByLabelText('Write your reflection')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add Bible passage' })).toBeInTheDocument()
  expect(screen.getByLabelText('Reflection title')).toBeEnabled()
})

/*
 * The rule the redesign exists to enforce. Four empty section cards beside an
 * empty conversation is the form we removed, so its absence is a test rather
 * than a convention.
 */
test('the four C.H.A.T. sections are writable on a brand-new reflection', async () => {
  vi.stubGlobal('fetch', mockAuthenticatedFetch())
  renderAt('/')
  expect(await screen.findByRole('heading', { name: /content/i })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /heart/i })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /application/i })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /testimony/i })).toBeInTheDocument()
  expect(screen.queryByText(/C.H.A.T. takes shape as you write/i)).toBeNull()
  expect(screen.getByLabelText('Reflection title')).toBeEnabled()
})

test('the header carries one account menu, not an email and a status line', async () => {
  vi.stubGlobal('fetch', mockAuthenticatedFetch())
  renderAt('/')
  const trigger = await screen.findByRole('button', {
    name: /Account menu for ada@example.com/i,
  })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('API connected')).toBeNull()
  // The sidebar offers one too, so this asks specifically for the shell's.
  expect(
    within(screen.getByRole('banner')).getByRole('button', { name: 'New reflection' }),
  ).toBeInTheDocument()
})

/*
 * Route wiring only. What the Reflections page says about itself is that page's
 * own test to make; this one fails if the route stops resolving.
 */
test('the Reflections route replaces Library, and /library still resolves', async () => {
  vi.stubGlobal('fetch', mockAuthenticatedFetch())
  renderAt('/library')
  expect(await screen.findByRole('heading', { name: 'Reflections' })).toBeInTheDocument()
})

/*
 * The destinations are named honestly — Shared and Public describe the content,
 * where "For You" would claim a personalisation that does not exist. There is
 * no fourth tab, and none of the three is a disabled placeholder.
 */
test('community offers Shared, Public and Communities, and nothing it cannot do', async () => {
  vi.stubGlobal('fetch', mockAuthenticatedFetch())
  renderAt('/community')

  const tabs = await screen.findAllByRole('tab')
  expect(tabs.map((tab) => tab.textContent)).toEqual(['Shared', 'Public', 'Communities'])
  expect(screen.queryByText(/for you/i)).not.toBeInTheDocument()
  expect(tabs.every((tab) => !tab.hasAttribute('disabled'))).toBe(true)
})

/*
 * An empty feed says what the space is for. "No posts." is what this replaced.
 */
test('an empty Community is written, not blank', async () => {
  vi.stubGlobal('fetch', mockAuthenticatedFetch())
  renderAt('/community')

  expect(
    await screen.findByRole('heading', { name: /nothing has been shared with you yet/i }),
  ).toBeInTheDocument()
  expect(screen.queryByText(/^no posts\.?$/i)).not.toBeInTheDocument()
})

test('create engine keeps text in the app', async () => {
  vi.stubGlobal('fetch', mockAuthenticatedFetch())
  renderAt('/create')
  expect(await screen.findByRole('heading', { name: 'Create an image' })).toBeInTheDocument()
  expect(screen.getByText(/never sent to an image model/i)).toBeInTheDocument()
})

test('an unknown address keeps the shell and explains itself', async () => {
  vi.stubGlobal('fetch', mockAuthenticatedFetch())
  renderAt('/nope')
  expect(await screen.findByRole('heading', { name: 'This page is not in C.H.A.T.' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to Reflect' })).toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: 'Primary desktop' })).toBeInTheDocument()
})

test('Community is in the primary navigation once a shared entry can be opened', async () => {
  vi.stubGlobal('fetch', mockAuthenticatedFetch())
  renderAt('/')
  const desktop = await screen.findByRole('navigation', { name: 'Primary desktop' })
  expect(within(desktop).getByRole('link', { name: 'Community' })).toHaveAttribute(
    'href',
    '/community',
  )
})

test('open-source licences remain directly reachable without signing in', async () => {
  vi.stubGlobal('fetch', mockUnauthenticatedFetch())
  renderAt('/open-source-licenses')
  expect(await screen.findByRole('heading', { name: 'Open Source Licences' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Fabric.js' })).toBeInTheDocument()
})
