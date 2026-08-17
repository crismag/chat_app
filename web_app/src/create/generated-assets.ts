import type {
  StudioAssetResolver,
  StudioGeneratedAssetCallback,
  StudioGeneratedAssetResult,
} from '@crismag/create-studio'
import { api, apiUrl } from '../shared/api/client.ts'

const resolvedAssetUrls = new Map<string, string>()

export interface StudioGeneratedAssetStatus {
  enabled: boolean
}

/** Read capability state without exposing provider identity or configuration. */
export function fetchStudioGeneratedAssetStatus(): Promise<StudioGeneratedAssetStatus> {
  return api<StudioGeneratedAssetStatus>('/studio-assets/status')
}

/** Build the browser-to-host callback for one owner-checked reflection. */
export function createChatGeneratedAssetCallback(conversationId: string): StudioGeneratedAssetCallback {
  return (request) => api<StudioGeneratedAssetResult>(
    `/studio-assets/${encodeURIComponent(conversationId)}/generate`,
    {
      method: 'POST',
      signal: request.signal,
      body: JSON.stringify({
        purpose: request.purpose,
        dimensions: request.dimensions,
        prompt: request.prompt,
        ...(request.negativePrompt ? { negativePrompt: request.negativePrompt } : {}),
        safeArea: request.safeArea,
        ...(request.variationOfAssetId ? { variationOfAssetId: request.variationOfAssetId } : {}),
      }),
    },
  )
}

/** Resolve owner-scoped stable IDs through authenticated host storage. */
export const resolveChatStudioAsset: StudioAssetResolver = async ({ assetId, signal }) => {
  const cached = resolvedAssetUrls.get(assetId)
  if (cached) return { url: cached }
  if (!assetId.startsWith('studio-asset.')) throw new Error('This Studio asset is not registered with C.H.A.T.')
  const response = await fetch(apiUrl(`/studio-assets/${encodeURIComponent(assetId)}`), {
    credentials: 'include',
    signal,
  })
  if (!response.ok) throw new Error('The generated Studio asset is unavailable.')
  const blob = await response.blob()
  if (!blob.type.startsWith('image/')) throw new Error('The generated Studio asset has an unsupported media type.')
  const url = URL.createObjectURL(blob)
  resolvedAssetUrls.set(assetId, url)
  return { url }
}

/** Release session-local object URLs when the Create route unmounts. */
export function releaseChatStudioAssets(): void {
  resolvedAssetUrls.forEach((url) => { URL.revokeObjectURL(url) })
  resolvedAssetUrls.clear()
}
