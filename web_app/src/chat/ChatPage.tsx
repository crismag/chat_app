import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  AI_ACTIONS,
  CHAT_FORMATS,
  type AiAction,
  type ChatFormat,
  type ChatSection,
  type ChatSectionType,
  type ConversationSummary,
} from '@chat/shared'
import { api } from '../shared/api/client.ts'
import {
  BookIcon,
  CloseIcon,
  GlobeIcon,
  LockIcon,
  SendIcon,
} from '../shared/ui/icons.tsx'
import { ChatCompanion } from './ChatCompanion.tsx'
import { ConversationSidebar } from './ConversationSidebar.tsx'
import { deriveTitle, displayTitle } from './history.ts'
import { SECTIONS } from './sections.ts'
import styles from './ChatPage.module.css'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  authorOrigin: string
}

/** The API returns a format on every conversation; the shared summary predates it. */
type Summary = ConversationSummary & { format?: ChatFormat }

type ConversationDetail = Summary & {
  messages: Message[]
  sections: Record<ChatSectionType, ChatSection>
}

const contextualActions: { id: AiAction; label: string }[] = [
  { id: AI_ACTIONS.EXPLAIN, label: 'Explain this passage' },
  { id: AI_ACTIONS.POLISH, label: 'Polish' },
  { id: AI_ACTIONS.SHORTEN, label: 'Shorten' },
  { id: AI_ACTIONS.SUMMARIZE, label: 'Summarize' },
]

