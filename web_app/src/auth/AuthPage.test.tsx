/*
 * Two defects, and only the behaviour that made them defects.
 *
 * Neither is about how the page looks: one is that a slow network could create
 * an account twice, and the other is that a failure was announced without ever
 * saying which field it belonged to.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { AuthPage } from './AuthPage.tsx'
import { AuthProvider } from './AuthContext.tsx'

afterEach(cleanup)

/** Resolves when the test says so, standing in for a slow network. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let registerCalls = 0
let loginCalls = 0
let pending: ReturnType<typeof deferred<Response>> | null = null

beforeEach(() => {
  registerCalls = 0
  loginCalls = 0
  pending = null
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

    if (url.includes('/auth/me')) return json({ error: 'Unauthenticated.' }, 401)
    if (url.includes('/auth/register')) {
      registerCalls += 1
      if (pending) return pending.promise
      return json({ id: 'u1', email: 'a@b.co' })
    }
    if (url.includes('/auth/login')) {
      loginCalls += 1
      return json({ error: 'Invalid email or password.' }, 401)
    }
    return json({ error: 'unexpected' }, 500)
  }))
})

function renderPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AuthPage />
      </AuthProvider>
    </MemoryRouter>,
  )
}

async function fillIn(mode: 'login' | 'register') {
  if (mode === 'register') {
    fireEvent.click(await screen.findByRole('button', { name: 'Create an account' }))
  }
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-password' } })
}

test('a second press cannot create a second account', async () => {
  pending = deferred<Response>()
  renderPage()
  await fillIn('register')

  const submit = screen.getByRole('button', { name: 'Create account' })
  fireEvent.click(submit)

  /* While the first request is in flight the control is unusable... */
  await waitFor(() => expect(screen.getByRole('button', { name: 'Creating account…' })).toBeDisabled())

  /* ...and pressing anyway — pointer or Enter — sends nothing more. */
  fireEvent.click(screen.getByRole('button', { name: 'Creating account…' }))
  fireEvent.submit(screen.getByLabelText('Email').closest('form')!)

  pending.resolve(
    new Response(JSON.stringify({ id: 'u1', email: 'a@b.co' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  await waitFor(() => expect(registerCalls).toBe(1))
})

test('a taken email is reported on the email field, and the caret goes there', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/auth/me')) {
      return new Response(JSON.stringify({}), { status: 401, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ error: 'An account with that email already exists.' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    })
  }))

  renderPage()
  await fillIn('register')
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('An account with that email already exists.')

  const emailField = screen.getByLabelText('Email')
  expect(emailField).toHaveAttribute('aria-invalid', 'true')
  expect(emailField).toHaveAttribute('aria-describedby', alert.getAttribute('id'))
  await waitFor(() => expect(document.activeElement).toBe(emailField))

  /* The password is not in question, so it is not marked. */
  expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid')
})

/*
 * The server answers a failed sign-in without saying which half was wrong.
 * Marking one field would give away exactly what that wording withholds, so
 * both are marked or neither is.
 */
test('a failed sign-in implicates both fields, and singles out neither', async () => {
  renderPage()
  await fillIn('login')
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Invalid email or password.')
  for (const label of ['Email', 'Password']) {
    const field = screen.getByLabelText(label)
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAttribute('aria-describedby', alert.getAttribute('id'))
  }
  expect(loginCalls).toBe(1)
})

test('correcting the field clears the failure', async () => {
  renderPage()
  await fillIn('login')
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByRole('alert')

  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'another-password' } })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid')
})
