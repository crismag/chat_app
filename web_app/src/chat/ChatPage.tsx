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
  AI_CHAT_NOTICE,
  AI_DISCLOSURE,
  AI_OUTCOMES,
  AI_UNAVAILABLE_MESSAGE,
  AUTHOR_ORIGINS,
  TITLE_SOURCES,
  CHAT_FORMATS,
  validateChat,
  type AiAction,
  type AiCapabilities,
  type AiGuidanceSection,
  type ChatFormat,
  type ValidationResult,
} from '@chat/shared'
import { ScripturePassage } from '../bible/ScripturePassage.tsx'
import { ApiError, api } from '../shared/api/client.ts'
import {
  BookIcon,
  ChatIcon,
  CloseIcon,
  GlobeIcon,
  LockIcon,
  ShareIcon,
  SparkIcon,
  TrashIcon,
} from '../shared/ui/icons.tsx'
import { ChatArtifact } from './ChatArtifact.tsx'
import { ChatHelper } from './ChatHelper.tsx'
import {
  DeleteSheet,
  FormatSheet,
  ShareSheet,
  TitleSuggestionSheet,
  type ShareAudience,
} from './ChatSheets.tsx'
import { ConversationSidebar } from './ConversationSidebar.tsx'
import { AiDisclosureSheet } from './FieldAssist.tsx'
import { deriveTitle, displayTitle } from './history.ts'
import type { Chip } from './chips.ts'
import { fieldsFor, mergeInto } from './sections.ts'
import type {
  AddedNotice,
  AssistBusy,
  AssistState,
  ConversationDetail,
  FieldGuidance,
  FieldImprovement,
  FieldType,
  PendingAdd,
  Proposal,
  SaveState,
  Summary,
} from './types.ts'
import { AddToSectionSheet } from './ChatSheets.tsx'
import styles from './ChatPage.module.css'

const SIDEBAR_KEY = 'chat.reflect.sidebar'

/**
 * Whether this person has been told what assistance sends, and where.
 *
 * Remembered rather than asked every time, because a disclosure shown on every
 * click is a dialog people learn to dismiss without reading — which is worse
 * than not showing it, since it looks like consent.
 */
const DISCLOSURE_KEY = 'chat.ai.disclosure'

