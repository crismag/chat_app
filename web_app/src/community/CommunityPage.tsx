import { useEffect, useState } from 'react'
import type { ConversationSummary } from '@chat/shared'
import { api } from '../shared/api/client.ts'
import styles from '../library/LibraryPage.module.css'

export function CommunityPage() {
  const [items, setItems] = useState<ConversationSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<ConversationSummary[]>('/community')
      .then(setItems)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Unable to load community')
      })
  }, [])

  return (
    <section className={styles.page}>
      <h1>Community</h1>
      <p>Only C.H.A.T.s that someone explicitly published appear here.</p>
      {error ? <p>{error}</p> : null}
      {items.length === 0 ? <p>No published entries yet.</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <span>{item.title}</span>
            <span>{item.scriptureReference}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
