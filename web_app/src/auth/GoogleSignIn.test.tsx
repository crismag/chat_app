/*
 * The several ways "Continue with Google" can fail.
 *
 * Google Identity Services is a script on somebody else's server rendering a
 * button this application does not draw. Each way that can go wrong is tested
 * here, because the one outcome that is not acceptable is a blank space where
 * a sign-in used to be.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { AuthProvider } from './AuthContext.tsx'
import { GoogleSignIn } from './GoogleSignIn.tsx'

afterEach(() => {
  cleanup()
  delete (window as { google?: unknown }).google
  document.querySelectorAll('script').forEach((script) => { script.remove() })
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Stands in for the script Google would have loaded. */
function installGoogle(): {
  fire: (credential?: string) => void
  rendered: () => boolean
  lastOptions: () => Record<string, unknown> | null
} {
  let callback: (response: { credential?: string }) => void = () => {}
  let drawn = false
  let lastOptions: Record<string, unknown> | null = null
  ;(window as unknown as { google: unknown }).google = {
    accounts: {
      id: {
        initialize(options: { callback: (response: { credential?: string }) => void }) {
          callback = options.callback
        },
        renderButton(_parent: HTMLElement, options: Record<string, unknown>) {
          drawn = true
          lastOptions = options
        },
        disableAutoSelect() {},
      },
    },
  }
  return {
    fire: (credential?: string) => { callback({ ...(credential ? { credential } : {}) }) },
    rendered: () => drawn,
    lastOptions: () => lastOptions,
  }
}

function renderButton(onSignedIn = vi.fn()) {
  render(
    <MemoryRouter>
      <AuthProvider>
        <GoogleSignIn onSignedIn={onSignedIn} />
      </AuthProvider>
    </MemoryRouter>,
  )
  return onSignedIn
}

let calls: { url: string; body: unknown; headers: unknown }[] = []

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, headers: init?.headers })
      if (url.includes('/auth/me')) return json({ error: 'Unauthenticated.' }, 401)
      if (url.includes('/auth/google/config')) return json({ clientId: 'client-123', configured: true })
      if (url.includes('/auth/google')) {
        return json({ id: 'u1', accountType: 'REGISTERED', email: 'a@b.co', guestName: null, emailVerified: true })
      }
      return json({ error: 'unexpected' }, 500)
    }),
  )
})

test('the credential goes to the server, and nothing is read from it here', async () => {
  const google = installGoogle()
  const onSignedIn = renderButton()
  await waitFor(() => { expect(google.rendered()).toBe(true) })

  google.fire('a-signed-google-token')
  await waitFor(() => { expect(onSignedIn).toHaveBeenCalled() })

  const sent = calls.find((call) => call.url.includes('/auth/google') && !call.url.includes('config'))
  expect(sent?.body).toEqual({ credential: 'a-signed-google-token', keepSignedIn: false })
})

test('Google is asked to draw a button wide enough to see', async () => {
  const google = installGoogle()
  renderButton()
  await waitFor(() => { expect(google.rendered()).toBe(true) })
  const width = Number(google.lastOptions()?.width)
  expect(width).toBeGreaterThanOrEqual(200)
  expect(width).toBeLessThanOrEqual(400)
})

test('the config GET is a simple request, so a down API cannot hide it behind a preflight', async () => {
  installGoogle()
  renderButton()
  await waitFor(() => {
    expect(calls.some((call) => call.url.includes('/auth/google/config'))).toBe(true)
  })
  const config = calls.find((call) => call.url.includes('/auth/google/config'))
  const headers = (config?.headers ?? {}) as Record<string, string>
  expect(headers['Content-Type'] ?? headers['content-type']).toBeUndefined()
})

test('closing the Google popup says nothing and leaves the button', async () => {
  const google = installGoogle()
  const onSignedIn = renderButton()
  await waitFor(() => { expect(google.rendered()).toBe(true) })

  /* Google calls back with no credential when somebody dismisses it. */
  google.fire(undefined)

  expect(onSignedIn).not.toHaveBeenCalled()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('a refused credential is explained rather than swallowed', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/me')) return json({ error: 'Unauthenticated.' }, 401)
      if (url.includes('/auth/google/config')) return json({ clientId: 'client-123', configured: true })
      return json({ error: 'That Google sign-in could not be verified. Try again.' }, 401)
    }),
  )
  const google = installGoogle()
  renderButton()
  await waitFor(() => { expect(google.rendered()).toBe(true) })

  google.fire('a-stale-token')
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not be verified/i)
})

test('a server with no Google configured simply does not offer it', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/me')) return json({ error: 'Unauthenticated.' }, 401)
      return json({ clientId: null, configured: false })
    }),
  )
  installGoogle()
  const { container } = render(
    <MemoryRouter>
      <AuthProvider>
        <GoogleSignIn onSignedIn={vi.fn()} />
      </AuthProvider>
    </MemoryRouter>,
  )
  /*
   * Nothing at all rather than a broken button: every other way in still
   * works, and an explanation about server configuration is not something a
   * visitor can act on. The "or" belongs to Google, so it goes too.
   */
  await waitFor(() => { expect(container.querySelector('[class*=root]')).toBeNull() })
  expect(screen.queryByText('or')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull()
})

test('an unreachable config still offers Continue with Google, not a blank', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/me')) return json({ error: 'Unauthenticated.' }, 401)
      return json({ error: 'The API is not responding. Please try again shortly.' }, 502)
    }),
  )
  renderButton()
  expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
  expect(screen.getByText('or')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('the library failing to load leaves the rest of the page working', async () => {
  /* No window.google, and the script element never fires load. */
  render(
    <MemoryRouter>
      <AuthProvider>
        <GoogleSignIn onSignedIn={vi.fn()} />
        <p>Sign in with an email instead</p>
      </AuthProvider>
    </MemoryRouter>,
  )
  expect(await screen.findByText('Sign in with an email instead')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('a script that errors still leaves a Continue with Google control', async () => {
  renderButton()
  expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
  expect(screen.getByText('or')).toBeInTheDocument()
})
