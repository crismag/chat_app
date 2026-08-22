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
  REQUEST_STATUS,
  THREAD_KINDS,
  directPairKey,
  type RequestStatus,
} from './limits.ts';

export type MessagingPerson = {
  id: string;
  handle: string | null;
  displayName: string;
  avatarUrl: string | null;
};

export type PublicMessage = {
  id: string;
  threadId: string;
  senderUserId: string;
  body: string;
  createdAt: string;
};

export type PublicThread = {
  id: string;
  kind: 'direct';
  other: MessagingPerson;
  lastMessage: PublicMessage | null;
  unreadCount: number;
  pendingIncomingRequestId: string | null;
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
};

type StoredMessage = PublicMessage;

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
  listChats(actorId: string, lookup: PersonLookup): PublicThread[];
  getThread(actorId: string, threadId: string, lookup: PersonLookup): PublicThread | null;
  listMessages(actorId: string, threadId: string, afterId?: string): PublicMessage[] | null;
  sendMessage(actorId: string, threadId: string, body: string): PublicMessage | null | 'forbidden';
  markRead(actorId: string, threadId: string, messageId: string): boolean;
  areContacts(a: string, b: string): boolean;
  listContacts(actorId: string, lookup: PersonLookup): PublicContact[];
  listIncomingRequests(actorId: string, lookup: PersonLookup): PublicRequest[];
  pendingBetween(a: string, b: string): StoredRequest | null;
  cooldownActive(senderId: string, recipientId: string): boolean;
  createPendingRequest(senderId: string, recipientId: string, threadId: string): StoredRequest;
  acceptRequest(actorId: string, requestId: string, lookup: PersonLookup): PublicThread | null;
  declineRequest(actorId: string, requestId: string): boolean;
  preferences(userId: string): MessagingPreferences;
  setAllowNonContactRequests(userId: string, allow: boolean): MessagingPreferences;
  otherMemberId(threadId: string, actorId: string): string | null;
  isMember(threadId: string, userId: string): boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultPreferences(): MessagingPreferences {
  return { allowNonContactRequests: true, updatedAt: nowIso() };
}

function messageAfter(cursor: StoredMessage, candidate: StoredMessage): boolean {
  if (candidate.createdAt !== cursor.createdAt) return candidate.createdAt > cursor.createdAt;
  return candidate.id > cursor.id;
}

