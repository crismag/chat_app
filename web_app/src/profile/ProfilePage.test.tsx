/*
 * Profile page tests.
 *
 * Note what is *not* asserted here: that a private reflection is hidden. That
 * belongs to `api/src/profile/profile.test.ts`, where it is asserted against
 * the payload, because a rendering test would pass just as well against a
 * server that sent everything and a component that hid the wrong half. What is
 * asserted here is the other half of the brief — that the page shows a
 * portfolio and does not grow an empty social profile around it.
 */

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { ProfilePage } from './ProfilePage.tsx'

const profile = {
  handle: 'cris',
  displayName: 'Cris Magalang',
  tagline: 'Reading slowly, on purpose.',
  favouriteVerses: ['Romans 8:28', 'Psalm 46:10'],
  publicChatCount: 1,
  isOwner: false,
  blocked: false,
  reportReasons: [
    { id: 'spam', label: 'Spam or advertising' },
    { id: 'harassment', label: 'Harassment or hateful content' },
  ],
  shares: [
    {
      id: 's1',
      format: 'full',
      title: 'Trusting while I cannot see',
      scriptureReference: 'Romans 8:28',
      updatedAt: new Date().toISOString(),
      sections: ['heart', 'application'],
      excerpt: 'This passage met my fear that uncertainty means God has stopped working.',
    },
  ],
}

function mockFetch(overrides: Record<string, unknown> = {}) {
  const view = { ...profile, ...overrides }
  return vi.fn((input: RequestInfo, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/profiles/me')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          handle: view.handle,
          displayName: view.displayName,
          tagline: view.tagline,
          favouriteVerses: view.favouriteVerses,
          limits: {
            displayName: 50,
            handleMin: 3,
            handleMax: 30,
            tagline: 160,
            favouriteVerses: 3,
            favouriteVerseLength: 64,
          },
        }),
      } as Response)
    }
    if (url.includes('/report') && method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, message: 'Thank you. This profile has been reported.' }),
      } as Response)
    }
    return Promise.resolve({ ok: true, json: async () => view } as Response)
  })
}

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={['/profile/cris']}>
      <Routes>
        <Route path="/profile/:handle" element={<ProfilePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('reads as a portfolio: identity, favourite Scripture and the shared work', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderProfile()

  expect(await screen.findByRole('heading', { level: 1, name: 'Cris Magalang' })).toBeVisible()
  expect(screen.getByText('@cris')).toBeVisible()
  expect(screen.getByText('Reading slowly, on purpose.')).toBeVisible()
  expect(screen.getByText('Romans 8:28', { selector: 'li' })).toBeVisible()
  expect(screen.getByText('1 public C.H.A.T.')).toBeVisible()
  expect(screen.getByRole('heading', { level: 2, name: 'Shares' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Trusting while I cannot see' })).toBeVisible()
})

test('shows no tabs and no follower or following counts', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderProfile()
  await screen.findByRole('heading', { level: 1, name: 'Cris Magalang' })

  /* The brief forbids empty future tabs by name. */
  expect(screen.queryAllByRole('tab')).toHaveLength(0)
  for (const forbidden of [
    /followers/i,
    /following/i,
    /activity/i,
    /likes/i,
    /encouraged/i,
    /subscriptions/i,
    /communities/i,
    /notes/i,
  ]) {
    expect(screen.queryByText(forbidden)).toBeNull()
  }
})

test('has no disabled controls anywhere on the page', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderProfile()
  await screen.findByRole('heading', { level: 1, name: 'Cris Magalang' })

  for (const button of screen.getAllByRole('button')) {
    expect(button).toBeEnabled()
  }
})

test("offers Report and Block on someone else's profile, and Edit on one's own", async () => {
  vi.stubGlobal('fetch', mockFetch())
  const view = renderProfile()
  await screen.findByRole('button', { name: 'Report profile' })
  expect(screen.getByRole('button', { name: 'Block user' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Edit profile' })).toBeNull()
  view.unmount()
  cleanup()

  vi.stubGlobal('fetch', mockFetch({ isOwner: true }))
  renderProfile()
  expect(await screen.findByRole('button', { name: 'Edit profile' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Report profile' })).toBeNull()
})

test('reporting states that nothing is removed, and confirms afterwards', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderProfile()

  fireEvent.click(await screen.findByRole('button', { name: 'Report profile' }))
  expect(screen.getByText(/does not remove anything for other people/i)).toBeVisible()

  /* A reason is required, so the submit is unavailable until one is chosen. */
  const send = screen.getByRole('button', { name: 'Send report' })
  expect(send).toBeDisabled()
  fireEvent.click(screen.getByLabelText('Spam or advertising'))
  expect(send).toBeEnabled()

  fireEvent.click(send)
  await waitFor(() =>
    expect(screen.getByText(/has been reported/i)).toBeInTheDocument(),
  )
})

test("the owner's editor shows the server's limits and enforces them in the field", async () => {
  vi.stubGlobal('fetch', mockFetch({ isOwner: true }))
  renderProfile()

  fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }))
  const name = await screen.findByLabelText('Display name')
  expect(name).toHaveAttribute('maxlength', '50')
  expect(screen.getByLabelText('Handle')).toHaveAttribute('maxlength', '30')
  expect(screen.getByLabelText('Tagline')).toHaveAttribute('maxlength', '160')
  /* Exactly three verse fields — the limit, expressed as the form's shape. */
  expect(screen.getAllByLabelText(/Favourite Scripture reference/)).toHaveLength(3)
})

test('a taken handle is reported in words, beside the field it belongs to', async () => {
  const fetcher = mockFetch({ isOwner: true })
  vi.stubGlobal('fetch', (input: RequestInfo, init?: RequestInit) => {
    if (String(input).includes('/profiles/me') && init?.method === 'PATCH') {
      return Promise.resolve({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({
          error: 'The handle @taken is already taken. Please choose another.',
          field: 'handle',
        }),
      } as Response)
    }
    return fetcher(input, init)
  })

  renderProfile()
  fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }))
  const handle = await screen.findByLabelText('Handle')
  fireEvent.change(handle, { target: { value: 'taken' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('The handle @taken is already taken. Please choose another.')
  expect(screen.getByLabelText('Handle')).toHaveAttribute('aria-invalid', 'true')
})

test('an empty profile invites sharing rather than showing an empty grid', async () => {
  vi.stubGlobal('fetch', mockFetch({ isOwner: true, shares: [], publicChatCount: 0 }))
  renderProfile()

  expect(await screen.findByText('You have not shared a C.H.A.T. yet')).toBeVisible()
  expect(screen.getByText('0 public C.H.A.T.s')).toBeVisible()
})

test('a blocked profile shows nothing of the person and offers an undo', async () => {
  vi.stubGlobal(
    'fetch',
    mockFetch({ blocked: true, shares: [], publicChatCount: null, tagline: '' }),
  )
  renderProfile()

  expect(await screen.findByText('You blocked this person')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Unblock @cris' })).toBeVisible()
  expect(screen.queryByRole('heading', { name: 'Shares' })).toBeNull()
})

test('member since names the month the person joined, not the one before it', async () => {
  /*
   * The API sends a bare YYYY-MM. Parsing that as UTC and formatting it in a
   * behind-UTC zone slides the label back a month, so 2026-08 read "July 2026".
   */
  vi.stubGlobal('fetch', mockFetch({ isOwner: true, memberSince: '2026-08' }))
  renderProfile()

  expect(await screen.findByText('Here since August 2026')).toBeVisible()
})
