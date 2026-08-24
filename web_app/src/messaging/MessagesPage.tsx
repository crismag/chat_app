/*
 * Messages — Messenger-like inbox: Chats, Requests, Contacts.
 * Two-pane on desktop, stacked list-then-thread on a phone.
 */

import { useCallback, useEffect, useId, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { isGuest } from '@chat/shared'
import { ApiError } from '../shared/api/client.ts'
import { Recoverable } from '../shared/ui/Recoverable.tsx'
import { Avatar } from '../shared/ui/Avatar.tsx'
import { NARROW_QUERY, useMediaQuery } from '../shared/ui/useMediaQuery.ts'
import { useMobileBar } from '../shared/mobile/MobileBar.tsx'
import { useAuth } from '../auth/useAuth.ts'
import { ThreadView } from './ThreadView.tsx'
import {
  acceptRequest,
  blockRequest,
  declineRequest,
  findPeople,
  getPreferences,
  getThread,
  isMuted,
  listChats,
  listContacts,
  listRequests,
  openConversation,
  personLabel,
  setAllowRequests,
  setAllowSeenReceipts,
  type MessagingContact,
  type MessagingPerson,
  type MessagingRequest,
  type MessagingThread,
} from './api.ts'
import styles from './MessagesPage.module.css'

const TABS = [
  { id: 'chats', label: 'Chats' },
  { id: 'requests', label: 'Requests' },
  { id: 'contacts', label: 'Contacts' },
] as const

type Tab = (typeof TABS)[number]['id']

export function MessagesPage() {
  const { threadId } = useParams()
  const navigate = useNavigate()
  const narrow = useMediaQuery(NARROW_QUERY)
  const { user } = useAuth()
  const registered = Boolean(user && !isGuest(user))

  const [tab, setTab] = useState<Tab>('chats')
  const [chats, setChats] = useState<MessagingThread[]>([])
  const [requests, setRequests] = useState<MessagingRequest[]>([])
  const [contacts, setContacts] = useState<MessagingContact[]>([])
  const [thread, setThread] = useState<MessagingThread | null>(null)
  const [allowRequests, setAllow] = useState(true)
  const [allowSeen, setAllowSeen] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useMobileBar(() => ({ title: 'Messages' }), [])

  const loadLists = useCallback(async () => {
    if (!registered) {
      setLoading(false)
      return
    }
    setError(null)
    try {
      const [chatList, requestList, contactList, prefs] = await Promise.all([
        listChats(showArchived ? 'archived' : 'chats'),
        listRequests(),
        listContacts(),
        getPreferences(),
      ])
      setChats(chatList.items)
      setRequests(requestList.items)
      setContacts(contactList.items)
      setAllow(prefs.allowNonContactRequests)
      setAllowSeen(prefs.allowSeenReceipts)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Messages could not be loaded just now.')
    } finally {
      setLoading(false)
    }
  }, [registered, showArchived])

  useEffect(() => {
    void loadLists()
  }, [loadLists])

  useEffect(() => {
    if (!threadId || !registered) {
      setThread(null)
      return
    }
    void getThread(threadId)
      .then(setThread)
      .catch((caught: unknown) => {
        setThread(null)
        setError(caught instanceof ApiError ? caught.message : 'That conversation could not be opened.')
      })
  }, [threadId, registered])

  async function startWith(handle: string) {
    setError(null)
    try {
      const opened = await openConversation(handle)
      navigate(`/messages/${opened.thread.id}`)
      void loadLists()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not start that conversation.')
    }
  }

  const showList = !narrow || !threadId
  const showThreadPane = !narrow || Boolean(threadId)

  return (
    <section className={styles.page} data-narrow={narrow ? 'true' : 'false'} data-open={threadId ? 'true' : 'false'}>
      {narrow && threadId ? null : (
        <header className={styles.header}>
          <h1 className={styles.title}>Messages</h1>
          <p className={styles.description}>Private text with people you know. Not a reflection, and not shared.</p>
          {/*
            Somewhere to start.
            Messaging arrived with one way in — the Message button on somebody
            else's profile — and nothing in the application links to another
            person's profile. In practice a first conversation meant typing a
            handle into the address bar, which is not a way in at all.
          */}
          {registered ? <FindSomeone onPick={(handle) => void startWith(handle)} /> : null}
        </header>
      )}

      {!registered ? (
        <div className={styles.empty}>
          <h2 className={styles.emptyHeading}>Sign in to use Messages</h2>
          <p className={styles.emptyBody}>
            Messaging is for registered accounts, so a conversation stays with the person who started it.
          </p>
        </div>
      ) : (
        <div className={styles.layout}>
          {showList ? (
            <div className={styles.pane}>
              <div className={styles.tabs} role="tablist" aria-label="Message views">
                {TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.id}
                    className={styles.tab}
                    data-active={tab === item.id ? 'true' : 'false'}
                    onClick={() => setTab(item.id)}
                  >
                    {item.label}
                    {item.id === 'requests' && requests.length > 0 ? (
                      <span className={styles.count}>{requests.length}</span>
                    ) : null}
                  </button>
                ))}
              </div>

              {error ? (
                <Recoverable message={error} onRetry={() => void loadLists()} onDismiss={() => setError(null)} />
              ) : null}

              {loading ? (
                <p className={styles.muted} role="status">
                  Loading messages…
                </p>
              ) : tab === 'chats' ? (
                <>
                  <div className={styles.inboxBar}>
                    <button
                      type="button"
                      className={styles.inboxToggle}
                      data-active={!showArchived ? 'true' : 'false'}
                      onClick={() => setShowArchived(false)}
                    >
                      Inbox
                    </button>
                    <button
                      type="button"
                      className={styles.inboxToggle}
                      data-active={showArchived ? 'true' : 'false'}
                      onClick={() => setShowArchived(true)}
                    >
                      Archived
                    </button>
                  </div>
                {chats.length === 0 ? (
                  <div className={styles.empty}>
                    <h2 className={styles.emptyHeading}>
                      {showArchived ? 'Nothing archived' : 'No conversations yet'}
                    </h2>
                    <p className={styles.emptyBody}>
                      {showArchived
                        ? 'Conversations you archive wait here until someone writes again.'
                        : 'Find somebody above, or message them from their profile. Their reply appears here once they accept.'}
                    </p>
                  </div>
                ) : (
                  <ul className={styles.list}>
                    {chats.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={styles.row}
                          data-active={threadId === item.id ? 'true' : 'false'}
                          onClick={() => navigate(`/messages/${item.id}`)}
                        >
                          <Avatar
                            name={personLabel(item.other)}
                            identity={item.other.handle ?? item.other.id}
                            src={item.other.avatarUrl}
                            size="small"
                          />
                          <span className={styles.rowText}>
                            <span className={styles.rowName}>
                              {item.pinned ? 'Pinned · ' : ''}
                              {isMuted(item.mutedUntil) ? 'Muted · ' : ''}
                              {personLabel(item.other)}
                            </span>
                            <span className={styles.preview}>
                              {item.lastMessage?.deletedAt
                                ? 'Message removed'
                                : item.lastMessage?.body ?? 'No messages yet'}
                            </span>
                          </span>
                          {item.unreadCount > 0 ? <span className={styles.unread}>{item.unreadCount}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                </>
              ) : tab === 'requests' ? (
                requests.length === 0 ? (
                  <div className={styles.empty}>
                    <h2 className={styles.emptyHeading}>No message requests</h2>
                    <p className={styles.emptyBody}>When someone who is not a contact writes to you, it waits here.</p>
                  </div>
                ) : (
                  <ul className={styles.list}>
                    {requests.map((item) => (
                      <li key={item.id} className={styles.request}>
                        <button type="button" className={styles.row} onClick={() => navigate(`/messages/${item.threadId}`)}>
                          <Avatar
                            name={personLabel(item.sender)}
                            identity={item.sender.handle ?? item.sender.id}
                            src={item.sender.avatarUrl}
                            size="small"
                          />
                          <span className={styles.rowText}>
                            <span className={styles.rowName}>{personLabel(item.sender)}</span>
                            <span className={styles.preview}>{item.preview || 'Wants to message you'}</span>
                          </span>
                        </button>
                        <div className={styles.requestActions}>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() =>
                              void acceptRequest(item.id).then((accepted) => {
                                navigate(`/messages/${accepted.id}`)
                                void loadLists()
                              })
                            }
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => void declineRequest(item.id).then(() => void loadLists())}
                          >
                            Decline
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => void blockRequest(item.id).then(() => void loadLists())}
                          >
                            Block
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <>
                  <label className={styles.pref}>
                    <input
                      type="checkbox"
                      checked={allowRequests}
                      onChange={(event) => {
                        const next = event.target.checked
                        setAllow(next)
                        void setAllowRequests(next)
                      }}
                    />
                    Allow message requests from people who are not contacts
                  </label>
                  <label className={styles.pref}>
                    <input
                      type="checkbox"
                      checked={allowSeen}
                      onChange={(event) => {
                        const next = event.target.checked
                        setAllowSeen(next)
                        void setAllowSeenReceipts(next)
                      }}
                    />
                    Send and receive seen receipts
                  </label>
                  {contacts.length === 0 ? (
                    <div className={styles.empty}>
                      <h2 className={styles.emptyHeading}>No contacts yet</h2>
                      <p className={styles.emptyBody}>Accept a request, or find somebody to write to.</p>
                    </div>
                  ) : (
                    <ul className={styles.list}>
                      {contacts.map((item) => (
                        <li key={item.userId}>
                          <button
                            type="button"
                            className={styles.row}
                            onClick={() => {
                              if (item.person.handle) void startWith(item.person.handle)
                            }}
                          >
                            <Avatar
                              name={personLabel(item.person)}
                              identity={item.person.handle ?? item.person.id}
                              src={item.person.avatarUrl}
                              size="small"
                            />
                            <span className={styles.rowName}>{personLabel(item.person)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          ) : null}

          {showThreadPane && thread ? (
            <ThreadView
              thread={thread}
              mineId={user?.id ?? null}
              onBack={narrow ? () => navigate('/messages') : undefined}
              onUpdated={(next) => {
                setThread(next)
                void loadLists()
              }}
              onHidden={() => {
                setThread(null)
                void loadLists()
              }}
            />
          ) : showThreadPane && !threadId ? (
            <p className={styles.placeholder}>Select a conversation</p>
          ) : null}
        </div>
      )}
    </section>
  )
}

/**
 * Finding somebody to write to.
 *
 * The server decides who may appear — never you, nobody who has blocked you,
 * nobody who is not taking requests from strangers — so every result here is a
 * conversation that can actually be started rather than a door that will not
 * open.
 *
 * Below two characters the server answers with nothing, so there is no rule
 * here about when a query becomes real; there is one place that decides it and
 * this is not it.
 */
function FindSomeone({ onPick }: { onPick: (handle: string) => void }) {
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<MessagingPerson[]>([])
  const [searching, setSearching] = useState(false)
  const listId = useId()

  useEffect(() => {
    const wanted = query.trim()
    if (!wanted) {
      setPeople([])
      setSearching(false)
      return
    }

    /*
     * Debounced, and the request in flight is abandoned when the next
     * keystroke arrives. Without the abort, answers can land out of order and
     * a slow early request overwrites the results for what is now in the box.
     */
    const controller = new AbortController()
    setSearching(true)
    const timer = setTimeout(() => {
      findPeople(wanted, controller.signal)
        .then((answer) => setPeople(answer.items))
        .catch(() => {
          /* Including the abort. A superseded search has no result to report. */
        })
        .finally(() => setSearching(false))
    }, 250)

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [query])

  const tooShort = query.trim().length === 1

  return (
    <div className={styles.find}>
      <label className={styles.findLabel} htmlFor={`${listId}-find`}>
        Start a conversation
      </label>
      <input
        id={`${listId}-find`}
        className="input"
        type="search"
        value={query}
        placeholder="Search by name or @handle"
        autoComplete="off"
        aria-describedby={`${listId}-hint`}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p className={styles.findHint} id={`${listId}-hint`} role="status">
        {tooShort
          ? 'Keep typing — two letters or more.'
          : searching
            ? 'Looking…'
            : query.trim() && people.length === 0
              ? 'Nobody by that name is taking messages.'
              : ''}
      </p>

      {people.length > 0 ? (
        <ul className={styles.findResults}>
          {people.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                className={styles.findResult}
                onClick={() => {
                  setQuery('')
                  setPeople([])
                  if (person.handle) onPick(person.handle)
                }}
              >
                <Avatar
                  name={person.displayName}
                  identity={person.handle ?? person.id}
                  src={person.avatarUrl}
                  size="small"
                />
                <span className={styles.findWho}>
                  <span className={styles.findName}>{person.displayName}</span>
                  {person.handle ? (
                    <span className={styles.findHandle}>@{person.handle}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