function sortMessages(a: StoredMessage, b: StoredMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
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
    `);
  }

  openDirect(actorId: string, otherId: string, lookup: PersonLookup): PublicThread {
    const key = directPairKey(actorId, otherId);
    const existing = this.db
      .prepare('SELECT * FROM messaging_threads WHERE directPairKey = ?')
      .get(key) as Record<string, unknown> | undefined;
    if (existing) {
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

  listChats(actorId: string, lookup: PersonLookup): PublicThread[] {
    const rows = this.db
      .prepare(
        `SELECT t.id FROM messaging_threads t
          JOIN messaging_thread_members m ON m.threadId = t.id
         WHERE m.userId = ?
         ORDER BY t.updatedAt DESC`,
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

  listMessages(actorId: string, threadId: string, afterId?: string): PublicMessage[] | null {
    if (!this.isMember(threadId, actorId)) return null;
    const rows = this.db
      .prepare(
        `SELECT id, threadId, senderUserId, body, createdAt
           FROM messaging_messages WHERE threadId = ?
          ORDER BY createdAt ASC, id ASC`,
      )
      .all(threadId) as StoredMessage[];
    if (!afterId) return rows;
    const cursor = rows.find((row) => row.id === afterId);
    if (!cursor) return rows;
    return rows.filter((row) => messageAfter(cursor, row));
  }

  sendMessage(actorId: string, threadId: string, body: string): PublicMessage | null | 'forbidden' {
    if (!this.isMember(threadId, actorId)) return null;
    const incoming = this.pendingIncoming(actorId, threadId);
    if (incoming) return 'forbidden';
    const at = nowIso();
    const message: StoredMessage = {
      id: randomUUID(),
      threadId,
      senderUserId: actorId,
      body,
      createdAt: at,
    };
    this.db
      .prepare(
        `INSERT INTO messaging_messages (id, threadId, senderUserId, body, createdAt)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(message.id, threadId, actorId, body, at);
    this.db.prepare('UPDATE messaging_threads SET updatedAt = ? WHERE id = ?').run(at, threadId);
    return message;
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
      this.addContact(actorId, request.senderUserId, at);
      this.addContact(request.senderUserId, actorId, at);
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
      .prepare('SELECT allowNonContactRequests, updatedAt FROM messaging_preferences WHERE userId = ?')
      .get(userId) as { allowNonContactRequests: number; updatedAt: string } | undefined;
    if (!row) return defaultPreferences();
    return {
      allowNonContactRequests: Number(row.allowNonContactRequests) === 1,
      updatedAt: row.updatedAt,
    };
  }

  setAllowNonContactRequests(userId: string, allow: boolean): MessagingPreferences {
    const at = nowIso();
    this.db
      .prepare(
        `INSERT INTO messaging_preferences (userId, allowNonContactRequests, updatedAt)
         VALUES (?, ?, ?)
         ON CONFLICT(userId) DO UPDATE SET allowNonContactRequests = excluded.allowNonContactRequests,
           updatedAt = excluded.updatedAt`,
      )
      .run(userId, allow ? 1 : 0, at);
    return { allowNonContactRequests: allow, updatedAt: at };
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

  private addContact(userId: string, contactUserId: string, at: string): void {
    this.db
      .prepare(
        `INSERT INTO messaging_contacts (userId, contactUserId, createdAt)
         VALUES (?, ?, ?)
         ON CONFLICT(userId, contactUserId) DO NOTHING`,
      )
      .run(userId, contactUserId, at);
  }

  private lastMessage(threadId: string): StoredMessage | null {
    const row = this.db
      .prepare(
        `SELECT id, threadId, senderUserId, body, createdAt FROM messaging_messages
          WHERE threadId = ? ORDER BY createdAt DESC, id DESC LIMIT 1`,
      )
      .get(threadId) as StoredMessage | undefined;
    return row ?? null;
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
    const last = this.lastMessage(threadId);
    const membership = this.db
      .prepare(
        'SELECT lastReadMessageId FROM messaging_thread_members WHERE threadId = ? AND userId = ?',
      )
      .get(threadId, actorId) as { lastReadMessageId: string | null };
    const unreadCount = this.unreadCount(threadId, actorId, membership.lastReadMessageId);
    const incoming = this.pendingIncoming(actorId, threadId);
    return {
      id: String(row['id']),
      kind: 'direct',
      other: lookup(otherId),
      lastMessage: last,
      unreadCount,
      pendingIncomingRequestId: incoming?.id ?? null,
      updatedAt: String(row['updatedAt']),
    };
  }

  private unreadCount(threadId: string, actorId: string, lastReadMessageId: string | null): number {
    const rows = this.db
      .prepare(
        `SELECT id, threadId, senderUserId, body, createdAt FROM messaging_messages
          WHERE threadId = ? AND senderUserId <> ?`,
      )
      .all(threadId, actorId) as StoredMessage[];
    if (!lastReadMessageId) return rows.length;
    const cursor = this.db
      .prepare(
        `SELECT id, threadId, senderUserId, body, createdAt FROM messaging_messages WHERE id = ?`,
      )
      .get(lastReadMessageId) as StoredMessage | undefined;
    if (!cursor) return rows.length;
    return rows.filter((row) => messageAfter(cursor, row)).length;
  }
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
    this.state.members.push(
      { threadId: id, userId: actorId, role: MEMBER_ROLES.MEMBER, joinedAt: at, lastReadMessageId: null },
      { threadId: id, userId: otherId, role: MEMBER_ROLES.MEMBER, joinedAt: at, lastReadMessageId: null },
    );
    return this.publicThread(actorId, id, lookup)!;
  }

  listChats(actorId: string, lookup: PersonLookup): PublicThread[] {
    return [...this.state.threads.values()]
      .filter((thread) => this.isMember(thread.id, actorId))
      .map((thread) => this.publicThread(actorId, thread.id, lookup))
      .filter((thread): thread is PublicThread => thread !== null && !thread.pendingIncomingRequestId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  getThread(actorId: string, threadId: string, lookup: PersonLookup): PublicThread | null {
    return this.publicThread(actorId, threadId, lookup);
  }

  listMessages(actorId: string, threadId: string, afterId?: string): PublicMessage[] | null {
    if (!this.isMember(threadId, actorId)) return null;
    const rows = this.state.messages.filter((row) => row.threadId === threadId).sort(sortMessages);
    if (!afterId) return rows.map((row) => ({ ...row }));
    const cursor = rows.find((row) => row.id === afterId);
    if (!cursor) return rows.map((row) => ({ ...row }));
    return rows.filter((row) => messageAfter(cursor, row)).map((row) => ({ ...row }));
  }

  sendMessage(actorId: string, threadId: string, body: string): PublicMessage | null | 'forbidden' {
    if (!this.isMember(threadId, actorId)) return null;
    const incoming = this.pendingIncoming(actorId, threadId);
    if (incoming) return 'forbidden';
    const message: StoredMessage = {
      id: randomUUID(),
      threadId,
      senderUserId: actorId,
      body,
      createdAt: nowIso(),
    };
    this.state.messages.push(message);
    const thread = this.state.threads.get(threadId);
    if (thread) thread.updatedAt = message.createdAt;
    return { ...message };
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
    this.addContact(actorId, request.senderUserId, at);
    this.addContact(request.senderUserId, actorId, at);
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
    const prefs = { allowNonContactRequests: allow, updatedAt: nowIso() };
    this.state.preferences.set(userId, prefs);
    return prefs;
  }

  otherMemberId(threadId: string, actorId: string): string | null {
    return this.state.members.find((row) => row.threadId === threadId && row.userId !== actorId)?.userId ?? null;
  }

  isMember(threadId: string, userId: string): boolean {
    return this.state.members.some((row) => row.threadId === threadId && row.userId === userId);
  }

  private addContact(userId: string, contactUserId: string, at: string): void {
    if (this.areContacts(userId, contactUserId)) return;
    this.state.contacts.push({ userId, contactUserId, createdAt: at });
  }

  private lastMessage(threadId: string): StoredMessage | null {
    const rows = this.state.messages.filter((row) => row.threadId === threadId).sort(sortMessages);
    return rows.at(-1) ?? null;
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
    const last = this.lastMessage(threadId);
    const membership = this.state.members.find((row) => row.threadId === threadId && row.userId === actorId);
    const incoming = this.pendingIncoming(actorId, threadId);
    return {
      id: thread.id,
      kind: 'direct',
      other: lookup(otherId),
      lastMessage: last ? { ...last } : null,
      unreadCount: this.unreadCount(threadId, actorId, membership?.lastReadMessageId ?? null),
      pendingIncomingRequestId: incoming?.id ?? null,
      updatedAt: thread.updatedAt,
    };
  }

  private unreadCount(threadId: string, actorId: string, lastReadMessageId: string | null): number {
    const rows = this.state.messages.filter((row) => row.threadId === threadId && row.senderUserId !== actorId);
    if (!lastReadMessageId) return rows.length;
    const cursor = this.state.messages.find((row) => row.id === lastReadMessageId);
    if (!cursor) return rows.length;
    return rows.filter((row) => messageAfter(cursor, row)).length;
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
