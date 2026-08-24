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
import { AuthProvider } from '../auth/AuthContext.tsx'
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

/*
 * The account and the profile are kept apart here on purpose.
 *
 * `emailVerified` belongs to `/auth/me` — the caller's own session — and is
 * never in the `/profiles/:handle` payload. Letting it into `view` would make
 * these tests pass against a server that had started publishing it, which is
 * the one thing the notice must not depend on.
 */
function mockFetch(
  overrides: Record<string, unknown> = {},
  account: { accountType?: string; emailVerified?: boolean; email?: string | null } = {},
) {
  const view = { ...profile, ...overrides }
  const signedIn = account.accountType ?? overrides.accountType
  return vi.fn((input: RequestInfo, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/auth/send-verification') && method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          message: 'If that address needs confirming, a link is on its way to it.',
        }),
      } as Response)
    }
    if (url.includes('/auth/me')) {
      if (signedIn === 'REGISTERED') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'u-visitor',
            accountType: 'REGISTERED',
            email: account.email === undefined ? 'ada@example.com' : account.email,
            guestName: null,
            emailVerified: account.emailVerified ?? true,
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthenticated.' }),
      } as Response)
    }
    if (url.includes('/auth/sessions')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ sessions: [] }),
      } as Response)
    }
    if (url.includes('/bible/translations')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ translations: [] }),
      } as Response)
    }
    if (url.includes('/preferences')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ preferences: {} }),
      } as Response)
    }
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

function renderProfile(entry = '/profile/cris') {
  /*
   * The page reads the signed-in account so the header face can follow an
   * edit, so it needs the provider the application gives it.
   */
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/profile/:handle" element={<ProfilePage />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
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
  expect(screen.queryByRole('button', { name: 'Message' })).toBeNull()
  view.unmount()
  cleanup()

  vi.stubGlobal('fetch', mockFetch({ isOwner: true }))
  renderProfile()
  expect(await screen.findByRole('button', { name: 'Edit profile' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Report profile' })).toBeNull()
})

test('an unconfirmed address is told so on its own profile, and can ask for the link again', async () => {
  const fetcher = mockFetch(
    { isOwner: true },
    { accountType: 'REGISTERED', emailVerified: false, email: 'ada@example.com' },
  )
  vi.stubGlobal('fetch', fetcher)
  renderProfile()

  expect(
    await screen.findByRole('heading', { name: 'Confirm your email address' }),
  ).toBeVisible()
  /* The address is shown, so a typo in it is something a person can notice. */
  expect(screen.getByText('ada@example.com')).toBeVisible()
  /* It says what is and is not affected, rather than only that something is wrong. */
  expect(screen.getByText(/writing privately/i)).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: 'Send the link again' }))
  await waitFor(() => expect(screen.getByText(/a link is on its way/i)).toBeVisible())

  const asked = fetcher.mock.calls.find(([input]) =>
    String(input).includes('/auth/send-verification'),
  )
  expect(asked).toBeDefined()
  expect(asked?.[1]?.method).toBe('POST')
})

