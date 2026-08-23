/*
 * A name on somebody else's reflection has to go somewhere.
 *
 * The regression this guards is not "the link renders" — it is the two ways
 * the link is useless while still rendering: pointing at `/profile/` for an
 * author who never chose a handle, and being painted under a card's stretched
 * link so that clicking a person opens their reflection instead.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test } from 'vitest'

afterEach(cleanup)
import { AuthorLink } from './AuthorLink.tsx'

function renderLink(author: { handle: string; displayName: string }, showHandle = false) {
  return render(
    <MemoryRouter>
      <AuthorLink author={author} showHandle={showHandle} />
    </MemoryRouter>,
  )
}

test('a name with a handle goes to that public profile', () => {
  renderLink({ handle: 'ruth', displayName: 'Ruth Alvarez' })
  const link = screen.getByRole('link', { name: /Ruth Alvarez/ })
  expect(link).toHaveAttribute('href', '/profile/ruth')
})

test('the accessible name says where following it goes', () => {
  renderLink({ handle: 'ruth', displayName: 'Ruth Alvarez' })
  /* Twenty cards in a feed otherwise read as twenty links called nothing much. */
  expect(screen.getByRole('link', { name: 'Ruth Alvarez’s profile' })).toBeInTheDocument()
})

test('an author with no handle has no address, and is not linked to one', () => {
  renderLink({ handle: '', displayName: 'Ruth Alvarez' })
  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.getByText('Ruth Alvarez')).toBeInTheDocument()
})

test('whitespace is not a handle either', () => {
  renderLink({ handle: '   ', displayName: 'Ruth Alvarez' })
  expect(screen.queryByRole('link')).toBeNull()
})

test('the handle shows beside the name only where it is asked for', () => {
  renderLink({ handle: 'ruth', displayName: 'Ruth Alvarez' }, true)
  expect(screen.getByText('@ruth')).toBeInTheDocument()
})
