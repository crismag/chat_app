/*
 * The marks are text-free on purpose, so what they claim has to be tested
 * somewhere other than the screen.
 *
 * Every one of them replaced a sentence a person could read. These are the
 * assertions that the sentence is still there for anyone who cannot see the
 * shape: a name on every mark, the state inside that name, and the traffic
 * light distinguishable by more than its colour.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { SaveToggle } from './FieldMarks.tsx'

afterEach(cleanup)

describe('the save toggle', () => {
  test('is one control that states which state it is in', () => {
    const onSave = vi.fn()
    const { rerender } = render(<SaveToggle name="Heart" dirty onSave={onSave} />)

    const toggle = screen.getByRole('button', { name: 'Save Heart — unsaved changes' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(toggle)
    expect(onSave).toHaveBeenCalledOnce()

    rerender(<SaveToggle name="Heart" dirty={false} onSave={onSave} />)
    expect(screen.getByRole('button', { name: 'Heart is saved' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
