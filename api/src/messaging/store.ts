/*
 * Private messaging storage.
 *
 * Tables live here with a `messaging_` prefix so they cannot be mistaken for
 * reflection `messages`. There is no foreign key to `users`: accounts may be
 * MariaDB. Groups are not in V1 — kind is `direct` only.
 *
 * SQLite is the live path. Memory exists so `createApp(new MemoryStore())`
 * still works. Authz tests run against SqliteStore.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  DECLINE_COOLDOWN_MS,
  MEMBER_ROLES,
  MESSAGE_PAGE_DEFAULT,
  PIN_LIMIT,
  REACTION_EMOJIS,
  REQUEST_STATUS,
  SEARCH_LIMIT,
  THREAD_KINDS,
  changeWindowOpen,
  directPairKey,
  truncateParentBody,
  type RequestStatus,
} from './limits.ts';

export type MessagingPerson = {
  id: string;
  handle: string | null;
  displayName: string;
  avatarUrl: string | null;
};

export type MessageParent = {
  id: string;
  senderUserId: string;
  body: string;
};

export type MessageReaction = {
  emoji: string;
  count: number;
  me: boolean;
};

export type PublicMessage = {
  id: string;
  threadId: string;
  senderUserId: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  parent: MessageParent | null;
  reactions: MessageReaction[];
};

export type MessageList = {
  items: PublicMessage[];
  olderCursor: string | null;
};

export type ThreadListView = 'chats' | 'archived';

export type PublicThread = {
  id: string;
  kind: 'direct';
  other: MessagingPerson;
  lastMessage: PublicMessage | null;
  unreadCount: number;
  pendingIncomingRequestId: string | null;
  /**
   * Whether the other person is in *this reader's* contacts.
   *
   * Sent with the thread rather than fetched beside it so the control that
   * adds or removes them cannot disagree with the thread it is drawn on.
   */
  isContact: boolean;
  otherLastReadMessageId: string | null;
  mutedUntil: string | null;
  archived: boolean;
  pinned: boolean;
  updatedAt: string;
};

export type PublicRequest = {
  id: string;
  threadId: string;
  sender: MessagingPerson;
  createdAt: string;
  preview: string;
};

export type PublicContact = {
  userId: string;
  person: MessagingPerson;
  createdAt: string;
};

export type MessagingPreferences = {
  allowNonContactRequests: boolean;
  allowSeenReceipts: boolean;
  updatedAt: string;
};

type StoredThread = {
  id: string;
  kind: 'direct';
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  directPairKey: string;
};

type StoredMember = {
  threadId: string;
  userId: string;
  role: string;
  joinedAt: string;
  lastReadMessageId: string | null;
  mutedUntil: string | null;
  archivedAt: string | null;
  pinnedAt: string | null;
  hiddenAt: string | null;
};

type StoredMessage = {
  id: string;
  threadId: string;
  senderUserId: string;
  body: string;
  createdAt: string;
  parentMessageId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
};

type StoredRequest = {
  id: string;
  senderUserId: string;
  recipientUserId: string;
  threadId: string;
  status: RequestStatus;
  createdAt: string;
  respondedAt: string | null;
};

type MemoryState = {
  threads: Map<string, StoredThread>;
  members: StoredMember[];
  messages: StoredMessage[];
  contacts: { userId: string; contactUserId: string; createdAt: string }[];
  requests: StoredRequest[];
  preferences: Map<string, MessagingPreferences>;
  hides: { userId: string; messageId: string; createdAt: string }[];
  reactions: { messageId: string; userId: string; emoji: string; createdAt: string }[];
};

export type PersonLookup = (userId: string) => MessagingPerson;

const FALLBACK_PERSON = (userId: string): MessagingPerson => ({
  id: userId,
  handle: null,
  displayName: 'Someone',
  avatarUrl: null,
});

