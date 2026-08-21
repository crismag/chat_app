/*
 * The things that make a sheet a dialog rather than a floating div.
 *
 * Focus going in and coming back, and Escape closing, are the parts nobody
 * notices working and everybody notices missing — a keyboard left stranded
 * behind a scrim has no way back to the page.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useState } from 'react'
import { Sheet } from './Sheet.tsx'

afterEach(cleanup)

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open filters
      </button>
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false)
          onClose?.()
        }}
        title="Filters"
      >
        <button type="button">Status</button>
        <button type="button">Visibility</button>
      </Sheet>
    </>
  )
}

test('the sheet names itself, so it is not an anonymous dialog', () => {
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Open filters' }))
  expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument()
})

test('focus moves inside on open and returns to the opener on close', () => {
  render(<Harness />)
  const opener = screen.getByRole('button', { name: 'Open filters' })
  opener.focus()
  fireEvent.click(opener)

  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Status' }))

  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  /* Back where they were, not at the top of the page. */
  expect(document.activeElement).toBe(opener)
})

test('Escape closes it', () => {
  const onClose = vi.fn()
  render(<Harness onClose={onClose} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open filters' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalled()
})

test('the scrim closes it, and is not a tab stop of its own', () => {
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Open filters' }))
  const scrim = screen.getByRole('button', { name: 'Close' })
  expect(scrim).toHaveAttribute('tabindex', '-1')
  fireEvent.click(scrim)
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('Tab is kept inside rather than landing behind the scrim', () => {
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Open filters' }))
  const last = screen.getByRole('button', { name: 'Visibility' })
  last.focus()
  fireEvent.keyDown(document, { key: 'Tab' })
  /* Wrapped to the first control in the sheet, not out to the page. */
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Status' }))
})

test('the back gesture closes the sheet instead of leaving the screen', () => {
  const onClose = vi.fn()
  render(<Harness onClose={onClose} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open filters' }))
  window.dispatchEvent(new PopStateEvent('popstate'))
  expect(onClose).toHaveBeenCalled()
})
