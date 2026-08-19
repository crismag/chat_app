/*
 * The moment a visitor becomes somebody, and the two rules around it.
 *
 * One: nothing is created until they say so. Two: saying so does not cost them
 * the thing they were doing — the refused request is retried, so the action
 * they took is the action that happens.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from '../shared/api/client.ts'
import { AccountChoiceProvider } from './AccountChoice.tsx'
import { AuthProvider } from './AuthContext.tsx'

afterEach(cleanup)

let guestCalls = 0
let saveAttempts = 0

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  guestCalls = 0
  saveAttempts = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/auth/me')) return json({ error: 'Unauthenticated.' }, 401)
      if (url.includes('/auth/guest')) {
        guestCalls += 1
        return json(
          {
            id: 'g1',
            accountType: 'ANONYMOUS',
            email: null,
            guestName: 'QuietCedar-1',
            emailVerified: false,
          },
          201,
        )
      }
      if (url.includes('/conversations')) {
        saveAttempts += 1
        /* A visitor is refused; a guest is served. The second try succeeds. */
        return guestCalls === 0
          ? json(
              {
                error: 'Saving this needs an account.',
                needsAccount: true,
                creationSource: 'REFLECTION_CREATE',
              },
              401,
            )
          : json({ id: 'c1' }, 201)
      }
      return json({ error: 'unexpected' }, 500)
    }),
  )
})

function renderProvider() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AccountChoiceProvider />
      </AuthProvider>
    </MemoryRouter>,
  )
}

test('a refused save asks how it should be kept, and keeps it', async () => {
  renderProvider()
  const saved = api<{ id: string }>('/conversations', { method: 'POST', body: '{}' })

  /* The question names what they were doing rather than asking in general. */
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(screen.getByText(/To keep this reflection/i)).toBeInTheDocument()
  /* Nothing has been created merely by being asked. */
  expect(guestCalls).toBe(0)

  fireEvent.click(screen.getByRole('button', { name: /Continue as guest/i }))

  await expect(saved).resolves.toMatchObject({ id: 'c1' })
  expect(guestCalls).toBe(1)
  /* Once refused, once served: the action they took is the action that ran. */
  expect(saveAttempts).toBe(2)
})

test('closing the question creates nobody, and the action fails honestly', async () => {
  renderProvider()
  const saved = api('/conversations', { method: 'POST', body: '{}' })

  await screen.findByRole('dialog')
  fireEvent.click(screen.getByRole('button', { name: 'Not now' }))

  await expect(saved).rejects.toThrow()
  expect(guestCalls).toBe(0)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('what continuing as a guest means is said before it is chosen', async () => {
  renderProvider()
  void api('/conversations', { method: 'POST', body: '{}' }).catch(() => undefined)
  await screen.findByRole('dialog')

  /* Both halves: it is kept here, and it is lost if this browser is cleared. */
  expect(screen.getByText(/Kept in this browser on this device/i)).toBeInTheDocument()
  expect(screen.getByText(/site data, it is lost/i)).toBeInTheDocument()
  /* And that an account later costs them nothing they have written. */
  expect(screen.getByText(/everything\s+you have written comes with you/i)).toBeInTheDocument()
})