const SIDEBAR_KEY = 'chat.reflect.sidebar'

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
  const [reference, setReference] = useState('')
  const [referenceOpen, setReferenceOpen] = useState(false)
  const [proposal, setProposal] = useState<{ original: string; revised: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const [query, setQuery] = useState('')
  const [searchFocusToken, setSearchFocusToken] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)

  const composerRef = useRef<HTMLTextAreaElement>(null)
  const referenceRef = useRef<HTMLInputElement>(null)
  const messagesRef = useRef<HTMLOListElement>(null)
  const drawerCloseRef = useRef<HTMLButtonElement>(null)
  /** Which conversation the page has already loaded, so the URL effect can tell
   * a genuine navigation from its own echo. */
  const openedRef = useRef<string | null>(null)

  const isNarrow = useMediaQuery('(max-width: 899px)')
  /*
   * Below this the three panes stop fitting side by side without squeezing the
   * conversation, so the history collapses itself. The stored preference is not
   * forgotten — it is what comes back when the window is wide again.
   */
  const isTightDesktop = useMediaQuery('(max-width: 1199px)')

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

  const refreshList = useCallback(async () => {
    setConversations(await api<Summary[]>('/conversations'))
  }, [])

  /*
   * The open reflection lives in the address bar.
   *
   * Reloading in the middle of writing should not drop someone back onto an
   * empty page: the conversation being read is part of where they are, so it is
   * in the URL, and Back walks the reflections they opened.
   */
  const openConversation = useCallback(
    async (id: string) => {
      const next = await api<ConversationDetail>(`/conversations/${id}`)
      openedRef.current = id
      setActiveId(id)
      setDetail(next)
      setProposal(null)
      setSearchParams(
        (current) => {
          if (current.get('c') === id) return current
          const params = new URLSearchParams(current)
          params.set('c', id)
          return params
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  useEffect(() => {
    const requestedId = searchParams.get('c')
    void refreshList()
      .then(async () => {
        // Skip the round trip when the URL only caught up with what is open.
        if (requestedId && requestedId !== openedRef.current) {
          await openConversation(requestedId)
        }
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Unable to load conversations')
      })
  }, [searchParams, refreshList, openConversation])

  // The header's New reflection button arrives as ?new=1 rather than as state.
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      startNew()
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight })
  }, [detail])

  // A drawer traps nothing useful if Escape does not close it.
  useEffect(() => {
    if (!drawerOpen && !listOpen) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setDrawerOpen(false)
        setListOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen, listOpen])

  useEffect(() => {
    if (drawerOpen) {
      drawerCloseRef.current?.focus()
    }
  }, [drawerOpen])

  function startNew() {
    openedRef.current = null
    setActiveId(null)
    setDetail(null)
    setDraft('')
    setReference('')
    setReferenceOpen(false)
    setProposal(null)
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

  /*
   * Writing comes first.
   *
   * There is no title form to clear before a thought can be written down. The
   * conversation is created by the act of sending the first message, and named
   * from whatever it turns out to be about.
   */
  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || sending) {
      return
    }
    setSending(true)
    setError(null)
    try {
      let id = activeId
      if (!id) {
        const created = await api<Summary>('/conversations', {
          method: 'POST',
          body: JSON.stringify({
            title: deriveTitle(content),
            ...(reference.trim() ? { scriptureReference: reference.trim() } : {}),
          }),
        })
        id = created.id
      }
      await api(`/conversations/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      })
      setDraft('')
      setReferenceOpen(false)
      await openConversation(id)
      await refreshList()
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Unable to send that message')
    } finally {
      setSending(false)
    }
  }

  async function runAi(action: AiAction) {
    if (!activeId) return
    const result = await api<{ original?: string; revised?: string }>(
      `/conversations/${activeId}/ai`,
      { method: 'POST', body: JSON.stringify({ action }) },
    )
    if (result.original && result.revised) {
      setProposal({ original: result.original, revised: result.revised })
    }
    await openConversation(activeId)
  }

  async function saveSection(type: ChatSectionType, content: string) {
    if (!activeId) return
    await api(`/conversations/${activeId}/sections`, {
      method: 'PATCH',
      body: JSON.stringify({ type, content }),
    })
    await openConversation(activeId)
    await refreshList()
  }

  async function setPublication(publish: boolean) {
    if (!activeId) return
    try {
      await api(`/conversations/${activeId}/${publish ? 'publish' : 'unpublish'}`, {
        method: 'POST',
      })
      await openConversation(activeId)
      await refreshList()
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'This reflection is not ready to publish.',
      )
    }
  }

  const hasWritten = detail !== null && detail.messages.length > 0
  const format: ChatFormat = detail?.format ?? CHAT_FORMATS.FULL
  const done = detail
    ? SECTIONS.filter((meta) => detail.sections[meta.type]?.content.trim()).length
    : 0

  const sidebar = (
    <ConversationSidebar
      conversations={conversations}
      activeId={activeId}
      collapsed={isNarrow ? false : collapsed}
      query={query}
      onQuery={setQuery}
      onSelect={(id) => {
        setListOpen(false)
        void openConversation(id).catch(() => setError('Unable to open that reflection'))
      }}
      onNew={startNew}
      onToggle={toggleSidebar}
      onSearchRequested={() => {
        toggleSidebar()
        setSearchFocusToken((token) => token + 1)
      }}
      searchFocusToken={searchFocusToken}
    />
  )

  const companion = (
    <ChatCompanion
      sections={detail?.sections ?? null}
      format={format}
      title={detail?.title ?? ''}
      scriptureReference={detail?.scriptureReference ?? null}
      hasWritten={hasWritten}
      onSave={saveSection}
      onExtract={async () => {
        await runAi(AI_ACTIONS.EXTRACT_CHAT)
      }}
      onCreateVisual={() => void navigate(`/create?c=${activeId ?? ''}`)}
    />
  )

  return (
    <section
      className={styles.workspace}
      data-collapsed={!isNarrow && collapsed ? 'true' : 'false'}
    >
      {isNarrow ? null : sidebar}

      <div className={styles.thread}>
        {/*
          A div, not a <header>: this is the conversation's own heading row,
          and a second banner landmark beside the shell's would make the page
          ambiguous to anyone navigating by landmark.
        */}
        <div className={styles.threadHead}>
          <div className={styles.threadHeadMain}>
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

            <div className={styles.threadIdentity}>
              {/* Scripture leads: it is the anchor the reflection hangs from. */}
              <p className={styles.scripture}>
                {detail?.scriptureReference ?? 'No passage chosen yet'}
              </p>
              <h1 className={styles.threadTitle}>
                {detail
                  ? displayTitle(detail.title, detail.scriptureReference)
                  : 'New reflection'}
              </h1>
            </div>
          </div>

          <div className={styles.threadHeadSide}>
            {detail ? (
              <span className={styles.privacy}>
                {detail.publicationState === 'published' ? (
                  <>
                    <GlobeIcon className={styles.tinyIcon} />
                    Published
                  </>
                ) : (
                  <>
                    <LockIcon className={styles.tinyIcon} />
                    Private
                  </>
                )}
              </span>
            ) : null}

            {detail ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void setPublication(detail.publicationState !== 'published')}
              >
                {detail.publicationState === 'published' ? 'Unpublish' : 'Publish'}
              </button>
            ) : null}

            {/* The companion's own handle, on screens too narrow to show it. */}
            {isNarrow && hasWritten ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setDrawerOpen(true)}
                aria-expanded={drawerOpen}
              >
                C.H.A.T. {done}/4
              </button>
            ) : null}
          </div>
        </div>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        {hasWritten && detail ? (
          <ol className={styles.messages} ref={messagesRef}>
            {detail.messages.map((message) => (
              <li key={message.id} className={styles.message} data-role={message.role}>
                <p className={styles.messageWho}>
                  {message.role === 'user' ? 'You' : 'C.H.A.T.'}
                </p>
                <p className={styles.messageBody}>{message.content}</p>
              </li>
            ))}
          </ol>
        ) : (
          /*
           * The empty state asks a question rather than reporting an absence,
           * and every action beside it starts something. Nothing here has to be
           * filled in before writing is possible.
           */
          <div className={styles.empty}>
            <p className={styles.emptyPrompt}>What passage are you reflecting on today?</p>
            <div className={styles.emptyActions}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setReferenceOpen(true)
                  window.setTimeout(() => referenceRef.current?.focus(), 0)
                }}
              >
                Choose a Scripture
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => composerRef.current?.focus()}
              >
                Share what touched your heart
              </button>
              {conversations.length > 0 ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    const last = conversations[0]
                    if (last) {
                      void openConversation(last.id)
                    }
                  }}
                >
                  Continue your last reflection
                </button>
              ) : null}
            </div>
          </div>
        )}

        {proposal ? (
          <aside className={styles.proposal}>
            <p className={styles.proposalLabel}>
              Suggested wording — nothing has been changed
            </p>
            <p className={styles.proposalOriginal}>{proposal.original}</p>
            <p className={styles.proposalRevised}>{proposal.revised}</p>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setProposal(null)}
            >
              Dismiss
            </button>
          </aside>
        ) : null}

        <div className={styles.composerWrap}>
          {hasWritten ? (
            <div className={styles.contextualActions}>
              {contextualActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className={styles.chip}
                  onClick={() => void runAi(action.id)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}

          {referenceOpen && !detail ? (
            <label className={styles.referenceRow}>
              <span className="sr-only">Scripture reference</span>
              <input
                ref={referenceRef}
                className={styles.referenceInput}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Romans 8:28"
              />
            </label>
          ) : null}

          <form className={styles.composer} onSubmit={(event) => void sendMessage(event)}>
            <textarea
              ref={composerRef}
              className={styles.composerInput}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  void sendMessage(event as unknown as FormEvent)
                }
              }}
              placeholder={
                hasWritten
                  ? 'Keep going…'
                  : 'Write what you are seeing in the passage, or what it stirred.'
              }
              aria-label="Write your reflection"
              rows={2}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={sending || !draft.trim()}
              aria-label="Send"
            >
              <SendIcon className={styles.smallIcon} />
            </button>
          </form>
        </div>
      </div>

      {isNarrow ? null : companion}

      {/* --- Drawers, on screens with room for one pane at a time --------- */}

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

      {isNarrow && drawerOpen ? (
        <div className={styles.scrim} onClick={() => setDrawerOpen(false)}>
          <div
            className={`${styles.drawer} ${styles.drawerRight}`}
            role="dialog"
            aria-label="C.H.A.T. companion"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.drawerHead}>
              <button
                ref={drawerCloseRef}
                type="button"
                className={styles.headerButton}
                onClick={() => setDrawerOpen(false)}
                aria-label="Close the C.H.A.T. companion"
              >
                <CloseIcon className={styles.smallIcon} />
              </button>
            </div>
            {companion}
          </div>
        </div>
      ) : null}
    </section>
  )
}
