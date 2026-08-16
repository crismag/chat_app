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
import { OriginMark, SaveToggle, StatusLight } from './FieldMarks.tsx'

afterEach(cleanup)

describe('the traffic light', () => {
  test('names its section and its state, and shows no text', () => {
    const { container } = render(<StatusLight name="Heart" status="empty" />)
    const light = screen.getByRole('img', { name: 'Heart — nothing written yet' })

    expect(light).toBeInTheDocument()
    /* The tooltip is the only text, and it is hidden from the reader of names. */
    expect(container.querySelector('span[aria-hidden="true"]')?.textContent).toBe(
      'Heart — nothing written yet',
    )
    expect(light.textContent).toBe('')
  })

  test('is reachable by keyboard, so its wording is not mouse-only', () => {
    render(<StatusLight name="Heart" status="written" />)
    expect(screen.getByRole('img', { name: 'Heart — written' })).toHaveAttribute('tabindex', '0')
  })

  test('changes shape as well as colour', () => {
    const shapeOf = (status: 'empty' | 'long' | 'written') => {
      const { container } = render(<StatusLight name="Heart" status={status} />)
      return container.querySelector('svg')!.innerHTML
    }

    const shapes = [shapeOf('empty'), shapeOf('long'), shapeOf('written')]
    expect(new Set(shapes).size).toBe(3)
  })
})

describe('provenance', () => {
  test('says whose words these are without printing it', () => {
    render(<OriginMark origin="ai_assisted" />)
    expect(screen.getByRole('img', { name: 'AI assisted' })).toBeInTheDocument()
  })

  test('and stays readable to anything reading the page rather than seeing it', () => {
    const { container } = render(<OriginMark origin="user" />)
    expect(container.querySelector('.sr-only')?.textContent).toBe('Your words')
  })
})

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
