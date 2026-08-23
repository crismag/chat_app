const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api'

/** Resolve one API path for non-JSON asset fetches using the same host setting. */
export function apiUrl(path: string): string {
  return `${apiBase}${path}`
}

/**
 * The API's own origin — scheme and host, nothing else — derived from the
 * same setting `apiUrl` reads.
 *
 * `apiBase` is `https://chatapi.crishub.com/api` in production and the bare
 * `/api` in development, where the dev server proxies it. Resolving either one
 * against `window.location.origin` always yields an absolute origin: the
 * API's real host in production, and the page's own origin in development —
 * which is exactly where the dev proxy already sends it, so nothing changes
 * there.
 */
function apiOrigin(): string {
  return new URL(apiBase, window.location.origin).origin
}

/**
 * A path the server already built whole, resolved against the API rather than
 * the page.
 *
 * `avatarUrl` in a profile or a messaging payload arrives as `/api/...` — a
 * path rooted at the *API's* domain, because that is where the route lives.
 * Used as-is in an `<img src>`, a browser resolves a path with nothing in
 * front of it against the page's own origin instead, which is the web app's
 * host wherever the two differ. That is the read-side twin of the mistake
 * `apiUrl` exists to prevent on the write side — a fetch written as a bare
 * `/api/...` reaching the static host instead of the API — except a broken
 * image fails silently into a fallback with no message at all: the picture
 * really was uploaded, and the person who uploaded it has no way to tell that
 * from a picture that never saved.
 *
 * A path that is already absolute — `https://...`, or a local `blob:` from a
 * picture not yet uploaded — is returned unchanged.
 */
export function resolveApiPath(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path
  return `${apiOrigin()}${path}`
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

/**
 * What the browser says when it could not reach the server at all.
 *
 * "Failed to fetch" is Chrome's wording for every network-level failure —
 * the API being down, DNS, a blocked CORS preflight, a lost connection. Shown
 * to somebody typing a password it reads like "your password is wrong, in a
 * strange font", and there is no way to tell the two apart. This is the
 * distinction the interface owes them.
 */
export const UNREACHABLE_STATUS = 0;
export const UNREACHABLE_MESSAGE =
  'We could not reach C.H.A.T. just now — this is us, not you, and nothing you typed was wrong. Check your connection, or try again in a moment.';

export async function api<T>(path: string, init?: RequestInit, retrying = false): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (caught: unknown) {
    /*
     * Never reached the server. Status 0 rather than a made-up one, so
     * anything deciding what to do can tell "no answer" from "an answer that
     * happened to be a failure" — a sign-in form should offer to retry here
     * and should not mark the password field wrong.
     */
    throw new ApiError(UNREACHABLE_MESSAGE, UNREACHABLE_STATUS, { cause: String(caught) });
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    /*
     * The gateway answers 502 when the API process is not running. That is the
     * same fact as a failed fetch from the person's point of view, so it gets
     * the same sentence rather than "Bad Gateway".
     */
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      const stated = (body as { error?: string }).error;
      throw new ApiError(
        stated && !/gateway|unavailable/i.test(stated) ? stated : UNREACHABLE_MESSAGE,
        response.status,
        body,
      );
    }
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
