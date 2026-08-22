/*
 * Notes — a private Keep-like list, not a C.H.A.T. surface.
 *
 * Nothing here is a reflection. There is no verse, no section colour, and no
 * share. The page lists this person's notes, opens one in an overlay, and
 * writes it back with a debounced save. Authorisation happened on the server;
 * this file renders the rows it was given.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError } from '../shared/api/client.ts'
import { Recoverable } from '../shared/ui/Recoverable.tsx'
import { NARROW_QUERY, useMediaQuery } from '../shared/ui/useMediaQuery.ts'
import { useMobileBar } from '../shared/mobile/MobileBar.tsx'
import { NoteCard } from './NoteCard.tsx'
import { NoteEditor } from './NoteEditor.tsx'
import {
  createNote,
  deleteNote,
  listNotes,
  restoreNote,
  updateNote,
  type Note,
  type NoteView,
} from './api.ts'
import styles from './NotesPage.module.css'

const VIEWS: { id: NoteView; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'archived', label: 'Archive' },
  { id: 'trash', label: 'Trash' },
]

const EMPTY: Record<NoteView, { heading: string; body: string }> = {
  active: {
    heading: 'Notes you write will appear here',
    body: 'Create a note to keep something private — a thought, a list, a reminder to yourself.',
  },
  archived: {
    heading: 'Nothing is archived',
    body: 'Archive a note to put it aside without deleting it. It will wait here.',
  },
  trash: {
    heading: 'Trash is empty',
    body: 'Deleted notes stay here until you restore them.',
  },
}

function sortNotes(items: Note[]): Note[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.updatedAt.localeCompare(a.updatedAt)
  })
}

export function NotesPage() {
  const narrow = useMediaQuery(NARROW_QUERY)
  const [view, setView] = useState<NoteView>('active')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [items, setItems] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useMobileBar(() => ({ title: 'Notes' }), [])

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => window.clearTimeout(handle)
  }, [query])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listNotes(view, debouncedQuery)
      setItems(result.items)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Notes could not be loaded just now.')
    } finally {
      setLoading(false)
    }
  }, [view, debouncedQuery])

  useEffect(() => {
    void load()
  }, [load])

  const openNote = items.find((item) => item.id === openId) ?? null
  const pinned = useMemo(() => items.filter((item) => item.pinned), [items])
  const rest = useMemo(() => items.filter((item) => !item.pinned), [items])
  const splitPinned = view !== 'trash' && pinned.length > 0
  const leftover = splitPinned ? rest : items

  function replace(updated: Note) {
    setItems((current) => {
      const belongs =
        view === 'trash' ? updated.deletedAt !== null : updated.deletedAt === null && updated.archived === (view === 'archived')
      const without = current.filter((item) => item.id !== updated.id)
      if (!belongs) return without
      return sortNotes([...without, updated])
    })
  }

  async function handleNew() {
    setCreating(true)
    setError(null)
    try {
      const note = await createNote()
      setView('active')
      setQuery('')
      setDebouncedQuery('')
      setItems((current) => sortNotes([note, ...current.filter((item) => item.id !== note.id)]))
      setOpenId(note.id)
    } catch (caught) {
      /*
       * A visitor creating a note is asked for an account by the API client.
       * If they close that question, this is the original 401 — not a load
       * failure, and not something to shout about on the page.
       */
      if (caught instanceof ApiError && caught.status === 401) return
      setError(caught instanceof ApiError ? caught.message : 'The note could not be created.')
    } finally {
      setCreating(false)
    }
  }

  async function handlePin(note: Note) {
    try {
      replace(await updateNote(note.id, { pinned: !note.pinned }))
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return
      setError(caught instanceof ApiError ? caught.message : 'The note could not be updated.')
    }
  }

  async function handleArchive(note: Note) {
    try {
      const archived = !note.archived
      replace(await updateNote(note.id, { archived, pinned: archived ? false : note.pinned }))
      if (openId === note.id && view === 'active' && archived) setOpenId(null)
      if (openId === note.id && view === 'archived' && !archived) setOpenId(null)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return
      setError(caught instanceof ApiError ? caught.message : 'The note could not be updated.')
    }
  }

  async function handleDelete(note: Note) {
    try {
      replace(await deleteNote(note.id))
      if (openId === note.id) setOpenId(null)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return
      setError(caught instanceof ApiError ? caught.message : 'The note could not be deleted.')
    }
  }

  async function handleRestore(note: Note) {
    try {
      replace(await restoreNote(note.id))
      if (openId === note.id) setOpenId(null)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return
      setError(caught instanceof ApiError ? caught.message : 'The note could not be restored.')
    }
  }

  const empty = EMPTY[view]
  const searching = debouncedQuery.length > 0

  return (
    <section className={styles.page}>
      {narrow ? null : (
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Notes</h1>
            <p className={styles.description}>Private to you. Not a reflection, and not shared.</p>
          </div>
        </header>
      )}

      <div className={styles.toolbar}>
        <button
          type="button"
          className={`btn btn-primary btn-sm ${styles.newNote}`}
          onClick={() => void handleNew()}
          disabled={creating}
        >
          + New note
        </button>
        <label className={styles.searchLabel}>
          <span className={styles.srOnly}>Search notes</span>
          <input
            type="search"
            className={styles.search}
            placeholder="Search notes…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className={styles.views} role="tablist" aria-label="Note views">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={view === item.id}
              className={styles.view}
              data-active={view === item.id ? 'true' : 'false'}
              onClick={() => {
                setView(item.id)
                setOpenId(null)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <Recoverable message={error} onRetry={() => void load()} onDismiss={() => setError(null)} />
      ) : null}

      {loading && items.length === 0 ? (
        <p className={styles.muted} role="status">
          Loading notes…
        </p>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          <h2 className={styles.emptyHeading}>
            {searching ? 'No notes match that search' : empty.heading}
          </h2>
          <p className={styles.emptyBody}>
            {searching ? 'Try a different word, or clear the search to see everything in this view.' : empty.body}
          </p>
        </div>
      ) : (
        <>
          {splitPinned ? <h2 className={styles.section}>Pinned</h2> : null}
          {splitPinned ? (
            <div className={styles.grid}>
              {pinned.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  view={view}
                  onOpen={() => setOpenId(note.id)}
                  onPin={() => void handlePin(note)}
                  onArchive={() => void handleArchive(note)}
                  onDelete={() => void handleDelete(note)}
                  onRestore={() => void handleRestore(note)}
                />
              ))}
            </div>
          ) : null}
          {splitPinned && leftover.length > 0 ? <h2 className={styles.section}>Others</h2> : null}
          {leftover.length > 0 ? (
          <div className={styles.grid}>
            {leftover.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                view={view}
                onOpen={() => setOpenId(note.id)}
                onPin={() => void handlePin(note)}
                onArchive={() => void handleArchive(note)}
                onDelete={() => void handleDelete(note)}
                onRestore={() => void handleRestore(note)}
              />
            ))}
          </div>
          ) : null}
        </>
      )}

      {openNote ? (
        <NoteEditor
          note={openNote}
          view={view}
          onClose={() => setOpenId(null)}
          onSaved={replace}
          onPin={() => void handlePin(openNote)}
          onArchive={() => void handleArchive(openNote)}
          onDelete={() => void handleDelete(openNote)}
          onRestore={() => void handleRestore(openNote)}
        />
      ) : null}
    </section>
  )
}