export interface MessagingStore {
  openDirect(
    actorId: string,
    otherId: string,
    lookup: PersonLookup,
  ): PublicThread;
  listChats(actorId: string, lookup: PersonLookup, view?: ThreadListView): PublicThread[];
  getThread(actorId: string, threadId: string, lookup: PersonLookup): PublicThread | null;
  listMessages(
    actorId: string,
    threadId: string,
    opts?: { after?: string; before?: string; limit?: number },
  ): MessageList | null;
  sendMessage(
    actorId: string,
    threadId: string,
    body: string,
    parentMessageId?: string,
  ): PublicMessage | null | 'forbidden' | 'bad_parent';
  editMessage(
    actorId: string,
    threadId: string,
    messageId: string,
    body: string,
  ): PublicMessage | null | 'forbidden' | 'closed';
  deleteMessage(
    actorId: string,
    threadId: string,
    messageId: string,
    scope: 'me' | 'everyone',
  ): true | null | 'forbidden' | 'closed';
  setReaction(
    actorId: string,
    threadId: string,
    messageId: string,
    emoji: string | null,
  ): PublicMessage | null | 'forbidden' | 'bad_emoji';
  searchMessages(actorId: string, threadId: string, query: string): PublicMessage[] | null;
  setMuted(actorId: string, threadId: string, until: string | null, lookup: PersonLookup): PublicThread | null;
  setArchived(
    actorId: string,
    threadId: string,
    archived: boolean,
    lookup: PersonLookup,
  ): PublicThread | null;
  setPinned(
    actorId: string,
    threadId: string,
    pinned: boolean,
    lookup: PersonLookup,
  ): PublicThread | null | 'pin_limit';
  hideThread(actorId: string, threadId: string): boolean;
  markRead(actorId: string, threadId: string, messageId: string): boolean;
  /**
   * Is `b` in `a`'s contacts?
   *
   * **One direction, and the direction carries the meaning.** A contact list is
   * somebody's own address book: adding a person is a note to yourself, not an
   * agreement between two people, and it says nothing about whether they have
   * added you.
   *
   * A caller deciding a *permission* must therefore ask it the way round the
   * permission runs. "May this person write to me without asking first" is a
   * question about **my** list, never theirs — see `routes.ts`.
   */
  areContacts(a: string, b: string): boolean;
  /** Whether these two already have a direct thread, however it began. */
  hasDirectThread(a: string, b: string): boolean;
  listContacts(actorId: string, lookup: PersonLookup): PublicContact[];
  /** Put somebody in this person's own contacts. Theirs is untouched. */
  addContactFor(actorId: string, contactUserId: string): void;
  /** Take somebody out of this person's own contacts. Theirs is untouched. */
  removeContactFor(actorId: string, contactUserId: string): void;
  listIncomingRequests(actorId: string, lookup: PersonLookup): PublicRequest[];
  pendingBetween(a: string, b: string): StoredRequest | null;
  cooldownActive(senderId: string, recipientId: string): boolean;
  createPendingRequest(senderId: string, recipientId: string, threadId: string): StoredRequest;
  acceptRequest(actorId: string, requestId: string, lookup: PersonLookup): PublicThread | null;
  declineRequest(actorId: string, requestId: string): boolean;
  preferences(userId: string): MessagingPreferences;
  setAllowNonContactRequests(userId: string, allow: boolean): MessagingPreferences;
  setAllowSeenReceipts(userId: string, allow: boolean): MessagingPreferences;
  otherMemberId(threadId: string, actorId: string): string | null;
  isMember(threadId: string, userId: string): boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultPreferences(): MessagingPreferences {
  return { allowNonContactRequests: true, allowSeenReceipts: true, updatedAt: nowIso() };
}

function addColumn(db: DatabaseSync, table: string, column: string, type: string): void {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (existing.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function pageVisible(
  rows: StoredMessage[],
  opts: { after?: string; before?: string; limit: number },
): StoredMessage[] {
  if (opts.after) return after(rows, opts.after);
  const end = opts.before ? rows.findIndex((row) => row.id === opts.before) : rows.length;
  const head = end === -1 ? rows : rows.slice(0, end);
  return head.slice(-opts.limit);
}

function olderCursorFor(all: StoredMessage[], page: StoredMessage[]): string | null {
  const first = page[0];
  if (!first || !all[0] || first.id === all[0].id) return null;
  return first.id;
}

function summariseReactions(
  rows: { emoji: string; userId: string }[],
  actorId: string,
): MessageReaction[] {
  const counts = new Map<string, { count: number; me: boolean }>();
  for (const row of rows) {
    const current = counts.get(row.emoji) ?? { count: 0, me: false };
    current.count += 1;
    if (row.userId === actorId) current.me = true;
    counts.set(row.emoji, current);
  }
  return REACTION_EMOJIS.filter((emoji) => counts.has(emoji)).map((emoji) => ({
    emoji,
    count: counts.get(emoji)!.count,
    me: counts.get(emoji)!.me,
  }));
}

/**
 * Everything after the message the caller already has.
 *
 * By position in the thread, not by comparing values. `createdAt` is
 * millisecond resolution, so two messages sent in the same millisecond — which
 * is ordinary in a conversation and constant in a test — carried the same
 * timestamp, and the tie was broken by comparing random UUIDs. When the newer
 * message's id happened to sort lower, polling never returned it: not a
 * delayed message, a permanently missing one.
 *
 * The rows arrive in the order they were written, which is the order the
 * thread happened in, so "after" is simply "further along".
 */
function after(rows: StoredMessage[], afterId: string | undefined): StoredMessage[] {
  if (!afterId) return rows;
  const at = rows.findIndex((row) => row.id === afterId);
  /* An id from another thread, or one since deleted: send the thread. */
  return at === -1 ? rows : rows.slice(at + 1);
}

/* ------------------------------------------------------------------ sqlite */

class SqliteMessagingStore implements MessagingStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messaging_threads (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        createdByUserId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        directPairKey TEXT UNIQUE
      );
      CREATE TABLE IF NOT EXISTS messaging_thread_members (
        threadId TEXT NOT NULL,
        userId TEXT NOT NULL,
        role TEXT NOT NULL,
        joinedAt TEXT NOT NULL,
        lastReadMessageId TEXT,
        PRIMARY KEY (threadId, userId)
      );
      CREATE TABLE IF NOT EXISTS messaging_messages (
        id TEXT PRIMARY KEY,
        threadId TEXT NOT NULL,
        senderUserId TEXT NOT NULL,
        body TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messaging_messages_thread
        ON messaging_messages (threadId, createdAt, id);
      CREATE TABLE IF NOT EXISTS messaging_contacts (
        userId TEXT NOT NULL,
        contactUserId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        PRIMARY KEY (userId, contactUserId)
      );
      CREATE TABLE IF NOT EXISTS messaging_requests (
        id TEXT PRIMARY KEY,
        senderUserId TEXT NOT NULL,
        recipientUserId TEXT NOT NULL,
        threadId TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        respondedAt TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messaging_requests_recipient
        ON messaging_requests (recipientUserId, status);
      CREATE TABLE IF NOT EXISTS messaging_preferences (
        userId TEXT PRIMARY KEY,
        allowNonContactRequests INTEGER NOT NULL DEFAULT 1,
        updatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messaging_message_hides (
        userId TEXT NOT NULL,
        messageId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        PRIMARY KEY (userId, messageId)
      );
      CREATE TABLE IF NOT EXISTS messaging_reactions (
        messageId TEXT NOT NULL,
        userId TEXT NOT NULL,
        emoji TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        PRIMARY KEY (messageId, userId)
      );
    `);
    addColumn(this.db, 'messaging_messages', 'parentMessageId', 'TEXT');
    addColumn(this.db, 'messaging_messages', 'editedAt', 'TEXT');
    addColumn(this.db, 'messaging_messages', 'deletedAt', 'TEXT');
    addColumn(this.db, 'messaging_thread_members', 'mutedUntil', 'TEXT');
    addColumn(this.db, 'messaging_thread_members', 'archivedAt', 'TEXT');
    addColumn(this.db, 'messaging_thread_members', 'pinnedAt', 'TEXT');
    addColumn(this.db, 'messaging_thread_members', 'hiddenAt', 'TEXT');
    addColumn(this.db, 'messaging_preferences', 'allowSeenReceipts', 'INTEGER NOT NULL DEFAULT 1');
  }

  /*
   * Used to tell a new conversation from returning to one. Reopening a thread
   * that exists is navigation, and must not be counted against the daily
   * ceiling on reaching new people.
   */
  hasDirectThread(a: string, b: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM messaging_threads WHERE directPairKey = ?')
      .get(directPairKey(a, b));
    return row !== undefined;
  }

  openDirect(actorId: string, otherId: string, lookup: PersonLookup): PublicThread {
    const key = directPairKey(actorId, otherId);
    const existing = this.db
      .prepare('SELECT * FROM messaging_threads WHERE directPairKey = ?')
      .get(key) as Record<string, unknown> | undefined;
    if (existing) {
      this.revealFor(String(existing['id']), actorId);
      const thread = this.publicThread(actorId, String(existing['id']), lookup);
      if (thread) return thread;
    }
    const at = nowIso();
    const id = randomUUID();
    try {
      this.db.exec('BEGIN');
      this.db
        .prepare(
          `INSERT INTO messaging_threads (id, kind, createdByUserId, createdAt, updatedAt, directPairKey)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, THREAD_KINDS.DIRECT, actorId, at, at, key);
      this.db
        .prepare(
          `INSERT INTO messaging_thread_members (threadId, userId, role, joinedAt, lastReadMessageId)
           VALUES (?, ?, ?, ?, NULL)`,
        )
        .run(id, actorId, MEMBER_ROLES.MEMBER, at);
      this.db
        .prepare(
          `INSERT INTO messaging_thread_members (threadId, userId, role, joinedAt, lastReadMessageId)
           VALUES (?, ?, ?, ?, NULL)`,
        )
        .run(id, otherId, MEMBER_ROLES.MEMBER, at);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      const raced = this.db
        .prepare('SELECT id FROM messaging_threads WHERE directPairKey = ?')
        .get(key) as { id: string } | undefined;
      if (raced) {
        const thread = this.publicThread(actorId, raced.id, lookup);
        if (thread) return thread;
      }
      throw error;
    }
    return this.publicThread(actorId, id, lookup)!;
  }

  listChats(actorId: string, lookup: PersonLookup, view: ThreadListView = 'chats'): PublicThread[] {
    const rows = this.db
      .prepare(
        `SELECT t.id FROM messaging_threads t
          JOIN messaging_thread_members m ON m.threadId = t.id
         WHERE m.userId = ?
           AND m.hiddenAt IS NULL
           AND ${view === 'archived' ? 'm.archivedAt IS NOT NULL' : 'm.archivedAt IS NULL'}
         ORDER BY CASE WHEN m.pinnedAt IS NULL THEN 1 ELSE 0 END, t.updatedAt DESC`,
      )
      .all(actorId) as { id: string }[];
    const chats: PublicThread[] = [];
    for (const row of rows) {
      const thread = this.publicThread(actorId, row.id, lookup);
      if (!thread) continue;
      if (thread.pendingIncomingRequestId) continue;
      chats.push(thread);
    }
    return chats;
  }

  getThread(actorId: string, threadId: string, lookup: PersonLookup): PublicThread | null {
    return this.publicThread(actorId, threadId, lookup);
  }

  listMessages(
    actorId: string,
    threadId: string,
    opts: { after?: string; before?: string; limit?: number } = {},
  ): MessageList | null {
    if (!this.isMember(threadId, actorId)) return null;
    const rows = this.visibleRows(actorId, threadId);
    const limit = opts.limit ?? MESSAGE_PAGE_DEFAULT;
    const page = pageVisible(rows, { after: opts.after, before: opts.before, limit });
    return {
      items: page.map((row) => this.publicMessage(actorId, row)),
      olderCursor: opts.after ? null : olderCursorFor(rows, page),
    };
  }

  sendMessage(
    actorId: string,
    threadId: string,
    body: string,
    parentMessageId?: string,
  ): PublicMessage | null | 'forbidden' | 'bad_parent' {
    if (!this.isMember(threadId, actorId)) return null;
    const incoming = this.pendingIncoming(actorId, threadId);
    if (incoming) return 'forbidden';
    if (parentMessageId && !this.canQuote(actorId, threadId, parentMessageId)) return 'bad_parent';
    const at = nowIso();
    const message: StoredMessage = {
      id: randomUUID(),
      threadId,
      senderUserId: actorId,
      body,
      createdAt: at,
      parentMessageId: parentMessageId ?? null,
      editedAt: null,
      deletedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO messaging_messages
           (id, threadId, senderUserId, body, createdAt, parentMessageId, editedAt, deletedAt)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(message.id, threadId, actorId, body, at, message.parentMessageId);
    this.db.prepare('UPDATE messaging_threads SET updatedAt = ? WHERE id = ?').run(at, threadId);
    this.wakeOthers(threadId, actorId);
    return this.publicMessage(actorId, message);
  }

  markRead(actorId: string, threadId: string, messageId: string): boolean {
    if (!this.isMember(threadId, actorId)) return false;
    const row = this.db
      .prepare('SELECT id FROM messaging_messages WHERE id = ? AND threadId = ?')
      .get(messageId, threadId) as { id: string } | undefined;
    if (!row) return false;
    this.db
      .prepare(
        `UPDATE messaging_thread_members SET lastReadMessageId = ?
          WHERE threadId = ? AND userId = ?`,
      )
      .run(messageId, threadId, actorId);
    return true;
  }

  editMessage(
    actorId: string,
    threadId: string,
    messageId: string,
    body: string,
  ): PublicMessage | null | 'forbidden' | 'closed' {
    if (!this.isMember(threadId, actorId)) return null;
    if (this.pendingIncoming(actorId, threadId)) return 'forbidden';
    const row = this.storedMessage(threadId, messageId);
    if (!row || this.isHidden(actorId, messageId)) return null;
    if (row.senderUserId !== actorId || row.deletedAt) return 'forbidden';
    if (!changeWindowOpen(row.createdAt)) return 'closed';
    const at = nowIso();
    this.db
      .prepare('UPDATE messaging_messages SET body = ?, editedAt = ? WHERE id = ?')
      .run(body, at, messageId);
    return this.publicMessage(actorId, { ...row, body, editedAt: at });
  }

  deleteMessage(
    actorId: string,
    threadId: string,
    messageId: string,
    scope: 'me' | 'everyone',
  ): true | null | 'forbidden' | 'closed' {
    if (!this.isMember(threadId, actorId)) return null;
    if (this.pendingIncoming(actorId, threadId)) return 'forbidden';
    const row = this.storedMessage(threadId, messageId);
    if (!row || this.isHidden(actorId, messageId)) return null;
    if (scope === 'me') {
      this.db
        .prepare(
          `INSERT INTO messaging_message_hides (userId, messageId, createdAt)
           VALUES (?, ?, ?) ON CONFLICT(userId, messageId) DO NOTHING`,
        )
        .run(actorId, messageId, nowIso());
      return true;
    }
    if (row.senderUserId !== actorId || row.deletedAt) return 'forbidden';
    if (!changeWindowOpen(row.createdAt)) return 'closed';
    this.db
      .prepare('UPDATE messaging_messages SET body = ?, deletedAt = ? WHERE id = ?')
      .run('', nowIso(), messageId);
    return true;
  }

  setReaction(
    actorId: string,
    threadId: string,
    messageId: string,
    emoji: string | null,
  ): PublicMessage | null | 'forbidden' | 'bad_emoji' {
    if (!this.isMember(threadId, actorId)) return null;
    if (this.pendingIncoming(actorId, threadId)) return 'forbidden';
    if (emoji && !REACTION_EMOJIS.includes(emoji as (typeof REACTION_EMOJIS)[number])) {
      return 'bad_emoji';
    }
    const row = this.storedMessage(threadId, messageId);
    if (!row || this.isHidden(actorId, messageId) || row.deletedAt) return null;
    const existing = this.db
      .prepare('SELECT emoji FROM messaging_reactions WHERE messageId = ? AND userId = ?')
      .get(messageId, actorId) as { emoji: string } | undefined;
    if (!emoji || existing?.emoji === emoji) {
      this.db
        .prepare('DELETE FROM messaging_reactions WHERE messageId = ? AND userId = ?')
        .run(messageId, actorId);
    } else {
      this.db
        .prepare(
          `INSERT INTO messaging_reactions (messageId, userId, emoji, createdAt)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(messageId, userId) DO UPDATE SET emoji = excluded.emoji, createdAt = excluded.createdAt`,
        )
        .run(messageId, actorId, emoji, nowIso());
    }
    return this.publicMessage(actorId, row);
  }

  searchMessages(actorId: string, threadId: string, query: string): PublicMessage[] | null {
    if (!this.isMember(threadId, actorId)) return null;
    const needle = query.trim();
    if (needle.length < 2) return [];
    const rows = this.visibleRows(actorId, threadId)
      .filter((row) => !row.deletedAt && row.body.toLowerCase().includes(needle.toLowerCase()))
      .reverse()
      .slice(0, SEARCH_LIMIT);
    return rows.map((row) => this.publicMessage(actorId, row));
  }

  setMuted(
    actorId: string,
    threadId: string,
    until: string | null,
    lookup: PersonLookup,
  ): PublicThread | null {
    if (!this.isMember(threadId, actorId)) return null;
    this.db
      .prepare('UPDATE messaging_thread_members SET mutedUntil = ? WHERE threadId = ? AND userId = ?')
      .run(until, threadId, actorId);
    return this.publicThread(actorId, threadId, lookup);
  }

  setArchived(
    actorId: string,
    threadId: string,
    archived: boolean,
    lookup: PersonLookup,
  ): PublicThread | null {
    if (!this.isMember(threadId, actorId)) return null;
    this.db
      .prepare('UPDATE messaging_thread_members SET archivedAt = ? WHERE threadId = ? AND userId = ?')
      .run(archived ? nowIso() : null, threadId, actorId);
    return this.publicThread(actorId, threadId, lookup);
  }

  setPinned(
    actorId: string,
    threadId: string,
    pinned: boolean,
    lookup: PersonLookup,
  ): PublicThread | null | 'pin_limit' {
    if (!this.isMember(threadId, actorId)) return null;
    if (pinned && this.pinCount(actorId, threadId) >= PIN_LIMIT) return 'pin_limit';
    this.db
      .prepare('UPDATE messaging_thread_members SET pinnedAt = ? WHERE threadId = ? AND userId = ?')
      .run(pinned ? nowIso() : null, threadId, actorId);
    return this.publicThread(actorId, threadId, lookup);
  }

  hideThread(actorId: string, threadId: string): boolean {
    if (!this.isMember(threadId, actorId)) return false;
    this.db
      .prepare(
        'UPDATE messaging_thread_members SET hiddenAt = ?, archivedAt = NULL, pinnedAt = NULL WHERE threadId = ? AND userId = ?',
      )
      .run(nowIso(), threadId, actorId);
    return true;
  }

  areContacts(a: string, b: string): boolean {
    const row = this.db
      .prepare(
        'SELECT 1 AS present FROM messaging_contacts WHERE userId = ? AND contactUserId = ?',
      )
      .get(a, b) as { present?: number } | undefined;
    return row !== undefined;
  }

  listContacts(actorId: string, lookup: PersonLookup): PublicContact[] {
    const rows = this.db
      .prepare(
        `SELECT contactUserId, createdAt FROM messaging_contacts
          WHERE userId = ? ORDER BY createdAt DESC`,
      )
      .all(actorId) as { contactUserId: string; createdAt: string }[];
    return rows.map((row) => ({
      userId: row.contactUserId,
      person: lookup(row.contactUserId),
      createdAt: row.createdAt,
    }));
  }

  listIncomingRequests(actorId: string, lookup: PersonLookup): PublicRequest[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messaging_requests
          WHERE recipientUserId = ? AND status = ?
          ORDER BY createdAt DESC`,
      )
      .all(actorId, REQUEST_STATUS.PENDING) as Record<string, unknown>[];
    return rows.map((row) => {
      const request = requestFromRow(row);
      const last = this.lastMessage(request.threadId);
      return {
        id: request.id,
        threadId: request.threadId,
        sender: lookup(request.senderUserId),
        createdAt: request.createdAt,
        preview: last?.body ?? '',
      };
    });
  }

  pendingBetween(a: string, b: string): StoredRequest | null {
    const row = this.db
      .prepare(
        `SELECT * FROM messaging_requests
          WHERE status = ?
            AND ((senderUserId = ? AND recipientUserId = ?)
              OR (senderUserId = ? AND recipientUserId = ?))
          ORDER BY createdAt DESC LIMIT 1`,
      )
      .get(REQUEST_STATUS.PENDING, a, b, b, a) as Record<string, unknown> | undefined;
    return row ? requestFromRow(row) : null;
  }

  cooldownActive(senderId: string, recipientId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT respondedAt FROM messaging_requests
          WHERE senderUserId = ? AND recipientUserId = ? AND status = ?
          ORDER BY respondedAt DESC LIMIT 1`,
      )
      .get(senderId, recipientId, REQUEST_STATUS.DECLINED) as { respondedAt: string | null } | undefined;
    if (!row?.respondedAt) return false;
    return Date.now() - Date.parse(row.respondedAt) < DECLINE_COOLDOWN_MS;
  }

  createPendingRequest(senderId: string, recipientId: string, threadId: string): StoredRequest {
    const existing = this.pendingBetween(senderId, recipientId);
    if (existing) return existing;
    const stored: StoredRequest = {
      id: randomUUID(),
      senderUserId: senderId,
      recipientUserId: recipientId,
      threadId,
      status: REQUEST_STATUS.PENDING,
      createdAt: nowIso(),
      respondedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO messaging_requests
           (id, senderUserId, recipientUserId, threadId, status, createdAt, respondedAt)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        stored.id,
        stored.senderUserId,
        stored.recipientUserId,
        stored.threadId,
        stored.status,
        stored.createdAt,
      );
    return stored;
  }

  acceptRequest(actorId: string, requestId: string, lookup: PersonLookup): PublicThread | null {
    const row = this.db
      .prepare('SELECT * FROM messaging_requests WHERE id = ? AND recipientUserId = ? AND status = ?')
      .get(requestId, actorId, REQUEST_STATUS.PENDING) as Record<string, unknown> | undefined;
    if (!row) return null;
    const request = requestFromRow(row);
    const at = nowIso();
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `UPDATE messaging_requests SET status = ?, respondedAt = ? WHERE id = ?`,
        )
        .run(REQUEST_STATUS.ACCEPTED, at, request.id);
      /*
       * One row, not two: the sender joins the accepter's contacts, and the
       * accepter does not join the sender's.
       *
       * Both rows used to be written, which made a contact list an agreement
       * rather than an address book — and it meant answering one message
       * silently handed that person a place on your list that you never chose
       * to give them. What accepting says is "I will hear from you"; it does
       * not say anything about the other direction.
       */
      this.addContact(actorId, request.senderUserId, at);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.publicThread(actorId, request.threadId, lookup);
  }

  declineRequest(actorId: string, requestId: string): boolean {
    const row = this.db
      .prepare('SELECT id FROM messaging_requests WHERE id = ? AND recipientUserId = ? AND status = ?')
      .get(requestId, actorId, REQUEST_STATUS.PENDING) as { id: string } | undefined;
    if (!row) return false;
    this.db
      .prepare(`UPDATE messaging_requests SET status = ?, respondedAt = ? WHERE id = ?`)
      .run(REQUEST_STATUS.DECLINED, nowIso(), requestId);
    return true;
  }

  preferences(userId: string): MessagingPreferences {
    const row = this.db
      .prepare(
        'SELECT allowNonContactRequests, allowSeenReceipts, updatedAt FROM messaging_preferences WHERE userId = ?',
      )
      .get(userId) as
      | { allowNonContactRequests: number; allowSeenReceipts: number; updatedAt: string }
      | undefined;
    if (!row) return defaultPreferences();
    return {
      allowNonContactRequests: Number(row.allowNonContactRequests) === 1,
      allowSeenReceipts: Number(row.allowSeenReceipts) === 1,
      updatedAt: row.updatedAt,
    };
  }

  setAllowNonContactRequests(userId: string, allow: boolean): MessagingPreferences {
    return this.patchPreferences(userId, { allowNonContactRequests: allow });
  }

  setAllowSeenReceipts(userId: string, allow: boolean): MessagingPreferences {
    return this.patchPreferences(userId, { allowSeenReceipts: allow });
  }

  otherMemberId(threadId: string, actorId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT userId FROM messaging_thread_members WHERE threadId = ? AND userId <> ?`,
      )
      .get(threadId, actorId) as { userId: string } | undefined;
    return row?.userId ?? null;
  }

  isMember(threadId: string, userId: string): boolean {
    const row = this.db
      .prepare(
        'SELECT 1 AS present FROM messaging_thread_members WHERE threadId = ? AND userId = ?',
      )
      .get(threadId, userId) as { present?: number } | undefined;
    return row !== undefined;
  }

  addContactFor(actorId: string, contactUserId: string): void {
    this.addContact(actorId, contactUserId, nowIso());
  }

  removeContactFor(actorId: string, contactUserId: string): void {
    this.db
      .prepare('DELETE FROM messaging_contacts WHERE userId = ? AND contactUserId = ?')
      .run(actorId, contactUserId);
  }

  private addContact(userId: string, contactUserId: string, at: string): void {
    this.db
      .prepare(
        `INSERT INTO messaging_contacts (userId, contactUserId, createdAt)
         VALUES (?, ?, ?)
         ON CONFLICT(userId, contactUserId) DO NOTHING`,
      )
      .run(userId, contactUserId, at);
  }

  private lastMessage(threadId: string, actorId?: string): StoredMessage | null {
    const rows = actorId ? this.visibleRows(actorId, threadId) : this.threadRows(threadId);
    return rows.at(-1) ?? null;
  }

  private patchPreferences(
    userId: string,
    patch: { allowNonContactRequests?: boolean; allowSeenReceipts?: boolean },
  ): MessagingPreferences {
    const current = this.preferences(userId);
    const next: MessagingPreferences = {
      allowNonContactRequests: patch.allowNonContactRequests ?? current.allowNonContactRequests,
      allowSeenReceipts: patch.allowSeenReceipts ?? current.allowSeenReceipts,
      updatedAt: nowIso(),
    };
    this.db
      .prepare(
        `INSERT INTO messaging_preferences (userId, allowNonContactRequests, allowSeenReceipts, updatedAt)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(userId) DO UPDATE SET
           allowNonContactRequests = excluded.allowNonContactRequests,
           allowSeenReceipts = excluded.allowSeenReceipts,
           updatedAt = excluded.updatedAt`,
      )
      .run(userId, next.allowNonContactRequests ? 1 : 0, next.allowSeenReceipts ? 1 : 0, next.updatedAt);
    return next;
  }

  private pendingIncoming(actorId: string, threadId: string): StoredRequest | null {
    const row = this.db
      .prepare(
        `SELECT * FROM messaging_requests
          WHERE threadId = ? AND recipientUserId = ? AND status = ?`,
      )
      .get(threadId, actorId, REQUEST_STATUS.PENDING) as Record<string, unknown> | undefined;
    return row ? requestFromRow(row) : null;
  }

  private publicThread(actorId: string, threadId: string, lookup: PersonLookup): PublicThread | null {
    if (!this.isMember(threadId, actorId)) return null;
    const row = this.db
      .prepare('SELECT * FROM messaging_threads WHERE id = ?')
      .get(threadId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const otherId = this.otherMemberId(threadId, actorId);
    if (!otherId) return null;
    const last = this.lastMessage(threadId, actorId);
    const membership = this.db
      .prepare(
        `SELECT lastReadMessageId, mutedUntil, archivedAt, pinnedAt
           FROM messaging_thread_members WHERE threadId = ? AND userId = ?`,
      )
      .get(threadId, actorId) as {
      lastReadMessageId: string | null;
      mutedUntil: string | null;
      archivedAt: string | null;
      pinnedAt: string | null;
    };
    const unreadCount = this.unreadCount(threadId, actorId, membership.lastReadMessageId);
    const incoming = this.pendingIncoming(actorId, threadId);
    return {
      id: String(row['id']),
      kind: 'direct',
      other: lookup(otherId),
      lastMessage: last ? this.publicMessage(actorId, last) : null,
      unreadCount,
      pendingIncomingRequestId: incoming?.id ?? null,
      isContact: this.areContacts(actorId, otherId),
      otherLastReadMessageId: this.seenCursor(actorId, threadId, otherId),
      mutedUntil: membership.mutedUntil,
      archived: Boolean(membership.archivedAt),
      pinned: Boolean(membership.pinnedAt),
      updatedAt: String(row['updatedAt']),
    };
  }

  /*
   * How many of the other person's messages arrived after the one this reader
   * last saw — by write position, for the same reason listMessages is. Two
   * messages in one millisecond used to be ordered by comparing UUIDs, which
   * could leave a message uncounted and the thread looking read when it was
   * not.
   */
  private unreadCount(threadId: string, actorId: string, lastReadMessageId: string | null): number {
    const rows = this.visibleRows(actorId, threadId).filter(
      (row) => row.senderUserId !== actorId && !row.deletedAt,
    );
    if (!lastReadMessageId) return rows.length;
    const readAt = this.visibleRows(actorId, threadId).findIndex((row) => row.id === lastReadMessageId);
    if (readAt === -1) return rows.length;
    return this.visibleRows(actorId, threadId)
      .slice(readAt + 1)
      .filter((row) => row.senderUserId !== actorId && !row.deletedAt).length;
  }

  private visibleRows(actorId: string, threadId: string): StoredMessage[] {
    return this.threadRows(threadId).filter((row) => !this.isHidden(actorId, row.id));
  }

  private threadRows(threadId: string): StoredMessage[] {
    return (
      this.db
        .prepare(
          `SELECT id, threadId, senderUserId, body, createdAt, parentMessageId, editedAt, deletedAt
             FROM messaging_messages WHERE threadId = ? ORDER BY rowid ASC`,
        )
        .all(threadId) as Record<string, unknown>[]
    ).map(messageFromRow);
  }

  private storedMessage(threadId: string, messageId: string): StoredMessage | null {
    const row = this.db
      .prepare(
        `SELECT id, threadId, senderUserId, body, createdAt, parentMessageId, editedAt, deletedAt
           FROM messaging_messages WHERE id = ? AND threadId = ?`,
      )
      .get(messageId, threadId) as Record<string, unknown> | undefined;
    return row ? messageFromRow(row) : null;
  }

  private isHidden(actorId: string, messageId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS present FROM messaging_message_hides WHERE userId = ? AND messageId = ?')
      .get(actorId, messageId) as { present?: number } | undefined;
    return row !== undefined;
  }

  private canQuote(actorId: string, threadId: string, parentId: string): boolean {
    const parent = this.storedMessage(threadId, parentId);
    return Boolean(parent && !parent.deletedAt && !this.isHidden(actorId, parentId));
  }

  private revealFor(threadId: string, actorId: string): void {
    this.db
      .prepare('UPDATE messaging_thread_members SET hiddenAt = NULL WHERE threadId = ? AND userId = ?')
      .run(threadId, actorId);
  }

  private wakeOthers(threadId: string, actorId: string): void {
    this.db
      .prepare(
        `UPDATE messaging_thread_members
            SET archivedAt = NULL, hiddenAt = NULL
          WHERE threadId = ? AND userId <> ?`,
      )
      .run(threadId, actorId);
  }

  private pinCount(actorId: string, exceptThreadId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM messaging_thread_members
          WHERE userId = ? AND pinnedAt IS NOT NULL AND hiddenAt IS NULL AND threadId <> ?`,
      )
      .get(actorId, exceptThreadId) as { n: number } | undefined;
    return Number(row?.n ?? 0);
  }

