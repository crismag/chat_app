const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api'

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
    throw new Error((body as { error?: string }).error ?? `Request failed (${response.status})`)
  }

  return (await response.json()) as T
}
