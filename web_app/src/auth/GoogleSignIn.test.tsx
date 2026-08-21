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
function installGoogle(): { fire: (credential?: string) => void; rendered: () => boolean } {
  let callback: (response: { credential?: string }) => void = () => {}
  let drawn = false
  ;(window as unknown as { google: unknown }).google = {
    accounts: {
      id: {
        initialize(options: { callback: (response: { credential?: string }) => void }) {
          callback = options.callback
        },
        renderButton() {
          drawn = true
        },
        disableAutoSelect() {},
      },
    },
  }
  return { fire: (credential?: string) => { callback({ ...(credential ? { credential } : {}) }) }, rendered: () => drawn }
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

let calls: { url: string; body: unknown }[] = []

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
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
   * visitor can act on.
   */
  await waitFor(() => { expect(container.querySelector('[class*=root]')).toBeNull() })
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