  private seenCursor(actorId: string, threadId: string, otherId: string): string | null {
    if (!this.preferences(actorId).allowSeenReceipts) return null;
    if (!this.preferences(otherId).allowSeenReceipts) return null;
    const row = this.db
      .prepare(
        'SELECT lastReadMessageId FROM messaging_thread_members WHERE threadId = ? AND userId = ?',
      )
      .get(threadId, otherId) as { lastReadMessageId: string | null } | undefined;
    return row?.lastReadMessageId ?? null;
  }

  private publicMessage(actorId: string, row: StoredMessage): PublicMessage {
    const reactions = this.db
      .prepare('SELECT emoji, userId FROM messaging_reactions WHERE messageId = ?')
      .all(row.id) as { emoji: string; userId: string }[];
    let parent: MessageParent | null = null;
    if (row.parentMessageId) {
      const stored = this.storedMessage(row.threadId, row.parentMessageId);
      if (stored && !stored.deletedAt && !this.isHidden(actorId, stored.id)) {
        parent = {
          id: stored.id,
          senderUserId: stored.senderUserId,
          body: truncateParentBody(stored.body),
        };
      }
    }
    return {
      id: row.id,
      threadId: row.threadId,
      senderUserId: row.senderUserId,
      body: row.deletedAt ? '' : row.body,
      createdAt: row.createdAt,
      editedAt: row.editedAt,
      deletedAt: row.deletedAt,
      parent,
      reactions: summariseReactions(reactions, actorId),
    };
  }
}