/** The four sections assistance understands. Heart, never a highlight. */
const SECTION_FIELDS: AiGuidanceSection[] = ['content', 'heart', 'application', 'testimony']

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

  /*
   * What assistance can do, asked once rather than assumed. A control that
   * cannot work has to be able to say why.
   */
  const [ai, setAi] = useState<{
    enabled: boolean
    reason?: string
    capabilities?: AiCapabilities
  }>({ enabled: true })
  const [suggesting, setSuggesting] = useState(false)
  const [titleSuggestions, setTitleSuggestions] = useState<
    { titles: string[]; source: string } | null
  >(null)

  /*
   * Model-backed assistance, held entirely apart from the artifact.
   *
   * None of this state is the reflection. Questions, a suggested wording and
   * the last thing undone all live here and are thrown away when the page
   * moves on; the only route from any of them into the C.H.A.T. is the same
   * section write the author makes by hand, and it only runs when they press
   * a button that says so.
   */
  const [assistBusy, setAssistBusy] = useState<{ field: FieldType; kind: AssistBusy } | null>(null)
  const [guidance, setGuidance] = useState<Partial<Record<FieldType, FieldGuidance>>>({})
  const [improvement, setImprovement] = useState<
    ({ field: FieldType } & FieldImprovement) | null
  >(null)
  const [clarification, setClarification] = useState<{ field: FieldType; question: string } | null>(
    null,
  )
  const [assistError, setAssistError] = useState<{ field: FieldType; message: string } | null>(null)
  /* What Undo puts back. Set only when a suggestion was actually accepted. */
  const [undoable, setUndoable] = useState<{ field: FieldType; previous: string } | null>(null)
  /* The action waiting behind the disclosure, if the disclosure is showing. */
  const [pendingAssist, setPendingAssist] = useState<
    { field: AiGuidanceSection; kind: Exclude<AssistBusy, null> } | null
  >(null)

  /*
   * The bounded conversation.
   *
   * `replying` is separate from `sending` on purpose. Sending is over in
   * milliseconds and must never be held up by a provider; waiting for a reply
   * is a different, slower thing, and the composer stays usable throughout it.
   */
  const [replying, setReplying] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  /* A message whose reply is waiting behind the disclosure. */
  const [pendingChat, setPendingChat] = useState<
    { id: string; message: string; chip?: Chip } | null
  >(null)
  /** The last reply request, so "Try again" repeats it without re-sending it. */
  const [lastRequest, setLastRequest] = useState<
    { conversationId: string; message: string; chip?: Chip } | null
  >(null)

  /*
   * Adding a draft into a section.
   *
   * `pendingAdd` is only ever set when the destination ALREADY HAS TEXT. An
   * empty section is written straight away; a section with the author's words
   * in it raises the choice — Append, Replace, Insert at cursor, Cancel —
   * because silently replacing what someone wrote is the one outcome none of
   * this is allowed to produce.
   */
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null)
  const [addedNotice, setAddedNotice] = useState<AddedNotice | null>(null)
  /** Where the caret was, per section, so "insert at cursor" can mean it. */
  const [carets, setCarets] = useState<Partial<Record<FieldType, number>>>({})
  /*
   * Provenance for text sitting in the unsaved buffer.
   *
   * Generated material lands as UNSAVED writing rather than as a commit, so by
   * the time it is written down the stored origin still says `user` — and
   * `saveAll` would record the author as having written it. This remembers what
   * actually landed, so the badge cannot quietly become a claim nobody made.
   */
  const [pendingOrigins, setPendingOrigins] = useState<Partial<Record<FieldType, string>>>({})
  /**
   * The section that just received something, briefly marked.
   *
   * Named `flash` rather than the obvious word: "highlight" is forbidden across
   * this codebase because it is the plausible-wrong name for the H in C.H.A.T.,
   * and there is a regression test that will not — and should not — try to tell
   * a visual flash apart from a mislabelled section.
   */
  const [flashField, setFlashField] = useState<FieldType | null>(null)

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
          pendingOrigins[field as FieldType] ??
          (storedOrigin(field as FieldType) === AUTHOR_ORIGINS.USER
            ? AUTHOR_ORIGINS.USER
            : AUTHOR_ORIGINS.AI_ASSISTED)
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
  }, [activeId, edits, storedValue, storedOrigin, refreshList, pendingOrigins])

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

  /**
   * Ask for a reply to a message that is already stored.
   *
   * A second call rather than part of sending, and the id is passed in rather
   * than read from state — the first message of a new reflection creates the
   * conversation, and `activeId` has not caught up by the time this runs.
   */
  async function requestReply(conversationId: string, message: string, chip?: Chip) {
    setReplying(true)
    setChatError(null)
    setLastRequest({ conversationId, message, ...(chip ? { chip } : {}) })
    try {
      await api('/ai/reflection-chat', {
        method: 'POST',
        body: JSON.stringify({
          conversationId,
          message,
          /*
           * An identifier from a fixed set, not prompt text. The server decides
           * what it means and — crucially — whether this turn may produce a
           * draft at all.
           */
          ...(chip ? { action: chip.action } : {}),
          ...(chip?.section ? { section: chip.section } : {}),
          /*
           * Scoped mode travels as application state. The server validates it
           * against the section enum anyway and uses it — not anything the
           * model says — to decide where a draft would go.
           */
          ...(discussing && SECTION_FIELDS.includes(discussing as never)
            ? { focusSection: discussing }
            : {}),
        }),
      })
      /* The reply was stored server-side; re-reading is what puts it on screen. */
      await openConversation(conversationId)
    } catch (caught: unknown) {
      /*
       * A failed reply is not a failed message. What they wrote is already
       * saved, so this reports beside the thread and leaves it alone.
       */
      setChatError(assistMessage(caught))
    } finally {
      setReplying(false)
    }
  }

  async function sendMessage(event: FormEvent, override?: string) {
    event.preventDefault()
    const content = (override ?? draft).trim()
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

      /*
       * Then, separately, ask for a reply. With no provider this is skipped
       * entirely and the thread is simply a place to think out loud — which is
       * why the composer needs no special case for AI being off.
       */
      if (ai.capabilities?.reflectionChat) {
        if (window.localStorage.getItem(DISCLOSURE_KEY) === 'accepted') {
          void requestReply(id, content)
        } else {
          /* Their message is saved either way; only the reply waits. */
          setPendingChat({ id, message: content })
        }
      }
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

  /**
   * Ask for a few candidate titles, and show them for review.
   *
   * A title is a label rather than a confession, so proposing one is fair game
   * where proposing a Testimony would not be. It is still only a proposal:
   * nothing is written until the author picks one, and picking is what the
   * sheet is for.
   */
  async function suggestTitle() {
    if (!activeId) return
    setSuggesting(true)
    setError(null)
    try {
      const result = await api<{ suggestions?: string[]; source?: string }>(
        `/conversations/${activeId}/ai`,
        { method: 'POST', body: JSON.stringify({ action: AI_ACTIONS.SUGGEST_TITLE }) },
      )
      if (result.suggestions?.length) {
        setTitleSuggestions({
          titles: result.suggestions,
          source: result.source ?? TITLE_SOURCES.HEURISTIC,
        })
      } else {
        setError('No title could be drawn from this yet. Write a little more first.')
      }
    } catch (caught: unknown) {
      /* 503 means assistance went away underneath us; the button says so now. */
      if (caught instanceof ApiError && caught.status === 503) {
        const body = caught.body as { ai?: { reason?: string } }
        setAi({ enabled: false, reason: body.ai?.reason ?? caught.message })
      }
      setError(caught instanceof Error ? caught.message : 'Unable to suggest a title')
    } finally {
      setSuggesting(false)
    }
  }

  /* --- Model-backed assistance ------------------------------------------ */

  /**
   * Turn a failed assistance request into a sentence, without inventing one.
   *
   * The server sends a typed outcome and copy it wrote; this reads the body it
   * was given rather than composing anything from a status code. When there is
   * no body to read — the network went away — it falls back to the one message
   * that always applies, which points at the manual workflow.
   */
  function assistMessage(caught: unknown): string {
    if (caught instanceof ApiError) {
      const body = caught.body as { error?: string; outcome?: string; retryAfterSeconds?: number }
      if (body.outcome === AI_OUTCOMES.RATE_LIMITED && body.retryAfterSeconds) {
        return `${body.error ?? ''} Try again in about ${body.retryAfterSeconds} seconds.`.trim()
      }
      if (body.error) return body.error
    }
    return AI_UNAVAILABLE_MESSAGE
  }

  async function askForQuestions(field: AiGuidanceSection) {
    if (!activeId || !detail) return
    setAssistError(null)
    setAssistBusy({ field, kind: 'questions' })
    try {
      /*
       * Only what this action needs travels: the passage, the sections being
       * asked about, and what has already been written in them. No profile, no
       * other reflections, no identifiers, no message history.
       */
      const written: Partial<Record<AiGuidanceSection, string>> = {}
      for (const meta of SECTION_FIELDS) {
        const value = valueOf(meta).trim()
        if (value) written[meta] = value
      }

      const result = await api<{
        sections: Partial<Record<AiGuidanceSection, { questions: string[] }>>
        notice: string
      }>('/ai/reflection-guidance', {
        method: 'POST',
        body: JSON.stringify({
          passageReference: referenceDraft ?? detail.scriptureReference ?? '',
          sections: [field],
          written,
        }),
      })

      setGuidance((current) => ({
        ...current,
        [field]: {
          questions: result.sections[field]?.questions ?? [],
          notice: result.notice,
        },
      }))
    } catch (caught: unknown) {
      setAssistError({ field, message: assistMessage(caught) })
    } finally {
      setAssistBusy(null)
    }
  }

  async function askForImprovement(field: AiGuidanceSection) {
    if (!activeId || !detail) return
    const text = valueOf(field).trim()
    if (!text) return
    setAssistError(null)
    setClarification(null)
    setAssistBusy({ field, kind: 'improve' })
    try {
      const result = await api<{
        outcome: string
        original: string
        suggested?: string
        summaryOfChanges?: string[]
        question?: string
      }>('/ai/improve-writing', {
        method: 'POST',
        body: JSON.stringify({
          section: field,
          text,
          passageReference: referenceDraft ?? detail.scriptureReference ?? '',
        }),
      })

      /*
       * The honest answer when meaning was uncertain. It is shown as a question
       * rather than as a failure, because the request worked — the model
       * declined to guess, which is exactly what it was told to do.
       */
      if (result.outcome === AI_OUTCOMES.NEEDS_USER_CLARIFICATION) {
        setClarification({ field, question: result.question ?? '' })
        return
      }

      setImprovement({
        field,
        original: result.original,
        suggested: result.suggested ?? '',
        summaryOfChanges: result.summaryOfChanges ?? [],
      })
    } catch (caught: unknown) {
      setAssistError({ field, message: assistMessage(caught) })
    } finally {
      setAssistBusy(null)
    }
  }

  /**
   * The gate in front of the first real request.
   *
   * The disclosure is shown once, before anything leaves the browser, and the
   * action that prompted it is held rather than dropped — declining costs the
   * person nothing and running it afterwards costs them no second click.
   */
  function requestAssist(field: AiGuidanceSection, kind: Exclude<AssistBusy, null>) {
    /* One request at a time, page-wide. Two in flight would race to set state. */
    if (assistBusy) return
    if (window.localStorage.getItem(DISCLOSURE_KEY) !== 'accepted') {
      setPendingAssist({ field, kind })
      return
    }
    void (kind === 'questions' ? askForQuestions(field) : askForImprovement(field))
  }

  /**
   * Accept a suggested wording — an ordinary section write, marked as assisted.
   *
   * The author's original is kept in `undoable` first. "The original must remain
   * recoverable" is not satisfied by a preview that has already been replaced by
   * the thing it was previewing.
   */
  async function acceptImprovement() {
    if (!improvement) return
    const { field, original, suggested } = improvement
    setImprovement(null)
    setUndoable({ field, previous: original })
    await putIntoField(field, suggested, AUTHOR_ORIGINS.AI_ASSISTED)
  }

  async function undoImprovement() {
    if (!undoable) return
    const { field, previous } = undoable
    setUndoable(null)
    /* Their words come back as theirs. Undo restores authorship, not only text. */
    await putIntoField(field, previous, AUTHOR_ORIGINS.USER)
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

  /**
   * Offer a draft into a section — the only route from the chat into the C.H.A.T.
   *
   * This runs because the author pressed a button. Nothing upstream of it can
   * reach a section: the chat endpoint appends messages and never touches the
   * sections table, and the model has no way to name a destination. The write
   * below goes through the same authenticated section endpoint used when
   * someone types into the field by hand.
   */
  function addDraftToSection(field: FieldType, text: string) {
    const existing = valueOf(field)
    if (!existing.trim()) {
      /* Nothing there to protect, so it goes straight into the unsaved buffer. */
      void applyAdd(field, text, 'replace')
      return
    }
    setPendingAdd({ field, text, existing, caret: carets[field] ?? null })
  }

  /**
   * Put the text into the section's UNSAVED buffer — never a commit.
   *
   * This is the difference between "review in Content" and "write to Content".
   * The text appears in the editor as unsaved writing the author can change,
   * the header says Unsaved, and the ordinary Save they already use is what
   * commits it. Nothing generated is ever written down without them.
   */
  async function applyAdd(
    field: FieldType,
    text: string,
    mode: 'append' | 'replace' | 'insert',
  ) {
    const existing = valueOf(field)
    const next = mergeInto(existing, text, mode, carets[field] ?? existing.length)

    /*
     * Replacing stashes the previous text where Undo already looks, so a
     * replacement the author regrets is one press away from being undone.
     */
    if (mode === 'replace' && existing.trim()) {
      setUndoable({ field, previous: existing })
    }

    setPendingAdd(null)
    setEdits((current) => ({ ...current, [field]: next }))
    setPendingOrigins((current) => ({ ...current, [field]: AUTHOR_ORIGINS.AI_GENERATED }))
    setAddedNotice({ field, at: Date.now() })
    flashSection(field)

    /*
     * Bring them to it — unless they are typing somewhere else, in which case
     * moving the page under them is worse than letting them find it.
     */
    const active = document.activeElement
    const typingElsewhere =
      active instanceof HTMLTextAreaElement && active.id !== `chat-field-${field}`
    if (!typingElsewhere) viewSection(field)
  }

  /** Mark the destination, briefly, so it is seen to have received something. */
  function flashSection(field: FieldType) {
    setFlashField(field)
    window.setTimeout(
      () => setFlashField((current) => (current === field ? null : current)),
      2200,
    )
  }

  /** Take the author to the section that just changed. */
  function viewSection(field: FieldType) {
    const input = document.getElementById(`chat-field-${field}`)
    if (!input) return
    input.scrollIntoView({ block: 'center', behavior: 'smooth' })
    ;(input as HTMLTextAreaElement).focus({ preventScroll: true })
    flashSection(field)
  }

  /**
   * Ask again for the same thing.
   *
   * It repeats the REQUEST without re-posting the message that caused it, so
   * retrying does not duplicate the author's turn in the thread. It does not
   * tell the model what was wrong with the first attempt, so a second draft can
   * resemble the first — a known limitation rather than a surprise.
   */
  function retryLast() {
    if (!lastRequest || replying) return
    void requestReply(lastRequest.conversationId, lastRequest.message, lastRequest.chip)
  }

  /**
   * Invoke a structured action from a chip.
   *
   * The request fires immediately — a chip that filled the composer and waited
   * for Send is a control that looks like it did something and did not, which
   * is the defect this replaces.
   *
   * The human-readable message is stored as an ordinary user turn so the thread
   * still reads as a conversation later; the ACTION is what the server acts on,
   * and it is an identifier from a fixed list rather than that text.
   */
  async function runChip(chip: Chip) {
    if (!chatReady || sending || replying) return
    setChatError(null)

    let id = activeId
    try {
      if (!id) {
        const reference = referenceDraft?.trim()
        const created = await api<Summary>('/conversations', {
          method: 'POST',
          body: JSON.stringify({
            title: deriveTitle(chip.message),
            ...(reference ? { scriptureReference: reference } : {}),
          }),
        })
        id = created.id
      }
      await api(`/conversations/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: chip.message }),
      })
      await openConversation(id)
      await refreshList()
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Unable to send that')
      return
    }

    if (window.localStorage.getItem(DISCLOSURE_KEY) === 'accepted') {
      void requestReply(id, chip.message, chip)
    } else {
      setPendingChat({ id, message: chip.message, chip })
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

  /*
   * Why Suggest title cannot be pressed, when it cannot. `null` means it can —
   * and every other value is a sentence the person can read, rather than a
   * greyed-out control with no explanation attached to it.
   */
  const suggestReasonId = 'suggest-title-reason'
  const suggestTitleReason: string | null = !detail
    ? 'Start a reflection first — there is nothing to name yet.'
    : !hasWritten
      ? 'Write something first. A title is drawn from what you have written.'
      : !ai.enabled
        ? (ai.reason ?? 'Assistance is unavailable right now.')
        : null

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

  /* Asked once: whether assistance is there, and what to say when it is not. */
  useEffect(() => {
    api<{ enabled: boolean; reason?: string; capabilities?: AiCapabilities }>('/ai/status')
      .then(setAi)
      .catch(() =>
        setAi({ enabled: false, reason: 'Assistance could not be reached right now.' }),
      )
  }, [])

  /*
   * Everything the section controls need, in one object.
   *
   * `busyField`/`busyKind` are a single pair for the whole page rather than one
   * per section, which is what makes "no duplicate in-flight requests" a fact
   * about the state rather than a rule each handler has to remember.
   */
  /* Whether a reply can be asked for at all. */
  const chatReady = ai.capabilities?.reflectionChat === true

  const assist: AssistState = {
    available: ai.capabilities?.improveWriting === true && detail !== null,
    unavailableReason: !detail
      ? 'Start a reflection first.'
      : ai.capabilities?.improveWriting
        ? null
        : (ai.reason ?? AI_UNAVAILABLE_MESSAGE),
    busyField: assistBusy?.field ?? null,
    busyKind: assistBusy?.kind ?? null,
    guidance,
    improvement,
    clarification,
    error: assistError,
    undoable,
    onAsk: (field) => requestAssist(field, 'questions'),
    onImprove: (field) => requestAssist(field, 'improve'),
    onAccept: () => void acceptImprovement(),
    onDiscard: () => {
      /* Discard leaves the author's words exactly as they were. */
      setImprovement(null)
      setClarification(null)
    },
    onDismissGuidance: (field) =>
      setGuidance((current) => {
        const next = { ...current }
        delete next[field]
        return next
      }),
    onUndo: () => void undoImprovement(),
  }

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
      reference={referenceDraft ?? detail?.scriptureReference ?? ''}
      messages={detail?.messages ?? []}
      draft={draft}
      sending={sending}
      discussing={discussing}
      proposal={proposal}
      busyAction={busyAction}
      onDraft={setDraft}
      onSend={(event) => void sendMessage(event)}
      onChip={(chip) => void runChip(chip)}
      onAction={(action) => void runAi(action)}
      onUseInField={(field, content, origin) => void putIntoField(field, content, origin)}
      onStopDiscussing={() => setDiscussing(null)}
      onDismissProposal={() => setProposal(null)}
      composerRef={composerRef}
      replying={replying}
      chatError={chatError}
      chatAvailable={ai.capabilities?.reflectionChat === true}
      chatNotice={AI_CHAT_NOTICE}
      onDismissChatError={() => setChatError(null)}
      onAddDraft={addDraftToSection}
      onRetryDraft={retryLast}
      addedNotice={addedNotice}
      onViewSection={viewSection}
      onDismissAdded={() => setAddedNotice(null)}
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

            {/*
              An assist, not a gate. The field beside it stays exactly as
              editable as it was; this is for the moment when nothing comes to
              mind. When it cannot work it says why, rather than sitting there
              live and quietly doing nothing.
            */}
            <button
              type="button"
              className={styles.suggestButton}
              disabled={suggestTitleReason !== null || suggesting}
              title={suggestTitleReason ?? undefined}
              aria-describedby={suggestTitleReason ? suggestReasonId : undefined}
              onClick={() => void suggestTitle()}
            >
              <SparkIcon className={styles.tinyIcon} />
              {suggesting ? 'Thinking…' : 'Suggest title'}
            </button>
            {suggestTitleReason ? (
              <span className="sr-only" id={suggestReasonId}>
                {suggestTitleReason}
              </span>
            ) : null}
          </div>

          <div className={styles.artifactHeadSide}>
            {/*
              Saving, in words, where the work is — and only once there is
              work. A blank page reporting "Saved" is a reassurance about
              nothing.
            */}
            {detail ? (
              <>
                <span className={styles.saveState} data-status={saveStatus} role="status">
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
              </>
            ) : null}

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

        {/*
          The passage, above the writing.

          It sits between the reflection's title and its four sections because
          that is the order of the act: you read the passage, then you write
          about it. The component owns everything else — its own loading, its
          own storage, its own recovery — so this page hands it a reflection id
          and nothing more.
        */}
        <ScripturePassage
          conversationId={activeId}
          initialReference={referenceDraft ?? detail?.scriptureReference ?? ''}
        />

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
            assist={assist}
            flashed={flashField}
            onCaret={(field, at) => setCarets((current) => ({ ...current, [field]: at }))}
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
            (['content', 'heart', 'application', 'testimony'] as const).map((field) => [
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

      {titleSuggestions && detail ? (
        <TitleSuggestionSheet
          suggestions={titleSuggestions.titles}
          source={titleSuggestions.source}
          currentTitle={displayTitleValue(detail.title, detail.scriptureReference)}
          format={format}
          /* Declining leaves the title exactly as it was. */
          onClose={() => setTitleSuggestions(null)}
          onUse={async (title) => {
            const ok = await patchConversation({ title })
            if (ok) setTitleSuggestions(null)
          }}
        />
      ) : null}

      {/*
        The only place existing section text can be displaced, and it asks
        first. There is no code path that replaces what the author wrote
        without this sheet returning an answer.
      */}
      {pendingAdd ? (
        <AddToSectionSheet
          sectionName={
            fields.find((meta) => meta.type === pendingAdd.field)?.name ?? pendingAdd.field
          }
          text={pendingAdd.text}
          existing={pendingAdd.existing}
          caret={pendingAdd.caret}
          onCancel={() => setPendingAdd(null)}
          onChoose={(mode) => void applyAdd(pendingAdd.field, pendingAdd.text, mode)}
        />
      ) : null}

      {pendingAssist || pendingChat ? (
        <AiDisclosureSheet
          disclosure={AI_DISCLOSURE}
          onAccept={() => {
            const assist = pendingAssist
            const chat = pendingChat
            window.localStorage.setItem(DISCLOSURE_KEY, 'accepted')
            setPendingAssist(null)
            setPendingChat(null)
            /* Held rather than dropped: agreeing does not cost a second click. */
            if (assist) {
              void (assist.kind === 'questions'
                ? askForQuestions(assist.field)
                : askForImprovement(assist.field))
            }
            if (chat) void requestReply(chat.id, chat.message, chat.chip)
          }}
          /*
           * Declining sends nothing. A message already written stays written —
           * it simply goes unanswered, which is the note-to-self behaviour.
           */
          onClose={() => {
            setPendingAssist(null)
            setPendingChat(null)
          }}
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
