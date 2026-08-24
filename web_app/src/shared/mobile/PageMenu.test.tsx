/*
 * Intro and About are reachable from here on every screen that has one of
 * these sheets — which, on a phone, is nearly every screen, because a phone
 * hides the shell's own header (and the `InfoMenu` control that lives in it)
 * the moment a screen supplies its own app bar. This sheet is what a phone
 * actually has open at the moment `⋮` is pressed, so this is where "reachable
 * without an account" has to be true, not only in the header a phone never
 * shows.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { AuthProvider } from '../../auth/AuthContext.tsx'
import { PageMenu } from './PageMenu.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function mockFetch(authed: boolean) {
  return vi.fn((input: RequestInfo) => {
    const url = String(input)
    if (url.includes('/auth/me')) {
      return Promise.resolve(
        authed
          ? {
              ok: true,
              json: async () => ({
                id: 'u1',
                accountType: 'REGISTERED',
                email: 'ada@example.com',
                guestName: null,
                emailVerified: true,
              }),
            }
          : { ok: false, status: 401, json: async () => ({ error: 'Unauthenticated.' }) },
      )
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

function renderMenu() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Routes>
          <Route
            path="/"
            element={<PageMenu open onClose={() => {}} />}
          />
          <Route path="/intro" element={<p>The intro page</p>} />
          <Route path="/about" element={<p>The about page</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

test('Intro and About are in the sheet before anyone is signed in', async () => {
  vi.stubGlobal('fetch', mockFetch(false))
  renderMenu()

  expect(await screen.findByRole('button', { name: 'Intro' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'About' })).toBeInTheDocument()
})

test('Intro and About are in the sheet once somebody is signed in', async () => {
  vi.stubGlobal('fetch', mockFetch(true))
  renderMenu()

  expect(await screen.findByRole('button', { name: 'Intro' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'About' })).toBeInTheDocument()
})

test('Intro takes the sheet\'s own router to /intro and closes the sheet', async () => {
  vi.stubGlobal('fetch', mockFetch(false))
  renderMenu()

  fireEvent.click(await screen.findByRole('button', { name: 'Intro' }))
  expect(await screen.findByText('The intro page')).toBeInTheDocument()
})

test('About takes the sheet\'s own router to /about', async () => {
  vi.stubGlobal('fetch', mockFetch(false))
  renderMenu()

  fireEvent.click(await screen.findByRole('button', { name: 'About' }))
  expect(await screen.findByText('The about page')).toBeInTheDocument()
})
