import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  CREATE_FORMATS,
  CREATE_LAYOUTS,
  CREATE_STYLES,
  type BiblePassage,
  type ConversationSummary,
  type CreateFormat,
  type CreateLayout,
  type CreateStyle,
} from '@chat/shared'
import {
  CreateStudio,
  deserializeStudioDocument,
  exportStudioDocumentPage,
  exportStudioDocumentPages,
  serializeStudioDocument,
  type StudioDocument,
  type StudioEditorIssue,
  type StudioRenderResult,
} from '@crismag/create-studio'
import '@crismag/create-studio/styles.css'
import { fetchSavedPassage } from '../bible/api.ts'
import { api } from '../shared/api/client.ts'
import { savePng } from '../shared/native/save-image.ts'
import {
  CHAT_STUDIO_CAPABILITIES,
  CHAT_STUDIO_TEMPLATE,
  CHAT_STUDIO_TEMPLATES,
  availableReflectionFields,
  buildChatStudioDocument,
  defaultReflectionField,
  readComposeOptions,
  usesSelectedField,
  type ReflectionField,
  type StudioReflectionSource,
} from './host-adapter.ts'
import { collectOverflowingText, fitChatStudioDocument } from './overflow.ts'
import { applyChatStudioStyle } from './styles.ts'
import { NARROW_QUERY, useMediaQuery } from '../shared/ui/useMediaQuery.ts'
import { useMobileBar } from '../shared/mobile/MobileBar.tsx'
import { Sheet } from '../shared/mobile/Sheet.tsx'
import { BackIcon, MoreIcon } from '../shared/ui/icons.tsx'
import styles from './CreatePage.module.css'
import {
  createChatGeneratedAssetCallback,
  fetchStudioGeneratedAssetStatus,
  releaseChatStudioAssets,
  resolveChatStudioAsset,
} from './generated-assets.ts'

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

const LAYOUT_LABELS: Record<CreateLayout, string> = {
  [CREATE_LAYOUTS.QUOTE_FOCUS]: 'Quote focus',
  [CREATE_LAYOUTS.VERSE_REFLECTION]: 'Verse + reflection',
  [CREATE_LAYOUTS.CHAT_STACKED]: 'Full C.H.A.T. stacked',
  [CREATE_LAYOUTS.CHAT_TWO_COLUMN]: 'Full C.H.A.T. two-column',
}

const STYLE_LABELS: Record<CreateStyle, string> = {
  [CREATE_STYLES.CREAM_BOTANICAL]: 'Cream botanical',
  [CREATE_STYLES.MODERN_MINIMAL]: 'Modern minimal',
  [CREATE_STYLES.DARK_WORSHIP]: 'Dark worship',
  [CREATE_STYLES.WARM_PHOTOGRAPHIC]: 'Warm photographic overlay',
  [CREATE_STYLES.JOURNAL_PAPER]: 'Journal / paper',
}

const FORMAT_LABELS: Record<CreateFormat, string> = {
  [CREATE_FORMATS.SQUARE]: 'Square',
  [CREATE_FORMATS.PORTRAIT]: 'Portrait',
}

function safeFilename(title: string): string {
  const value = title.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
  return value || 'reflection'
}

