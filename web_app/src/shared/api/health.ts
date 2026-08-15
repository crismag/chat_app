import type { HealthResponse } from '@chat/shared'

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api'

export async function fetchApiHealth(): Promise<HealthResponse> {
  const response = await fetch(`${apiBase}/health`)

  if (!response.ok) {
    throw new Error(`Health check failed (${response.status})`)
  }

  return (await response.json()) as HealthResponse
}
