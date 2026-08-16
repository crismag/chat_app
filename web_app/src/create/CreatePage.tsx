import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { BiblePassage, ConversationSummary } from '@chat/shared'
import {
  CreateStudio,
  deserializeStudioDocument,
  exportStudioDocumentPage,
  serializeStudioDocument,
  type StudioDocument,
  type StudioRenderResult,
} from '@crismag/create-studio'
import '@crismag/create-studio/styles.css'
import { fetchSavedPassage } from '../bible/api.ts'
import { api } from '../shared/api/client.ts'
import {
  CHAT_SQUARE_TEMPLATE,
  availableReflectionFields,
  buildChatStudioDocument,
  defaultReflectionField,
  type ReflectionField,
  type StudioReflectionSource,
} from './host-adapter.ts'
import styles from './CreatePage.module.css'

interface StoredCreation {
  document: unknown
  templateId: string
  templateVersion: number
  exportMetadata: ExportMetadata | null
  updatedAt: string
}

interface ExportMetadata {
  exportedAt: string
  format: 'image/png'
  width: number
  height: number
}

const FIELD_LABELS: Record<ReflectionField, string> = {
  heart: 'Heart',
  application: 'Application',
  testimony: 'Testimony',
  reflection: 'Reflection',
}

function safeFilename(title: string): string {
  const value = title.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
  return `${value || 'reflection'}.png`
}

export function CreatePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [conversationId, setConversationId] = useState(searchParams.get('c') ?? '')
  const [source, setSource] = useState<StudioReflectionSource | null>(null)
  const [passage, setPassage] = useState<BiblePassage | null>(null)
  const [document, setDocument] = useState<StudioDocument | null>(null)
  const [selectedField, setSelectedField] = useState<ReflectionField | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fields = useMemo(() => source ? availableReflectionFields(source) : [], [source])

  useEffect(() => {
    api<ConversationSummary[]>('/conversations')
      .then((items) => {
        setConversations(items)
        setConversationId((current) => items.some(({ id }) => id === current) ? current : (items[0]?.id ?? ''))
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Unable to load reflections'))
  }, [])

  useEffect(() => {
    if (!conversationId) {
      setLoading(false)
      setSource(null)
      setDocument(null)
      return
    }
    let active = true
    setLoading(true)
    setError(null)
    setMessage(null)
    Promise.all([
      api<StudioReflectionSource>(`/conversations/${encodeURIComponent(conversationId)}`),
      fetchSavedPassage(conversationId),
      api<{ creation: StoredCreation | null }>(`/studio-creations/${encodeURIComponent(conversationId)}`),
    ])
      .then(([reflection, savedPassage, saved]) => {
        if (!active) return
        const restored = saved.creation
          ? deserializeStudioDocument(JSON.stringify(saved.creation.document))
          : buildChatStudioDocument(reflection, savedPassage.passage)
        const storedField = restored.metadata?.['selectedField']
        setSource(reflection)
        setPassage(savedPassage.passage)
        setSelectedField(
          typeof storedField === 'string' && ['heart', 'application', 'testimony', 'reflection'].includes(storedField)
            ? storedField as ReflectionField
            : defaultReflectionField(reflection),
        )
        setDocument(restored)
        if (saved.creation) setMessage('Saved Studio document reopened.')
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Unable to open this reflection in Studio'))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [conversationId])

  async function persist(nextDocument: StudioDocument, exportMetadata?: ExportMetadata) {
    const canonical = JSON.parse(serializeStudioDocument(nextDocument)) as unknown
    await api(`/studio-creations/${encodeURIComponent(conversationId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        document: canonical,
        template: CHAT_SQUARE_TEMPLATE,
        ...(exportMetadata ? { exportMetadata } : {}),
      }),
    })
  }

  async function save(nextDocument: StudioDocument) {
    setError(null)
    setMessage('Saving…')
    try {
      await persist(nextDocument)
      setMessage('Saved. This composition will reopen with the reflection.')
    } catch (caught) {
      setMessage(null)
      setError(caught instanceof Error ? caught.message : 'Unable to save the composition')
    }
  }

  async function exportPng(nextDocument: StudioDocument, pageId: string) {
    setError(null)
    setMessage('Preparing PNG…')
    try {
      const result = await exportStudioDocumentPage(nextDocument, { pageId, format: 'png', scale: 1 })
      const url = URL.createObjectURL(result.blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = safeFilename(source?.title ?? nextDocument.title ?? 'reflection')
      link.click()
      URL.revokeObjectURL(url)
      const exportMetadata: ExportMetadata = {
        exportedAt: new Date().toISOString(),
        format: 'image/png',
        width: result.width,
        height: result.height,
      }
      await persist(nextDocument, exportMetadata)
      setMessage(`Exported and saved ${result.width} × ${result.height} PNG.`)
    } catch (caught) {
      setMessage(null)
      setError(caught instanceof Error ? caught.message : 'Unable to export the composition')
    }
  }

  function rebuildFromSelection() {
    if (!source) return
    setDocument(buildChatStudioDocument(source, passage, selectedField))
    setMessage('Card rebuilt from the exact saved reflection. Save to keep it.')
  }

  function reportRender(result: StudioRenderResult) {
    if (result.issues.length > 0) setError(result.issues.map(({ message: issue }) => issue).join(' '))
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className="eyebrow">Create Studio</p>
          <h1>Create an image</h1>
          <p>Text is rendered deterministically in C.H.A.T. and is never sent to an image model.</p>
        </div>
        <label className={styles.reflectionPicker}>
          <span>Reflection</span>
          <select
            value={conversationId}
            onChange={(event) => {
              const id = event.currentTarget.value
              setConversationId(id)
              setSearchParams(id ? { c: id } : {})
            }}
          >
            {conversations.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
      </header>

      {loading ? <p role="status">Opening Studio…</p> : null}
      {!loading && conversations.length === 0 ? <p>Finish a reflection before creating an image.</p> : null}
      {source && fields.length > 0 ? (
        <div className={styles.sourceControls}>
          <label>
            <span>Reflection field on card</span>
            <select value={selectedField ?? ''} onChange={(event) => setSelectedField(event.currentTarget.value as ReflectionField)}>
              {fields.map((field) => <option key={field} value={field}>{FIELD_LABELS[field]}</option>)}
            </select>
          </label>
          <button type="button" className="btn btn-secondary" onClick={rebuildFromSelection}>Rebuild from reflection</button>
        </div>
      ) : null}
      {message ? <p className={styles.status} role="status">{message}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {document ? (
        <div className={styles.studio}>
          <CreateStudio
            document={document}
            onDocumentChange={setDocument}
            onSave={save}
            onExport={exportPng}
            onRenderResult={reportRender}
            capabilities={{ images: false }}
          />
        </div>
      ) : null}
    </section>
  )
}
