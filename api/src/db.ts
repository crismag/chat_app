/*
 * Persistence.
 *
 * Until now the store was five `Map`s, so every account, conversation, message
 * and session vanished when the process restarted. That is fatal for a product
 * whose promise is "a persistent, searchable personal library", and it blocks
 * community membership entirely — membership that disappears on restart is not
 * membership.
 *
 * This is SQLite through `node:sqlite`, which ships inside Node and needs no
 * native build step, so there is nothing to compile on a deploy target.
 *
 * The classes below deliberately present the same `get` / `set` / `has` /
 * `delete` / `values` surface the old Maps did. Every mutation in `app.ts`
 * already ends in a `.set()`, so the swap needs no changes there at all — which
 * keeps this change to one thing, and makes it easy to reason about if it has
 * to be reverted.
 */
import { DatabaseSync } from 'node:sqlite';
import type {
  StoredConversation,
  StoredMessage,
  StoredSection,
  StoredSession,
  StoredUser,
} from './store.ts';

/** How long a session lasts before it must be established again. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function migrate(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expiresAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      format TEXT NOT NULL DEFAULT 'full',
      title TEXT NOT NULL,
      scriptureReference TEXT,
      publicationState TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      originalContent TEXT NOT NULL,
      authorOrigin TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sections (
      conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      authorOrigin TEXT NOT NULL,
      PRIMARY KEY (conversationId, type)
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(userId);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversationId, position);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expiresAt);
  `);
}

/** Rows come back as plain objects; this keeps the casts in one place. */
type Row = Record<string, unknown>;

class UserTable {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  get(id: string): StoredUser | undefined {
    const row = this.db
      .prepare('SELECT id, email, passwordHash FROM users WHERE id = ?')
      .get(id) as Row | undefined;
    return row as StoredUser | undefined;
  }

  set(id: string, user: StoredUser): this {
    this.db
      .prepare(
        `INSERT INTO users (id, email, passwordHash) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET email = excluded.email,
                                       passwordHash = excluded.passwordHash`,
      )
      .run(id, user.email, user.passwordHash);
    return this;
  }
}

/** Email → id. Backed by the same table; the unique index does the work. */
class EmailIndex {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  has(email: string): boolean {
    return this.get(email) !== undefined;
  }

  get(email: string): string | undefined {
    const row = this.db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(email) as Row | undefined;
    return row?.['id'] as string | undefined;
  }

  /* The row is written by UserTable.set; the index needs nothing of its own. */
  set(): this {
    return this;
  }
}

class SessionTable {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /**
   * Expiry is enforced on read rather than by a sweeper. A token that has aged
   * out is deleted the moment it is presented, so an old cookie cannot be
   * revived by a clock change or a missed cron.
   */
  get(token: string): StoredSession | undefined {
    const row = this.db
      .prepare('SELECT token, userId, expiresAt FROM sessions WHERE token = ?')
      .get(token) as Row | undefined;
    if (!row) return undefined;

    if (Number(row['expiresAt']) <= Date.now()) {
      this.delete(token);
      return undefined;
    }
    return { token: row['token'] as string, userId: row['userId'] as string };
  }

  set(token: string, session: StoredSession): this {
    this.db
      .prepare(
        `INSERT INTO sessions (token, userId, expiresAt) VALUES (?, ?, ?)
         ON CONFLICT(token) DO UPDATE SET expiresAt = excluded.expiresAt`,
      )
      .run(token, session.userId, Date.now() + SESSION_TTL_MS);
    return this;
  }

  delete(token: string): boolean {
    return this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token).changes > 0;
  }
}

class ConversationTable {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  get(id: string): StoredConversation | undefined {
    const row = this.db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(id) as Row | undefined;
    return row as StoredConversation | undefined;
  }

  set(id: string, conversation: StoredConversation): this {
    this.db
      .prepare(
        `INSERT INTO conversations
           (id, userId, format, title, scriptureReference, publicationState, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           format = excluded.format,
           title = excluded.title,
           scriptureReference = excluded.scriptureReference,
           publicationState = excluded.publicationState,
           updatedAt = excluded.updatedAt`,
      )
      .run(
        id,
        conversation.userId,
        conversation.format,
        conversation.title,
        conversation.scriptureReference,
        conversation.publicationState,
        conversation.createdAt,
        conversation.updatedAt,
      );
    return this;
  }

  values(): StoredConversation[] {
    return this.db
      .prepare('SELECT * FROM conversations')
      .all() as unknown as StoredConversation[];
  }

