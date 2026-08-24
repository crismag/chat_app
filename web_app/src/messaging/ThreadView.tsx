/*
 * One conversation. Bubbles use surface tokens, not C.H.A.T. section colours
 * and not Messenger blue.
 *
 * Density: search and per-message verbs stay off-screen until asked for.
 * Messenger keeps a log of bubbles; it does not print a toolbar under every
 * line. Tap a message to act on it. Search lives under More.
 */

import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError } from '../shared/api/client.ts'
import { Avatar } from '../shared/ui/Avatar.tsx'
import { ContactButton } from './ContactButton.tsx'
import {
  REACTION_EMOJIS,
  MUTE_UNTIL_ON,
  addContact,
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
  removeContact,
  searchThread,
  sendMessage,
  setReaction,
  type MessagingMessage,
  type MessagingThread,
} from './api.ts'
import { formatClusterTime, shouldShowClusterTime } from './time.ts'
import styles from './ThreadView.module.css'

const POLL_MS = 4_000

function closeMenu(event: { currentTarget: EventTarget & Element }) {
  const details = event.currentTarget.closest('details')
  if (details) details.open = false
}

function ThreadMenu({
  compact,
  searchOpen,
  muted,
  pinned,
  archived,
  isContact,
  handle,
  onSearch,
  onContact,
  onMute,
  onPin,
  onArchive,
  onHide,
}: {
  compact: boolean
  searchOpen: boolean
  muted: boolean
  pinned: boolean
  archived: boolean
  isContact: boolean
  handle: string | null
  onSearch: () => void
  onContact: () => void
  onMute: () => void
  onPin: () => void
  onArchive: () => void
  onHide: () => void
}) {
  return (
    <details className={styles.menu}>
      <summary>More</summary>
      <div className={styles.menuList}>
        <button
          type="button"
          onClick={(event) => {
            onSearch()
            closeMenu(event)
          }}
        >
          {searchOpen ? 'Hide search' : 'Search'}
        </button>
        {compact && handle ? (
          <button
            type="button"
            onClick={(event) => {
              onContact()
              closeMenu(event)
            }}
          >
            {isContact ? 'Remove from contacts' : 'Add to contacts'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={(event) => {
            onMute()
            closeMenu(event)
          }}
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <button
          type="button"
          onClick={(event) => {
            onPin()
            closeMenu(event)
          }}
        >
          {pinned ? 'Unpin' : 'Pin'}
        </button>
        <button
          type="button"
          onClick={(event) => {
            onArchive()
            closeMenu(event)
          }}
        >
          {archived ? 'Unarchive' : 'Archive'}
        </button>
        <button
          type="button"
          onClick={(event) => {
            closeMenu(event)
            onHide()
          }}
        >
          Remove for me
        </button>
      </div>
    </details>
  )
}

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
  const compact = Boolean(onBack)
  const [messages, setMessages] = useState<MessagingMessage[]>([])
  const [olderCursor, setOlderCursor] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<MessagingMessage | null>(null)
  const [editing, setEditing] = useState<MessagingMessage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [hits, setHits] = useState<MessagingMessage[] | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const lastId = messages.at(-1)?.id

  useEffect(() => {
    let live = true
    setLoaded(false)
    setSelectedId(null)
    setSearch('')
    setSearchOpen(false)
    void listMessages(thread.id)
      .then((result) => {
        if (!live) return
        setMessages(result.items)
        setOlderCursor(result.olderCursor)
        setLoaded(true)
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
    if (!searchOpen) {
      setHits(null)
      return
    }
    const wanted = search.trim()
    if (wanted.length < 2) {
      setHits(null)
      return
    }
    const timer = window.setTimeout(() => {
      void searchThread(thread.id, wanted).then((result) => setHits(result.items))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [search, searchOpen, thread.id])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setSelectedId(null)
      if (searchOpen) {
        setSearchOpen(false)
        setSearch('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchOpen])

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
      setSelectedId(null)
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
      setSelectedId(null)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The message could not be removed.')
    }
  }

  async function react(message: MessagingMessage, emoji: string) {
    try {
      replaceMessage(
        await setReaction(
          thread.id,
          message.id,
          message.reactions.some((item) => item.me && item.emoji === emoji) ? null : emoji,
        ),
      )
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

  async function toggleContact() {
    if (!thread.other.handle) return
    const next = !thread.isContact
    onUpdated({ ...thread, isContact: next })
    try {
      if (next) await addContact(thread.other.handle)
      else await removeContact(thread.other.handle)
    } catch (caught) {
      onUpdated({ ...thread, isContact: !next })
      setError(caught instanceof ApiError ? caught.message : 'Contacts could not be updated.')
    }
  }

  const name = personLabel(thread.other)
  const muted = isMuted(thread.mutedUntil)
  const shown = hits ?? messages
  const selected = shown.find((item) => item.id === selectedId) ?? null
  const lastMine = [...messages].reverse().find((item) => item.senderUserId === mineId && !item.deletedAt)
  const seen =
    thread.otherLastReadMessageId && lastMine && thread.otherLastReadMessageId === lastMine.id
  const selectedChangeable = Boolean(
    selected && selected.senderUserId === mineId && !selected.deletedAt && canChangeMessage(selected.createdAt),
  )

  const menu = (
    <ThreadMenu
      compact={compact}
      searchOpen={searchOpen}
      muted={muted}
      pinned={thread.pinned}
      archived={thread.archived}
      isContact={thread.isContact}
      handle={thread.other.handle}
      onSearch={() => setSearchOpen((open) => !open)}
      onContact={() => void toggleContact()}
      onMute={() => void applyThread(() => muteThread(thread.id, muted ? null : MUTE_UNTIL_ON))}
      onPin={() => void applyThread(() => pinThread(thread.id, !thread.pinned))}
      onArchive={() => void applyThread(() => archiveThread(thread.id, !thread.archived))}
      onHide={() => {
        void hideThread(thread.id).then(() => {
          onHidden?.()
          navigate('/messages')
        })
      }}
    />
  )

  return (
    <section
      className={styles.thread}
      data-compact={compact ? 'true' : 'false'}
      aria-label={`Conversation with ${name}`}
    >
      {compact ? (
        <h2 className={styles.srOnly}>
          {thread.other.handle ? <Link to={`/profile/${thread.other.handle}`}>{name}</Link> : name}
        </h2>
      ) : (
        <header className={styles.head}>
          <Avatar
            name={name}
            identity={thread.other.handle ?? thread.other.id}
            src={thread.other.avatarUrl}
            size="small"
          />
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
          {menu}
        </header>
      )}

      <div className={styles.body}>
        {searchOpen ? (
          <label className={styles.search}>
            <span className={styles.srOnly}>Search this conversation</span>
            <input
              className={styles.searchInput}
              type="search"
              value={search}
              placeholder="Search this conversation"
              autoFocus
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        ) : null}

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
            <p className={styles.empty}>
              {hits
                ? 'Nothing in this conversation matches.'
                : loaded
                  ? 'No messages yet. Say hello.'
                  : 'Loading messages…'}
            </p>
          ) : (
            shown.map((message, index) => {
              const mine = message.senderUserId === mineId
              const active = selectedId === message.id
              const stamp = shouldShowClusterTime(message.createdAt, shown[index - 1]?.createdAt)
              return (
                <Fragment key={message.id}>
                  {stamp ? (
                    <time className={styles.stamp} dateTime={message.createdAt}>
                      {formatClusterTime(message.createdAt)}
                    </time>
                  ) : null}
                  <div
                    className={styles.row}
                    data-mine={mine ? 'true' : 'false'}
                    data-selected={active ? 'true' : 'false'}
                  >
                    {message.parent ? <p className={styles.quote}>{message.parent.body}</p> : null}
                    <p
                      className={styles.bubble}
                      data-deleted={message.deletedAt ? 'true' : 'false'}
                      role={message.deletedAt ? undefined : 'button'}
                      tabIndex={message.deletedAt ? undefined : 0}
                      aria-pressed={message.deletedAt ? undefined : active}
                      aria-label={message.deletedAt ? undefined : message.body}
                      onClick={() => {
                        if (message.deletedAt || thread.pendingIncomingRequestId) return
                        setSelectedId((current) => (current === message.id ? null : message.id))
                      }}
                      onKeyDown={(event) => {
                        if (message.deletedAt || thread.pendingIncomingRequestId) return
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedId((current) => (current === message.id ? null : message.id))
                        }
                      }}
                    >
                      {message.deletedAt ? 'Message removed' : message.body}
                    </p>
                    {message.editedAt && !message.deletedAt ? (
                      <span className={styles.edited}>Edited</span>
                    ) : null}
                    {message.reactions.length > 0 ? (
                      <p className={styles.reactionRow}>
                        {message.reactions.map((item) => (
                          <span key={item.emoji}>
                            {item.emoji} {item.count}
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </div>
                </Fragment>
              )
            })
          )}
          {seen ? <p className={styles.seen}>Seen</p> : null}
        </div>
      </div>

      {selected && !selected.deletedAt && !thread.pendingIncomingRequestId ? (
        <div className={styles.actions} role="toolbar" aria-label="Message actions">
          <button
            type="button"
            onClick={() => {
              setReplyTo(selected)
              setEditing(null)
              setSelectedId(null)
            }}
          >
            Reply
          </button>
          {REACTION_EMOJIS.map((emoji) => (
            <button key={emoji} type="button" onClick={() => void react(selected, emoji)}>
              {emoji}
            </button>
          ))}
          {selectedChangeable ? (
            <button
              type="button"
              onClick={() => {
                setEditing(selected)
                setReplyTo(null)
                setDraft(selected.body)
                setSelectedId(null)
              }}
            >
              Edit
            </button>
          ) : null}
          <button type="button" onClick={() => void remove(selected, 'me')}>
            Hide
          </button>
          {selectedChangeable ? (
            <button type="button" onClick={() => void remove(selected, 'everyone')}>
              Unsend
            </button>
          ) : null}
        </div>
      ) : null}

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
        {compact ? menu : null}
        <div className={styles.composeField}>
          <label className={styles.srOnly} htmlFor={`compose-${thread.id}`}>
            Message
          </label>
          <textarea
            id={`compose-${thread.id}`}
            className={styles.input}
            rows={1}
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
        </div>
        <button type="submit" className={styles.send} disabled={sending || !draft.trim()}>
          {editing ? 'Save' : 'Send'}
        </button>
      </form>
    </section>
  )
}
