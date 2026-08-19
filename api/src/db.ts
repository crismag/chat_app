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
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readAccountType, readVisibility } from '@chat/shared';
import type {
  StoredAccount,
  StoredConversation,
  StoredCreationContext,
  StoredMessage,
  StoredSection,
  StoredSession,
} from './store.ts';
import { readStoredTags, tagsJson } from './reflections/tags.ts';

/** How long a session lasts before it must be established again. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function migrate(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    /*
     * One table for everybody, guests included.
     *
     * A guest is not a placeholder waiting to become a user; they are a user
     * with no identity attached yet. So there is no separate guest table and
     * no second kind of ownership -- there is accountType, and everything a
     * person makes points at this row whichever value it holds. That is what
     * makes registration an UPDATE rather than a migration.
     *
     * email and passwordHash are nullable because a guest has neither, and
     * accountType is stored explicitly rather than inferred from their being
     * null: "has no password" and "has not registered" are different facts,
     * and a single-sign-on account would have the first without the second.
     */
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      accountType TEXT NOT NULL DEFAULT 'REGISTERED',
      email TEXT UNIQUE,
      passwordHash TEXT,
      emailVerifiedAt TEXT,
      displayName TEXT,
      guestName TEXT UNIQUE,
      guestCreatedAt TEXT,
      registeredAt TEXT,
      creationMethod TEXT,
      creationSource TEXT,
      platform TEXT,
      deviceClass TEXT,
      createdAt TEXT,
      lastSeenAt TEXT,
      /* Set when this guest's work was moved into an account that existed. */
      mergedIntoUserId TEXT
    );

    /*
     * How a guest proves, on their next visit, that they are the same guest.
     *
     * The credential is a long random value held in a cookie; what is stored
     * here is its hash, for the same reason a password's is. A database that
     * leaked would then contain nothing that can be replayed.
     *
     * Separate from the user row because it is revocable and replaceable
     * without touching the account, and because a future application
     * installation is another row rather than another user.
     */
    CREATE TABLE IF NOT EXISTS anonymous_credentials (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tokenHash TEXT NOT NULL UNIQUE,
      installationId TEXT,
      platform TEXT,
      createdAt TEXT NOT NULL,
      lastSeenAt TEXT,
      revokedAt TEXT
    );

    /*
     * The next number for each base name.
     *
     * A counter rather than random digits, so QuietCedar-14 means what it
     * appears to mean. Incremented inside a transaction, because the whole
     * value of a sequence is that two callers cannot be handed the same one.
     */
    CREATE TABLE IF NOT EXISTS guest_name_sequences (
      baseName TEXT PRIMARY KEY,
      nextSequence INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expiresAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      /*
       * Who wrote it. A guest and a registered user are both users, so this is
       * one column rather than two, and registration never touches it.
       *
       * Not a foreign key: accounts are moving to MariaDB and this identifier
       * is the public one that crosses between the two stores. The constraint
       * that used to be here was the login wall expressed in SQL anyway.
       */
      userId TEXT NOT NULL,
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
  upgradeUsersToAccounts(db);
  carryOwnersIntoUsers(db);
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(userId)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_anonymous_credentials_user ON anonymous_credentials(userId)');
}

/**
 * The old two-column users table becomes the account table.
 *
 * SQLite cannot relax a NOT NULL, so this is a rebuild rather than a set of
 * `ALTER TABLE`s: every existing row is an account somebody registered, which
 * is exactly what `REGISTERED` means, and their creation date is unknown
 * rather than invented.
 */
function upgradeUsersToAccounts(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
  if (columns.some((column) => column.name === 'accountType')) return;

  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        accountType TEXT NOT NULL DEFAULT 'REGISTERED',
        email TEXT UNIQUE,
        passwordHash TEXT,
        emailVerifiedAt TEXT,
        displayName TEXT,
        guestName TEXT UNIQUE,
        guestCreatedAt TEXT,
        registeredAt TEXT,
        creationMethod TEXT,
        creationSource TEXT,
        platform TEXT,
        deviceClass TEXT,
        createdAt TEXT,
        lastSeenAt TEXT,
        mergedIntoUserId TEXT
      );
      INSERT INTO users_new (id, accountType, email, passwordHash, creationMethod)
        SELECT id, 'REGISTERED', email, passwordHash, 'REGISTRATION' FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Owners were a separate table; they are users now.
 *
 * The intermediate design gave a reflection an `ownerId` pointing at a row
 * that was not a user, so that somebody without an account could own
 * something. Making the guest a first-class user does the same job with one
 * fewer concept, and this carries any database written in between across:
 * an owner with an account becomes that account, and one without becomes the
 * guest user it was standing in for.
 *
 * The old cookie will not resolve afterwards -- it named an owner, and the
 * credential is hashed now -- so such a guest is asked to choose again on
 * their next visit. Their writing is still theirs the moment they sign in to
 * the account that owns it; nothing is deleted here.
 */
