import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createChatGeneratedAssetCallback,
  fetchStudioGeneratedAssetStatus,
  releaseChatStudioAssets,
  resolveChatStudioAsset,
} from './generated-assets.ts'

afterEach(() => {
  releaseChatStudioAssets()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('C.H.A.T. generated-asset browser adapter', () => {
  test('passes only provider-neutral fields to the authenticated host endpoint', async () => {
    let body: Record<string, unknown> | undefined
    const fetchMock = vi.fn((_input: RequestInfo, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          assetId: 'studio-asset.generated-1',
          width: 1080,
          height: 1080,
          provenance: { provider: 'host-provider', modelVersion: 'safe-v1' },
        }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const callback = createChatGeneratedAssetCallback('reflection-1')
    const result = await callback({
      purpose: 'page-background',
      pageId: 'page.square',
      dimensions: { width: 1080, height: 1080 },
      prompt: 'Quiet field at dawn',
      negativePrompt: 'words',
      safeArea: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      metadata: { sourceApplication: 'chat_app', sourceReflectionId: 'reflection-1' },
      signal: controller.signal,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/studio-assets/reflection-1/generate'),
      expect.objectContaining({ method: 'POST', credentials: 'include', signal: controller.signal }),
    )
    expect(body).toEqual({
      purpose: 'page-background',
      dimensions: { width: 1080, height: 1080 },
      prompt: 'Quiet field at dawn',
      negativePrompt: 'words',
      safeArea: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    })
    expect(JSON.stringify(body)).not.toMatch(/metadata|provider|credential|api.?key/i)
    expect(result.assetId).toBe('studio-asset.generated-1')
  })

  test('reads capability state and resolves only stable owner-scoped assets', async () => {
    const createObjectURL = vi.fn(() => 'blob:chat-generated-asset')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const fetchMock = vi.fn((input: RequestInfo) => {
      const url = String(input)
      if (url.endsWith('/studio-assets/status')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ enabled: true }) })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob(['image'], { type: 'image/png' })),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchStudioGeneratedAssetStatus()).resolves.toEqual({ enabled: true })
    const resolved = await resolveChatStudioAsset({
      assetId: 'studio-asset.generated-1',
      purpose: 'page-background',
      pageId: 'page.square',
      signal: new AbortController().signal,
    })
    expect(resolved).toEqual({ url: 'blob:chat-generated-asset' })
    await expect(resolveChatStudioAsset({
      assetId: 'https://temporary.example/image',
      purpose: 'page-background',
      pageId: 'page.square',
      signal: new AbortController().signal,
    })).rejects.toThrow(/not registered/)
    releaseChatStudioAssets()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:chat-generated-asset')
  })
})
