import { ActionMenu } from '../shared/ui/ActionMenu.tsx'
import { MoreIcon } from '../shared/ui/icons.tsx'
import { plainPreview } from './format.ts'
import { ArchiveIcon, PinIcon, RestoreIcon, TrashIcon } from './icons.tsx'
import type { Note, NoteView } from './api.ts'
import styles from './NotesPage.module.css'

const PREVIEW = 160

/*
 * One line of the note, with its formatting taken off.
 *
 * A card is a glance, and `**Groceries**` at a glance is worse than
 * `Groceries` — the syntax is noise exactly where there is least room for it.
 * `plainPreview` keeps a ✓ on finished tasks, which is the one piece of
 * formatting worth carrying into a line this short.
 */
function previewOf(body: string): string {
  const compact = plainPreview(body)
  if (!compact) return ''
  return compact.length > PREVIEW ? `${compact.slice(0, PREVIEW).trimEnd()}…` : compact
}

export function NoteCard({
  note,
  view,
  onOpen,
  onPin,
  onArchive,
  onDelete,
  onRestore,
}: {
  note: Note
  view: NoteView
  onOpen: () => void
  onPin: () => void
  onArchive: () => void
  onDelete: () => void
  onRestore: () => void
}) {
  const title = note.title.trim() || 'Untitled'
  const preview = previewOf(note.body)
  const moreItems =
    view === 'trash'
      ? [
          { label: 'Restore', onSelect: onRestore, icon: <RestoreIcon /> },
        ]
      : [
          {
            label: view === 'archived' ? 'Unarchive' : 'Archive',
            onSelect: onArchive,
            icon: <ArchiveIcon />,
          },
          { label: 'Delete', onSelect: onDelete, icon: <TrashIcon />, danger: true },
        ]

  return (
    <article className={styles.card} data-pinned={note.pinned ? 'true' : 'false'}>
      <button type="button" className={styles.cardOpen} onClick={onOpen}>
        <h3 className={styles.cardTitle}>{title}</h3>
        {preview ? <p className={styles.cardPreview}>{preview}</p> : null}
      </button>
      <div className={styles.cardActions}>
        {view === 'trash' ? (
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Restore"
            onClick={onRestore}
          >
            <RestoreIcon />
          </button>
        ) : (
          <button
            type="button"
            className={styles.iconButton}
            aria-label={note.pinned ? 'Unpin' : 'Pin'}
            aria-pressed={note.pinned}
            onClick={onPin}
          >
            <PinIcon filled={note.pinned} />
          </button>
        )}
        {view !== 'trash' ? (
          <button
            type="button"
            className={`${styles.iconButton} ${styles.cardExtra}`}
            aria-label={view === 'archived' ? 'Unarchive' : 'Archive'}
            onClick={onArchive}
          >
            <ArchiveIcon />
          </button>
        ) : null}
        {view !== 'trash' ? (
          <button
            type="button"
            className={`${styles.iconButton} ${styles.cardExtra}`}
            aria-label="Delete"
            onClick={onDelete}
          >
            <TrashIcon />
          </button>
        ) : null}
        <ActionMenu
          label="More note actions"
          trigger={<MoreIcon />}
          triggerClassName={`${styles.iconButton} ${styles.cardMore}`}
          items={moreItems}
        />
      </div>
    </article>
  )
}
