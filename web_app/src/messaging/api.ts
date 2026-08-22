import { api } from '../shared/api/client.ts'

export type MessagingPerson = {
  id: string
  handle: string | null
  displayName: string
  avatarUrl: string | null
}

export type MessagingMessage = {
  id: string
  threadId: string
  senderUserId: string
  body: string
  createdAt: string
}

export type MessagingThread = {
  id: string
  kind: 'direct'
  other: MessagingPerson
  lastMessage: MessagingMessage | null
  unreadCount: number
  pendingIncomingRequestId: string | null
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
  updatedAt: string
}

export function listChats() {
  return api<{ items: MessagingThread[] }>('/messaging/threads')
}

export function getThread(threadId: string) {
  return api<MessagingThread>(`/messaging/threads/${threadId}`)
}

export function listMessages(threadId: string, after?: string) {
  const query = after ? `?after=${encodeURIComponent(after)}` : ''
  return api<{ items: MessagingMessage[] }>(`/messaging/threads/${threadId}/messages${query}`)
}

export function sendMessage(threadId: string, body: string) {
  return api<MessagingMessage>(`/messaging/threads/${threadId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

export function markRead(threadId: string, lastReadMessageId: string) {
  return api<{ ok: true }>(`/messaging/threads/${threadId}/read`, {
    method: 'POST',
    body: JSON.stringify({ lastReadMessageId }),
  })
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

export function personLabel(person: MessagingPerson) {
  return person.displayName || (person.handle ? `@${person.handle}` : 'Someone')
}