function carryOwnersIntoUsers(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(conversations)').all() as { name: string }[];
  const names = columns.map((column) => column.name);
  if (!names.includes('ownerId')) return;

  db.exec('BEGIN');
  try {
    if (!names.includes('userId')) db.exec('ALTER TABLE conversations ADD COLUMN userId TEXT');
    const owners = db.prepare('SELECT id, userId FROM owners').all() as {
      id: string;
      userId: string | null;
    }[];
    const now = new Date().toISOString();
    for (const owner of owners) {
      const accountId = owner.userId ?? owner.id;
      if (!owner.userId) {
        db.prepare(
          `INSERT INTO users (id, accountType, guestName, guestCreatedAt, creationMethod,
                              creationSource, platform, deviceClass, createdAt)
           VALUES (?, 'ANONYMOUS', NULL, ?, 'GUEST_OPT_IN', 'OTHER_PERSISTENT_ACTION', 'WEB', 'UNKNOWN', ?)
           ON CONFLICT(id) DO NOTHING`,
        ).run(owner.id, now, now);
      }
      db.prepare('UPDATE conversations SET userId = ? WHERE ownerId = ?').run(accountId, owner.id);
    }
    db.exec('DELETE FROM conversations WHERE userId IS NULL');
    db.exec('ALTER TABLE conversations DROP COLUMN ownerId');
    db.exec('DROP TABLE IF EXISTS owners');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
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

/**
 * Accounts, guests and registered alike.
 *
 * The methods that matter are `createGuest` and `claim`. Together they are the
 * product invariant: a guest is made once, and registering fills in the fields
 * it was missing. Nothing here moves a reflection, because nothing needs to --
 * the id does not change, so neither does anything pointing at it.
 */
class AccountTable {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  private static read(row: Row | undefined): StoredAccount | undefined {
    if (!row) return undefined;
    return {
      id: String(row['id']),
      accountType: readAccountType(row['accountType']),
      email: row['email'] == null ? null : String(row['email']),
      passwordHash: row['passwordHash'] == null ? null : String(row['passwordHash']),
      emailVerifiedAt: row['emailVerifiedAt'] == null ? null : String(row['emailVerifiedAt']),
      displayName: row['displayName'] == null ? null : String(row['displayName']),
      guestName: row['guestName'] == null ? null : String(row['guestName']),
      registeredAt: row['registeredAt'] == null ? null : String(row['registeredAt']),
      mergedIntoUserId: row['mergedIntoUserId'] == null ? null : String(row['mergedIntoUserId']),
    };
  }

  get(id: string): StoredAccount | undefined {
    return AccountTable.read(
      this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined,
    );
  }

  byEmail(email: string): StoredAccount | undefined {
    return AccountTable.read(
      this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as Row | undefined,
    );
  }

  createRegistered(email: string, passwordHash: string): StoredAccount {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO users (id, accountType, email, passwordHash, registeredAt,
                            creationMethod, createdAt, lastSeenAt)
         VALUES (?, 'REGISTERED', ?, ?, ?, 'REGISTRATION', ?, ?)`,
      )
      .run(id, email, passwordHash, now, now, now);
    return this.get(id) as StoredAccount;
  }

  createGuest(name: string, context: StoredCreationContext): StoredAccount {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO users (id, accountType, guestName, guestCreatedAt, creationMethod,
                            creationSource, platform, deviceClass, createdAt, lastSeenAt)
         VALUES (?, 'ANONYMOUS', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        name,
        now,
        context.creationMethod,
        context.creationSource,
        context.platform,
        context.deviceClass,
        now,
        now,
      );
    return this.get(id) as StoredAccount;
  }

  /**
   * Registration, done to the row that already exists.
   *
   * The guest name is kept. It is what the person has been called in the
   * interface up to this moment, and an audit trail that ends the instant
   * somebody registers is an audit trail with a hole in it.
   *
   * Guarded on the row still being a guest, so two registrations racing on one
   * guest cannot both succeed.
   */
  claim(id: string, email: string, passwordHash: string): StoredAccount | undefined {
    const changed = this.db
      .prepare(
        `UPDATE users
            SET accountType = 'REGISTERED', email = ?, passwordHash = ?, registeredAt = ?
          WHERE id = ? AND accountType = 'ANONYMOUS'`,
      )
      .run(email, passwordHash, new Date().toISOString(), id).changes;
    return changed > 0 ? this.get(id) : undefined;
  }

  setEmailVerified(id: string, at = new Date().toISOString()): void {
    this.db.prepare('UPDATE users SET emailVerifiedAt = ? WHERE id = ?').run(at, id);
  }

  touch(id: string): void {
    this.db.prepare('UPDATE users SET lastSeenAt = ? WHERE id = ?').run(new Date().toISOString(), id);
  }

  /**
   * The other path: this guest's work belongs to an account that already
   * exists.
   *
   * Rows really do move here, so it is one transaction. The guest row is kept
   * and marked rather than deleted, because a credential still in somebody's
   * browser has to resolve to something known -- a retired account they are
   * told about -- rather than looking like a brand-new visitor.
   */
  merge(fromUserId: string, intoUserId: string): number {
    if (fromUserId === intoUserId) return 0;
    this.db.exec('BEGIN');
    try {
      const moved = this.db
        .prepare('UPDATE conversations SET userId = ? WHERE userId = ?')
        .run(intoUserId, fromUserId).changes;
      this.db
        .prepare('UPDATE users SET mergedIntoUserId = ? WHERE id = ?')
        .run(intoUserId, fromUserId);
      this.db
        .prepare("UPDATE anonymous_credentials SET revokedAt = ? WHERE userId = ? AND revokedAt IS NULL")
        .run(new Date().toISOString(), fromUserId);
      this.db.exec('COMMIT');
      return Number(moved);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * The next number for a base name, handed out once.
   *
   * Read and write in one transaction: the whole point of a sequence is that
   * two callers arriving together get different numbers, and a read followed
   * by a write outside a transaction is exactly how they would not.
   */
  nextGuestSequence(baseName: string): number {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db
        .prepare('SELECT nextSequence FROM guest_name_sequences WHERE baseName = ?')
        .get(baseName) as Row | undefined;
      const next = Number(row?.['nextSequence'] ?? 1);
      this.db
        .prepare(
          `INSERT INTO guest_name_sequences (baseName, nextSequence) VALUES (?, ?)
           ON CONFLICT(baseName) DO UPDATE SET nextSequence = excluded.nextSequence`,
        )
        .run(baseName, next + 1);
      this.db.exec('COMMIT');
      return next;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

/**
 * Guest credentials: the hash, never the value.
 *
 * Looking one up is a lookup by hash, so a stolen database yields nothing that
 * can be presented to the server. Revocation is a timestamp rather than a
 * delete, so a credential that was retired stays distinguishable from one that
 * never existed.
 */
class GuestCredentialTable {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  create(input: { userId: string; tokenHash: string; platform: string; installationId?: string | null }): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO anonymous_credentials
           (id, userId, tokenHash, installationId, platform, createdAt, lastSeenAt, revokedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        id,
        input.userId,
        input.tokenHash,
        input.installationId ?? null,
        input.platform,
        new Date().toISOString(),
        new Date().toISOString(),
      );
    return id;
  }

  findByTokenHash(tokenHash: string): { id: string; userId: string } | undefined {
    const row = this.db
      .prepare('SELECT id, userId FROM anonymous_credentials WHERE tokenHash = ? AND revokedAt IS NULL')
      .get(tokenHash) as Row | undefined;
    return row ? { id: String(row['id']), userId: String(row['userId']) } : undefined;
  }

  touch(id: string): void {
    this.db
      .prepare('UPDATE anonymous_credentials SET lastSeenAt = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  revokeForUser(userId: string): void {
    this.db
      .prepare('UPDATE anonymous_credentials SET revokedAt = ? WHERE userId = ? AND revokedAt IS NULL')
      .run(new Date().toISOString(), userId);
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
           userId = excluded.userId,
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  readonly accounts: AccountTable;
  readonly guestCredentials: GuestCredentialTable;
  readonly sessions: SessionTable;
  readonly conversations: ConversationTable;
  readonly messages: MessageTable;
  readonly sections: SectionTable;

  constructor(location = ':memory:') {
    this.db = new DatabaseSync(location);
    migrate(this.db);
    this.accounts = new AccountTable(this.db);
    this.guestCredentials = new GuestCredentialTable(this.db);
    this.sessions = new SessionTable(this.db);
    this.conversations = new ConversationTable(this.db);
    this.messages = new MessageTable(this.db);
    this.sections = new SectionTable(this.db);
  }

  close(): void {
    this.db.close();
  }
}
