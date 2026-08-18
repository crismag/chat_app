import { expect, test } from 'vitest'
import { pathFromAppUrl } from './urls.ts'

test('maps a custom-scheme deep link onto the matching in-app route', () => {
  expect(pathFromAppUrl('chat://community/publications/p1')).toBe('/community/publications/p1')
  expect(pathFromAppUrl('chat:///reflections?q=psalm')).toBe('/reflections?q=psalm')
})

test('keeps the path of an https universal link', () => {
  expect(pathFromAppUrl('https://chat.example/community/publications/p1')).toBe(
    '/community/publications/p1',
  )
})

test('ignores a URL it cannot interpret', () => {
  expect(pathFromAppUrl('not a url')).toBeNull()
  expect(pathFromAppUrl('intent://ignored')).toBeNull()
})
