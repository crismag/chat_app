import { afterEach, expect, test, vi } from 'vitest'
import { shareWithPlatform } from './share.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('copies a public URL when the browser has no share sheet', async () => {
  const writeText = vi.fn(async () => undefined)
  vi.stubGlobal('navigator', {
    clipboard: { writeText },
  })
  await expect(
    shareWithPlatform({ title: 'A reflection', url: 'https://chat.example/p/1' }),
  ).resolves.toBe('copied')
  expect(writeText).toHaveBeenCalledWith('https://chat.example/p/1')
})
