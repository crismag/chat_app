/*
 * Devices and sessions, from the owner's side.
 *
 * The behaviour worth pinning is not "a list appears" but the three things
 * that make the list safe to hand to a browser: it carries no token, it shows
 * only your own sessions, and revoking one actually stops it working.
 */
import { describe, expect, test } from 'vitest'

import { createApp } from '../app.ts'
import { SqliteStore } from '../db.ts'
import { MemoryStore } from '../store.ts'
import { cookieHeader } from '../http/set-cookie.ts'
import { hashSessionToken } from '../mysql/tokens.ts'

type App = ReturnType<typeof createApp>

const backings = [
  { name: 'sqlite', make: () => new SqliteStore() },
  { name: 'memory', make: () => new MemoryStore() },
] as const

type Session = {
  id: string
  current: boolean
  sessionType: string
  platform: string | null
}

async function register(app: App, email: string) {
  const response = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret12' }),
  })
  expect(response.status).toBe(201)
  return cookieHeader(response.headers.get('set-cookie'))
}

async function signIn(app: App, email: string) {
  const response = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret12' }),
  })
  expect(response.status).toBe(200)
  return cookieHeader(response.headers.get('set-cookie'))
}

/*
 * The id the server will use for a given cookie. Derived here rather than
 * picked out of the listing, so the test names one exact session instead of
 * whichever one happened to sort first.
 */
function idOf(cookie: string): string {
  return hashSessionToken(/chat_session=([^;]+)/.exec(cookie)?.[1] ?? '')
}

function list(app: App, cookie: string) {
  return app.request('/api/auth/sessions', { headers: { Cookie: cookie } })
}

for (const backing of backings) {
  describe(`sessions (${backing.name})`, () => {
    test('somebody signed in on two browsers sees two, and knows which is here', async () => {
      const app = createApp(backing.make())
      const first = await register(app, 'ada@example.com')
      const second = await signIn(app, 'ada@example.com')

      const seen = (await (await list(app, second)).json()) as { sessions: Session[] }
      expect(seen.sessions.length).toBeGreaterThanOrEqual(2)
      expect(seen.sessions.filter((session) => session.current)).toHaveLength(1)
      expect(first).not.toBe(second)
    })

    test('no session token is ever handed to the page', async () => {
      const app = createApp(backing.make())
      const cookie = await register(app, 'ada@example.com')

      const body = await (await list(app, cookie)).text()
      /*
       * The cookie value is the credential. The list names sessions by a hash
       * of it, so the raw value must appear nowhere in the response.
       */
      const token = /chat_session=([^;]+)/.exec(cookie)?.[1] ?? 'no-token'
      expect(token).not.toBe('no-token')
      expect(body).not.toContain(token)
    })

    test('revoking a session stops it working, and leaves the others alone', async () => {
      const app = createApp(backing.make())
      const doomed = await register(app, 'ada@example.com')
      const keeper = await signIn(app, 'ada@example.com')

      const seen = (await (await list(app, keeper)).json()) as { sessions: Session[] }
      /* The listing names the doomed browser, and does not call it the current one. */
      const doomedId = idOf(doomed)
      expect(seen.sessions.find((session) => session.id === doomedId)?.current).toBe(false)

      const revoked = await app.request(`/api/auth/sessions/${doomedId}`, {
        method: 'DELETE',
        headers: { Cookie: keeper },
      })
      expect(revoked.status).toBe(200)

      /* The revoked browser is signed out; this one is untouched. */
      expect((await app.request('/api/auth/me', { headers: { Cookie: doomed } })).status).toBe(401)
      expect((await app.request('/api/auth/me', { headers: { Cookie: keeper } })).status).toBe(200)
    })

    test('one account cannot revoke another account\'s session', async () => {
      const app = createApp(backing.make())
      const ada = await register(app, 'ada@example.com')
      const bob = await register(app, 'bob@example.com')

      const refused = await app.request(`/api/auth/sessions/${idOf(ada)}`, {
        method: 'DELETE',
        headers: { Cookie: bob },
      })
      expect(refused.status).toBe(404)

      /* Ada is still signed in, which is the point. */
      expect((await app.request('/api/auth/me', { headers: { Cookie: ada } })).status).toBe(200)
    })

    test('signing out everywhere else keeps this one', async () => {
      const app = createApp(backing.make())
      const old1 = await register(app, 'ada@example.com')
      const old2 = await signIn(app, 'ada@example.com')
      const here = await signIn(app, 'ada@example.com')

      const swept = await app.request('/api/auth/sessions/revoke-others', {
        method: 'POST',
        headers: { Cookie: here },
      })
      expect(swept.status).toBe(200)

      expect((await app.request('/api/auth/me', { headers: { Cookie: here } })).status).toBe(200)
      expect((await app.request('/api/auth/me', { headers: { Cookie: old1 } })).status).toBe(401)
      expect((await app.request('/api/auth/me', { headers: { Cookie: old2 } })).status).toBe(401)
    })

    test('a guest has nothing to manage', async () => {
      const app = createApp(backing.make())
      const guest = await app.request('/api/auth/guest', { method: 'POST' })
      const cookie = cookieHeader(guest.headers.get('set-cookie'))

      expect((await list(app, cookie)).status).toBe(401)
    })

    test('a signed-out visitor cannot ask who is signed in', async () => {
      const app = createApp(backing.make())
      expect((await app.request('/api/auth/sessions')).status).toBe(401)
    })
  })
}
