/*
 * One face for a person, wherever they appear.
 *
 * The property that matters is stability: the same person must look the same
 * on every screen, or the application looks like it is showing three different
 * people as you move through it.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { Avatar, initialsFor } from './Avatar.tsx'

afterEach(cleanup)

test('initials come from what the person is actually called', () => {
  expect(initialsFor('Ada Lovelace')).toBe('AL')
  expect(initialsFor('Ada')).toBe('A')
  expect(initialsFor('  ada   lovelace  ')).toBe('AL')
  /* Three or more names still give two letters: more is texture, not letters. */
  expect(initialsFor('Ada Byron King Lovelace')).toBe('AL')
})

test('somebody with no name still has a face rather than a broken one', () => {
  expect(initialsFor('')).toBe('?')
  expect(initialsFor('   ')).toBe('?')
})

test('non-Latin names are not cut in half', () => {
  /* Split by code point, so a name outside the basic plane keeps its first character. */
  expect(initialsFor('日本 語')).toBe('日語')
  expect(initialsFor('😀 Smith')).toBe('😀S')
})

test('a generated avatar announces the person, not the letters', () => {
  render(<Avatar name="Ada Lovelace" />)
  /* "A L" read aloud tells nobody anything; the name does. */
  const avatar = screen.getByRole('img', { name: 'Ada Lovelace' })
  expect(avatar).toHaveTextContent('AL')
})

test('the same identity gets the same colour every time', () => {
  const { container: first } = render(<Avatar name="Ada Lovelace" identity="ada" />)
  const { container: second } = render(<Avatar name="Ada L" identity="ada" />)
  const toneOf = (root: HTMLElement) => root.querySelector('[data-tone]')?.getAttribute('data-tone')
  /* Keyed on identity, so renaming yourself does not change your face. */
  expect(toneOf(first as HTMLElement)).toBe(toneOf(second as HTMLElement))
})

test('different people generally get different colours', () => {
  const tones = new Set(
    ['ada', 'grace', 'alan', 'katherine', 'dorothy'].map((identity) => {
      const { container } = render(<Avatar name={identity} identity={identity} />)
      const tone = container.querySelector('[data-tone]')?.getAttribute('data-tone')
      cleanup()
      return tone
    }),
  )
  expect(tones.size).toBeGreaterThan(1)
})

test('a real picture is shown, and does not repeat the name to a screen reader', () => {
  const { container } = render(<Avatar name="Ada Lovelace" src="/avatars/ada.png" />)
  const image = container.querySelector('img')
  expect(image).toHaveAttribute('src', '/avatars/ada.png')
  /* The name is almost always beside it; "photo of Ada, Ada" is worse than one Ada. */
  expect(image).toHaveAttribute('alt', '')
  expect(screen.queryByRole('img', { name: 'Ada Lovelace' })).toBeNull()
})