export function CreatePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [conversationId, setConversationId] = useState(searchParams.get('c') ?? '')
  const [source, setSource] = useState<StudioReflectionSource | null>(null)
  const [passage, setPassage] = useState<BiblePassage | null>(null)
  const [document, setDocument] = useState<StudioDocument | null>(null)
  const [layout, setLayout] = useState<CreateLayout>(CREATE_LAYOUTS.CHAT_STACKED)
  const [style, setStyle] = useState<CreateStyle>(CREATE_STYLES.CREAM_BOTANICAL)
  const [format, setFormat] = useState<CreateFormat>(CREATE_FORMATS.PORTRAIT)
  const [selectedField, setSelectedField] = useState<ReflectionField | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generatedAssetsEnabled, setGeneratedAssetsEnabled] = useState(false)
  const navigate = useNavigate()
  const narrow = useMediaQuery(NARROW_QUERY)
  /*
   * The setup questions are asked once, in a sheet, and then get out of the
   * way. They open by themselves while there is nothing to look at, because
   * that is the only moment they are the point; once a composition exists the
   * canvas is the point and these are revisited deliberately.
   */
  const [setupOpen, setSetupOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  /*
   * Saving has its own state, rather than being read off the page's general
   * error.
   *
   * Deriving it from `error` meant every failure on the screen — a reflection
   * that would not load, a passage lookup, text overflowing its box — was
   * reported in the bar as "Save failed", which is a specific and alarming
   * claim about somebody's work that was usually untrue.
   */
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const fields = useMemo(() => source ? availableReflectionFields(source) : [], [source])
  const overflowCount = document ? collectOverflowingText(document).length : 0
  const generatedAssetCallback = useMemo(
    () => conversationId && generatedAssetsEnabled ? createChatGeneratedAssetCallback(conversationId) : undefined,
    [conversationId, generatedAssetsEnabled],
  )

  useEffect(() => {
    fetchStudioGeneratedAssetStatus()
      .then(({ enabled }) => { setGeneratedAssetsEnabled(enabled) })
      .catch(() => { setGeneratedAssetsEnabled(false) })
    return releaseChatStudioAssets
  }, [])

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
          : null
        const compose = readComposeOptions(restored)
        const field = compose.selectedField ?? defaultReflectionField(reflection)
        setSource(reflection)
        setPassage(savedPassage.passage)
        setLayout(compose.layout)
        setStyle(compose.style)
        setFormat(compose.format)
        setSelectedField(field)
        setDocument(restored ?? buildChatStudioDocument(reflection, savedPassage.passage, field, compose))
        if (saved.creation) setMessage('Saved Studio document reopened.')
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Unable to open this reflection in Studio'))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [conversationId])

  /*
   * The setup sheet opens itself while there is nothing to look at, and only
   * then. Once a document exists the canvas is the point, and these questions
   * are revisited on purpose rather than met on arrival.
   */
  useEffect(() => {
    if (!narrow) return
    if (loading) return
    if (document) return
    if (conversations.length === 0) return
    setSetupOpen(true)
  }, [narrow, loading, document, conversations.length])

  async function persist(nextDocument: StudioDocument, exportMetadata?: ExportMetadata) {
    const canonical = JSON.parse(serializeStudioDocument(nextDocument)) as unknown
    await api(`/studio-creations/${encodeURIComponent(conversationId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        document: canonical,
        template: CHAT_STUDIO_TEMPLATE,
        ...(exportMetadata ? { exportMetadata } : {}),
      }),
    })
  }

  async function save(nextDocument: StudioDocument) {
    setError(null)
    setMessage('Saving…')
    setSaveStatus('saving')
    try {
      await persist(nextDocument)
      setMessage('Saved. This composition will reopen with the reflection.')
      setSaveStatus('saved')
    } catch (caught) {
      setMessage(null)
      setError(caught instanceof Error ? caught.message : 'Unable to save the composition')
      setSaveStatus('failed')
    }
  }

  async function exportPng(nextDocument: StudioDocument, pageId: string) {
    setError(null)
    setMessage('Preparing PNG…')
    try {
      const result = await exportStudioDocumentPage(
        nextDocument,
        { pageId, format: 'png', scale: 1 },
        { assetResolver: resolveChatStudioAsset },
      )
      const filename = `${safeFilename(source?.title ?? nextDocument.title ?? 'reflection')}.png`
      const saved = await savePng(result.blob, filename)
      const exportMetadata: ExportMetadata = {
        exportedAt: new Date().toISOString(),
        format: 'image/png',
        width: result.width,
        height: result.height,
      }
      await persist(nextDocument, exportMetadata)
      setMessage(
        saved === 'shared'
          ? `Exported ${result.width} × ${result.height} PNG. Choose where to save it.`
          : `Exported and saved ${result.width} × ${result.height} PNG.`,
      )
    } catch (caught) {
      setMessage(null)
      setError(caught instanceof Error ? caught.message : 'Unable to export the composition')
    }
  }

  async function exportAll(nextDocument: StudioDocument) {
    setError(null)
    setMessage('Preparing carousel PNGs…')
    try {
      const result = await exportStudioDocumentPages(
        nextDocument,
        { format: 'png', scale: 1 },
        { assetResolver: resolveChatStudioAsset },
      )
      const base = safeFilename(source?.title ?? nextDocument.title ?? 'reflection')
      let last = result.pages[0]
      for (const page of result.pages) {
        last = page
        await savePng(page.blob, `${base}-${String(page.pageNumber).padStart(2, '0')}.png`)
      }
      if (last) {
        await persist(nextDocument, {
          exportedAt: new Date().toISOString(),
          format: 'image/png',
          width: last.width,
          height: last.height,
        })
      }
      setMessage(`Exported ${result.pages.length} PNG${result.pages.length === 1 ? '' : 's'} for this carousel.`)
    } catch (caught) {
      setMessage(null)
      setError(caught instanceof Error ? caught.message : 'Unable to export the carousel')
    }
  }

  function composeFromSource(
    nextLayout = layout,
    nextStyle = style,
    nextFormat = format,
    nextField = selectedField,
  ) {
    if (!source) return
    setDocument(buildChatStudioDocument(source, passage, nextField, {
      layout: nextLayout,
      style: nextStyle,
      format: nextFormat,
      selectedField: nextField,
    }))
    setMessage('Card rebuilt from the exact saved reflection. Save to keep it.')
  }

  function changeStyle(next: CreateStyle) {
    setStyle(next)
    setDocument((current) => current ? applyChatStudioStyle(current, next) : current)
  }

  function splitOverflow() {
    if (!document) return
    const fitted = fitChatStudioDocument(document)
    setDocument(fitted.document)
    setMessage(
      fitted.overflowRemaining.length > 0
        ? 'Some text still does not fit the readable minimum. Shorten it, or choose a stacked layout.'
        : 'Leftover words were moved onto following cards. Save to keep the carousel.',
    )
  }

  function reportRender(result: StudioRenderResult) {
    if (result.issues.length > 0) setError(result.issues.map(({ message: issue }) => issue).join(' '))
  }

  function reportEditorIssue(issue: StudioEditorIssue) {
    if (issue.severity === 'info') return
    if (issue.code === 'transform-rejected' || issue.code === 'stale-runtime-event' || issue.code === 'document-invalid') {
      setMessage(issue.message)
      return
    }
    setError(issue.message)
  }

  /*
   * A quiet word about saving, rather than a paragraph.
   *
   * The page already tracks a sentence for each outcome; the bar needs the
   * state behind it, which is what somebody glances at while working.
   */
  const saveState =
    saveStatus === 'saving'
      ? 'Saving…'
      : saveStatus === 'saved'
        ? 'Saved'
        : saveStatus === 'failed'
          ? 'Save failed'
          : ''

  useMobileBar(
    () => ({
      title: source?.title ?? 'Create visual',
      immersive: true,
      replace: (
        <div className={styles.editorBar}>
          <button
            type="button"
            className={styles.barButton}
            aria-label="Back to the reflection"
            onClick={() => {
              /*
               * Back to the reflection this belongs to, not into whatever the
               * history happens to hold. Saving is the Studio's own callback
               * and has already run for every edit, so nothing is dropped by
               * leaving.
               */
              void navigate(conversationId ? `/reflections/${conversationId}` : '/reflections')
            }}
          >
            <BackIcon className={styles.barIcon} />
          </button>
          <h1 className={styles.barTitle}>{source?.title ?? 'Create visual'}</h1>
          {saveState ? (
            <span className={styles.barSave} data-state={saveStatus} role="status">
              {saveState}
            </span>
          ) : null}
          <button
            type="button"
            className={styles.barButton}
            aria-label="Editor menu"
            onClick={() => setMenuOpen(true)}
          >
            <MoreIcon className={styles.barIcon} />
          </button>
        </div>
      ),
    }),
    [source?.title, conversationId, saveState, saveStatus, navigate],
  )

  /*
   * The setup questions, in one place.
   *
   * On a desktop they sit above the editor, where there is room for them. On a
   * phone they are the contents of a sheet — asked when there is nothing to
   * look at, and revisited from the menu — because a form that permanently
   * occupies the first screen of an image editor is a form standing where the
   * image should be.
   */
  const setupControls = (
    <>
      <header className={styles.header}>
        <div>
          <p className="eyebrow">Create Studio</p>
          <h1>Create an image</h1>
          <p>Choose a layout and style. Text is rendered in C.H.A.T. and is never sent to an image model.</p>
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

      {source ? (
        <div className={styles.sourceControls}>
          <label>
            <span>Format</span>
            <select value={format} onChange={(event) => {
              const next = event.currentTarget.value as CreateFormat
              setFormat(next)
              composeFromSource(layout, style, next, selectedField)
            }}>
              {Object.values(CREATE_FORMATS).map((value) => <option key={value} value={value}>{FORMAT_LABELS[value]}</option>)}
            </select>
          </label>
          <label>
            <span>Layout</span>
            <select value={layout} onChange={(event) => {
              const next = event.currentTarget.value as CreateLayout
              setLayout(next)
              composeFromSource(next, style, format, selectedField)
            }}>
              {Object.values(CREATE_LAYOUTS).map((value) => <option key={value} value={value}>{LAYOUT_LABELS[value]}</option>)}
            </select>
          </label>
          <label>
            <span>Style</span>
            <select value={style} onChange={(event) => changeStyle(event.currentTarget.value as CreateStyle)}>
              {Object.values(CREATE_STYLES).map((value) => <option key={value} value={value}>{STYLE_LABELS[value]}</option>)}
            </select>
          </label>
          {usesSelectedField(layout) && fields.length > 0 ? (
            <label>
              <span>Reflection field on card</span>
              <select value={selectedField ?? ''} onChange={(event) => {
                const next = event.currentTarget.value as ReflectionField
                setSelectedField(next)
                composeFromSource(layout, style, format, next)
              }}>
                {fields.map((field) => <option key={field} value={field}>{FIELD_LABELS[field]}</option>)}
              </select>
            </label>
          ) : null}
          <button type="button" className="btn btn-secondary" onClick={() => composeFromSource()}>Rebuild from reflection</button>
        </div>
      ) : null}
    </>
  )

  return (
    <section className={styles.page} data-narrow={narrow ? 'true' : 'false'}>
      {narrow ? null : setupControls}

      {/*
        Said on every screen, because when there is no composition yet these
        are the only things on it.
        They used to live inside the setup block, which is hidden on a phone —
        so a visitor arriving at /create with no reflections saw a bar and an
        empty screen, and nothing telling them what to do about it.
      */}
      {loading ? (
        <p className={styles.state} role="status">
          Opening Studio…
        </p>
      ) : null}
      {!loading && conversations.length === 0 ? (
        <p className={styles.state}>
          Finish a reflection first — Create Studio makes an image from something you have
          written.
        </p>
      ) : null}
      {!loading && conversations.length > 0 && !document && narrow ? (
        <p className={styles.state}>
          Choose a reflection and a look, and Studio will compose it.
        </p>
      ) : null}


      {/*
        On a phone the setup lives in a sheet, and the menu is how it is
        reopened once a composition exists.
      */}
      {narrow ? (
        <>
          <Sheet
            open={setupOpen}
            onClose={() => setSetupOpen(false)}
            title="Set up this visual"
            description="Rebuilding may replace layout changes you have made."
          >
            {setupControls}
          </Sheet>

          <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu">
            <div className={styles.menuRows}>
              <button
                type="button"
                className={styles.menuRow}
                onClick={() => {
                  setMenuOpen(false)
                  setSetupOpen(true)
                }}
              >
                Format, layout and style
                <small>Reflection, format, layout, style — and rebuild</small>
              </button>
            </div>
          </Sheet>
        </>
      ) : null}

      {overflowCount > 0 ? (
        <div className={styles.overflow} role="status">
          <p>{overflowCount} text {overflowCount === 1 ? 'block still overflows' : 'blocks still overflow'} the readable area. Words are never dropped.</p>
          <button type="button" className="btn btn-secondary" onClick={splitOverflow}>Split leftover text across cards</button>
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
            onExportAll={exportAll}
            assetResolver={resolveChatStudioAsset}
            onRequestGeneratedAsset={generatedAssetCallback}
            generatedAssetSafeArea={{ x: 0.12, y: 0.12, width: 0.76, height: 0.76 }}
            generatedAssetMetadata={{ sourceApplication: 'chat_app', sourceReflectionId: conversationId }}
            onRenderResult={reportRender}
            onEditorIssue={reportEditorIssue}
            capabilities={CHAT_STUDIO_CAPABILITIES}
            templates={CHAT_STUDIO_TEMPLATES}
          />
        </div>
      ) : null}
    </section>
  )
}
