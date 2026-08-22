/*
 * What Notes asks the server for, and the shapes it gets back.
 *
 * These types mirror the JSON the API serves. There is no `userId` here,
 * because there is none in the payload — ownership was decided in the query
 * that produced the row, and a client-side filter would be a second, weaker
 * copy of a rule that is already enforced where it counts.
 */

import { api } from '../shared/api/client.ts'

export type NoteView = 'active' | 'archived' | 'trash'

export type Note = {
  id: string
  title: string
  body: string
  pinned: boolean
  archived: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type NotesList = {
  items: Note[]
  view: NoteView
}

export type NoteWrite = {
  title?: string
  body?: string
  pinned?: boolean
  archived?: boolean
}

export function listNotes(view: NoteView = 'active', q = ''): Promise<NotesList> {
  const params = new URLSearchParams()
  if (view !== 'active') params.set('view', view)
  if (q) params.set('q', q)
  const query = params.toString()
  return api<NotesList>(`/notes${query ? `?${query}` : ''}`)
}

export function createNote(input: NoteWrite = {}): Promise<Note> {
  return api<Note>('/notes', { method: 'POST', body: JSON.stringify(input) })
}

export function getNote(id: string): Promise<Note> {
  return api<Note>(`/notes/${id}`)
}

export function updateNote(id: string, patch: NoteWrite): Promise<Note> {
  return api<Note>(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export function deleteNote(id: string): Promise<Note> {
  return api<Note>(`/notes/${id}`, { method: 'DELETE' })
}

export function restoreNote(id: string): Promise<Note> {
  return api<Note>(`/notes/${id}/restore`, { method: 'POST' })
}
