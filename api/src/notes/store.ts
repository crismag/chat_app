/*
 * Notes storage.
 *
 * ── Why this owns its table ─────────────────────────────────────────────────
 *
 * Same reasoning as profile and community: the schema, the migration and the
 * queries live in this directory, so the feature is one folder to read and one
 * table to drop. Adding Notes does not mean editing a SQL migration another
 * piece of work is in the middle of.
 *
 * ── The rule this file exists to enforce ────────────────────────────────────
 *
 * **Ownership is in every SQL WHERE.** A note another person wrote is never
 * loaded into this process at all. Missing and not-yours are the same answer
 * (`null`) so a route cannot distinguish them by accident in a status code.
 *
 * There is no foreign key from `notes.userId` to `users`. Accounts may live in
 * MariaDB; a constraint pointing at a SQLite table that no longer holds the
 * people using this would fail the first write on behalf of a real account.
 *
 * ── Two implementations ─────────────────────────────────────────────────────
 *
 * SQLite is the real one. Memory exists so `createApp(new MemoryStore())` still
 * works — existing tests hand in Maps, and Notes must not 500 because it
 * assumed a database handle. The memory rows live in a WeakMap keyed by the
 * store object, so two `createNotesStore` calls over the same MemoryStore share
 * the same notes, and the rows go away with the store.
 *
 * Authorisation tests run against `SqliteStore(':memory:')`. An access check
 * that only passes in the lenient backing is the failure this repository has
 * already been burned by.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { NOTE_BODY_MAX, NOTE_TITLE_MAX, likePattern, type NoteView } from './limits.ts';

/* ------------------------------------------------------------------- types */

