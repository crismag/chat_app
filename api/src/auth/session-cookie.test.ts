import { expect, test } from 'vitest'
import { sessionCookieOptions } from './session-cookie.ts'

test('local Vite keeps a Lax cookie that can travel over HTTP', () => {
  const options = sessionCookieOptions('http://localhost:5173', { NODE_ENV: 'development' })
  expect(options.sameSite).toBe('Lax')
  expect(options.secure).toBe(false)
  expect(options.httpOnly).toBe(true)
})

test('a packaged WebView gets a cross-site cookie the native stack can store', () => {
  const options = sessionCookieOptions('https://localhost', { NODE_ENV: 'development' })
  expect(options.sameSite).toBe('None')
  expect(options.secure).toBe(true)
})

test('production browser sessions are Secure even when SameSite stays Lax', () => {
  const options = sessionCookieOptions('https://chat.example', { NODE_ENV: 'production' })
  expect(options.sameSite).toBe('Lax')
  expect(options.secure).toBe(true)
})
