/*
 * One conversation. Bubbles use surface tokens, not C.H.A.T. section colours
 * and not Messenger blue.
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../shared/api/client.ts'
import { Avatar } from '../shared/ui/Avatar.tsx'
import { ContactButton } from './ContactButton.tsx'
import {
  listMessages,
  markRead,
  personLabel,
  sendMessage,
  type MessagingMessage,
  type MessagingThread,
} from './api.ts'
import styles from './ThreadView.module.css'

const POLL_MS = 4_000

export function ThreadView({
  thread,
  mineId,
  onBack,
  onUpdated,
}: {
  thread: MessagingThread
  mineId: string | null
  onBack?: () => void
  onUpdated: (thread: MessagingThread) => void
}) {
  const [messages, setMessages] = useState<MessagingMessage[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const lastId = messages.at(-1)?.id

  useEffect(() => {
    let live = true
    void listMessages(thread.id)
      .then((result) => {
        if (!live) return
        setMessages(result.items)
        const newest = result.items.at(-1)
        if (newest) void markRead(thread.id, newest.id).then(() => onUpdated({ ...thread, unreadCount: 0 }))
      })
      .catch((caught: unknown) => {
        if (!live) return
        setError(caught instanceof ApiError ? caught.message : 'Messages could not be loaded.')
      })
    return () => {
      live = false
    }
  }, [thread.id])

  useEffect(() => {
    if (!lastId) return
    const handle = window.setInterval(() => {
      void listMessages(thread.id, lastId).then((result) => {
        if (result.items.length === 0) return
        setMessages((current) => {
          const seen = new Set(current.map((item) => item.id))
          return [...current, ...result.items.filter((item) => !seen.has(item.id))]
        })
        const newest = result.items.at(-1)
        if (newest) void markRead(thread.id, newest.id)
      })
    }, POLL_MS)
    return () => window.clearInterval(handle)
  }, [thread.id, lastId])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [messages.length])

  async function submit() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    try {
      const sent = await sendMessage(thread.id, body)
      setDraft('')
      setMessages((current) => [...current, sent])
      onUpdated({ ...thread, lastMessage: sent, unreadCount: 0 })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The message could not be sent.')
    } finally {
      setSending(false)
    }
  }

  const name = personLabel(thread.other)

  return (
    <section className={styles.thread} aria-label={`Conversation with ${name}`}>
      <header className={styles.head}>
        {onBack ? (
          <button type="button" className={styles.back} onClick={onBack}>
            Back
          </button>
        ) : null}
        <Avatar name={name} identity={thread.other.handle ?? thread.other.id} src={thread.other.avatarUrl} size="small" />
        <div className={styles.who}>
          {/*
            The name goes to their profile. It was the one thing in a
            conversation that named a person and led nowhere.
          */}
          <h2 className={styles.name}>
            {thread.other.handle ? (
              <Link to={`/profile/${thread.other.handle}`}>{name}</Link>
            ) : (
              name
            )}
          </h2>
          {thread.other.handle ? <p className={styles.handle}>@{thread.other.handle}</p> : null}
        </div>
        {/*
          Adding somebody is a note in your own address book — it is what lets
          them write to you later without joining a queue, and it says nothing
          about whether they have added you.
        */}
        {thread.other.handle ? (
          <ContactButton
            handle={thread.other.handle}
            isContact={thread.isContact}
            onChanged={(isContact) => onUpdated({ ...thread, isContact })}
          />
        ) : null}
      </header>

      {thread.pendingIncomingRequestId ? (
        <p className={styles.banner} role="status">
          Accept this request in Requests before you can reply.
        </p>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.log} ref={scroller}>
        {messages.length === 0 ? (
          <p className={styles.empty}>No messages yet. Say hello.</p>
        ) : (
          messages.map((message) => {
            const mine = message.senderUserId === mineId
            return (
              <div key={message.id} className={styles.row} data-mine={mine ? 'true' : 'false'}>
                <p className={styles.bubble}>{message.body}</p>
                <time className={styles.time} dateTime={message.createdAt}>
                  {new Date(message.createdAt).toLocaleString()}
                </time>
              </div>
            )
          })
        )}
      </div>

      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <label className={styles.srOnly} htmlFor={`compose-${thread.id}`}>
          Message
        </label>
        <textarea
          id={`compose-${thread.id}`}
          className={styles.input}
          rows={2}
          value={draft}
          disabled={Boolean(thread.pendingIncomingRequestId)}
          placeholder={thread.pendingIncomingRequestId ? 'Accept the request to reply' : 'Write a message…'}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={sending || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  )
}
