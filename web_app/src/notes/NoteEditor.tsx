import { useEffect, useId, useRef, useState } from 'react'
import { NARROW_QUERY, useMediaQuery } from '../shared/ui/useMediaQuery.ts'
import { ArchiveIcon, CloseIcon, PinIcon, RestoreIcon, TrashIcon } from './icons.tsx'
import { updateNote, type Note, type NoteView } from './api.ts'
import styles from './NoteEditor.module.css'

const SAVE_DEBOUNCE_MS = 600
const TITLE_MAX = 200
const BODY_MAX = 20_000

type SaveStatus = 'editing' | 'saving' | 'saved' | 'failed' | 'idle'

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: '',
  editing: 'Editing',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'Save failed',
}

export function NoteEditor({
  note,
  view,
  onClose,
  onSaved,
  onPin,
  onArchive,
  onDelete,
  onRestore,
}: {
  note: Note
  view: NoteView
  onClose: () => void
  onSaved: (note: Note) => void
  onPin: () => void
  onArchive: () => void
  onDelete: () => void
  onRestore: () => void
}) {
  const narrow = useMediaQuery(NARROW_QUERY)
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const titleId = useId()
  const bodyId = useId()
  const titleRef = useRef<HTMLInputElement>(null)
  const saveGen = useRef(0)
  const timer = useRef(0)
  const savedSnap = useRef({ title: note.title, body: note.body })
  const latest = useRef({ title: note.title, body: note.body })
  const closeRef = useRef<() => Promise<void>>(async () => {})
  const openedId = useRef(note.id)
  latest.current = { title, body }

  useEffect(() => {
    if (openedId.current === note.id) return
    openedId.current = note.id
    setTitle(note.title)
    setBody(note.body)
    savedSnap.current = { title: note.title, body: note.body }
    setStatus('idle')
    saveGen.current = 0
  }, [note.id, note.title, note.body])

  useEffect(() => {
    titleRef.current?.focus()
  }, [note.id])

  useEffect(() => {
    if (title === savedSnap.current.title && body === savedSnap.current.body) return
    saveGen.current += 1
    setStatus('editing')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      void persist()
    }, SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer.current)
    // persist reads latest via ref; recreating it every render would reschedule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body])

  async function persist(): Promise<boolean> {
    const snapshot = latest.current
    const gen = ++saveGen.current
    setStatus('saving')
    try {
      const saved = await updateNote(note.id, { title: snapshot.title, body: snapshot.body })
      if (gen !== saveGen.current) return false
      savedSnap.current = { title: snapshot.title, body: snapshot.body }
      setStatus('saved')
      onSaved(saved)
      return true
    } catch {
      if (gen !== saveGen.current) return false
      setStatus('failed')
      return false
    }
  }

  async function handleClose() {
    window.clearTimeout(timer.current)
    const dirty =
      latest.current.title !== savedSnap.current.title || latest.current.body !== savedSnap.current.body
    if (dirty) await persist()
    onClose()
  }
  closeRef.current = handleClose

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      void closeRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = previous
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id])

  return (
    <div className={styles.root} data-shape={narrow ? 'sheet' : 'dialog'}>
      <button
        type="button"
        className={styles.scrim}
        aria-label="Close note"
        onClick={() => void handleClose()}
      />
      <div className={styles.surface} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className={styles.head}>
          <p className={styles.status} aria-live="polite">
            {STATUS_LABEL[status]}
          </p>
          <div className={styles.headActions}>
            {view === 'trash' ? (
              <button type="button" className={styles.iconButton} aria-label="Restore" onClick={onRestore}>
                <RestoreIcon />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={note.pinned ? 'Unpin' : 'Pin'}
                  aria-pressed={note.pinned}
                  onClick={onPin}
                >
                  <PinIcon filled={note.pinned} />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={note.archived ? 'Unarchive' : 'Archive'}
                  onClick={onArchive}
                >
                  <ArchiveIcon />
                </button>
                <button type="button" className={styles.iconButton} aria-label="Delete" onClick={onDelete}>
                  <TrashIcon />
                </button>
              </>
            )}
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Close"
              onClick={() => void handleClose()}
            >
              <CloseIcon />
            </button>
          </div>
        </header>

        <label className={styles.srOnly} htmlFor={titleId}>
          Note title
        </label>
        <input
          ref={titleRef}
          id={titleId}
          className={styles.title}
          value={title}
          maxLength={TITLE_MAX}
          placeholder="Title"
          onChange={(event) => setTitle(event.target.value)}
        />

        <label className={styles.srOnly} htmlFor={bodyId}>
          Note
        </label>
        <textarea
          id={bodyId}
          className={styles.body}
          value={body}
          maxLength={BODY_MAX}
          placeholder="Write a note…"
          onChange={(event) => setBody(event.target.value)}
        />
      </div>
    </div>
  )
}
