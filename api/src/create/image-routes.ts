import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { SlidingWindowRateLimiter } from '../ai/rate-limit.ts'
import { addressOf } from '../http/address.ts'
import { CAPABILITIES, isEnabled, unavailableReason } from '../http/capabilities.ts'
import type { StudioImageProvider, StudioImageProviderRequest } from './image-provider.ts'
import type { StudioImageAssetStore } from './image-store.ts'

const MAX_DIMENSION = 8192
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const UNSAFE_KEY = /(?:password|secret|api[-_]?key|access[-_]?token|authorization)/i

interface ParsedRequest extends StudioImageProviderRequest {
  variationOfAssetId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizedSafeArea(value: unknown): ParsedRequest['safeArea'] | null {
  if (!isRecord(value)) return null
  const entries = ['x', 'y', 'width', 'height'].map((key) => Number(value[key]))
  if (entries.some((entry) => !Number.isFinite(entry) || entry < 0 || entry > 1)) return null
  const [x, y, width, height] = entries
  if (x === undefined || y === undefined || width === undefined || height === undefined) return null
  if (width <= 0 || height <= 0 || x + width > 1 || y + height > 1) return null
  return { x, y, width, height }
}

function parseRequest(value: unknown): ParsedRequest | null {
  if (!isRecord(value) || !isRecord(value['dimensions'])) return null
  const purpose = value['purpose']
  const width = Number(value['dimensions']['width'])
  const height = Number(value['dimensions']['height'])
  const prompt = typeof value['prompt'] === 'string' ? value['prompt'].trim() : ''
  const negativePrompt = typeof value['negativePrompt'] === 'string' ? value['negativePrompt'].trim() : undefined
  const safeArea = normalizedSafeArea(value['safeArea'])
  const variationOfAssetId = typeof value['variationOfAssetId'] === 'string' ? value['variationOfAssetId'] : undefined
  if (
    !['page-background', 'supporting-image'].includes(String(purpose)) ||
    !Number.isInteger(width) || width < 1 || width > MAX_DIMENSION ||
    !Number.isInteger(height) || height < 1 || height > MAX_DIMENSION ||
    !prompt || prompt.length > 4_000 ||
    (negativePrompt?.length ?? 0) > 2_000 ||
    !safeArea ||
    variationOfAssetId?.includes('://')
  ) return null
  return {
    purpose: purpose as ParsedRequest['purpose'],
    width,
    height,
    prompt,
    ...(negativePrompt ? { negativePrompt } : {}),
    safeArea,
    ...(variationOfAssetId ? { variationOfAssetId } : {}),
  }
}

function safeProvenance(value: unknown): value is Record<string, string | number | boolean | null> {
  return isRecord(value) && Object.entries(value).every(([key, entry]) =>
    !UNSAFE_KEY.test(key) && (entry === null || ['string', 'number', 'boolean'].includes(typeof entry)),
  )
}

export interface StudioImageRouteDependencies {
  provider?: StudioImageProvider
  assets: StudioImageAssetStore
  currentUser(c: Context): Promise<{ id: string } | null>
  ownsConversation(userId: string, conversationId: string): boolean
  now(): string
}

/**
 * How many backgrounds one person, and one address, may generate a minute.
 *
 * Small, because generation is slow and billed per call. The address ceiling
 * is deliberately looser than the account one: it exists to catch many fresh
 * accounts from one place, and a household or an office behind a single
 * address must not be squeezed by it.
 */
const PER_USER_PER_MINUTE = 6
const PER_ADDRESS_PER_MINUTE = 24

/** Authenticated host routes for provider work and stable asset resolution. */
export function createStudioImageRoutes(deps: StudioImageRouteDependencies) {
  /*
   * Generation is slow and expensive, so these are small. The numbers are
   * per minute and are the same shape as the assistance limiter, which is the
   * point: one way of counting, not a second one to reason about.
   */
  const perUser = new SlidingWindowRateLimiter(PER_USER_PER_MINUTE)
  const perAddress = new SlidingWindowRateLimiter(PER_ADDRESS_PER_MINUTE)

  const routes = new Hono()

  routes.get('/status', async (c) => c.json({ enabled: Boolean(deps.provider) }))

  routes.post('/:conversationId/generate', async (c) => {
    /*
     * Image generation is billed per call, so it is switchable on its own —
     * an incident here must not be a reason to stop anybody writing, and it
     * must not require a deploy to stop.
     */
    if (!isEnabled(CAPABILITIES.IMAGE_GENERATION)) {
      return c.json({ error: unavailableReason(CAPABILITIES.IMAGE_GENERATION) }, 503)
    }
    const user = await deps.currentUser(c)
    if (!user) return c.json({ error: 'Unauthenticated.' }, 401)
    const conversationId = c.req.param('conversationId')
    if (!deps.ownsConversation(user.id, conversationId)) return c.json({ error: 'Reflection not found.' }, 404)
    if (!deps.provider) return c.json({ error: 'Generated backgrounds are not configured.' }, 503)

    /*
     * Metered after ownership, before the provider.
     *
     * Every call here costs money once a real model is wired, and nothing
     * upstream limited it: auth, ownership and a kill switch, then straight to
     * the provider. A held-down button was a bill.
     *
     * Per account first, because that is the honest unit — an account is a
     * person, and it cannot be rotated by reconnecting. The address ceiling
     * sits behind it and is deliberately looser: it exists to catch many fresh
     * accounts from one place, and a household or an office behind one address
     * must not be squeezed by it.
     */
    for (const [key, limiter] of [
      [`user:${user.id}`, perUser],
      [`address:${addressOf(c)}`, perAddress],
    ] as const) {
      const decision = limiter.take(key)
      if (!decision.allowed) {
        return c.json(
          {
            error: 'That is a lot of backgrounds at once. Please wait a moment.',
            retryAfterSeconds: decision.retryAfterSeconds,
          },
          429,
          { 'Retry-After': String(decision.retryAfterSeconds) },
        )
      }
    }
    const parsed = parseRequest(await c.req.json().catch(() => null))
    if (!parsed) return c.json({ error: 'The generated-background request is invalid.' }, 400)
    if (parsed.variationOfAssetId) {
      const source = deps.assets.get(parsed.variationOfAssetId)
      if (!source || source.userId !== user.id || source.conversationId !== conversationId) {
        return c.json({ error: 'Variation source not found.' }, 404)
      }
    }
    let result
    try {
      result = await deps.provider.generate({
        purpose: parsed.purpose,
        width: parsed.width,
        height: parsed.height,
        prompt: parsed.prompt,
        ...(parsed.negativePrompt ? { negativePrompt: parsed.negativePrompt } : {}),
        safeArea: parsed.safeArea,
        ...(parsed.variationOfAssetId ? { variationSeed: parsed.variationOfAssetId } : {}),
      }, { signal: c.req.raw.signal })
    } catch (error: unknown) {
      if (c.req.raw.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        return c.json({ error: 'Background generation was cancelled.' }, 408)
      }
      return c.json({ error: 'The image provider could not generate this background.' }, 502)
    }
    if (
      result.width !== parsed.width || result.height !== parsed.height ||
      result.bytes.byteLength === 0 || result.bytes.byteLength > MAX_IMAGE_BYTES ||
      !['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(result.contentType) ||
      (result.provenance && !safeProvenance(result.provenance))
    ) return c.json({ error: 'The image provider returned an invalid asset.' }, 502)
    const id = `studio-asset.${randomUUID()}`
    const provenance = { provider: deps.provider.name, ...result.provenance }
    deps.assets.set({
      id,
      userId: user.id,
      conversationId,
      bytes: result.bytes,
      contentType: result.contentType,
      width: result.width,
      height: result.height,
      provenance,
      createdAt: deps.now(),
    })
    return c.json({ assetId: id, width: result.width, height: result.height, provenance })
  })

  routes.get('/:assetId', async (c) => {
    const user = await deps.currentUser(c)
    if (!user) return c.json({ error: 'Unauthenticated.' }, 401)
    const asset = deps.assets.get(c.req.param('assetId'))
    if (!asset || asset.userId !== user.id) return c.json({ error: 'Asset not found.' }, 404)
    return new Response(asset.bytes, {
      headers: {
        'Content-Type': asset.contentType,
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })

  return routes
}