function messageFromRow(row: Record<string, unknown>): StoredMessage {
  return {
    id: String(row['id']),
    threadId: String(row['threadId']),
    senderUserId: String(row['senderUserId']),
    body: String(row['body']),
    createdAt: String(row['createdAt']),
    parentMessageId: row['parentMessageId'] == null ? null : String(row['parentMessageId']),
    editedAt: row['editedAt'] == null ? null : String(row['editedAt']),
    deletedAt: row['deletedAt'] == null ? null : String(row['deletedAt']),
  };
}

function requestFromRow(row: Record<string, unknown>): StoredRequest {
  return {
    id: String(row['id']),
    senderUserId: String(row['senderUserId']),
    recipientUserId: String(row['recipientUserId']),
    threadId: String(row['threadId']),
    status: String(row['status']) as RequestStatus,
    createdAt: String(row['createdAt']),
    respondedAt: row['respondedAt'] == null ? null : String(row['respondedAt']),
  };
}

/* ------------------------------------------------------------------ memory */

const memoryByStore = new WeakMap<object, MemoryState>();

function emptyMember(threadId: string, userId: string, at: string): StoredMember {
  return {
    threadId,
    userId,
    role: MEMBER_ROLES.MEMBER,
    joinedAt: at,
    lastReadMessageId: null,
    mutedUntil: null,
    archivedAt: null,
    pinnedAt: null,
    hiddenAt: null,
  };
}

