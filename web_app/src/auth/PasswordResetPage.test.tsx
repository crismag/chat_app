/*
 * The forgotten-password pages, and the one thing they must never reveal.
 *
 * A form that answers differently for an address that has an account is a way
 * to find out who writes here. The page therefore shows the server's sentence
 * unchanged and composes nothing of its own — so the assertions below are
 * mostly about sameness, and about not marking anything as the person's fault.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AuthProvider } from './AuthContext.tsx'
import { PasswordResetPage } from './PasswordResetPage.tsx'

afterEach(cleanup)

let asked: unknown[] = []
let reset: unknown[] = []

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const SAME_ANSWER =
  'If that address has an account, a link to set a new password is on its way. It works for one hour.'

beforeEach(() => {
  asked = []
  reset = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/auth/me')) return json({ error: 'Unauthenticated.' }, 401)
      if (url.includes('/auth/forgot-password')) {
        asked.push(JSON.parse(String(init?.body ?? '{}')))
        return json({ message: SAME_ANSWER })
      }
      if (url.includes('/auth/reset-password')) {
        reset.push(JSON.parse(String(init?.body ?? '{}')))
        return json({ id: 'u1', accountType: 'REGISTERED', email: 'a@b.co', guestName: null, emailVerified: false })
      }
      return json({ error: 'unexpected' }, 500)
    }),
  )
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/forgot-password" element={<PasswordResetPage />} />
          <Route path="/reset-password" element={<PasswordResetPage />} />
          <Route path="/" element={<p>the application</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

test('asking for a link shows the server’s sentence, not one of its own', async () => {
  renderAt('/forgot-password')
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'someone@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send the link' }))

  expect(await screen.findByText(SAME_ANSWER)).toBeInTheDocument()
  expect(asked).toEqual([{ email: 'someone@example.com' }])
  /*
   * Nothing here claims an email was sent, because the page cannot know — and
   * a page that said "sent!" would be answering the question the server
   * refuses to answer.
   */
  expect(screen.queryByText(/we have sent/i)).toBeNull()
  expect(screen.queryByText(/no account/i)).toBeNull()
})

test('the emailed link lands on the form that sets a password', async () => {
  renderAt('/reset-password?token=abc123')
  expect(await screen.findByRole('heading', { name: 'Set a new password' })).toBeInTheDocument()
  /* And not on the form that asks for another link. */
  expect(screen.queryByLabelText('Email')).toBeNull()
})

test('setting one sends the token with it, and lands in the application', async () => {
  renderAt('/reset-password?token=abc123')
  fireEvent.change(await screen.findByLabelText('New password'), {
    target: { value: 'a-brand-new-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }))

  await waitFor(() => expect(reset).toHaveLength(1))
  expect(reset[0]).toEqual({ token: 'abc123', password: 'a-brand-new-password' })
  expect(await screen.findByText('the application')).toBeInTheDocument()
})

test('a spent link says so, and offers another', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/me')) return json({ error: 'Unauthenticated.' }, 401)
      return json(
        { error: 'That link has expired or has already been used. Ask for a new one and it will work for an hour.' },
        400,
      )
    }),
  )

  renderAt('/reset-password?token=stale')
  fireEvent.change(await screen.findByLabelText('New password'), {
    target: { value: 'a-brand-new-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(/expired or has already been used/i)
  expect(screen.getByRole('link', { name: 'Ask for another' })).toBeInTheDocument()
})
