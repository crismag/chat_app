/*
 * One conversation. Bubbles use surface tokens, not C.H.A.T. section colours
 * and not Messenger blue.
 */

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError } from '../shared/api/client.ts'
import { Avatar } from '../shared/ui/Avatar.tsx'
import { ContactButton } from './ContactButton.tsx'
import {
  REACTION_EMOJIS,
  MUTE_UNTIL_ON,
  archiveThread,
  canChangeMessage,
  deleteMessage,
  editMessage,
  hideThread,
  isMuted,
  listMessages,
  markRead,
  muteThread,
  personLabel,
  pinThread,
  searchThread,
  sendMessage,
  setReaction,
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
  onHidden,
}: {
  thread: MessagingThread
  mineId: string | null
  onBack?: () => void
  onUpdated: (thread: MessagingThread) => void
  onHidden?: () => void
}) {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<MessagingMessage[]>([])
  const [olderCursor, setOlderCursor] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<MessagingMessage | null>(null)
  const [editing, setEditing] = useState<MessagingMessage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')
  const [hits, setHits] = useState<MessagingMessage[] | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const lastId = messages.at(-1)?.id

  useEffect(() => {
    let live = true
    void listMessages(thread.id)
      .then((result) => {
        if (!live) return
        setMessages(result.items)
        setOlderCursor(result.olderCursor)
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
      void listMessages(thread.id, { after: lastId }).then((result) => {
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

  useEffect(() => {
    const wanted = search.trim()
    if (wanted.length < 2) {
      setHits(null)
      return
    }
    const timer = window.setTimeout(() => {
      void searchThread(thread.id, wanted).then((result) => setHits(result.items))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [search, thread.id])

  function replaceMessage(next: MessagingMessage) {
    setMessages((current) => current.map((item) => (item.id === next.id ? next : item)))
  }

  async function submit() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    try {
      if (editing) {
        const edited = await editMessage(thread.id, editing.id, body)
        replaceMessage(edited)
        setEditing(null)
        setDraft('')
      } else {
        const sent = await sendMessage(thread.id, body, replyTo?.id)
        setDraft('')
        setReplyTo(null)
        setMessages((current) => [...current, sent])
        onUpdated({ ...thread, lastMessage: sent, unreadCount: 0, archived: false })
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The message could not be sent.')
    } finally {
      setSending(false)
    }
  }

  async function remove(message: MessagingMessage, scope: 'me' | 'everyone') {
    setError(null)
    try {
      await deleteMessage(thread.id, message.id, scope)
      if (scope === 'me') {
        setMessages((current) => current.filter((item) => item.id !== message.id))
      } else {
        replaceMessage({ ...message, body: '', deletedAt: new Date().toISOString(), parent: null, reactions: [] })
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The message could not be removed.')
    }
  }

  async function react(message: MessagingMessage, emoji: string) {
    try {
      replaceMessage(await setReaction(thread.id, message.id, message.reactions.some((item) => item.me && item.emoji === emoji) ? null : emoji))
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That reaction could not be saved.')
    }
  }

  async function applyThread(action: () => Promise<MessagingThread>) {
    try {
      onUpdated(await action())
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That could not be changed.')
    }
  }

  const name = personLabel(thread.other)
  const muted = isMuted(thread.mutedUntil)
  const shown = hits ?? messages
  const lastMine = [...messages].reverse().find((item) => item.senderUserId === mineId && !item.deletedAt)
  const seen =
    thread.otherLastReadMessageId && lastMine && thread.otherLastReadMessageId === lastMine.id

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
          <h2 className={styles.name}>
            {thread.other.handle ? (
              <Link to={`/profile/${thread.other.handle}`}>{name}</Link>
            ) : (
              name
            )}
          </h2>
          {thread.other.handle ? <p className={styles.handle}>@{thread.other.handle}</p> : null}
        </div>
        {thread.other.handle ? (
          <ContactButton
            handle={thread.other.handle}
            isContact={thread.isContact}
            onChanged={(isContact) => onUpdated({ ...thread, isContact })}
          />
        ) : null}
        <details className={styles.menu}>
          <summary>More</summary>
          <div className={styles.menuList}>
            <button
              type="button"
              onClick={() => void applyThread(() => muteThread(thread.id, muted ? null : MUTE_UNTIL_ON))}
            >
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button
              type="button"
              onClick={() => void applyThread(() => pinThread(thread.id, !thread.pinned))}
            >
              {thread.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              type="button"
              onClick={() => void applyThread(() => archiveThread(thread.id, !thread.archived))}
            >
              {thread.archived ? 'Unarchive' : 'Archive'}
            </button>
            <button
              type="button"
              onClick={() => {
                void hideThread(thread.id).then(() => {
                  onHidden?.()
                  navigate('/messages')
                })
              }}
            >
              Remove for me
            </button>
          </div>
        </details>
      </header>

      <label className={styles.search}>
        <span className={styles.srOnly}>Search this conversation</span>
        <input
          className={styles.searchInput}
          type="search"
          value={search}
          placeholder="Search this conversation"
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>

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
        {olderCursor && !hits ? (
          <button
            type="button"
            className={styles.older}
            onClick={() => {
              void listMessages(thread.id, { before: olderCursor }).then((result) => {
                setMessages((current) => {
                  const seenIds = new Set(current.map((item) => item.id))
                  return [...result.items.filter((item) => !seenIds.has(item.id)), ...current]
                })
                setOlderCursor(result.olderCursor)
              })
            }}
          >
            Older messages
          </button>
        ) : null}
        {shown.length === 0 ? (
          <p className={styles.empty}>{hits ? 'Nothing in this conversation matches.' : 'No messages yet. Say hello.'}</p>
        ) : (
          shown.map((message) => {
            const mine = message.senderUserId === mineId
            const changeable = mine && !message.deletedAt && canChangeMessage(message.createdAt)
            return (
              <div key={message.id} className={styles.row} data-mine={mine ? 'true' : 'false'}>
                {message.parent ? (
                  <p className={styles.quote}>{message.parent.body}</p>
                ) : null}
                <p className={styles.bubble} data-deleted={message.deletedAt ? 'true' : 'false'}>
                  {message.deletedAt ? 'Message removed' : message.body}
                </p>
                <time className={styles.time} dateTime={message.createdAt}>
                  {new Date(message.createdAt).toLocaleString()}
                  {message.editedAt ? ' · Edited' : ''}
                </time>
                {message.reactions.length > 0 ? (
                  <p className={styles.reactionRow}>
                    {message.reactions.map((item) => (
                      <span key={item.emoji}>
                        {item.emoji} {item.count}
                      </span>
                    ))}
                  </p>
                ) : null}
                {!message.deletedAt && !thread.pendingIncomingRequestId ? (
                  <div className={styles.actions}>
                    <button type="button" onClick={() => { setReplyTo(message); setEditing(null) }}>
                      Reply
                    </button>
                    {REACTION_EMOJIS.map((emoji) => (
                      <button key={emoji} type="button" onClick={() => void react(message, emoji)}>
                        {emoji}
                      </button>
                    ))}
                    {changeable ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(message)
                          setReplyTo(null)
                          setDraft(message.body)
                        }}
                      >
                        Edit
                      </button>
                    ) : null}
                    <button type="button" onClick={() => void remove(message, 'me')}>
                      Hide
                    </button>
                    {changeable ? (
                      <button type="button" onClick={() => void remove(message, 'everyone')}>
                        Unsend
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })
        )}
        {seen ? <p className={styles.seen}>Seen</p> : null}
      </div>

      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {replyTo || editing ? (
          <p className={styles.composeNote}>
            {editing ? 'Editing' : `Replying to: ${replyTo?.body ?? ''}`}
            <button
              type="button"
              className={styles.clearNote}
              onClick={() => {
                setReplyTo(null)
                setEditing(null)
                if (editing) setDraft('')
              }}
            >
              Cancel
            </button>
          </p>
        ) : null}
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
          {editing ? 'Save' : 'Send'}
        </button>
      </form>
    </section>
  )
}
