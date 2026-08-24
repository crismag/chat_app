import { api } from '../shared/api/client.ts'

export type MessagingPerson = {
  id: string
  handle: string | null
  displayName: string
  avatarUrl: string | null
}

export const REACTION_EMOJIS = ['❤', '🙏', '👍', '✅'] as const

export type MessagingMessage = {
  id: string
  threadId: string
  senderUserId: string
  body: string
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
  parent: { id: string; senderUserId: string; body: string } | null
  reactions: { emoji: string; count: number; me: boolean }[]
}

export type MessagingThread = {
  id: string
  kind: 'direct'
  other: MessagingPerson
  lastMessage: MessagingMessage | null
  unreadCount: number
  pendingIncomingRequestId: string | null
  /** Whether the other person is in *my* contacts. Never whether I am in theirs. */
  isContact: boolean
  otherLastReadMessageId: string | null
  mutedUntil: string | null
  archived: boolean
  pinned: boolean
  updatedAt: string
}

export type MessagingRequest = {
  id: string
  threadId: string
  sender: MessagingPerson
  createdAt: string
  preview: string
}

export type MessagingContact = {
  userId: string
  person: MessagingPerson
  createdAt: string
}

export type MessagingPreferences = {
  allowNonContactRequests: boolean
  allowSeenReceipts: boolean
  updatedAt: string
}

export function listChats(view: 'chats' | 'archived' = 'chats') {
  const query = view === 'archived' ? '?view=archived' : ''
  return api<{ items: MessagingThread[] }>(`/messaging/threads${query}`)
}

export function getThread(threadId: string) {
  return api<MessagingThread>(`/messaging/threads/${threadId}`)
}

export function listMessages(threadId: string, opts?: { after?: string; before?: string; limit?: number }) {
  const params = new URLSearchParams()
  if (opts?.after) params.set('after', opts.after)
  if (opts?.before) params.set('before', opts.before)
  if (opts?.limit) params.set('limit', String(opts.limit))
  const query = params.size ? `?${params}` : ''
  return api<{ items: MessagingMessage[]; olderCursor: string | null }>(
    `/messaging/threads/${threadId}/messages${query}`,
  )
}

export function sendMessage(threadId: string, body: string, parentMessageId?: string) {
  return api<MessagingMessage>(`/messaging/threads/${threadId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body, parentMessageId }),
  })
}

export function editMessage(threadId: string, messageId: string, body: string) {
  return api<MessagingMessage>(`/messaging/threads/${threadId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
  })
}

export function deleteMessage(threadId: string, messageId: string, scope: 'me' | 'everyone') {
  return api<{ ok: true }>(`/messaging/threads/${threadId}/messages/${messageId}/delete`, {
    method: 'POST',
    body: JSON.stringify({ scope }),
  })
}

export function setReaction(threadId: string, messageId: string, emoji: string | null) {
  return api<MessagingMessage>(`/messaging/threads/${threadId}/messages/${messageId}/reaction`, {
    method: 'PUT',
    body: JSON.stringify({ emoji }),
  })
}

export function searchThread(threadId: string, query: string) {
  return api<{ items: MessagingMessage[] }>(
    `/messaging/threads/${threadId}/search?q=${encodeURIComponent(query)}`,
  )
}

export function muteThread(threadId: string, until: string | null) {
  return api<MessagingThread>(`/messaging/threads/${threadId}/mute`, {
    method: 'POST',
    body: JSON.stringify({ until }),
  })
}

export function archiveThread(threadId: string, archived: boolean) {
  return api<MessagingThread>(`/messaging/threads/${threadId}/archive`, {
    method: 'POST',
    body: JSON.stringify({ archived }),
  })
}

export function pinThread(threadId: string, pinned: boolean) {
  return api<MessagingThread>(`/messaging/threads/${threadId}/pin`, {
    method: 'POST',
    body: JSON.stringify({ pinned }),
  })
}

