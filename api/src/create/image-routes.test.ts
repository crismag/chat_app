import { describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../app.ts'
import { SqliteStore } from '../db.ts'
import { MemoryStore } from '../store.ts'
import { cookieHeader } from '../http/set-cookie.ts'
import {
  DeterministicStudioImageProvider,
  type StudioImageProvider,
} from './image-provider.ts'

async function register(app: ReturnType<typeof createApp>, email: string) {
  const response = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret12' }),
  })
  return cookieHeader(response.headers.get('set-cookie'))
}

async function createReflection(app: ReturnType<typeof createApp>, cookie: string) {
  const response = await app.request('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: 'Generated background', scriptureReference: 'Psalm 23:2' }),
  })
  return (await response.json()) as { id: string }
}

function generationBody(variationOfAssetId?: string) {
  return {
    purpose: 'page-background',
    dimensions: { width: 1080, height: 1080 },
    prompt: 'Quiet green fields with an uncluttered center',
    negativePrompt: 'words, letters, typography',
    safeArea: { x: 0.15, y: 0.18, width: 0.7, height: 0.64 },
    ...(variationOfAssetId ? { variationOfAssetId } : {}),
  }
}

describe('Studio generated-image host routes', () => {
  test('reports disabled until a server-side provider is connected', async () => {
    const app = createApp(new MemoryStore())
    const response = await app.request('/api/studio-assets/status')
    expect(await response.json()).toEqual({ enabled: false })
  })

  test('generates, stores, resolves, and varies an owner-scoped stable asset', async () => {
    const app = createApp(new MemoryStore(), {}, { provider: new DeterministicStudioImageProvider() })
    const cookie = await register(app, 'generated@example.com')
    const reflection = await createReflection(app, cookie)
    const path = `/api/studio-assets/${reflection.id}/generate`
    const response = await app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(generationBody()),
    })
    expect(response.status).toBe(200)
    const generated = (await response.json()) as {
      assetId: string
      width: number
      height: number
      provenance: Record<string, unknown>
    }
    expect(generated).toMatchObject({
      assetId: expect.stringMatching(/^studio-asset\./),
      width: 1080,
      height: 1080,
      provenance: { provider: 'deterministic-fixture', generatorVersion: 1 },
    })
    expect(JSON.stringify(generated)).not.toMatch(/prompt|secret|credential|api.?key/i)

    const asset = await app.request(`/api/studio-assets/${generated.assetId}`, { headers: { Cookie: cookie } })
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toContain('image/svg+xml')
    expect(await asset.text()).toMatch(/^<svg/)

    const variation = await app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(generationBody(generated.assetId)),
    })
    expect(variation.status).toBe(200)
    expect(await variation.json()).toEqual(expect.objectContaining({
      assetId: expect.not.stringMatching(new RegExp(`^${generated.assetId}$`)),
    }))

    const strangerCookie = await register(app, 'generated-stranger@example.com')
    const hidden = await app.request(`/api/studio-assets/${generated.assetId}`, { headers: { Cookie: strangerCookie } })
    expect(hidden.status).toBe(404)
  })

  test('validates inputs and replaces provider failures with application copy', async () => {
    const failingProvider: StudioImageProvider = {
      name: 'private-provider-name',
      generate: () => Promise.reject(new Error('https://provider.example/project/secret-detail')),
    }
    const app = createApp(new MemoryStore(), {}, { provider: failingProvider })
    const cookie = await register(app, 'generated-failure@example.com')
    const reflection = await createReflection(app, cookie)
    const path = `/api/studio-assets/${reflection.id}/generate`
    const invalid = await app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ...generationBody(), prompt: '' }),
    })
    expect(invalid.status).toBe(400)

    const failure = await app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(generationBody()),
    })
    expect(failure.status).toBe(502)
    expect(JSON.stringify(await failure.json())).not.toMatch(/private-provider|provider\.example|secret-detail/)
  })

  test('keeps generated assets available after the SQLite host restarts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'chat-studio-images-'))
    const location = join(directory, 'chat.sqlite')
    try {
      const firstStore = new SqliteStore(location)
      const firstApp = createApp(firstStore, {}, { provider: new DeterministicStudioImageProvider() })
      const cookie = await register(firstApp, 'generated-restart@example.com')
      const reflection = await createReflection(firstApp, cookie)
      const response = await firstApp.request(`/api/studio-assets/${reflection.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(generationBody()),
      })
      const generated = (await response.json()) as { assetId: string }
      firstStore.close()

      const secondStore = new SqliteStore(location)
      const secondApp = createApp(secondStore)
      const asset = await secondApp.request(`/api/studio-assets/${generated.assetId}`, { headers: { Cookie: cookie } })
      expect(asset.status).toBe(200)
      expect(await asset.text()).toMatch(/^<svg/)
      secondStore.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('Studio generation is metered', () => {
  /*
   * Every generate costs money once a real model is wired, and nothing
   * upstream limited it: auth, ownership, a kill switch, then the provider.
   * A held-down button was a bill.
   */
  test('a burst is refused with Retry-After, and the honest first call is not', async () => {
    const app = createApp(new SqliteStore(), {}, { provider: new DeterministicStudioImageProvider() })
    const cookie = await register(app, 'burst@example.com')
    const reflection = await createReflection(app, cookie)
    const path = `/api/studio-assets/${reflection.id}/generate`

    const generate = () =>
      app.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(generationBody()),
      })

    const statuses: number[] = []
    for (let attempt = 0; attempt < 8; attempt += 1) {
      statuses.push((await generate()).status)
    }

    /* The first ones work. Somebody trying a few backgrounds is not abuse. */
    expect(statuses[0]).toBe(200)
    expect(statuses.filter((status) => status === 200).length).toBeGreaterThanOrEqual(6)
    expect(statuses.at(-1)).toBe(429)

    const refused = await generate()
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0)
    const body = (await refused.json()) as { error: string; retryAfterSeconds: number }
    /* Said as a wait, not as a failure: it ends, and the person can be told when. */
    expect(body.error).toMatch(/wait a moment/i)
    expect(body.retryAfterSeconds).toBeGreaterThan(0)
  })

  test('one person exhausting their allowance does not spend anybody else\'s', async () => {
    const app = createApp(new SqliteStore(), {}, { provider: new DeterministicStudioImageProvider() })
    const heavy = await register(app, 'heavy@example.com')
    const quiet = await register(app, 'quiet@example.com')
    const theirs = await createReflection(app, heavy)
    const mine = await createReflection(app, quiet)

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await app.request(`/api/studio-assets/${theirs.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: heavy },
        body: JSON.stringify(generationBody()),
      })
    }

    /*
     * The account ceiling is the one that bit. The address ceiling is looser
     * on purpose, so a household or an office behind one address is not
     * squeezed by whoever generated first.
     */
    const other = await app.request(`/api/studio-assets/${mine.id}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: quiet },
      body: JSON.stringify(generationBody()),
    })
    expect(other.status).toBe(200)
  })
})