test('a confirmed address is not asked to confirm anything', async () => {
  vi.stubGlobal(
    'fetch',
    mockFetch({ isOwner: true }, { accountType: 'REGISTERED', emailVerified: true }),
  )
  renderProfile()
  await screen.findByRole('button', { name: 'Edit profile' })

  expect(screen.queryByRole('heading', { name: 'Confirm your email address' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Send the link again' })).toBeNull()
})

test('a visitor is told nothing about whether this person confirmed their address', async () => {
  /*
   * The visitor is themselves unconfirmed, and looking at somebody else's
   * page. Neither fact may put the notice on screen: it is about the reader's
   * own account, and it belongs on their own profile only.
   */
  vi.stubGlobal(
    'fetch',
    mockFetch({ isOwner: false }, { accountType: 'REGISTERED', emailVerified: false }),
  )
  renderProfile()
  await screen.findByRole('heading', { level: 1, name: 'Cris Magalang' })

  expect(screen.queryByRole('heading', { name: 'Confirm your email address' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Send the link again' })).toBeNull()
})

test('a guest on their own page is not told to confirm an address they never gave', async () => {
  vi.stubGlobal('fetch', mockFetch({ isOwner: true }))
  renderProfile()
  await screen.findByRole('button', { name: 'Edit profile' })

  expect(screen.queryByRole('heading', { name: 'Confirm your email address' })).toBeNull()
})

test('a signed-in visitor can Message from a profile', async () => {
  vi.stubGlobal('fetch', mockFetch({ accountType: 'REGISTERED' }))
  renderProfile()
  expect(await screen.findByRole('button', { name: 'Message' })).toBeVisible()
})

test('reporting states that nothing is removed, and confirms afterwards', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderProfile()

  fireEvent.click(await screen.findByRole('button', { name: 'Report profile' }))
  expect(screen.getByText(/does not remove anything for other people/i)).toBeVisible()

  /*
   * "Submit report", as Community says it: one dialog reports both a
   * reflection and a profile, and the label came with it.
   */
  const send = screen.getByRole('button', { name: 'Submit report' })
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

test('a visitor gets no tab strip, because there is one thing to see', async () => {
  vi.stubGlobal('fetch', mockFetch({ isOwner: false }))
  renderProfile()

  await screen.findByRole('heading', { name: 'Cris Magalang' })
  expect(screen.queryByRole('navigation', { name: 'Profile sections' })).toBeNull()
  /* Their public shares are still right there, without needing a tab. */
  expect(screen.getByText('Trusting while I cannot see')).toBeVisible()
})

test('the owner gets the sections, and lands on their shares', async () => {
  vi.stubGlobal('fetch', mockFetch({ isOwner: true }))
  renderProfile()

  const tabs = await screen.findByRole('navigation', { name: 'Profile sections' })
  expect(tabs).toBeVisible()
  expect(screen.getByRole('link', { name: 'Shared' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByText('Trusting while I cannot see')).toBeVisible()
})

test('the open section comes from the URL, so it can be linked to', async () => {
  vi.stubGlobal('fetch', mockFetch({ isOwner: true }))
  renderProfile('/profile/cris?tab=profile')

  expect(await screen.findByRole('heading', { name: 'Favourite Scripture' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page')
})

test('a section this release does not have opens the page rather than breaking it', async () => {
  vi.stubGlobal('fetch', mockFetch({ isOwner: true }))
  renderProfile('/profile/cris?tab=trophies')

  /* A stale bookmark lands on the default section, not on an error. */
  expect(await screen.findByText('Trusting while I cannot see')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Shared' })).toHaveAttribute('aria-current', 'page')
})

test('a taken handle is said before the form is submitted, not after', async () => {
  const fetcher = mockFetch({ isOwner: true })
  vi.stubGlobal('fetch', (input: RequestInfo, init?: RequestInit) => {
    if (String(input).includes('handle-available')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          handle: 'taken',
          available: false,
          problem: 'The handle @taken is already taken. Please choose another.',
        }),
      } as Response)
    }
    return fetcher(input, init)
  })

  renderProfile()
  fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }))
  fireEvent.change(await screen.findByLabelText('Handle'), { target: { value: 'taken' } })

  /* Announced without stealing focus, and the field is marked invalid with it. */
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('The handle @taken is already taken.'),
  )
  expect(screen.getByLabelText('Handle')).toHaveAttribute('aria-invalid', 'true')
})

test('a free handle says so, and nothing is marked wrong', async () => {
  const fetcher = mockFetch({ isOwner: true })
  vi.stubGlobal('fetch', (input: RequestInfo, init?: RequestInit) => {
    if (String(input).includes('handle-available')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ handle: 'quietcedar', available: true, problem: null }),
      } as Response)
    }
    return fetcher(input, init)
  })

  renderProfile()
  fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }))
  fireEvent.change(await screen.findByLabelText('Handle'), { target: { value: 'quietcedar' } })

  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('@quietcedar is available.'),
  )
  expect(screen.getByLabelText('Handle')).not.toHaveAttribute('aria-invalid', 'true')
})

test("the owner's settings include import and export of their writing", async () => {
  vi.stubGlobal('fetch', mockFetch({ isOwner: true }))
  renderProfile('/profile/cris?tab=settings')

  expect(await screen.findByRole('heading', { name: 'Your writing' })).toBeVisible()
  expect(screen.getByRole('checkbox', { name: /Reflections/ })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: /Notes/ })).toBeChecked()
  expect(screen.getByRole('button', { name: 'Download JSON' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Download Markdown' })).toBeVisible()
})

test('a visitor does not see import or export on a profile', async () => {
  vi.stubGlobal('fetch', mockFetch({ isOwner: false }))
  renderProfile()
  await screen.findByRole('heading', { name: 'Cris Magalang' })
  expect(screen.queryByRole('heading', { name: 'Your writing' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Download JSON' })).toBeNull()
})
