/*
 * Three sharing concepts, and which of them needs an account.
 *
 * Handing a reflection to another app is an export: it creates no record in
 * C.H.A.T., puts nobody's name to anything, and a guest may do it. Publishing
 * to Public or into a community is different in kind — both put an author
 * beside the writing where other people can see it — and that is what an
 * account is for.
 *
 * The failure this guards against is the tidy-looking one: refusing a guest
 * the whole sheet. That takes away the destination they were always entitled
 * to, in order to protect the two they were not.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'
import { ShareSheet } from './ChatSheets.tsx'

afterEach(cleanup)

function renderSheet(canPublish: boolean) {
  const onShare = vi.fn(async () => {})
  const onShareExternally = vi.fn(async () => {})
  render(
    <MemoryRouter>
      <ShareSheet
        currentlyShared={false}
        validation={null}
        format="full"
        communities={[]}
        reflectionId="r1"
        canPublish={canPublish}
        onClose={() => {}}
        onShare={onShare}
        onShareExternally={onShareExternally}
      />
    </MemoryRouter>,
  )
  return { onShare, onShareExternally }
}

test('a guest can still hand their reflection to another app', () => {
  const { onShareExternally } = renderSheet(false)
  /* And it is what the sheet opens on, since it is what they can do. */
  fireEvent.click(screen.getByRole('button', { name: /Share to another app/ }))
  expect(onShareExternally).toHaveBeenCalledOnce()
})

test('the platform destinations send a guest to sign in, not away', () => {
  const { onShare } = renderSheet(false)
  fireEvent.click(screen.getByRole('radio', { name: /Public/ }))

  /* Nothing is published, and nothing is refused either. */
  expect(onShare).not.toHaveBeenCalled()
  const link = screen.getByRole('link', { name: 'Sign in to share' })
  const url = new URL(link.getAttribute('href')!, 'http://localhost')
  expect(url.pathname).toBe('/login')
  /* Where they came from travels with them: back to this reflection. */
  expect(url.searchParams.get('next')).toBe('/?c=r1')
  expect(url.searchParams.get('intent')).toBe('share')
})

test('and it says the reflection is untouched before it asks for anything', () => {
  renderSheet(false)
  fireEvent.click(screen.getByRole('radio', { name: /Public/ }))
  expect(screen.getByText(/saved and stays exactly as it is/i)).toBeInTheDocument()
  expect(screen.getByText(/brings everything you have written with you/i)).toBeInTheDocument()
})

test('a registered person gets the ordinary sheet, with no sign-in anywhere in it', () => {
  const { onShare } = renderSheet(true)
  expect(screen.queryByRole('link', { name: 'Sign in to share' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Share publicly' }))
  expect(onShare).toHaveBeenCalledOnce()
})
