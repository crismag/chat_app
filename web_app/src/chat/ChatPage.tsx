import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import {
  AI_ACTIONS,
  CHAT_SECTION_TYPES,
  type AiAction,
  type ChatSection,
  type ChatSectionType,
  type ConversationSummary,
} from '@chat/shared'
import { api } from '../shared/api/client.ts'
import styles from './ChatPage.module.css'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  authorOrigin: string
}

type ConversationDetail = ConversationSummary & {
  messages: Message[]
  sections: Record<ChatSectionType, ChatSection>
}

const aiActions: { id: AiAction; label: string }[] = [
  { id: AI_ACTIONS.EXPLAIN, label: 'Explain' },
  { id: AI_ACTIONS.GRAMMAR, label: 'Grammar only' },
  { id: AI_ACTIONS.POLISH, label: 'Polish' },
  { id: AI_ACTIONS.SHORTEN, label: 'Shorten' },
  { id: AI_ACTIONS.SUMMARIZE, label: 'Summarize' },
  { id: AI_ACTIONS.EXTRACT_CHAT, label: 'Extract C.H.A.T.' },
]

export function ChatPage() {
  const [searchParams] = useSearchParams()
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ConversationDetail | null>(null)
  const [draft, setDraft] = useState('')
  const [title, setTitle] = useState('')
  const [reference, setReference] = useState('')
  const [proposal, setProposal] = useState<{ original: string; revised: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refreshList() {
    setConversations(await api<ConversationSummary[]>('/conversations'))
  }

  async function openConversation(id: string) {
    const next = await api<ConversationDetail>(`/conversations/${id}`)
    setActiveId(id)
    setDetail(next)
    setProposal(null)
  }

  useEffect(() => {
    const requestedId = searchParams.get('c')
    void refreshList()
      .then(async () => {
        if (requestedId) {
          await openConversation(requestedId)
        }
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : 'Unable to load conversations')
      })
  }, [searchParams])

  async function createConversation(event: FormEvent) {
    event.preventDefault()
    const created = await api<ConversationSummary>('/conversations', {
      method: 'POST',
      body: JSON.stringify({ title, scriptureReference: reference }),
    })
    setTitle('')
    setReference('')
    await refreshList()
    await openConversation(created.id)
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    if (!activeId || !draft.trim()) {
      return
    }
    await api(`/conversations/${activeId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: draft }),
    })
    setDraft('')
    await openConversation(activeId)
    await refreshList()
  }

  async function runAi(action: AiAction) {
    if (!activeId) {
      return
    }
    const result = await api<{
      original?: string
      revised?: string
      sections?: ConversationDetail['sections']
    }>(`/conversations/${activeId}/ai`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    })
    if (result.original && result.revised) {
      setProposal({ original: result.original, revised: result.revised })
    }
    await openConversation(activeId)
  }

  async function saveSection(type: ChatSectionType, content: string) {
    if (!activeId) {
      return
    }
    await api(`/conversations/${activeId}/sections`, {
      method: 'PATCH',
      body: JSON.stringify({ type, content }),
    })
    await openConversation(activeId)
  }

  async function publish() {
    if (!activeId) {
      return
    }
    await api(`/conversations/${activeId}/publish`, { method: 'POST' })
    await openConversation(activeId)
    await refreshList()
  }

  async function unpublish() {
    if (!activeId) {
      return
    }
    await api(`/conversations/${activeId}/unpublish`, { method: 'POST' })
    await openConversation(activeId)
    await refreshList()
  }

  return (
    <section className={styles.workspace}>
      <aside className={styles.sidebar}>
        <h1>Conversation</h1>
        <form className={styles.stack} onSubmit={(event) => void createConversation(event)}>
          <input
            placeholder="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
          <input
            placeholder="Scripture reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
          <button type="submit">New conversation</button>
        </form>
        <ul className={styles.list}>
          {conversations.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={item.id === activeId ? styles.activeItem : undefined}
                onClick={() => void openConversation(item.id)}
              >
                {item.title}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className={styles.thread}>
        {error ? <p className={styles.error}>{error}</p> : null}
        {detail ? (
          <>
            <header>
              <h2>{detail.title}</h2>
              <p>
                {detail.scriptureReference ?? 'No reference yet'} · {detail.publicationState}
              </p>
              {detail.publicationState === 'private' ? (
                <button type="button" onClick={() => void publish()}>
                  Publish to Community
                </button>
              ) : (
                <button type="button" onClick={() => void unpublish()}>
                  Unpublish
                </button>
              )}
            </header>
            <ol className={styles.messages}>
              {detail.messages.map((message) => (
                <li key={message.id} data-role={message.role}>
                  <strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong>
                  <p>{message.content}</p>
                </li>
              ))}
            </ol>
            {proposal ? (
              <aside className={styles.proposal}>
                <p>Original preserved:</p>
                <p>{proposal.original}</p>
                <p>Proposed revision (not applied):</p>
                <p>{proposal.revised}</p>
              </aside>
            ) : null}
            <div className={styles.actions}>
              {aiActions.map((action) => (
                <button key={action.id} type="button" onClick={() => void runAi(action.id)}>
                  {action.label}
                </button>
              ))}
            </div>
            <form className={styles.composer} onSubmit={(event) => void sendMessage(event)}>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Write a reflection, question, or testimony…"
                required
              />
              <button type="submit">Send</button>
            </form>
          </>
        ) : (
          <p>Start or open a conversation. It stays private until you publish it.</p>
        )}
      </div>

      <aside className={styles.sections}>
        <h2>C.H.A.T.</h2>
        {Object.values(CHAT_SECTION_TYPES).map((type) => (
          <label key={type}>
            {type}
            <textarea
              value={detail?.sections[type]?.content ?? ''}
              onChange={(event) => {
                if (!detail) {
                  return
                }
                setDetail({
                  ...detail,
                  sections: {
                    ...detail.sections,
                    [type]: {
                      type,
                      content: event.target.value,
                      authorOrigin: detail.sections[type]?.authorOrigin ?? 'user',
                    },
                  },
                })
              }}
              onBlur={(event) => void saveSection(type, event.target.value)}
              placeholder={
                type === 'heart' || type === 'testimony'
                  ? 'Leave empty unless you have expressed this'
                  : ''
              }
            />
          </label>
        ))}
      </aside>
    </section>
  )
}
