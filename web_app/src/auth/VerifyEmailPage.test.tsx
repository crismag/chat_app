/*
 * The page a confirmation link lands on.
 *
 * Two things matter here: the token is spent once however the component
 * renders, and the server's sentence is shown as written — unknown, expired
 * and already-used are deliberately one message, and rewording it in the
 * browser is how that protection would quietly be lost.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import { VerifyEmailPage } from './VerifyEmailPage.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

test('a good link confirms the address and says what it changed', async () => {
  const fetcher = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: async () => ({ verified: true, message: 'Your email address is confirmed.' }),
    } as Response),
  )
  vi.stubGlobal('fetch', fetcher)

  renderAt('/verify-email?token=a-real-token')

  expect(await screen.findByText('Your email address is confirmed.')).toBeVisible()
  expect(screen.getByText(/share reflections with other people/i)).toBeVisible()
})

test('the token is spent once, however the component renders', async () => {
  const fetcher = vi.fn(() =>
    Promise.resolve({ ok: true, json: async () => ({ message: 'Confirmed.' }) } as Response),
  )
  vi.stubGlobal('fetch', fetcher)

  const { rerender } = renderAt('/verify-email?token=a-real-token')
  rerender(
    <MemoryRouter initialEntries={['/verify-email?token=a-real-token']}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmailPage />} />
      </Routes>
    </MemoryRouter>,
  )

  await screen.findByText('Confirmed.')
  /*
   * A second spend would turn a working link into "no longer valid", which
   * from the outside looks exactly like the link having failed.
   */
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
})

test("a refused link shows the server's sentence, unchanged", async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'That link is no longer valid. Ask for a new one from your account.',
        }),
      } as Response),
    ),
  )

  renderAt('/verify-email?token=spent')

  expect(
    await screen.findByText('That link is no longer valid. Ask for a new one from your account.'),
  ).toBeVisible()
  /* No claim about which of unknown, expired or used it was. */
  expect(screen.queryByText(/expired|already used|unknown/i)).toBeNull()
})

test('a link with no code says so without asking the server', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)

  renderAt('/verify-email')

  expect(await screen.findByText(/missing its confirmation code/i)).toBeVisible()
  expect(fetcher).not.toHaveBeenCalled()
})
