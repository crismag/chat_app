import { useEffect, useState } from 'react'
import type { HealthResponse } from '@chat/shared'
import { fetchApiHealth } from './health.ts'
import styles from './ApiHealth.module.css'

type HealthState =
  | { status: 'loading' }
  | { status: 'ok'; timestamp: string }
  | { status: 'error'; message: string }

export function ApiHealth() {
  const [state, setState] = useState<HealthState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    fetchApiHealth()
      .then((health: HealthResponse) => {
        if (!cancelled) {
          setState({ status: 'ok', timestamp: health.timestamp })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'API unavailable',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') {
    return <p className={styles.status}>Checking API…</p>
  }

  if (state.status === 'error') {
    return (
      <p className={`${styles.status} ${styles.error}`} title={state.message}>
        API offline
      </p>
    )
  }

  return (
    <p className={`${styles.status} ${styles.ok}`} title={state.timestamp}>
      API connected
    </p>
  )
}
