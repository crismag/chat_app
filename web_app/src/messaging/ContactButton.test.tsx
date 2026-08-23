/*
 * The contact control.
 *
 * What is worth asserting is the failure path: the button flips immediately
 * because a bookmark should not need a spinner, and a failed add must put it
 * back and say so. Silently reverting would leave somebody certain they had
 * added a person they had not.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ContactButton } from './ContactButton.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stub(status: number) {
  /* Typed as the global fetch so the recorded calls keep their argument types. */
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(status === 200 ? { isContact: true } : { error: 'No.' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

test('a person not in contacts is offered as one to add', () => {
  stub(200)
  render(<ContactButton handle="ruth" isContact={false} onChanged={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Add to contacts' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})

test('adding reports the new state straight away', async () => {
  const fetchMock = stub(200)
  const onChanged = vi.fn()
  render(<ContactButton handle="ruth" isContact={false} onChanged={onChanged} />)
  fireEvent.click(screen.getByRole('button'))
  expect(onChanged).toHaveBeenCalledWith(true)
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/messaging/contacts')
})

test('someone already in contacts is offered as one to remove', async () => {
  const fetchMock = stub(200)
  const onChanged = vi.fn()
  render(<ContactButton handle="ruth" isContact onChanged={onChanged} />)
  expect(screen.getByRole('button', { name: 'In contacts' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  fireEvent.click(screen.getByRole('button'))
  expect(onChanged).toHaveBeenCalledWith(false)
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  expect(String(fetchMock.mock.calls[0]?.[1]?.method)).toBe('DELETE')
})

test('a failure puts it back and says so, rather than lying quietly', async () => {
  stub(500)
  const onChanged = vi.fn()
  render(<ContactButton handle="ruth" isContact={false} onChanged={onChanged} />)
  fireEvent.click(screen.getByRole('button'))
  expect(onChanged).toHaveBeenNthCalledWith(1, true)
  await waitFor(() => expect(onChanged).toHaveBeenNthCalledWith(2, false))
  expect(await screen.findByRole('status')).toBeInTheDocument()
})
