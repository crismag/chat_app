/*
 * One face for a person, wherever they appear.
 *
 * The property that matters is stability: the same person must look the same
 * on every screen, or the application looks like it is showing three different
 * people as you move through it.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Avatar, initialsFor } from './Avatar.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

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
  /*
   * Resolved against the API's origin, not left as the bare path the server
   * sent — see the picture-loads-cross-origin test below for why. In this
   * test the API base is unset, so it resolves to the page's own origin,
   * which is what a bare path always meant here before the fix.
   */
  expect(image).toHaveAttribute('src', `${window.location.origin}/avatars/ada.png`)
  /* The name is almost always beside it; "photo of Ada, Ada" is worse than one Ada. */
  expect(image).toHaveAttribute('alt', '')
  expect(screen.queryByRole('img', { name: 'Ada Lovelace' })).toBeNull()
})

/*
 * The bug this covers: a picture that really was uploaded, shown as the
 * generated letters anyway, with nothing on screen saying why.
 *
 * `avatarUrl` in a server response is a path rooted at the *API's* domain —
 * `/api/profiles/<handle>/avatar?v=...` — because that is where the route
 * lives. The web app and the API are different domains in production,
 * so a browser given that path bare resolves it against the *page's* origin
 * instead and gets that host's 404, not the picture. The `<img>` fails
 * silently into the initials fallback the "picture that fails to load"
 * test above exists for, and the person who uploaded a real picture has no
 * way to tell that apart from an upload that never worked.
 */
test('a picture path from the API is loaded from the API, even when the page is served elsewhere', async () => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://chatapi.crishub.com/api')
  vi.resetModules()
  const { Avatar: FreshAvatar } = await import('./Avatar.tsx')

  const { container } = render(
    <FreshAvatar name="Ada Lovelace" src="/api/profiles/ada/avatar?v=1" />,
  )
  const image = container.querySelector('img')
  expect(image).toHaveAttribute(
    'src',
    'https://chatapi.crishub.com/api/profiles/ada/avatar?v=1',
  )
})

test('a picture that fails to load becomes the generated face, never a broken image', () => {
  render(<Avatar name="Ada Lovelace" identity="ada" src="/api/profiles/ada/avatar?v=1" />)

  const picture = document.querySelector('img')
  expect(picture).not.toBeNull()

  /* The stored picture is gone, or the request failed. The person is not. */
  fireEvent.error(picture as HTMLImageElement)

  expect(document.querySelector('img')).toBeNull()
  expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toBeVisible()
  expect(screen.getByText('AL')).toBeVisible()
})
