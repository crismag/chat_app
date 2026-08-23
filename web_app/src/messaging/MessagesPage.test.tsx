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
  isContact: false,
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
    if (url.includes('/messaging/people')) {
      const query = new URL(url, 'http://localhost').searchParams.get('q') ?? ''
      /* The server answers nothing below two characters; the box does not decide. */
      const items =
        query.length >= 2 && 'grace hopper quietcedar'.includes(query.toLowerCase())
          ? [{ id: 'u2', handle: 'quietcedar', displayName: 'Grace Hopper', avatarUrl: null }]
          : []
      return Promise.resolve({ ok: true, json: async () => ({ items }) })
    }
    if (url.includes('/messaging/open') && method === 'POST') {
      return Promise.resolve({ ok: true, json: async () => ({ thread: { ...thread, id: 't1' } }) })
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

test('somebody can be found and written to without leaving the page', async () => {
  const fetcher = mockFetch()
  vi.stubGlobal('fetch', fetcher)
  renderMessages()

  const box = await screen.findByLabelText('Start a conversation')
  fireEvent.change(box, { target: { value: 'grace' } })

  /*
   * Messaging arrived with one way in — a button on somebody else's profile —
   * and nothing in the application links to another person's profile. This is
   * the way in.
   */
  const result = await screen.findByRole('button', { name: /Grace Hopper/ })
  fireEvent.click(result)

  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        ([input, init]) =>
          String(input).includes('/messaging/open') && (init?.method ?? '') === 'POST',
      ),
    ).toBe(true),
  )
})

test('one letter asks for nothing and says so', async () => {
  const fetcher = mockFetch()
  vi.stubGlobal('fetch', fetcher)
  renderMessages()

  const box = await screen.findByLabelText('Start a conversation')
  fireEvent.change(box, { target: { value: 'g' } })

  expect(await screen.findByText(/two letters or more/i)).toBeVisible()
  /* And nothing was asked of the server for a single character. */
  await waitFor(() =>
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes('/messaging/people'))).toHaveLength(0),
  )
})

test('a name nobody answers to says so, rather than showing an empty box', async () => {
  vi.stubGlobal('fetch', mockFetch())
  renderMessages()

  fireEvent.change(await screen.findByLabelText('Start a conversation'), {
    target: { value: 'nobodyhere' },
  })

  expect(await screen.findByText(/Nobody by that name is taking messages/i)).toBeVisible()
})
