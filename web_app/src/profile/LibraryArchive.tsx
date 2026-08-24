/*
 * Download a copy of this person's writing, or bring writing in from a file.
 *
 * Lives on Settings because that is the owner's private toolbox. Exporting is
 * not sharing. Importing always creates new private copies. Guests never see
 * this — they have no profile, and the API refuses them.
 */

import { useId, useState } from 'react'
import {
  ARCHIVE_FORMATS,
  parseLibrary,
  type ArchiveFormat,
  type ArchiveSelection,
  type LibraryArchive,
} from '@chat/shared'

import { ApiError, api, apiUrl } from '../shared/api/client.ts'
import { saveTextFile } from '../shared/native/save-text.ts'
import styles from './SettingsPanel.module.css'

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const match = header.match(/filename="([^"]+)"/i)
  return match?.[1] ?? null
}

async function downloadLibrary(
  selection: ArchiveSelection,
  format: ArchiveFormat,
): Promise<void> {
  const params = new URLSearchParams()
  params.set('reflections', selection.reflections ? '1' : '0')
  params.set('notes', selection.notes ? '1' : '0')
  params.set('format', format)
  const response = await fetch(apiUrl(`/library/export?${params}`), { credentials: 'include' })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as {
      error?: string
    }
    throw new ApiError(body.error ?? 'That download could not be completed.', response.status, body)
  }
  const text = await response.text()
  const filename =
    filenameFromDisposition(response.headers.get('Content-Disposition')) ??
    (format === ARCHIVE_FORMATS.MARKDOWN ? 'chat-library.md' : 'chat-library.json')
  const mime =
    format === ARCHIVE_FORMATS.MARKDOWN ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8'
  await saveTextFile(text, filename, mime)
}

async function importLibrary(
  text: string,
  selection: ArchiveSelection,
): Promise<{ imported: { reflections: number; notes: number }; skipped: { reason: string }[] }> {
  return api('/library/import', {
    method: 'POST',
    body: JSON.stringify({
      text,
      include: { reflections: selection.reflections, notes: selection.notes },
    }),
  })
}

function previewLabel(archive: LibraryArchive): string {
  const reflections = archive.reflections.length
  const notes = archive.notes.length
  const parts: string[] = []
  if (reflections) {
    parts.push(reflections === 1 ? '1 reflection' : `${reflections} reflections`)
  }
  if (notes) {
    parts.push(notes === 1 ? '1 note' : `${notes} notes`)
  }
  if (parts.length === 0) return 'Nothing in this file can be imported with the boxes you ticked.'
  return `${parts.join(' and ')} will be added as private copies.`
}

export function LibraryArchive() {
  const ids = useId()
  const [reflections, setReflections] = useState(true)
  const [notes, setNotes] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{
    text: string
    name: string
    archive: LibraryArchive
  } | null>(null)

  const selection: ArchiveSelection = { reflections, notes }
  const none = !reflections && !notes

  async function download(format: ArchiveFormat) {
    setError(null)
    setNotice('')
    setBusy(true)
    try {
      await downloadLibrary(selection, format)
      setNotice(format === ARCHIVE_FORMATS.MARKDOWN ? 'Markdown downloaded.' : 'JSON downloaded.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That download could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  function chooseFile(file: File | undefined) {
    setError(null)
    setNotice('')
    setPending(null)
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      const parsed = parseLibrary(text)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      setPending({ text, name: file.name, archive: parsed.archive })
    }
    reader.onerror = () => setError('That file could not be read.')
    reader.readAsText(file)
  }

  async function confirmImport() {
    if (!pending) return
    setError(null)
    setNotice('')
    setBusy(true)
    try {
      const result = await importLibrary(pending.text, selection)
      const parts: string[] = []
      if (result.imported.reflections) {
        parts.push(
          result.imported.reflections === 1
            ? '1 reflection'
            : `${result.imported.reflections} reflections`,
        )
      }
      if (result.imported.notes) {
        parts.push(result.imported.notes === 1 ? '1 note' : `${result.imported.notes} notes`)
      }
      const skipped = result.skipped.length
      setNotice(
        parts.length > 0
          ? `Imported ${parts.join(' and ')}.${skipped ? ` ${skipped} skipped.` : ''}`
          : result.skipped[0]?.reason ?? 'Nothing was imported.',
      )
      setPending(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That file could not be imported.')
    } finally {
      setBusy(false)
    }
  }

  const previewArchive = pending
    ? {
        ...pending.archive,
        reflections: reflections ? pending.archive.reflections : [],
        notes: notes ? pending.archive.notes : [],
      }
    : null

  return (
    <section className={styles.group} aria-labelledby={`${ids}-heading`}>
      <h3 className={styles.legend} id={`${ids}-heading`}>
        Your writing
      </h3>
      <p className={styles.help} id={`${ids}-help`}>
        Download a copy of what you have written, or bring writing in from a file. This does not
        share anything. Imported writing stays private.
      </p>

      <div className={styles.checks}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={reflections}
            onChange={(event) => setReflections(event.target.checked)}
          />
          <span className={styles.choiceText}>
            <span className={styles.choiceName}>Reflections</span>
            <span className={styles.choiceBody}>Your C.H.A.T.s, including private drafts.</span>
          </span>
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={notes}
            onChange={(event) => setNotes(event.target.checked)}
          />
          <span className={styles.choiceText}>
            <span className={styles.choiceName}>Notes</span>
            <span className={styles.choiceBody}>Titles and bodies, including archived and trash.</span>
          </span>
        </label>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.help} role="status">
          {notice}
        </p>
      ) : null}

      <div className={styles.archiveActions}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || none}
          onClick={() => void download(ARCHIVE_FORMATS.JSON)}
        >
          Download JSON
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || none}
          onClick={() => void download(ARCHIVE_FORMATS.MARKDOWN)}
        >
          Download Markdown
        </button>
      </div>

      <div className={styles.import}>
        <label className={styles.fileLabel}>
          <span className="btn btn-secondary">{busy ? 'Working…' : 'Choose a file'}</span>
          <input
            className={styles.fileInput}
            type="file"
            accept=".json,.md,.markdown,.txt,application/json,text/markdown,text/plain"
            disabled={busy || none}
            aria-describedby={`${ids}-help`}
            onChange={(event) => {
              chooseFile(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </label>
        <p className={styles.help}>
          JSON from a previous download, or Markdown with headings. Tick what to bring in with the
          boxes above.
        </p>
      </div>

      {previewArchive ? (
        <div className={styles.preview}>
          <p className={styles.help}>
            {pending?.name ? `${pending.name}: ` : ''}
            {previewLabel(previewArchive)}
          </p>
          <div className={styles.archiveActions}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || none || previewArchive.reflections.length + previewArchive.notes.length === 0}
              onClick={() => void confirmImport()}
            >
              Import
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