export type StoredNote = {
  id: string;
  userId: string;
  title: string;
  body: string;
  isPinned: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/**
 * A note as it is served. Everything the owner may see, and nothing that
 * identifies them to a third party — `userId` is the one field that must never
 * appear in JSON.
 */
export type PublicNote = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type NoteWrite = {
  title?: string;
  body?: string;
  pinned?: boolean;
  archived?: boolean;
};

export type NoteListQuery = {
  userId: string;
  view: NoteView;
  q?: string;
};

export interface NotesStore {
  create(userId: string, input: NoteWrite): PublicNote;
  get(userId: string, id: string): PublicNote | null;
  list(query: NoteListQuery): PublicNote[];
  update(userId: string, id: string, patch: NoteWrite): PublicNote | null;
  softDelete(userId: string, id: string): PublicNote | null;
  restore(userId: string, id: string): PublicNote | null;
}

export function publicNote(note: StoredNote): PublicNote {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    pinned: note.isPinned,
    archived: note.isArchived,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    deletedAt: note.deletedAt,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function sortNotes(a: StoredNote, b: StoredNote): number {
  if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
  return b.updatedAt.localeCompare(a.updatedAt);
}

function inView(note: StoredNote, view: NoteView): boolean {
  if (view === 'trash') return note.deletedAt !== null;
  if (note.deletedAt !== null) return false;
  return view === 'archived' ? note.isArchived : !note.isArchived;
}

function matchesQuery(note: StoredNote, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return note.title.toLowerCase().includes(needle) || note.body.toLowerCase().includes(needle);
}

function applyWrite(note: StoredNote, patch: NoteWrite, timestamp: string): StoredNote {
  return {
    ...note,
    title: patch.title !== undefined ? patch.title : note.title,
    body: patch.body !== undefined ? patch.body : note.body,
    isPinned: patch.pinned !== undefined ? patch.pinned : note.isPinned,
    isArchived: patch.archived !== undefined ? patch.archived : note.isArchived,
    updatedAt: timestamp,
  };
}

/**
 * Validate a create or patch body.
 *
 * Types and maximum lengths are refused, never coerced. Over-long text is not
 * clipped: a client that sent 201 characters of title is told so, rather than
 * discovering later that a character vanished.
 */
export function parseNoteWrite(
  body: unknown,
): { ok: true; value: NoteWrite } | { ok: false; error: string } {
  if (body === undefined || body === null) return { ok: true, value: {} };
  if (typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'A JSON object is required.' };
  }

  const input = body as Record<string, unknown>;
  const value: NoteWrite = {};

  if ('title' in input) {
    if (typeof input['title'] !== 'string') {
      return { ok: false, error: 'Title must be a string.' };
    }
    const title = input['title'];
    if (title.length > NOTE_TITLE_MAX) {
      return {
        ok: false,
        error: `Title is ${title.length - NOTE_TITLE_MAX} characters over its maximum of ${NOTE_TITLE_MAX}.`,
      };
    }
    value.title = title;
  }

  if ('body' in input) {
    if (typeof input['body'] !== 'string') {
      return { ok: false, error: 'Body must be a string.' };
    }
    const noteBody = input['body'];
    if (noteBody.length > NOTE_BODY_MAX) {
      return {
        ok: false,
        error: `Body is ${noteBody.length - NOTE_BODY_MAX} characters over its maximum of ${NOTE_BODY_MAX}.`,
      };
    }
    value.body = noteBody;
  }

  if ('pinned' in input) {
    if (typeof input['pinned'] !== 'boolean') {
      return { ok: false, error: 'Pinned must be true or false.' };
    }
    value.pinned = input['pinned'];
  }

  if ('archived' in input) {
    if (typeof input['archived'] !== 'boolean') {
      return { ok: false, error: 'Archived must be true or false.' };
    }
    value.archived = input['archived'];
  }

  return { ok: true, value };
}

/* ------------------------------------------------------------------ sqlite */

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      isPinned INTEGER NOT NULL DEFAULT 0,
      isArchived INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT,
      updatedAt TEXT,
      deletedAt TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_notes_owner_list
      ON notes (userId, deletedAt, isArchived, isPinned, updatedAt);
  `);
}

type Row = Record<string, unknown>;

function noteFromRow(row: Row): StoredNote {
  return {
    id: String(row['id']),
    userId: String(row['userId']),
    title: String(row['title'] ?? ''),
    body: String(row['body'] ?? ''),
    isPinned: Number(row['isPinned'] ?? 0) !== 0,
    isArchived: Number(row['isArchived'] ?? 0) !== 0,
    createdAt: String(row['createdAt'] ?? ''),
    updatedAt: String(row['updatedAt'] ?? ''),
    deletedAt: row['deletedAt'] == null || row['deletedAt'] === '' ? null : String(row['deletedAt']),
  };
}

const NOTE_COLUMNS = `id, userId, title, body, isPinned, isArchived, createdAt, updatedAt, deletedAt`;

class SqliteNotesStore implements NotesStore {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    migrate(db);
  }

  create(userId: string, input: NoteWrite): PublicNote {
    const timestamp = nowIso();
    const stored: StoredNote = {
      id: randomUUID(),
      userId,
      title: input.title ?? '',
      body: input.body ?? '',
      isPinned: input.pinned ?? false,
      isArchived: input.archived ?? false,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO notes
           (${NOTE_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        stored.id,
        stored.userId,
        stored.title,
        stored.body,
        stored.isPinned ? 1 : 0,
        stored.isArchived ? 1 : 0,
        stored.createdAt,
        stored.updatedAt,
        stored.deletedAt,
      );
    return publicNote(stored);
  }

  get(userId: string, id: string): PublicNote | null {
    const row = this.db
      .prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ? AND userId = ?`)
      .get(id, userId) as Row | undefined;
    return row ? publicNote(noteFromRow(row)) : null;
  }

  list(query: NoteListQuery): PublicNote[] {
    const q = query.q?.trim() ?? '';
    const params: (string | number)[] = [query.userId];
    let sql = `SELECT ${NOTE_COLUMNS} FROM notes WHERE userId = ?`;

    if (query.view === 'trash') {
      sql += ' AND deletedAt IS NOT NULL';
    } else {
      sql += ' AND deletedAt IS NULL AND isArchived = ?';
      params.push(query.view === 'archived' ? 1 : 0);
    }

    if (q) {
      sql += ' AND (title LIKE ? ESCAPE CHAR(92) OR body LIKE ? ESCAPE CHAR(92))';
      const pattern = likePattern(q);
      params.push(pattern, pattern);
    }

    sql += ' ORDER BY isPinned DESC, updatedAt DESC';

    const rows = this.db.prepare(sql).all(...params) as Row[];
    return rows.map((row) => publicNote(noteFromRow(row)));
  }

  update(userId: string, id: string, patch: NoteWrite): PublicNote | null {
    const existing = this.ownedRow(userId, id);
    if (!existing) return null;
    const next = applyWrite(existing, patch, nowIso());
    this.db
      .prepare(
        `UPDATE notes
            SET title = ?, body = ?, isPinned = ?, isArchived = ?, updatedAt = ?
          WHERE id = ? AND userId = ?`,
      )
      .run(
        next.title,
        next.body,
        next.isPinned ? 1 : 0,
        next.isArchived ? 1 : 0,
        next.updatedAt,
        id,
        userId,
      );
    return publicNote(next);
  }

  softDelete(userId: string, id: string): PublicNote | null {
    const existing = this.ownedRow(userId, id);
    if (!existing || existing.deletedAt) return null;
    const timestamp = nowIso();
    const next: StoredNote = {
      ...existing,
      isPinned: false,
      deletedAt: timestamp,
      updatedAt: timestamp,
    };
    this.db
      .prepare(
        `UPDATE notes
            SET isPinned = 0, deletedAt = ?, updatedAt = ?
          WHERE id = ? AND userId = ? AND deletedAt IS NULL`,
      )
      .run(timestamp, timestamp, id, userId);
    return publicNote(next);
  }

  restore(userId: string, id: string): PublicNote | null {
    const existing = this.ownedRow(userId, id);
    if (!existing || !existing.deletedAt) return null;
    const timestamp = nowIso();
    const next: StoredNote = {
      ...existing,
      deletedAt: null,
      updatedAt: timestamp,
    };
    this.db
      .prepare(
        `UPDATE notes
            SET deletedAt = NULL, updatedAt = ?
          WHERE id = ? AND userId = ? AND deletedAt IS NOT NULL`,
      )
      .run(timestamp, id, userId);
    return publicNote(next);
  }

  private ownedRow(userId: string, id: string): StoredNote | null {
    const row = this.db
      .prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ? AND userId = ?`)
      .get(id, userId) as Row | undefined;
    return row ? noteFromRow(row) : null;
  }
}

/* ------------------------------------------------------------------ memory */

const memoryNotes = new WeakMap<object, Map<string, StoredNote>>();

function notesFor(store: object): Map<string, StoredNote> {
  let notes = memoryNotes.get(store);
  if (!notes) {
    notes = new Map();
    memoryNotes.set(store, notes);
  }
  return notes;
}

class MemoryNotesStore implements NotesStore {
  private readonly notes: Map<string, StoredNote>;

  constructor(store: object) {
    this.notes = notesFor(store);
  }

  create(userId: string, input: NoteWrite): PublicNote {
    const timestamp = nowIso();
    const stored: StoredNote = {
      id: randomUUID(),
      userId,
      title: input.title ?? '',
      body: input.body ?? '',
      isPinned: input.pinned ?? false,
      isArchived: input.archived ?? false,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    this.notes.set(stored.id, stored);
    return publicNote(stored);
  }

  get(userId: string, id: string): PublicNote | null {
    const note = this.notes.get(id);
    if (!note || note.userId !== userId) return null;
    return publicNote(note);
  }

  list(query: NoteListQuery): PublicNote[] {
    const q = query.q?.trim() ?? '';
    return [...this.notes.values()]
      .filter((note) => note.userId === query.userId && inView(note, query.view) && matchesQuery(note, q))
      .sort(sortNotes)
      .map(publicNote);
  }

  update(userId: string, id: string, patch: NoteWrite): PublicNote | null {
    const existing = this.owned(userId, id);
    if (!existing) return null;
    const next = applyWrite(existing, patch, nowIso());
    this.notes.set(id, next);
    return publicNote(next);
  }

  softDelete(userId: string, id: string): PublicNote | null {
    const existing = this.owned(userId, id);
    if (!existing || existing.deletedAt) return null;
    const timestamp = nowIso();
    const next: StoredNote = {
      ...existing,
      isPinned: false,
      deletedAt: timestamp,
      updatedAt: timestamp,
    };
    this.notes.set(id, next);
    return publicNote(next);
  }

  restore(userId: string, id: string): PublicNote | null {
    const existing = this.owned(userId, id);
    if (!existing || !existing.deletedAt) return null;
    const timestamp = nowIso();
    const next: StoredNote = { ...existing, deletedAt: null, updatedAt: timestamp };
    this.notes.set(id, next);
    return publicNote(next);
  }

  private owned(userId: string, id: string): StoredNote | null {
    const note = this.notes.get(id);
    if (!note || note.userId !== userId) return null;
    return note;
  }
}

/** SQLite when the store has a database handle; memory otherwise. */
export function createNotesStore(store: unknown): NotesStore {
  const handle = (store as { db?: DatabaseSync }).db;
  if (handle && typeof handle.prepare === 'function') {
    return new SqliteNotesStore(handle);
  }
  return new MemoryNotesStore(store as object);
}
