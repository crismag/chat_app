import { useState, type FormEvent } from 'react'
import type { ConversationSummary } from '@chat/shared'
import { api } from '../shared/api/client.ts'
import styles from './LibraryPage.module.css'

function readLibrary(body: unknown): ConversationSummary[] {
  if (Array.isArray(body)) return body as ConversationSummary[]
  const items = (body as { items?: ConversationSummary[] })?.items
  return Array.isArray(items) ? items : []
}

export function LibraryPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ConversationSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  async function search(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      setResults(
        readLibrary(await api<unknown>(`/library?q=${encodeURIComponent(query)}`)),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Search failed')
    }
  }

  return (
    <section className={styles.page}>
      <h1>Library</h1>
      <p>Search only your private conversations and Scripture references.</p>
      <form onSubmit={(event) => void search(event)}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Title, verse, or words you wrote"
        />
        <button type="submit">Search</button>
      </form>
      {error ? <p>{error}</p> : null}
      <ul>
        {results.map((item) => (
          <li key={item.id}>
            <a href={`/?c=${item.id}`}>{item.title}</a>
            <span>{item.scriptureReference}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
