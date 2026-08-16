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
     * Community answers with an object carrying the feed, the tag chips and
     * the report reasons — the shape that lets the page render chips it did
     * not invent. The reflection endpoints still answer with a list.
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
  /*
   * The passage is a field that is always there rather than a button pressed
   * once at the start: it can be filled in now, or long after the reflection
   * has been written.
   */
  expect(screen.getByLabelText('Scripture reference')).toBeEnabled()
  expect(screen.getByLabelText('Reflection title')).toBeInTheDocument()
})

/*
 * The rule the redesign exists to enforce. Four empty section cards beside an
 * empty conversation is the form we removed, so its absence is a test rather
 * than a convention.
 */
test('the four sections do not appear before anything has been written', async () => {
  vi.stubGlobal('fetch', mockAuthenticatedFetch())
  renderAt('/')
  expect(
    await screen.findByText('What passage are you reflecting on today?'),
  ).toBeInTheDocument()
  expect(screen.getByText(/C.H.A.T. takes shape as you write/i)).toBeInTheDocument()
  for (const name of ['Content', 'Heart', 'Application', 'Testimony']) {
    expect(screen.queryByRole('button', { name: new RegExp(`^${name} `) })).toBeNull()
  }
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

/*
 * An unknown URL used to render a blank white document — no header, no
 * navigation, no message, no way back.
 */
test('an unknown URL renders a way back rather than a blank page', async () => {
  vi.stubGlobal('fetch', mockAuthenticatedFetch())
  renderAt('/nope')

  expect(
    await screen.findByRole('heading', { name: /this page does not exist/i }),
  ).toBeInTheDocument()
  /* The shell survives the mistake, so the navigation is still there. */
  expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0)
  expect(screen.getByRole('link', { name: /go to reflect/i })).toBeInTheDocument()
})

test('create engine keeps text in the app', async () => {
  vi.stubGlobal('fetch', mockAuthenticatedFetch())
  renderAt('/create')
  expect(await screen.findByRole('heading', { name: 'Create an image' })).toBeInTheDocument()
  expect(screen.getByText(/never sent to an image model/i)).toBeInTheDocument()
})

test('open-source licences remain directly reachable without signing in', async () => {
  vi.stubGlobal('fetch', mockUnauthenticatedFetch())
  renderAt('/open-source-licenses')
  expect(await screen.findByRole('heading', { name: 'Open Source Licences' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Fabric.js' })).toBeInTheDocument()
})