function memoryState(host: object): MemoryState {
  const existing = memoryByStore.get(host);
  if (existing) return existing;
  const created: MemoryState = {
    threads: new Map(),
    members: [],
    messages: [],
    contacts: [],
    requests: [],
    preferences: new Map(),
    hides: [],
    reactions: [],
  };
  memoryByStore.set(host, created);
  return created;
}

class MemoryMessagingStore implements MessagingStore {
  private readonly state: MemoryState;

  constructor(host: object) {
    this.state = memoryState(host);
  }

  openDirect(actorId: string, otherId: string, lookup: PersonLookup): PublicThread {
    const key = directPairKey(actorId, otherId);
    for (const thread of this.state.threads.values()) {
      if (thread.directPairKey === key) {
        this.revealFor(thread.id, actorId);
        return this.publicThread(actorId, thread.id, lookup)!;
      }
    }
    const at = nowIso();
    const id = randomUUID();
    this.state.threads.set(id, {
      id,
      kind: 'direct',
      createdByUserId: actorId,
      createdAt: at,
      updatedAt: at,
      directPairKey: key,
    });
    this.state.members.push(emptyMember(id, actorId, at), emptyMember(id, otherId, at));
    return this.publicThread(actorId, id, lookup)!;
  }

  listChats(actorId: string, lookup: PersonLookup, view: ThreadListView = 'chats'): PublicThread[] {
    return [...this.state.threads.values()]
      .filter((thread) => this.isMember(thread.id, actorId))
      .map((thread) => this.publicThread(actorId, thread.id, lookup))
      .filter((thread): thread is PublicThread => {
        if (!thread || thread.pendingIncomingRequestId) return false;
        const member = this.member(thread.id, actorId);
        if (!member || member.hiddenAt) return false;
        return view === 'archived' ? Boolean(member.archivedAt) : !member.archivedAt;
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return a.updatedAt < b.updatedAt ? 1 : -1;
      });
  }

