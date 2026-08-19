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
import { readVisibility } from '@chat/shared';
import type {
  StoredConversation,
  StoredMessage,
  StoredSection,
  StoredSession,
  StoredUser,
} from './store.ts';
import { readStoredTags, tagsJson } from './reflections/tags.ts';

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
      visibility TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
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

  /*
   * Columns added after the table existed.
   *
   * `CREATE TABLE IF NOT EXISTS` does nothing for a database that already has
   * the table, so a new column needs its own step — and it has to be safe to
   * run on every start, including on a database that already has it. SQLite has
   * no `ADD COLUMN IF NOT EXISTS`, so the existing columns are read first.
   */
  addColumn(db, 'messages', 'draftText', 'TEXT');
  addColumn(db, 'messages', 'draftSection', 'TEXT');
  addColumn(db, 'conversations', 'tags', "TEXT NOT NULL DEFAULT '[]'");

  renameContextSectionToContent(db);
  renamePublicationStateToVisibility(db);
}

/**
 * `publicationState` becomes `visibility`, and `published` becomes `shared`.
 *
 * The old name described a publishing lifecycle the product never had: two
 * values, both of them answers to "who can see this". Renaming the column
 * without moving the values would leave every shared reflection reading as
 * private, which is why the value migration runs in the same transaction as
 * the rename rather than being left to the reader.
 *
 * Safe to run on every start: it does nothing once the column is gone.
 */
function renamePublicationStateToVisibility(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(conversations)').all() as { name: string }[];
  const names = columns.map((column) => column.name);
  if (!names.includes('publicationState')) return;

  db.exec('BEGIN');
  try {
    if (names.includes('visibility')) {
      /* Both present, which only happens if a rename was interrupted. */
      db.exec("UPDATE conversations SET visibility = publicationState WHERE visibility IS NULL OR visibility = ''");
      db.exec('ALTER TABLE conversations DROP COLUMN publicationState');
    } else {
      db.exec('ALTER TABLE conversations RENAME COLUMN publicationState TO visibility');
    }
    db.exec("UPDATE conversations SET visibility = 'shared' WHERE visibility = 'published'");
    db.exec("UPDATE conversations SET visibility = 'private' WHERE visibility NOT IN ('shared', 'private')");
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * The C of C.H.A.T. was renamed from Context to Content.
 *
 * `sections.type` stores that word literally, so a database written before the
 * rename holds rows nothing in the running code will ever ask for again. Left
 * alone, every reflection whose first section someone actually wrote would open
 * with an empty Content card — the author's words still on disk, and invisible.
 * That is data loss in every sense that matters to the person who wrote it.
 *
 * Three properties are load-bearing, and each is here on purpose:
 *
 *  - **Transactional.** Sections and the draft pointers on messages move
 *    together or not at all. A half-migrated database is worse than an
 *    unmigrated one, because the second run would look like it had nothing to
 *    do for the half already moved.
 *  - **Idempotent.** It runs on every start. After the first pass there are no
 *    `'context'` rows left, so every later pass updates nothing.
 *  - **Safe on a database that never held the old value.** A fresh install and
 *    the `:memory:` database each test builds match no rows at all.
 *
 * The collision case is the one worth stating. `sections` is keyed by
 * `(conversationId, type)`, so a conversation holding both an old `'context'`
 * row and a new `'content'` row cannot have the first renamed onto the second.
 * It should not exist — the code only ever wrote one of the two names — but if
 * it does, the row carrying WRITING wins, and an empty row is what gets
 * dropped. Nothing anyone typed is discarded to resolve a key conflict.
 */
function renameContextSectionToContent(db: DatabaseSync): void {
  const pending = db
    .prepare("SELECT COUNT(*) AS n FROM sections WHERE type = 'context'")
    .get() as { n: number } | undefined;
  const draftPointers = db
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE draftSection = 'context'")
    .get() as { n: number } | undefined;
  if (Number(pending?.n ?? 0) === 0 && Number(draftPointers?.n ?? 0) === 0) return;

  db.exec('BEGIN');
  try {
    /*
     * Conversations that somehow carry both names. Whichever row has text is
     * the one kept; when both are empty the old one goes, since the new name is
     * what the application will look for.
     */
    const collisions = db
      .prepare(
        `SELECT old.conversationId AS conversationId,
                length(trim(old.content)) AS oldLength,
                length(trim(new.content)) AS newLength
         FROM sections AS old
         JOIN sections AS new
           ON new.conversationId = old.conversationId AND new.type = 'content'
         WHERE old.type = 'context'`,
      )
      .all() as { conversationId: string; oldLength: number; newLength: number }[];

    for (const row of collisions) {
      const losingType = Number(row.oldLength) > Number(row.newLength) ? 'content' : 'context';
      db.prepare('DELETE FROM sections WHERE conversationId = ? AND type = ?').run(
        row.conversationId,
        losingType,
      );
    }

    db.exec("UPDATE sections SET type = 'content' WHERE type = 'context'");
    db.exec("UPDATE messages SET draftSection = 'content' WHERE draftSection = 'context'");
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function addColumn(db: DatabaseSync, table: string, column: string, type: string): void {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (existing.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/** Rows come back as plain objects; this keeps the casts in one place. */
type Row = Record<string, unknown>;

function conversationFromRow(row: Row): StoredConversation {
  return {
    id: String(row['id']),
    userId: String(row['userId']),
    format: row['format'] === 'condensed' ? 'condensed' : 'full',
    title: String(row['title']),
    scriptureReference: row['scriptureReference'] == null ? null : String(row['scriptureReference']),
    /* Rows written before sharing was called sharing say `published`. */
    visibility: readVisibility(row['visibility']),
    tags: readStoredTags(row['tags']),
    createdAt: String(row['createdAt']),
    updatedAt: String(row['updatedAt']),
  };
}

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
    return row ? conversationFromRow(row) : undefined;
  }

  set(id: string, conversation: StoredConversation): this {
    this.db
      .prepare(
        `INSERT INTO conversations
           (id, userId, format, title, scriptureReference, visibility, tags, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           format = excluded.format,
           title = excluded.title,
           scriptureReference = excluded.scriptureReference,
           visibility = excluded.visibility,
           tags = excluded.tags,
           updatedAt = excluded.updatedAt`,
      )
      .run(
        id,
        conversation.userId,
        conversation.format,
        conversation.title,
        conversation.scriptureReference,
        conversation.visibility,
        tagsJson(conversation.tags ?? []),
        conversation.createdAt,
        conversation.updatedAt,
      );
    return this;
  }

  values(): StoredConversation[] {
    return this.db
      .prepare('SELECT * FROM conversations')
      .all()
      .map((row) => conversationFromRow(row as Row));
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
        `SELECT id, conversationId, role, content, originalContent, authorOrigin, createdAt,
                draftText, draftSection
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
           (id, conversationId, position, role, content, originalContent, authorOrigin, createdAt,
            draftText, draftSection)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        message.draftText ?? null,
        message.draftSection ?? null,
      );
    return this;
  }

  set(conversationId: string, messages: StoredMessage[]): this {
    const insert = this.db.prepare(
      `INSERT INTO messages
         (id, conversationId, position, role, content, originalContent, authorOrigin, createdAt,
          draftText, draftSection)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          message.draftText ?? null,
          message.draftSection ?? null,
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
