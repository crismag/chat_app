import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { DevicesSection, describeDevice } from './DevicesSection.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const session = (over: Partial<Parameters<typeof describeDevice>[0]> = {}) => ({
  id: 'a1',
  current: false,
  sessionType: 'REGISTERED_PERSISTENT',
  createdAt: '2026-08-01T10:00:00.000Z',
  lastSeenAt: '2026-08-20T10:00:00.000Z',
  platform: 'web',
  deviceClass: 'phone',
  browserFamily: 'Firefox',
  osFamily: 'Android',
  ...over,
})

function withSessions(sessions: unknown[]) {
  const fetchMock = vi.fn((_input: RequestInfo, init?: RequestInit) => {
    if ((init?.method ?? 'GET') !== 'GET') {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) } as Response)
    }
    return Promise.resolve({ ok: true, json: async () => ({ sessions }) } as Response)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

test('a device is named from what was recorded, and never invented', () => {
  expect(describeDevice(session())).toBe('Firefox on Android')
  expect(describeDevice(session({ browserFamily: null, osFamily: null }))).toBe('phone')
  expect(
    describeDevice(session({ browserFamily: null, osFamily: null, deviceClass: null })),
  ).toBe('web')
  expect(
    describeDevice(
      session({ browserFamily: null, osFamily: null, deviceClass: null, platform: null }),
    ),
  ).toBe('Unknown device')
})

test('this device is marked and cannot be signed out from the list', async () => {
  withSessions([session({ id: 'here', current: true })])
  render(<DevicesSection />)

  expect(await screen.findByText(/This device/)).toBeVisible()
  /* Signing yourself out belongs to the account menu, not to a row in a list. */
  expect(screen.queryByRole('button', { name: /Sign out/ })).toBeNull()
})

test('another device can be signed out, and the list is re-read afterwards', async () => {
  const fetchMock = withSessions([
    session({ id: 'here', current: true }),
    session({ id: 'other', browserFamily: 'Safari', osFamily: 'iOS' }),
  ])
  render(<DevicesSection />)

  fireEvent.click(await screen.findByRole('button', { name: /Sign out Safari on iOS/ }))

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/sessions/other',
      expect.objectContaining({ method: 'DELETE' }),
    ),
  )
})

test('sign out everywhere else appears only when there is somewhere else', async () => {
  withSessions([session({ id: 'here', current: true })])
  const { unmount } = render(<DevicesSection />)
  await screen.findByText(/This device/)
  expect(screen.queryByRole('button', { name: 'Sign out everywhere else' })).toBeNull()
  unmount()

  withSessions([session({ id: 'here', current: true }), session({ id: 'other' })])
  render(<DevicesSection />)
  expect(
    await screen.findByRole('button', { name: 'Sign out everywhere else' }),
  ).toBeVisible()
})

test('a failure is reported rather than silently leaving a device signed in', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((_input: RequestInfo, init?: RequestInit) => {
      if ((init?.method ?? 'GET') !== 'GET') {
        return Promise.resolve({ ok: false, json: async () => ({ error: 'no' }) } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ sessions: [session({ id: 'other' })] }),
      } as Response)
    }),
  )
  render(<DevicesSection />)

  fireEvent.click(await screen.findByRole('button', { name: /Sign out Firefox on Android/ }))

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'That device could not be signed out.',
  )
})
