/*
 * Community management — what the owner is offered, and what a member is not.
 *
 * The API tests already prove who may change a role. This file asserts the
 * other half: that the person who started a community can find the controls
 * to look after it, identify someone, and hand ownership on — and that an
 * ordinary member is not shown those controls as disabled placeholders.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthContext.tsx'
import { CommunityManagePage } from './CommunityManagePage.tsx'
import type { CommunityDetail, CommunityMember } from './api.ts'

const community: CommunityDetail = {
  id: 'c1',
  name: 'Sunday Leaders',
  description: 'A place for our Sunday team.',
  role: 'owner',
  memberCount: 2,
  ownerCount: 1,
  closed: false,
  muted: false,
  settings: {
    discoverability: 'public',
    joinPolicy: 'approval',
    reflectionVisibility: 'members',
    approvalPolicy: 'owner_admin',
  },
}

const members: CommunityMember[] = [
  {
    userId: 'u-owner',
    handle: 'ada',
    displayName: 'Ada',
    role: 'owner',
    state: 'active',
    muted: false,
  },
  {
    userId: 'u-member',
    handle: 'bob',
    displayName: 'Bob',
    role: 'member',
    state: 'active',
    muted: false,
  },
]

function mockFetch(options: {
  community?: CommunityDetail
  members?: CommunityMember[]
  me?: { id: string }
} = {}) {
  const view = options.community ?? community
  const roster = options.members ?? members
  const me = options.me ?? { id: 'u-owner' }

  return vi.fn((input: RequestInfo, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()

    if (url.includes('/auth/me')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: me.id,
          accountType: 'REGISTERED',
          email: 'ada@example.com',
          guestName: null,
          emailVerified: true,
        }),
      } as Response)
    }

    if (url.includes('/owners') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        userId?: string
        stepDown?: boolean
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          userId: body.userId ?? 'u-member',
          role: 'owner',
          state: 'active',
          invited: false,
          steppedDown: Boolean(body.stepDown),
        }),
      } as Response)
    }

    if (url.includes('/members/') && method === 'PATCH') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, role: 'admin', state: 'active' }),
      } as Response)
    }

    if (url.includes('/invitations') && method === 'POST') {
      return Promise.resolve({
        ok: true,
        status: 201,
        json: async () => ({ ok: true }),
      } as Response)
    }

    if (url.includes('/join-requests')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ requests: [] }),
      } as Response)
    }

    if (url.includes('/members')) {
      return Promise.resolve({
        ok: true,
        json: async () => roster,
      } as Response)
    }

    if (url.includes('/communities/') && method === 'PATCH' && !url.includes('/settings')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { name?: string }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...view, name: body.name ?? view.name }),
      } as Response)
    }

    if (url.includes('/communities/')) {
      return Promise.resolve({
        ok: true,
        json: async () => view,
      } as Response)
    }

    return Promise.resolve({
      ok: true,
      json: async () => ({}),
    } as Response)
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderManage(path = '/community/c1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/community/:id" element={<CommunityManagePage />} />
          <Route path="/community" element={<p>Community list</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

test('an owner can manage the community they started, including the people in it', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderManage()

  expect(await screen.findByRole('heading', { name: 'Manage Sunday Leaders' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Community details' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'How this community works' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'People' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Delegate ownership' })).toBeInTheDocument()
  expect(screen.getByText('Bob')).toBeInTheDocument()
  expect(screen.getByLabelText('Role for Bob')).toBeInTheDocument()
})

test('a member sees who is here, not settings or ownership controls', async () => {
  vi.stubGlobal(
    'fetch',
    mockFetch({
      community: { ...community, role: 'member', ownerCount: 1 },
      me: { id: 'u-member' },
    }),
  )
  renderManage()

  expect(await screen.findByRole('heading', { name: 'Sunday Leaders' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Community details' })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'How this community works' })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Delegate ownership' })).toBeNull()
  expect(screen.queryByLabelText('Role for Ada')).toBeNull()
  expect(screen.getByRole('button', { name: 'Leave this community' })).toBeInTheDocument()
})

test('the owner can identify a member and add them as an owner', async () => {
  const fetchMock = mockFetch()
  vi.stubGlobal('fetch', fetchMock)
  renderManage()

  await screen.findByRole('heading', { name: 'Delegate ownership' })
  fireEvent.change(screen.getByLabelText('Who should be an owner?'), {
    target: { value: '@bob' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add as owner' }))

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/communities/c1/owners'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ userId: 'u-member', stepDown: false }),
      }),
    )
  })
  expect(await screen.findByText('They are now an owner of this community.')).toBeInTheDocument()
})

test('finding a person filters the roster by name or handle', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderManage()

  await screen.findByText('Bob')
  fireEvent.change(screen.getByLabelText('Find a member by name or handle'), {
    target: { value: 'ada' },
  })
  expect(screen.getByText('Ada (you)')).toBeInTheDocument()
  expect(screen.queryByText('Bob')).toBeNull()
})