  getThread(actorId: string, threadId: string, lookup: PersonLookup): PublicThread | null {
    return this.publicThread(actorId, threadId, lookup);
  }

  listMessages(
    actorId: string,
    threadId: string,
    opts: { after?: string; before?: string; limit?: number } = {},
  ): MessageList | null {
    if (!this.isMember(threadId, actorId)) return null;
    const rows = this.visibleRows(actorId, threadId);
    const limit = opts.limit ?? MESSAGE_PAGE_DEFAULT;
    const page = pageVisible(rows, { after: opts.after, before: opts.before, limit });
    return {
      items: page.map((row) => this.publicMessage(actorId, row)),
      olderCursor: opts.after ? null : olderCursorFor(rows, page),
    };
  }

  sendMessage(
    actorId: string,
    threadId: string,
    body: string,
    parentMessageId?: string,
  ): PublicMessage | null | 'forbidden' | 'bad_parent' {
    if (!this.isMember(threadId, actorId)) return null;
    if (this.pendingIncoming(actorId, threadId)) return 'forbidden';
    if (parentMessageId && !this.canQuote(actorId, threadId, parentMessageId)) return 'bad_parent';
    const message: StoredMessage = {
      id: randomUUID(),
      threadId,
      senderUserId: actorId,
      body,
      createdAt: nowIso(),
      parentMessageId: parentMessageId ?? null,
      editedAt: null,
      deletedAt: null,
    };
    this.state.messages.push(message);
    const thread = this.state.threads.get(threadId);
    if (thread) thread.updatedAt = message.createdAt;
    this.wakeOthers(threadId, actorId);
    return this.publicMessage(actorId, message);
  }

  editMessage(
    actorId: string,
    threadId: string,
    messageId: string,
    body: string,
  ): PublicMessage | null | 'forbidden' | 'closed' {
    if (!this.isMember(threadId, actorId)) return null;
    if (this.pendingIncoming(actorId, threadId)) return 'forbidden';
    const row = this.storedMessage(threadId, messageId);
    if (!row || this.isHidden(actorId, messageId)) return null;
    if (row.senderUserId !== actorId || row.deletedAt) return 'forbidden';
    if (!changeWindowOpen(row.createdAt)) return 'closed';
    row.editedAt = nowIso();
    row.body = body;
    return this.publicMessage(actorId, row);
  }

