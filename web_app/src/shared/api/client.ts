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

/**
 * What to do when the server says this action needs somebody to own it.
 *
 * The API answers a persistent action from a visitor with 401 and
 * `needsAccount`, because creating an account for them silently is the thing
 * this design refuses to do. The interface has to ask -- guest, or sign in --
 * and that question is the same wherever the action started, so it is answered
 * in one place instead of at every call site that might be the first one
 * somebody reaches.
 *
 * The handler resolves true once the caller is somebody, and the request is
 * retried exactly once. False means they closed the question, and the original
 * error travels on so the page can leave what they wrote alone.
 */
export type AccountRequiredHandler = (creationSource: string) => Promise<boolean>

let accountRequired: AccountRequiredHandler | null = null

export function onAccountRequired(handler: AccountRequiredHandler): () => void {
  accountRequired = handler
  return () => {
    if (accountRequired === handler) accountRequired = null
  }
}

function needsAccount(status: number, body: unknown): body is { creationSource?: string } {
  return status === 401 && (body as { needsAccount?: boolean } | null)?.needsAccount === true
}

export async function api<T>(path: string, init?: RequestInit, retrying = false): Promise<T> {
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
    if (!retrying && accountRequired && needsAccount(response.status, body)) {
      const resolved = await accountRequired(body.creationSource ?? 'OTHER_PERSISTENT_ACTION')
      if (resolved) return api<T>(path, init, true)
    }
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
