import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  AI_ACTIONS,
  AUTHOR_ORIGINS,
  CHAT_FORMATS,
  validateChat,
  type AiAction,
  type ChatFormat,
  type ValidationResult,
} from '@chat/shared'
import { ApiError, api } from '../shared/api/client.ts'
import {
  BookIcon,
  ChatIcon,
  CloseIcon,
  GlobeIcon,
  LockIcon,
  ShareIcon,
  TrashIcon,
} from '../shared/ui/icons.tsx'
import { ChatArtifact } from './ChatArtifact.tsx'
import { ChatHelper } from './ChatHelper.tsx'
import { DeleteSheet, FormatSheet, ShareSheet, type ShareAudience } from './ChatSheets.tsx'
import { ConversationSidebar } from './ConversationSidebar.tsx'
import { deriveTitle, displayTitle } from './history.ts'
import { fieldsFor } from './sections.ts'
import type {
  ConversationDetail,
  FieldType,
  Proposal,
  SaveState,
  Summary,
} from './types.ts'
import styles from './ChatPage.module.css'

const SIDEBAR_KEY = 'chat.reflect.sidebar'

/** How long after the last keystroke the artifact writes itself down. */
const AUTOSAVE_MS = 1200

/** Small enough to be worth writing rather than depending on. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    onChange()
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const [conversations, setConversations] = useState<Summary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [busyAction, setBusyAction] = useState<AiAction | null>(null)

  /*
   * The author's unsaved writing, held apart from what the server last said.
   *
   * Every refresh of the conversation merges into this rather than over it, so
   * a background reload — and there are several — cannot replace a sentence
   * halfway through being typed.
   */
  const [edits, setEdits] = useState<Partial<Record<FieldType, string>>>({})
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' })
  const [overflow, setOverflow] = useState<{ field: FieldType; text: string } | null>(null)

  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const [referenceDraft, setReferenceDraft] = useState<string | null>(null)

  const [discussing, setDiscussing] = useState<FieldType | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)

  const [shareOpen, setShareOpen] = useState(false)
  const [formatOpen, setFormatOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [validation, setValidation] = useState<ValidationResult | null>(null)

  const [query, setQuery] = useState('')
  const [searchFocusToken, setSearchFocusToken] = useState(0)
  const [helperOpen, setHelperOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)

  const composerRef = useRef<HTMLTextAreaElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const referenceRef = useRef<HTMLInputElement>(null)
  const openedRef = useRef<string | null>(null)
  const saveTimer = useRef<number | null>(null)

  const isNarrow = useMediaQuery('(max-width: 899px)')
  /*
   * Below this the three panes cannot all have room, and the artifact is the
   * one that must not be squeezed — it is the thing being made. The history
   * rails itself until the window is wide enough to hold it open, and the
   * stored preference is what comes back when it is.
   */
  const isTightDesktop = useMediaQuery('(max-width: 1399px)')

  const [preferCollapsed, setPreferCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(SIDEBAR_KEY) === 'collapsed'
  })
  const collapsed = preferCollapsed || isTightDesktop

  function toggleSidebar() {
    const next = !collapsed
    setPreferCollapsed(next)
    window.localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'expanded')
  }

  const format: ChatFormat = detail?.format ?? CHAT_FORMATS.FULL
  const fields = fieldsFor(format)

  const storedValue = useCallback(
    (field: FieldType): string => {
      if (!detail) return ''
      if (field === 'verse' || field === 'reflection') {
        return detail.condensed?.[field]?.content ?? ''
      }
      return detail.sections?.[field]?.content ?? ''
    },
    [detail],
  )

  const storedOrigin = useCallback(
    (field: FieldType): string => {
      if (!detail) return AUTHOR_ORIGINS.USER
      if (field === 'verse' || field === 'reflection') {
        return detail.condensed?.[field]?.authorOrigin ?? AUTHOR_ORIGINS.USER
      }
      return detail.sections?.[field]?.authorOrigin ?? AUTHOR_ORIGINS.USER
    },
    [detail],
  )

  const valueOf = useCallback(
    (field: FieldType) => edits[field] ?? storedValue(field),
    [edits, storedValue],
  )

  const dirtyFields = useMemo(() => {
    const dirty = new Set<FieldType>()
    for (const [field, value] of Object.entries(edits)) {
      if (value !== storedValue(field as FieldType)) dirty.add(field as FieldType)
    }
    return dirty
  }, [edits, storedValue])

  const hasUnsaved = dirtyFields.size > 0

  const refreshList = useCallback(async () => {
    setConversations(await api<Summary[]>('/conversations'))
  }, [])

  const openConversation = useCallback(
    async (id: string) => {
      const next = await api<ConversationDetail>(`/conversations/${id}`)
      const switching = openedRef.current !== id
      openedRef.current = id
      setActiveId(id)
      setDetail(next)
      if (switching) {
        /* A different reflection is a different piece of work: its own drafts. */
        setEdits({})
        setOverflow(null)
        setProposal(null)
        setDiscussing(null)
        setTitleDraft(null)
        setReferenceDraft(null)
        setValidation(null)
      }
      setSearchParams(
        (current) => {
          if (current.get('c') === id) return current
          const params = new URLSearchParams(current)
          params.set('c', id)
          return params
        },
        { replace: true },
      )
      return next
    },
    [setSearchParams],
  )

  useEffect(() => {
    const requestedId = searchParams.get('c')
    void refreshList()
      .then(async () => {
        if (requestedId && requestedId !== openedRef.current) {
          await openConversation(requestedId)
        }
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Unable to load conversations')
      })
  }, [searchParams, refreshList, openConversation])

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      void startNew()
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  /* --- Saving ---------------------------------------------------------- */

  /**
   * Write every changed field down, and say so.
   *
   * Returns whether it worked, because everything that could lose work — moving
   * to another reflection, starting a new one, leaving for Create — waits on
   * the answer rather than assuming it.
   */
  const saveAll = useCallback(async (): Promise<boolean> => {
    if (!activeId) return true
    const pending = Object.entries(edits).filter(
      ([field, value]) => value !== storedValue(field as FieldType),
    )
    if (pending.length === 0) return true

    setSaveState({ status: 'saving' })
    try {
      for (const [field, value] of pending) {
        /*
         * Editing wording the model drafted does not make it entirely the
         * author's. Their own writing stays theirs; anything the model touched
         * stays marked as assisted, so the badge on the card cannot quietly
         * become a claim nobody made.
         */
        const origin =
          storedOrigin(field as FieldType) === AUTHOR_ORIGINS.USER
            ? AUTHOR_ORIGINS.USER
            : AUTHOR_ORIGINS.AI_ASSISTED
        await api(`/conversations/${activeId}/sections`, {
          method: 'PATCH',
          body: JSON.stringify({ type: field, content: value, authorOrigin: origin }),
        })
      }
      const next = await api<ConversationDetail>(`/conversations/${activeId}`)
      setDetail(next)
      /* Only what was actually written is forgotten; later keystrokes stay. */
      setEdits((current) => {
        const remaining = { ...current }
        for (const [field, value] of pending) {
          if (remaining[field as FieldType] === value) delete remaining[field as FieldType]
        }
        return remaining
      })
      setSaveState({ status: 'saved', at: Date.now() })
      void refreshList()
      return true
    } catch (caught: unknown) {
      /*
       * A failed save keeps every character on screen. The state says so and
       * offers another go; nothing is rolled back to the server's version.
       */
      setSaveState({
        status: 'failed',
        message: caught instanceof Error ? caught.message : 'Could not save',
      })
      return false
    }
  }, [activeId, edits, storedValue, storedOrigin, refreshList])

  /*
   * Typing settles, and it is written down.
   *
   * The effect deliberately sets no state of its own — "unsaved" is derived
   * from whether anything differs from the server, not stored a second time.
   * Storing it meant a state update on every render, which React eventually
   * refused as a runaway loop while someone was simply typing quickly.
   */
  const saveAllRef = useRef(saveAll)
  saveAllRef.current = saveAll

  useEffect(() => {
    if (!hasUnsaved || !activeId) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void saveAllRef.current()
    }, AUTOSAVE_MS)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [edits, hasUnsaved, activeId])

  /* The last line of defence: the browser asks before the tab takes it away. */
  useEffect(() => {
    if (!hasUnsaved) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasUnsaved])

  /** Anything that moves away from this reflection goes through here first. */
  const leaveSafely = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    return saveAll()
  }, [saveAll])

  /* --- Editing the reflection ------------------------------------------ */

  async function patchConversation(body: Record<string, unknown>): Promise<boolean> {
    if (!activeId) return false
    setSaveState({ status: 'saving' })
    try {
      await api(`/conversations/${activeId}`, { method: 'PATCH', body: JSON.stringify(body) })
      await openConversation(activeId)
      await refreshList()
      setSaveState({ status: 'saved', at: Date.now() })
      return true
    } catch (caught: unknown) {
      setSaveState({
        status: 'failed',
        message: caught instanceof Error ? caught.message : 'Could not save',
      })
      return false
    }
  }

  async function startNew() {
    if (!(await leaveSafely())) return
    openedRef.current = null
    setActiveId(null)
    setDetail(null)
    setDraft('')
    setEdits({})
    setOverflow(null)
    setProposal(null)
    setDiscussing(null)
    setTitleDraft(null)
    setReferenceDraft(null)
    setValidation(null)
    setListOpen(false)
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current)
        params.delete('c')
        return params
      },
      { replace: true },
    )
    window.setTimeout(() => composerRef.current?.focus(), 0)
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || sending) return
    setSending(true)
    setError(null)
    try {
      let id = activeId
      if (!id) {
        const reference = referenceDraft?.trim()
        const created = await api<Summary>('/conversations', {
          method: 'POST',
          body: JSON.stringify({
            title: deriveTitle(content),
            ...(reference ? { scriptureReference: reference } : {}),
          }),
        })
        id = created.id
        setReferenceDraft(null)
      }
      await api(`/conversations/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      })
      setDraft('')
      await openConversation(id)
      await refreshList()
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Unable to send that message')
    } finally {
      setSending(false)
    }
  }

  /**
   * Ask the model for something, and hold the answer.
   *
   * The result is a proposal beside the author's words. It is applied only when
   * they say so, and it keeps its provenance when they do.
   */
  async function runAi(action: AiAction) {
    if (!activeId) return
    setBusyAction(action)
    setError(null)
    try {
      const result = await api<{
        original?: string
        revised?: string
        origin?: 'ai_assisted' | 'ai_generated'
        proposed?: Record<string, { content: string; authorOrigin: string }>
      }>(`/conversations/${activeId}/ai`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      })

      /* Refresh first, then raise the proposal — the other order erased it. */
      await openConversation(activeId)

      if (action === AI_ACTIONS.EXTRACT_CHAT) {
        const first = Object.entries(result.proposed ?? {})[0]
        if (!first) {
          setError(
            'There is nothing in the conversation yet that a section could be drawn from.',
          )
          return
        }
        const [field, section] = first
        setProposal({
          action,
          original: storedValue(field as FieldType),
          revised: section.content,
          origin: 'ai_assisted',
          field: field as FieldType,
        })
        return
      }

      if (result.original && result.revised) {
        setProposal({
          action,
          original: result.original,
          revised: result.revised,
          origin: result.origin ?? 'ai_assisted',
          field: discussing,
        })
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'That did not work')
    } finally {
      setBusyAction(null)
    }
  }

  /** Put a piece of text into a field, saying plainly where it came from. */
  async function putIntoField(field: FieldType, content: string, origin: string) {
    if (!activeId) return
    setSaveState({ status: 'saving' })
    try {
      await api(`/conversations/${activeId}/sections`, {
        method: 'PATCH',
        body: JSON.stringify({ type: field, content, authorOrigin: origin }),
      })
      await openConversation(activeId)
      setEdits((current) => {
        const next = { ...current }
        delete next[field]
        return next
      })
      setProposal(null)
      setSaveState({ status: 'saved', at: Date.now() })
      await refreshList()
    } catch (caught: unknown) {
      setSaveState({
        status: 'failed',
        message: caught instanceof Error ? caught.message : 'Could not save',
      })
    }
  }

  /** Send a section into the conversation, to be talked through. */
  async function discussField(field: FieldType) {
    if (!activeId) return
    const content = valueOf(field).trim()
    if (!content) return
    if (!(await leaveSafely())) return
    try {
      await api(`/conversations/${activeId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      })
      setDiscussing(field)
      setProposal(null)
      await openConversation(activeId)
      if (isNarrow) setHelperOpen(true)
      window.setTimeout(() => composerRef.current?.focus(), 0)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Unable to send that section')
    }
  }

  async function share(audience: ShareAudience, acknowledgeExtension: boolean) {
    if (!activeId) return
    if (!(await leaveSafely())) return
    setError(null)
    try {
      if (audience === 'only-me') {
        await api(`/conversations/${activeId}/unpublish`, { method: 'POST' })
      } else {
        await api(
          `/conversations/${activeId}/publish${acknowledgeExtension ? '?acknowledgeExtension=true' : ''}`,
          { method: 'POST' },
        )
      }
      setValidation(null)
      setShareOpen(false)
      await openConversation(activeId)
      await refreshList()
    } catch (caught: unknown) {
      /*
       * 422 is the format gate, and it answers with a report. Showing it is the
       * difference between "invalid" and "Heart is 46 characters over".
       */
      if (caught instanceof ApiError && caught.status === 422) {
        const body = caught.body as { validation?: ValidationResult }
        setValidation(body.validation ?? null)
        return
      }
      setError(caught instanceof Error ? caught.message : 'Unable to share this reflection')
    }
  }

  async function changeFormat(
    next: ChatFormat,
    carry: { field: FieldType; content: string } | null,
  ) {
    if (!activeId) return
    if (!(await leaveSafely())) return
    if (carry) {
      await api(`/conversations/${activeId}/sections`, {
        method: 'PATCH',
        body: JSON.stringify({
          type: carry.field,
          content: carry.content,
          authorOrigin: AUTHOR_ORIGINS.USER,
        }),
      })
    }
    await patchConversation({ format: next })
    setFormatOpen(false)
  }

  async function removeConversation() {
    if (!activeId) return
    try {
      await api(`/conversations/${activeId}`, { method: 'DELETE' })
      setDeleteOpen(false)
      openedRef.current = null
      setActiveId(null)
      setDetail(null)
      setEdits({})
      setSaveState({ status: 'idle' })
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current)
          params.delete('c')
          return params
        },
        { replace: true },
      )
      await refreshList()
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Unable to delete this reflection')
    }
  }

  /* --- Rendering -------------------------------------------------------- */

  const hasWritten = detail !== null && detail.messages.length > 0
  const written = fields.filter((meta) => valueOf(meta.type).trim()).length

  const liveValidation = detail
    ? validateChat(format, {
        title: titleDraft ?? detail.title,
        scriptureReference: referenceDraft ?? detail.scriptureReference ?? '',
        ...Object.fromEntries(fields.map((meta) => [meta.type, valueOf(meta.type)])),
      })
    : null

  useEffect(() => {
    if (!isNarrow) setHelperOpen(false)
  }, [isNarrow])

  useEffect(() => {
    if (!helperOpen && !listOpen) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setHelperOpen(false)
        setListOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [helperOpen, listOpen])

  /*
   * One reading of the truth: anything unwritten outranks the last success, so
   * a "Saved" from a moment ago can never sit above a sentence that is not.
   */
  const saveStatus: SaveState['status'] =
    saveState.status === 'saving' || saveState.status === 'failed'
      ? saveState.status
      : hasUnsaved
        ? 'unsaved'
        : saveState.status === 'saved'
          ? 'saved'
          : 'idle'

  const saveLabel = {
    saving: 'Saving…',
    saved: 'Saved',
    failed: 'Not saved',
    unsaved: 'Unsaved changes',
    idle: 'Saved',
  }[saveStatus]

  const sidebar = (
    <ConversationSidebar
      conversations={conversations}
      activeId={activeId}
      collapsed={isNarrow ? false : collapsed}
      query={query}
      onQuery={setQuery}
      onSelect={(id) => {
        setListOpen(false)
        void leaveSafely().then((ok) => {
          if (!ok) return
          void openConversation(id).catch(() => setError('Unable to open that reflection'))
        })
      }}
      onNew={() => void startNew()}
      onToggle={toggleSidebar}
      onSearchRequested={() => {
        toggleSidebar()
        setSearchFocusToken((token) => token + 1)
      }}
      searchFocusToken={searchFocusToken}
    />
  )

  const helper = (
    <ChatHelper
      format={format}
      messages={detail?.messages ?? []}
      draft={draft}
      sending={sending}
      discussing={discussing}
      proposal={proposal}
      busyAction={busyAction}
      onDraft={setDraft}
      onSend={(event) => void sendMessage(event)}
      onAction={(action) => void runAi(action)}
      onUseInField={(field, content, origin) => void putIntoField(field, content, origin)}
      onStopDiscussing={() => setDiscussing(null)}
      onDismissProposal={() => setProposal(null)}
      composerRef={composerRef}
    />
  )

  return (
    <section
      className={styles.workspace}
      data-collapsed={!isNarrow && collapsed ? 'true' : 'false'}
    >
      {isNarrow ? null : sidebar}

      {/*
        The artifact is the page.
        The C.H.A.T. is what is being made here, so it holds the middle and is
        shown whole; the conversation is the tool beside it.
      */}
      <div className={styles.artifact}>
        <div className={styles.artifactHead}>
          <div className={styles.artifactHeadMain}>
            {isNarrow ? (
              <button
                type="button"
                className={styles.headerButton}
                onClick={() => setListOpen(true)}
                aria-label="Open the reflections list"
              >
                <BookIcon className={styles.smallIcon} />
              </button>
            ) : null}

            <div className={styles.identity}>
              {/*
                Both of these are editable for as long as the reflection
                exists. Neither is a decision made once, at the beginning,
                before there was anything to name.
              */}
              <input
                ref={referenceRef}
                className={styles.referenceInput}
                value={referenceDraft ?? detail?.scriptureReference ?? ''}
                /* Not an example: an example set in caps reads as a real reference. */
                placeholder="Add the passage"
                aria-label="Scripture reference"
                onChange={(event) => setReferenceDraft(event.target.value)}
                onBlur={() => {
                  if (referenceDraft === null) return
                  /*
                   * Before there is a reflection to attach it to, the passage
                   * waits here and is carried in when the first message creates
                   * one. Choosing a Scripture has never required a form.
                   */
                  if (!detail) return
                  const value = referenceDraft.trim()
                  if (value === (detail?.scriptureReference ?? '')) {
                    setReferenceDraft(null)
                    return
                  }
                  void patchConversation({ scriptureReference: value }).then(() =>
                    setReferenceDraft(null),
                  )
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                  if (event.key === 'Escape') setReferenceDraft(null)
                }}
              />
              <input
                ref={titleRef}
                className={styles.titleInput}
                value={
                  titleDraft ??
                  (detail ? displayTitleValue(detail.title, detail.scriptureReference) : '')
                }
                placeholder={detail ? 'Name this reflection' : 'New reflection'}
                aria-label="Reflection title"
                disabled={!detail}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => {
                  if (titleDraft === null) return
                  const value = titleDraft.trim()
                  if (!value || value === detail?.title) {
                    setTitleDraft(null)
                    return
                  }
                  void patchConversation({ title: value }).then(() => setTitleDraft(null))
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                  if (event.key === 'Escape') setTitleDraft(null)
                }}
              />
            </div>
          </div>

          <div className={styles.artifactHeadSide}>
            {/* Saving, in words, where the work is. */}
            <span
              className={styles.saveState}
              data-status={saveStatus}
              role="status"
            >
              {saveLabel}
            </span>
            {saveState.status === 'failed' ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void saveAll()}
              >
                Try again
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!hasUnsaved}
                onClick={() => void saveAll()}
              >
                Save
              </button>
            )}

            {detail ? (
              <span className={styles.privacy}>
                {detail.publicationState === 'published' ? (
                  <>
                    <GlobeIcon className={styles.tinyIcon} />
                    Public
                  </>
                ) : (
                  <>
                    <LockIcon className={styles.tinyIcon} />
                    Only me
                  </>
                )}
              </span>
            ) : null}

            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!detail}
              onClick={() => setShareOpen(true)}
            >
              <ShareIcon className={styles.tinyIcon} />
              Share
            </button>

            <button
              type="button"
              className={styles.iconButton}
              disabled={!detail}
              aria-label="Delete this reflection"
              onClick={() => setDeleteOpen(true)}
            >
              <TrashIcon className={styles.smallIcon} />
            </button>

            {isNarrow ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setHelperOpen(true)}
                aria-expanded={helperOpen}
              >
                <ChatIcon className={styles.tinyIcon} />
                Chat
              </button>
            ) : null}
          </div>
        </div>

        <div className={styles.artifactMeta}>
          <button
            type="button"
            className={styles.formatButton}
            disabled={!detail}
            onClick={() => setFormatOpen(true)}
          >
            {format === CHAT_FORMATS.CONDENSED ? 'Condensed C.H.A.T.' : 'Full C.H.A.T.'}
            <span className={styles.formatChange}>Change</span>
          </button>

          {hasWritten ? (
            <p className={styles.progress}>
              <span className={styles.progressText}>
                {written} of {fields.length} written
              </span>
              <span className={styles.progressTrack} aria-hidden="true">
                <span
                  className={styles.progressFill}
                  style={{ inlineSize: `${(written / fields.length) * 100}%` }}
                />
              </span>
            </p>
          ) : null}

          {liveValidation && hasWritten ? (
            <span className={styles.combined} data-status={liveValidation.combined.status}>
              {liveValidation.combined.length} / {liveValidation.combined.recommended}{' '}
              characters together
            </span>
          ) : null}
        </div>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.artifactBody}>
          <ChatArtifact
            format={format}
            hasWritten={hasWritten}
            valueOf={valueOf}
            originOf={storedOrigin}
            dirtyFields={dirtyFields}
            discussing={discussing}
            proposal={proposal}
            overflow={overflow}
            onChange={(field, value, over) => {
              setEdits((current) => ({ ...current, [field]: value }))
              setOverflow(over ? { field, text: over } : null)
            }}
            onSave={() => void saveAll()}
            onDiscuss={(field) => void discussField(field)}
            onApplyProposal={() => {
              if (proposal?.field) {
                void putIntoField(proposal.field, proposal.revised, proposal.origin)
              }
            }}
            onDismissProposal={() => setProposal(null)}
          />
        </div>

        {hasWritten ? (
          <div className={styles.artifactFoot}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busyAction !== null}
              onClick={() => void runAi(AI_ACTIONS.EXTRACT_CHAT)}
            >
              {busyAction === AI_ACTIONS.EXTRACT_CHAT
                ? 'Reading the conversation…'
                : 'Suggest from conversation'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                void leaveSafely().then((ok) => {
                  if (ok) navigate(`/create?c=${activeId ?? ''}`)
                })
              }}
            >
              Create visual
            </button>
          </div>
        ) : null}
      </div>

      {/* The conversation, beside the work rather than in front of it. */}
      {isNarrow ? null : <aside className={styles.helper} aria-label="Reflection chat">{helper}</aside>}

      {isNarrow && listOpen ? (
        <div className={styles.scrim} onClick={() => setListOpen(false)}>
          <div
            className={`${styles.drawer} ${styles.drawerLeft}`}
            role="dialog"
            aria-label="Reflections"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.drawerHead}>
              <button
                type="button"
                className={styles.headerButton}
                onClick={() => setListOpen(false)}
                aria-label="Close the reflections list"
              >
                <CloseIcon className={styles.smallIcon} />
              </button>
            </div>
            {sidebar}
          </div>
        </div>
      ) : null}

      {isNarrow && helperOpen ? (
        <div className={styles.scrim} onClick={() => setHelperOpen(false)}>
          <div
            className={`${styles.drawer} ${styles.drawerRight}`}
            role="dialog"
            aria-label="Reflection chat"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.drawerHead}>
              <button
                type="button"
                className={styles.headerButton}
                onClick={() => setHelperOpen(false)}
                aria-label="Close the reflection chat"
              >
                <CloseIcon className={styles.smallIcon} />
              </button>
            </div>
            <div className={styles.helper}>{helper}</div>
          </div>
        </div>
      ) : null}

      {shareOpen && detail ? (
        <ShareSheet
          currentlyPublished={detail.publicationState === 'published'}
          validation={validation}
          format={format}
          onClose={() => {
            setShareOpen(false)
            setValidation(null)
          }}
          onShare={share}
        />
      ) : null}

      {formatOpen && detail ? (
        <FormatSheet
          format={format}
          fullSections={Object.fromEntries(
            (['context', 'heart', 'application', 'testimony'] as const).map((field) => [
              field,
              valueOf(field),
            ]),
          )}
          condensedFields={Object.fromEntries(
            (['verse', 'reflection'] as const).map((field) => [field, valueOf(field)]),
          )}
          onClose={() => setFormatOpen(false)}
          onChoose={changeFormat}
        />
      ) : null}

      {deleteOpen && detail ? (
        <DeleteSheet
          title={displayTitle(detail.title, detail.scriptureReference)}
          onClose={() => setDeleteOpen(false)}
          onDelete={removeConversation}
        />
      ) : null}
    </section>
  )
}

/**
 * The title, for an editable field.
 *
 * A reflection begun without a name is stored under its passage, and printing
 * that as the title reads as a bug. The field shows it as empty with a prompt,
 * so naming it is an invitation rather than a correction.
 */
function displayTitleValue(title: string, reference: string | null): string {
  return displayTitle(title, reference) === 'Untitled reflection' ? '' : title
}
