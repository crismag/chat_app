/*
 * The Communities tab shows join requests to whoever the community said may
 * decide — not only owners. A community that opened approvals to members
 * would otherwise look as if nobody was waiting.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthContext.tsx'
import { CommunityPage } from './CommunityPage.tsx'

function mockFetch(options: {
  role?: 'owner' | 'admin' | 'member'
  approvalPolicy?: 'owner_admin' | 'members'
} = {}) {
  const role = options.role ?? 'member'
  const approvalPolicy = options.approvalPolicy ?? 'members'

  return vi.fn((input: RequestInfo, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()

    if (url.includes('/auth/me')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: 'u-member',
          accountType: 'REGISTERED',
          email: 'bob@example.com',
          guestName: null,
          emailVerified: true,
        }),
      } as Response)
    }

    if (url.includes('/join-requests') && method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ state: 'active' }),
      } as Response)
    }

    if (url.includes('/join-requests')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          requests: [
            {
              userId: 'u-asker',
              handle: 'cara',
              displayName: 'Cara',
              requestedAt: '2026-08-23T00:00:00.000Z',
            },
          ],
        }),
      } as Response)
    }

    if (url.includes('/communities')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          communities: [
            {
              id: 'c1',
              name: 'Sunday Leaders',
              description: 'A place for our Sunday team.',
              role,
              memberCount: 2,
              closed: false,
              settings: {
                discoverability: 'public',
                joinPolicy: 'approval',
                reflectionVisibility: 'members',
                approvalPolicy,
              },
            },
          ],
          invitations: [],
        }),
      } as Response)
    }

    if (url.includes('/publications')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ scope: 'shared', items: [], hashtags: [], reportReasons: [] }),
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

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <CommunityPage />
      </AuthProvider>
    </MemoryRouter>,
  )
}

test('a member sees join requests when the community lets any member approve', async () => {
  const fetchMock = mockFetch({ role: 'member', approvalPolicy: 'members' })
  vi.stubGlobal('fetch', fetchMock)
  renderPage()

  fireEvent.click(await screen.findByRole('tab', { name: 'Communities' }))
  expect(await screen.findByText(/any member may approve joins/)).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'One person is asking to join' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/communities/c1/join-requests/u-asker'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decision: 'approve' }),
      }),
    )
  })
})

test('a member does not see join requests when only owners and admins may decide', async () => {
  vi.stubGlobal('fetch', mockFetch({ role: 'member', approvalPolicy: 'owner_admin' }))
  renderPage()

  fireEvent.click(await screen.findByRole('tab', { name: 'Communities' }))
  expect(await screen.findByText('Sunday Leaders')).toBeInTheDocument()
  expect(screen.queryByText(/any member may approve joins/)).toBeNull()
  expect(screen.queryByRole('heading', { name: /asking to join/i })).toBeNull()
})
