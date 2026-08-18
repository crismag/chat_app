import { expect, test } from 'vitest'
import { isNativeWebViewOrigin, webOrigins } from './origins.ts'

test('always includes the Vite and Capacitor WebView origins', () => {
  const origins = webOrigins({})
  expect(origins).toContain('http://localhost:5173')
  expect(origins).toContain('https://localhost')
  expect(origins).toContain('capacitor://localhost')
})

test('CHAT_WEB_ORIGINS adds a deployed web host without dropping defaults', () => {
  const origins = webOrigins({ CHAT_WEB_ORIGINS: 'https://chat.example, https://api-ui.example' })
  expect(origins).toContain('https://chat.example')
  expect(origins).toContain('https://api-ui.example')
  expect(origins).toContain('http://127.0.0.1:5173')
})

test('native WebView origins are the packaged Capacitor hosts, not Vite', () => {
  expect(isNativeWebViewOrigin('https://localhost')).toBe(true)
  expect(isNativeWebViewOrigin('capacitor://localhost')).toBe(true)
  expect(isNativeWebViewOrigin('http://localhost:5173')).toBe(false)
  expect(isNativeWebViewOrigin(undefined)).toBe(false)
})
