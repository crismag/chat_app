/*
 * Sharing is the identity-required action, and it asks at the point of use.
 *
 * The whole change is that an account is not needed to write. It is needed to
 * share, because Public and Community both put a name to something — so the
 * ask happens when somebody reaches for it, saying first that their reflection
 * is already safe.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test } from 'vitest'
import { SignInToShare } from './ChatSheets.tsx'

afterEach(cleanup)

function renderSheet() {
  return render(
    <MemoryRouter>
      <SignInToShare reflectionId="r1" onClose={() => {}} />
    </MemoryRouter>,
  )
}

test('it says the reflection is already saved before it asks for anything', () => {
  renderSheet()
  expect(screen.getByRole('heading', { name: 'Sign in to share' })).toBeInTheDocument()
  expect(screen.getByText(/already saved on this device/i)).toBeInTheDocument()
})

/*
 * Where they came from travels with them. Signing in must return somebody to
 * the reflection they were sharing, not to a dashboard.
 */
test('it carries the reflection back to itself after signing in', () => {
  renderSheet()
  const link = screen.getByRole('link', { name: /Sign in or create an account/ })
  const url = new URL(link.getAttribute('href')!, 'http://localhost')
  expect(url.pathname).toBe('/login')
  expect(url.searchParams.get('next')).toBe('/?c=r1')
  expect(url.searchParams.get('intent')).toBe('share')
})

test('and says what signing in gets them, rather than only what it costs', () => {
  renderSheet()
  expect(screen.getByText(/brings everything you have written here with you/i)).toBeInTheDocument()
})