  deleteMessage(
    actorId: string,
    threadId: string,
    messageId: string,
    scope: 'me' | 'everyone',
  ): true | null | 'forbidden' | 'closed' {
    if (!this.isMember(threadId, actorId)) return null;
    if (this.pendingIncoming(actorId, threadId)) return 'forbidden';
    const row = this.storedMessage(threadId, messageId);
    if (!row || this.isHidden(actorId, messageId)) return null;
    if (scope === 'me') {
      if (!this.isHidden(actorId, messageId)) {
        this.state.hides.push({ userId: actorId, messageId, createdAt: nowIso() });
      }
      return true;
    }
    if (row.senderUserId !== actorId || row.deletedAt) return 'forbidden';
    if (!changeWindowOpen(row.createdAt)) return 'closed';
    row.body = '';
    row.deletedAt = nowIso();
    return true;
  }

  setReaction(
    actorId: string,
    threadId: string,
    messageId: string,
    emoji: string | null,
  ): PublicMessage | null | 'forbidden' | 'bad_emoji' {
    if (!this.isMember(threadId, actorId)) return null;
    if (this.pendingIncoming(actorId, threadId)) return 'forbidden';
    if (emoji && !REACTION_EMOJIS.includes(emoji as (typeof REACTION_EMOJIS)[number])) {
      return 'bad_emoji';
    }
    const row = this.storedMessage(threadId, messageId);
    if (!row || this.isHidden(actorId, messageId) || row.deletedAt) return null;
    const existing = this.state.reactions.find((item) => item.messageId === messageId && item.userId === actorId);
    if (!emoji || existing?.emoji === emoji) {
      this.state.reactions = this.state.reactions.filter(
        (item) => !(item.messageId === messageId && item.userId === actorId),
      );
    } else if (existing) {
      existing.emoji = emoji;
      existing.createdAt = nowIso();
    } else {
      this.state.reactions.push({ messageId, userId: actorId, emoji, createdAt: nowIso() });
    }
    return this.publicMessage(actorId, row);
  }

  searchMessages(actorId: string, threadId: string, query: string): PublicMessage[] | null {
    if (!this.isMember(threadId, actorId)) return null;
    const needle = query.trim();
    if (needle.length < 2) return [];
    return this.visibleRows(actorId, threadId)
      .filter((row) => !row.deletedAt && row.body.toLowerCase().includes(needle.toLowerCase()))
      .reverse()
      .slice(0, SEARCH_LIMIT)
      .map((row) => this.publicMessage(actorId, row));
  }

  setMuted(
    actorId: string,
    threadId: string,
    until: string | null,
    lookup: PersonLookup,
  ): PublicThread | null {
    const member = this.member(threadId, actorId);
    if (!member) return null;
    member.mutedUntil = until;
    return this.publicThread(actorId, threadId, lookup);
  }

  setArchived(
    actorId: string,
    threadId: string,
    archived: boolean,
    lookup: PersonLookup,
  ): PublicThread | null {
    const member = this.member(threadId, actorId);
    if (!member) return null;
    member.archivedAt = archived ? nowIso() : null;
    return this.publicThread(actorId, threadId, lookup);
  }

  setPinned(
    actorId: string,
    threadId: string,
    pinned: boolean,
    lookup: PersonLookup,
  ): PublicThread | null | 'pin_limit' {
    const member = this.member(threadId, actorId);
    if (!member) return null;
    if (pinned) {
      const count = this.state.members.filter(
        (row) => row.userId === actorId && row.pinnedAt && !row.hiddenAt && row.threadId !== threadId,
      ).length;
      if (count >= PIN_LIMIT) return 'pin_limit';
    }
    member.pinnedAt = pinned ? nowIso() : null;
    return this.publicThread(actorId, threadId, lookup);
  }

  hideThread(actorId: string, threadId: string): boolean {
    const member = this.member(threadId, actorId);
    if (!member) return false;
    member.hiddenAt = nowIso();
    member.archivedAt = null;
    member.pinnedAt = null;
    return true;
  }

  markRead(actorId: string, threadId: string, messageId: string): boolean {
    if (!this.isMember(threadId, actorId)) return false;
    if (!this.state.messages.some((row) => row.id === messageId && row.threadId === threadId)) {
      return false;
    }
    const member = this.state.members.find((row) => row.threadId === threadId && row.userId === actorId);
    if (!member) return false;
    member.lastReadMessageId = messageId;
    return true;
  }

  areContacts(a: string, b: string): boolean {
    return this.state.contacts.some((row) => row.userId === a && row.contactUserId === b);
  }

  hasDirectThread(a: string, b: string): boolean {
    const key = directPairKey(a, b);
    return [...this.state.threads.values()].some((thread) => thread.directPairKey === key);
  }

