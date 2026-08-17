/** Provider-neutral image-generation request owned by the C.H.A.T. backend. */
export interface StudioImageProviderRequest {
  purpose: 'page-background' | 'supporting-image'
  width: number
  height: number
  prompt: string
  negativePrompt?: string
  safeArea: { x: number; y: number; width: number; height: number }
  variationSeed?: string
}

/** Encoded provider output before host-owned permanent registration. */
export interface StudioImageProviderResult {
  bytes: Uint8Array
  contentType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml'
  width: number
  height: number
  provenance?: Record<string, string | number | boolean | null>
}

/** Server-only provider seam. Implementations own credentials and vendor SDKs. */
export interface StudioImageProvider {
  readonly name: string
  generate(
    request: StudioImageProviderRequest,
    options: { signal: AbortSignal },
  ): Promise<StudioImageProviderResult>
}

function promptSeed(prompt: string, variationSeed = ''): number {
  return Array.from(`${prompt}:${variationSeed}`).reduce(
    (value, character) => (value * 31 + (character.codePointAt(0) ?? 0)) >>> 0,
    2166136261,
  )
}

/**
 * Original deterministic development provider. It proves provider swapping and
 * asset persistence without claiming AI output or requiring a credential.
 */
export class DeterministicStudioImageProvider implements StudioImageProvider {
  readonly name = 'deterministic-fixture'

  generate(
    request: StudioImageProviderRequest,
    options: { signal: AbortSignal },
  ): Promise<StudioImageProviderResult> {
    if (options.signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'))
    const seed = promptSeed(request.prompt, request.variationSeed)
    const hue = seed % 360
    const secondary = (hue + 42) % 360
    const tertiary = (hue + 96) % 360
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${request.width}" height="${request.height}" viewBox="0 0 ${request.width} ${request.height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 42% 28%)"/><stop offset="0.55" stop-color="hsl(${secondary} 38% 48%)"/><stop offset="1" stop-color="hsl(${tertiary} 48% 70%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="12%" cy="16%" r="24%" fill="white" opacity="0.10"/><circle cx="90%" cy="86%" r="31%" fill="white" opacity="0.10"/></svg>`
    return Promise.resolve({
      bytes: new TextEncoder().encode(svg),
      contentType: 'image/svg+xml',
      width: request.width,
      height: request.height,
      provenance: { generator: this.name, generatorVersion: 1, seed },
    })
  }
}
