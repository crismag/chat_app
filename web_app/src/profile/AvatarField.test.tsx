/*
 * The cropping itself is not exercised here: it needs a real canvas, which
 * jsdom does not have. Its arithmetic is tested directly in `crop.test.ts`,
 * and this file covers the parts around it — choosing, refusing, removing.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { AvatarField } from './AvatarField.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function field(avatarUrl: string | null, onChanged = vi.fn()) {
  render(
    <AvatarField
      name="Grace Hopper"
      identity="grace"
      avatarUrl={avatarUrl}
      onChanged={onChanged}
    />,
  )
  return onChanged
}

test('somebody with no picture is invited to add one, and offered no way to remove nothing', () => {
  field(null)

  expect(screen.getByText('Add a picture')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  /* Never an empty frame: the generated face stands in until there is a photo. */
  expect(screen.getByRole('img', { name: 'Grace Hopper' })).toBeVisible()
})

test('somebody with a picture can change or remove it', () => {
  field('/api/profiles/grace/avatar?v=1')

  expect(screen.getByText('Change picture')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Remove' })).toBeVisible()
})

test('removing a picture tells the page, so the face on it stops being stale', async () => {
  const fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, json: async () => ({ avatarUrl: null }) } as Response),
  )
  vi.stubGlobal('fetch', fetchMock)
  const onChanged = field('/api/profiles/grace/avatar?v=1')

  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

  await waitFor(() => expect(onChanged).toHaveBeenCalledWith(null))
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/profiles/me/avatar',
    expect.objectContaining({ method: 'DELETE' }),
  )
})

test('a refusal from the server is said out loud, not swallowed', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: false,
        json: async () => ({ error: 'That picture is too large. Please choose one under 512 KB.' }),
      } as Response),
    ),
  )
  const onChanged = field('/api/profiles/grace/avatar?v=1')

  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('That picture is too large.')
  expect(onChanged).not.toHaveBeenCalled()
})

test('a file that is not a picture is refused before anything is uploaded', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  field(null)

  const input = document.querySelector('input[type=file]') as HTMLInputElement
  const notAPicture = new File(['#!/bin/sh'], 'script.sh', { type: 'text/x-shellscript' })
  fireEvent.change(input, { target: { files: [notAPicture] } })

  expect(await screen.findByRole('alert')).toHaveTextContent('That file is not a picture.')
  expect(fetchMock).not.toHaveBeenCalled()
})
