const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api'

/** Resolve one API path for non-JSON asset fetches using the same host setting. */
export function apiUrl(path: string): string {
  return `${apiBase}${path}`
}

/**
 * A failed request, carrying what the server actually said.
 *
 * The publication gate answers 422 with a structured report — which field, how
 * long it is, both limits, how many pages it renders to — and an interface that
 * can only say "invalid" has thrown all of that away before it reaches the
 * person who has to act on it. So the body travels with the error.
 */
export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }))
    throw new ApiError(
      (body as { error?: string }).error ?? `Request failed (${response.status})`,
      response.status,
      body,
    )
  }

  if (response.status === 204) return undefined as T
  if (typeof response.text === 'function') {
    const text = await response.text()
    if (!text) return undefined as T
    return JSON.parse(text) as T
  }
  return (await response.json()) as T
}