  /**
   * Deleting a reflection deletes all of it.
   *
   * `PRAGMA foreign_keys = ON` and the `ON DELETE CASCADE` on messages and
   * sections mean the thread and the artifact go with the row, rather than
   * being left orphaned in two tables nothing can reach.
   */
  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id).changes > 0;
  }
}

/**
 * Conversation id → its messages, in order.
 *
 * `set` replaces the whole list because that is how the callers use it: they
 * read the array, append to it, and set it back. Rewriting the conversation's
 * messages inside one transaction keeps that honest at this scale, and avoids
 * a half-written thread if anything throws mid-way.
 */
class MessageTable {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  get(conversationId: string): StoredMessage[] | undefined {
    const rows = this.db
      .prepare(
        `SELECT id, conversationId, role, content, originalContent, authorOrigin, createdAt
         FROM messages WHERE conversationId = ? ORDER BY position`,
      )
      .all(conversationId) as unknown as StoredMessage[];
    return rows.length > 0 ? rows : undefined;
  }

  /**
   * Add one message to the end of the thread.
   *
   * The callers used to read the whole list, push, and write it all back. That
   * worked, but it is the same shape as the write that deleted a conversation's
   * sections — a replace wearing a save's clothes — and it loses everything if
   * the read ever comes back short. Appending cannot.
   */
  append(conversationId: string, message: StoredMessage): this {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) AS last FROM messages WHERE conversationId = ?')
      .get(conversationId) as Row | undefined;
    this.db
      .prepare(
        `INSERT INTO messages
           (id, conversationId, position, role, content, originalContent, authorOrigin, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        conversationId,
        Number(row?.['last'] ?? -1) + 1,
        message.role,
        message.content,
        message.originalContent,
        message.authorOrigin,
        message.createdAt,
      );
    return this;
  }

  set(conversationId: string, messages: StoredMessage[]): this {
    const insert = this.db.prepare(
      `INSERT INTO messages
         (id, conversationId, position, role, content, originalContent, authorOrigin, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('DELETE FROM messages WHERE conversationId = ?')
        .run(conversationId);
      messages.forEach((message, position) => {
        insert.run(
          message.id,
          conversationId,
          position,
          message.role,
          message.content,
          message.originalContent,
          message.authorOrigin,
          message.createdAt,
        );
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this;
  }

  delete(conversationId: string): boolean {
    return (
      this.db.prepare('DELETE FROM messages WHERE conversationId = ?').run(conversationId)
        .changes > 0
    );
  }
}

/** Conversation id → its C.H.A.T. sections, keyed by type. */
class SectionTable {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  get(conversationId: string): Record<string, StoredSection> | undefined {
    const rows = this.db
      .prepare(
        'SELECT type, content, authorOrigin FROM sections WHERE conversationId = ?',
      )
      .all(conversationId) as unknown as StoredSection[];
    if (rows.length === 0) return undefined;

    const sections: Record<string, StoredSection> = {};
    for (const row of rows) sections[row.type] = row;
    return sections;
  }

  set(conversationId: string, sections: Record<string, StoredSection>): this {
    const insert = this.db.prepare(
      `INSERT INTO sections (conversationId, type, content, authorOrigin)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(conversationId, type) DO UPDATE SET
         content = excluded.content,
         authorOrigin = excluded.authorOrigin`,
    );
    this.db.exec('BEGIN');
    try {
      for (const section of Object.values(sections)) {
        insert.run(
          conversationId,
          section.type,
          section.content,
          section.authorOrigin,
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this;
  }

  delete(conversationId: string): boolean {
    return (
      this.db.prepare('DELETE FROM sections WHERE conversationId = ?').run(conversationId)
        .changes > 0
    );
  }
}

/**
 * The store, with the same shape `MemoryStore` had.
 *
 * `:memory:` is the default so the test suite keeps running without touching
 * the disk, and each test gets its own empty database.
 */
export class SqliteStore {
  readonly db: DatabaseSync;
  readonly users: UserTable;
  readonly usersByEmail: EmailIndex;
  readonly sessions: SessionTable;
  readonly conversations: ConversationTable;
  readonly messages: MessageTable;
  readonly sections: SectionTable;

  constructor(location = ':memory:') {
    this.db = new DatabaseSync(location);
    migrate(this.db);
    this.users = new UserTable(this.db);
    this.usersByEmail = new EmailIndex(this.db);
    this.sessions = new SessionTable(this.db);
    this.conversations = new ConversationTable(this.db);
    this.messages = new MessageTable(this.db);
    this.sections = new SectionTable(this.db);
  }

  close(): void {
    this.db.close();
  }
}