  listContacts(actorId: string, lookup: PersonLookup): PublicContact[] {
    return this.state.contacts
      .filter((row) => row.userId === actorId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((row) => ({
        userId: row.contactUserId,
        person: lookup(row.contactUserId),
        createdAt: row.createdAt,
      }));
  }

  listIncomingRequests(actorId: string, lookup: PersonLookup): PublicRequest[] {
    return this.state.requests
      .filter((row) => row.recipientUserId === actorId && row.status === REQUEST_STATUS.PENDING)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((request) => {
        const last = this.lastMessage(request.threadId);
        return {
          id: request.id,
          threadId: request.threadId,
          sender: lookup(request.senderUserId),
          createdAt: request.createdAt,
          preview: last?.body ?? '',
        };
      });
  }

  pendingBetween(a: string, b: string): StoredRequest | null {
    return (
      this.state.requests.find(
        (row) =>
          row.status === REQUEST_STATUS.PENDING &&
          ((row.senderUserId === a && row.recipientUserId === b) ||
            (row.senderUserId === b && row.recipientUserId === a)),
      ) ?? null
    );
  }

  cooldownActive(senderId: string, recipientId: string): boolean {
    const declined = this.state.requests
      .filter(
        (row) =>
          row.senderUserId === senderId &&
          row.recipientUserId === recipientId &&
          row.status === REQUEST_STATUS.DECLINED &&
          row.respondedAt,
      )
      .sort((a, b) => String(b.respondedAt).localeCompare(String(a.respondedAt)))[0];
    if (!declined?.respondedAt) return false;
    return Date.now() - Date.parse(declined.respondedAt) < DECLINE_COOLDOWN_MS;
  }

  createPendingRequest(senderId: string, recipientId: string, threadId: string): StoredRequest {
    const existing = this.pendingBetween(senderId, recipientId);
    if (existing) return existing;
    const stored: StoredRequest = {
      id: randomUUID(),
      senderUserId: senderId,
      recipientUserId: recipientId,
      threadId,
      status: REQUEST_STATUS.PENDING,
      createdAt: nowIso(),
      respondedAt: null,
    };
    this.state.requests.push(stored);
    return stored;
  }

  acceptRequest(actorId: string, requestId: string, lookup: PersonLookup): PublicThread | null {
    const request = this.state.requests.find(
      (row) => row.id === requestId && row.recipientUserId === actorId && row.status === REQUEST_STATUS.PENDING,
    );
    if (!request) return null;
    const at = nowIso();
    request.status = REQUEST_STATUS.ACCEPTED;
    request.respondedAt = at;
    /* The accepter's own list only. See the SQLite implementation's note. */
    this.addContact(actorId, request.senderUserId, at);
    return this.publicThread(actorId, request.threadId, lookup);
  }

  declineRequest(actorId: string, requestId: string): boolean {
    const request = this.state.requests.find(
      (row) => row.id === requestId && row.recipientUserId === actorId && row.status === REQUEST_STATUS.PENDING,
    );
    if (!request) return false;
    request.status = REQUEST_STATUS.DECLINED;
    request.respondedAt = nowIso();
    return true;
  }

  preferences(userId: string): MessagingPreferences {
    return this.state.preferences.get(userId) ?? defaultPreferences();
  }

  setAllowNonContactRequests(userId: string, allow: boolean): MessagingPreferences {
    const prefs = { ...this.preferences(userId), allowNonContactRequests: allow, updatedAt: nowIso() };
    this.state.preferences.set(userId, prefs);
    return prefs;
  }

  setAllowSeenReceipts(userId: string, allow: boolean): MessagingPreferences {
    const prefs = { ...this.preferences(userId), allowSeenReceipts: allow, updatedAt: nowIso() };
    this.state.preferences.set(userId, prefs);
    return prefs;
  }

  otherMemberId(threadId: string, actorId: string): string | null {
    return this.state.members.find((row) => row.threadId === threadId && row.userId !== actorId)?.userId ?? null;
  }

  isMember(threadId: string, userId: string): boolean {
    return this.state.members.some((row) => row.threadId === threadId && row.userId === userId);
  }

  addContactFor(actorId: string, contactUserId: string): void {
    this.addContact(actorId, contactUserId, nowIso());
  }

  removeContactFor(actorId: string, contactUserId: string): void {
    this.state.contacts = this.state.contacts.filter(
      (row) => !(row.userId === actorId && row.contactUserId === contactUserId),
    );
  }

  private addContact(userId: string, contactUserId: string, at: string): void {
    if (this.areContacts(userId, contactUserId)) return;
    this.state.contacts.push({ userId, contactUserId, createdAt: at });
  }

  private lastMessage(threadId: string, actorId?: string): StoredMessage | null {
    const rows = actorId ? this.visibleRows(actorId, threadId) : this.state.messages.filter((row) => row.threadId === threadId);
    return rows.at(-1) ?? null;
  }

  private member(threadId: string, userId: string): StoredMember | undefined {
    return this.state.members.find((row) => row.threadId === threadId && row.userId === userId);
  }

  private pendingIncoming(actorId: string, threadId: string): StoredRequest | null {
    return (
      this.state.requests.find(
        (row) =>
          row.threadId === threadId &&
          row.recipientUserId === actorId &&
          row.status === REQUEST_STATUS.PENDING,
      ) ?? null
    );
  }

  private publicThread(actorId: string, threadId: string, lookup: PersonLookup): PublicThread | null {
    if (!this.isMember(threadId, actorId)) return null;
    const thread = this.state.threads.get(threadId);
    if (!thread) return null;
    const otherId = this.otherMemberId(threadId, actorId);
    if (!otherId) return null;
    const last = this.lastMessage(threadId, actorId);
    const membership = this.member(threadId, actorId);
    const incoming = this.pendingIncoming(actorId, threadId);
    return {
      id: thread.id,
      kind: 'direct',
      other: lookup(otherId),
      lastMessage: last ? this.publicMessage(actorId, last) : null,
      unreadCount: this.unreadCount(threadId, actorId, membership?.lastReadMessageId ?? null),
      pendingIncomingRequestId: incoming?.id ?? null,
      isContact: this.areContacts(actorId, otherId),
      otherLastReadMessageId: this.seenCursor(actorId, threadId, otherId),
      mutedUntil: membership?.mutedUntil ?? null,
      archived: Boolean(membership?.archivedAt),
      pinned: Boolean(membership?.pinnedAt),
      updatedAt: thread.updatedAt,
    };
  }

  private unreadCount(threadId: string, actorId: string, lastReadMessageId: string | null): number {
    const rows = this.visibleRows(actorId, threadId);
    const unread = rows.filter((row) => row.senderUserId !== actorId && !row.deletedAt);
    if (!lastReadMessageId) return unread.length;
    const readAt = rows.findIndex((row) => row.id === lastReadMessageId);
    if (readAt === -1) return unread.length;
    return rows.slice(readAt + 1).filter((row) => row.senderUserId !== actorId && !row.deletedAt).length;
  }

  private visibleRows(actorId: string, threadId: string): StoredMessage[] {
    return this.state.messages.filter((row) => row.threadId === threadId && !this.isHidden(actorId, row.id));
  }

  private storedMessage(threadId: string, messageId: string): StoredMessage | undefined {
    return this.state.messages.find((row) => row.id === messageId && row.threadId === threadId);
  }

  private isHidden(actorId: string, messageId: string): boolean {
    return this.state.hides.some((row) => row.userId === actorId && row.messageId === messageId);
  }

  private canQuote(actorId: string, threadId: string, parentId: string): boolean {
    const parent = this.storedMessage(threadId, parentId);
    return Boolean(parent && !parent.deletedAt && !this.isHidden(actorId, parentId));
  }

  private revealFor(threadId: string, actorId: string): void {
    const member = this.member(threadId, actorId);
    if (member) member.hiddenAt = null;
  }

  private wakeOthers(threadId: string, actorId: string): void {
    for (const member of this.state.members) {
      if (member.threadId === threadId && member.userId !== actorId) {
        member.archivedAt = null;
        member.hiddenAt = null;
      }
    }
  }

  private seenCursor(actorId: string, threadId: string, otherId: string): string | null {
    if (!this.preferences(actorId).allowSeenReceipts) return null;
    if (!this.preferences(otherId).allowSeenReceipts) return null;
    return this.member(threadId, otherId)?.lastReadMessageId ?? null;
  }

  private publicMessage(actorId: string, row: StoredMessage): PublicMessage {
    const reactions = this.state.reactions.filter((item) => item.messageId === row.id);
    let parent: MessageParent | null = null;
    if (row.parentMessageId) {
      const stored = this.storedMessage(row.threadId, row.parentMessageId);
      if (stored && !stored.deletedAt && !this.isHidden(actorId, stored.id)) {
        parent = {
          id: stored.id,
          senderUserId: stored.senderUserId,
          body: truncateParentBody(stored.body),
        };
      }
    }
    return {
      id: row.id,
      threadId: row.threadId,
      senderUserId: row.senderUserId,
      body: row.deletedAt ? '' : row.body,
      createdAt: row.createdAt,
      editedAt: row.editedAt,
      deletedAt: row.deletedAt,
      parent,
      reactions: summariseReactions(reactions, actorId),
    };
  }
}

export function createMessagingStore(store: object): MessagingStore {
  const handle = (store as { db?: DatabaseSync }).db;
  if (handle && typeof handle.prepare === 'function') {
    return new SqliteMessagingStore(handle);
  }
  return new MemoryMessagingStore(store);
}

export function fallbackPerson(userId: string): MessagingPerson {
  return FALLBACK_PERSON(userId);
}