export function hideThread(threadId: string) {
  return api<{ ok: true }>(`/messaging/threads/${threadId}/hide`, { method: 'POST' })
}

export function markRead(threadId: string, lastReadMessageId: string) {
  return api<{ ok: true }>(`/messaging/threads/${threadId}/read`, {
    method: 'POST',
    body: JSON.stringify({ lastReadMessageId }),
  })
}

/**
 * People who can be written to, matching what was typed.
 *
 * The server decides who appears: never the person searching, nobody who has
 * blocked them, and nobody who is not taking requests from strangers. So this
 * is a list of conversations that can actually be started, not a directory
 * with dead entries in it.
 *
 * Below two characters the server answers with nothing, so a caller may send
 * every keystroke without deciding when a query has become a real one.
 */
export function findPeople(query: string, signal?: AbortSignal) {
  return api<{ items: MessagingPerson[] }>(
    `/messaging/people?q=${encodeURIComponent(query)}`,
    signal ? { signal } : {},
  );
}

export function openConversation(handle: string) {
  return api<{ thread: MessagingThread }>('/messaging/open', {
    method: 'POST',
    body: JSON.stringify({ handle }),
  })
}

export function listContacts() {
  return api<{ items: MessagingContact[] }>('/messaging/contacts')
}

export function listRequests() {
  return api<{ items: MessagingRequest[] }>('/messaging/requests')
}

export function acceptRequest(requestId: string) {
  return api<MessagingThread>(`/messaging/requests/${requestId}/accept`, { method: 'POST' })
}

export function declineRequest(requestId: string) {
  return api<{ ok: true }>(`/messaging/requests/${requestId}/decline`, { method: 'POST' })
}

export function blockRequest(requestId: string) {
  return api<{ ok: true }>(`/messaging/requests/${requestId}/block`, { method: 'POST' })
}

export function getPreferences() {
  return api<MessagingPreferences>('/messaging/preferences')
}

export function setAllowRequests(allowNonContactRequests: boolean) {
  return api<MessagingPreferences>('/messaging/preferences', {
    method: 'PATCH',
    body: JSON.stringify({ allowNonContactRequests }),
  })
}

export function setAllowSeenReceipts(allowSeenReceipts: boolean) {
  return api<MessagingPreferences>('/messaging/preferences', {
    method: 'PATCH',
    body: JSON.stringify({ allowSeenReceipts }),
  })
}

export const MUTE_UNTIL_ON = '9999-01-01T00:00:00.000Z'

export function isMuted(mutedUntil: string | null): boolean {
  return Boolean(mutedUntil && Date.parse(mutedUntil) > Date.now())
}

export function canChangeMessage(createdAt: string): boolean {
  return Date.now() - Date.parse(createdAt) <= 15 * 60 * 1000
}

export function personLabel(person: MessagingPerson) {
  return person.displayName || (person.handle ? `@${person.handle}` : 'Someone')
}

/*
 * Contacts, which are one person's own address book.
 *
 * Adding somebody needs nothing from them and tells them nothing: the list is
 * read to decide who may write to *you* without asking, so adding a person
 * widens what they may do and takes nothing away. See `api/src/messaging/
 * routes.ts` for why that makes it safe to do from a public profile.
 */
export function addContact(handle: string): Promise<{ isContact: boolean }> {
  return api<{ isContact: boolean }>('/messaging/contacts', {
    method: 'POST',
    body: JSON.stringify({ handle }),
  })
}

export function removeContact(handle: string): Promise<{ isContact: boolean }> {
  return api<{ isContact: boolean }>(`/messaging/contacts/${encodeURIComponent(handle)}`, {
    method: 'DELETE',
  })
}

/** Whether this person is in my contacts. Never whether I am in theirs. */
export function contactStatus(handle: string): Promise<{ isContact: boolean; isSelf: boolean }> {
  return api<{ isContact: boolean; isSelf: boolean }>(
    `/messaging/contacts/${encodeURIComponent(handle)}`,
  )
}
