import { render, screen } from '@testing-library/react'
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
    if (url.includes('/conversations') || url.includes('/community') || url.includes('/library')) {
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

afterEach(() => {
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

test('signed-in users land on a private conversation workspace with C.H.A.T. sections', async () => {
  vi.stubGlobal('fetch', mockAuthenticatedFetch())
  renderAt('/')
  expect(await screen.findByRole('heading', { name: 'Conversation' })).toBeInTheDocument()
  expect(screen.getByText('Context · Heart · Application · Testimony')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'C.H.A.T.' })).toBeInTheDocument()
  expect(screen.getAllByPlaceholderText('Leave empty unless you have expressed this')).toHaveLength(2)
})

test('library search is scoped to the owner', async () => {
  vi.stubGlobal('fetch', mockAuthenticatedFetch())
  renderAt('/library')
  expect(
    await screen.findByText(/Search only your private conversations and Scripture references/i),
  ).toBeInTheDocument()
})

test('community only describes explicitly published C.H.A.T.s', async () => {
  vi.stubGlobal('fetch', mockAuthenticatedFetch())
  renderAt('/community')
  expect(
    await screen.findByText(/Only C.H.A.T.s that someone explicitly published appear here/i),
  ).toBeInTheDocument()
})

test('create engine keeps text in the app', async () => {
  vi.stubGlobal('fetch', mockAuthenticatedFetch())
  renderAt('/create')
  expect(await screen.findByRole('heading', { name: 'Create' })).toBeInTheDocument()
  expect(screen.getByText(/Text is never sent to an image model/i)).toBeInTheDocument()
})
