import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthContext.tsx'
import { MessagesPage } from './MessagesPage.tsx'
import type { MessagingThread } from './api.ts'

const thread: MessagingThread = {
  id: 't1',
  kind: 'direct',
  other: { id: 'u2', handle: 'bea', displayName: 'Bea', avatarUrl: null },
  lastMessage: {
    id: 'm1',
    threadId: 't1',
    senderUserId: 'u2',
    body: 'Hello there',
    createdAt: new Date().toISOString(),
  },
  unreadCount: 1,
  pendingIncomingRequestId: null,
  updatedAt: new Date().toISOString(),
}

function mockFetch() {
  return vi.fn((input: RequestInfo, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/auth/me')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: 'u1',
          accountType: 'REGISTERED',
          email: 'ada@example.com',
          guestName: null,
          emailVerified: true,
        }),
      })
    }
    if (url.includes('/messaging/threads/t1/messages')) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [thread.lastMessage] }) })
    }
    if (url.includes('/messaging/threads/t1') && method === 'GET') {
      return Promise.resolve({ ok: true, json: async () => thread })
    }
    if (url.includes('/messaging/threads')) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [thread] }) })
    }
    if (url.includes('/messaging/requests')) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [] }) })
    }
    if (url.includes('/messaging/contacts')) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [] }) })
    }
    if (url.includes('/messaging/preferences')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ allowNonContactRequests: true, updatedAt: thread.updatedAt }),
      })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

function renderMessages(path = '/messages') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/messages/:threadId" element={<MessagesPage />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('lists chats with a preview, and does not say "No posts"', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderMessages()
  expect(await screen.findByRole('heading', { name: 'Messages' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Chats' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Requests' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Contacts' })).toBeInTheDocument()
  expect(await screen.findByText('Bea')).toBeInTheDocument()
  expect(screen.getByText('Hello there')).toBeInTheDocument()
  expect(screen.queryByText(/no posts/i)).toBeNull()
})

test('the requests empty state is written in plain language', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderMessages()
  fireEvent.click(await screen.findByRole('tab', { name: 'Requests' }))
  expect(await screen.findByRole('heading', { name: 'No message requests' })).toBeInTheDocument()
})

test('opening a chat shows the conversation', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderMessages()
  fireEvent.click(await screen.findByRole('button', { name: /Bea/ }))
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Bea' })).toBeInTheDocument()
  })
})
