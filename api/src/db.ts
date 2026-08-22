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
  StoredInstallation,
  StoredInstallationInput,
  StoredConversation,
  StoredCreationContext,
  StoredMessage,
  StoredSection,
  StoredSession,
} from './store.ts';
import { readStoredTags, tagsJson } from './reflections/tags.ts';
import { hashSessionToken } from './mysql/tokens.ts';
import type { RevokedSession, StoredSessionSummary } from './auth/store.ts';

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
     * How a browser proves, on its next visit, which account it belongs to.
     *
     * An installation is a browser profile or an app on a device, and it is
     * deliberately not the same thing as a session. A session is the current
     * authorised interaction and can end; an installation is durable
     * recognition, and for a guest it is the only thing standing between them
     * and losing everything they have written. Collapsing the two would mean
     * an ordinary "sign out" destroyed a guest's account.
     *
     * The credential has two halves. installationId is a plain UUID and
     * identifies the row; credentialHash is the hash of a secret that never
     * touches the database. Both are presented together and both must match --
     * an id alone proves nothing, which is the difference between a credential
     * and a name.
     *
     * browserFamily, osFamily and deviceClass are diagnostics. They are
     * written when the row is made and never read to decide who somebody is:
     * recognising a person by what their machine looks like is recognising
     * somebody who did not agree to be recognised, and no amount of matching
     * metadata will unlock an account here.
     */
    CREATE TABLE IF NOT EXISTS account_installations (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      installationId TEXT NOT NULL UNIQUE,
      credentialHash TEXT NOT NULL,
      platform TEXT NOT NULL,
      deviceClass TEXT,
      browserFamily TEXT,
      osFamily TEXT,
      /* GUEST_PERSISTENT, or REGISTERED_PERSISTENT when somebody asked to be
         kept signed in on this device. There is no third value: a temporary
         sign-in deliberately leaves no durable recognition behind. */
      persistenceType TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      lastSeenAt TEXT,
      rotatedAt TEXT,
      revokedAt TEXT
    );

    /*
     * The next number for each base name.
     *
     * A counter rather than random digits, so QuietCedar-14 means what it
     * appears to mean. Incremented inside a transaction, because the whole
     * value of a sequence is that two callers cannot be handed the same one.
     */
    /*
     * A pending "I have forgotten my password".
     *
     * Only the hash of the token is here: the token itself is in an email, and
     * for the hour it lives it is a way into somebody's account. A leaked
     * database must not contain one.
     *
     * usedAt rather than a delete, so a link that has already been used is
     * distinguishable from one that never existed -- the first deserves
     * "that link has been used", the second deserves nothing at all.
     */
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      tokenHash TEXT NOT NULL UNIQUE,
      expiresAt INTEGER NOT NULL,
      usedAt TEXT,
      createdAt TEXT NOT NULL
    );

    /*
     * An account can be reached through more than one door.
     *
     * Google, a password, and whatever comes later all attach to the same
     * application user, so the identity is kept beside the account rather than
     * on it. The pair (provider, subject) is unique because that is the whole
     * guarantee: signing in with the same Google account twice can only ever
     * arrive at the same row, so a second sign-in cannot make a second person.
     *
     * The subject is Google's own subject claim, never the email address.
     * Addresses are
     * reassigned, changed and shared; a subject is stable for the life of the
     * account, which is what a permanent key has to be.
     */
    CREATE TABLE IF NOT EXISTS user_identities (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      providerUserId TEXT NOT NULL,
      email TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      lastLoginAt TEXT,
      UNIQUE (provider, providerUserId)
    );

    CREATE INDEX IF NOT EXISTS idx_user_identities_user
      ON user_identities (userId);

    CREATE TABLE IF NOT EXISTS guest_name_sequences (
      baseName TEXT PRIMARY KEY,
      nextSequence INTEGER NOT NULL
    );

    /*
     * The current interaction, and which installation established it.
     *
     * Revocable on its own, so ending a session says nothing about whether the
     * browser is still recognised. That separation is what lets a guest leave
     * without being destroyed, and lets a registered user on a shared computer
     * have a session that outlives nothing.
     */
    CREATE TABLE IF NOT EXISTS sessions (
      /* SHA-256 of the cookie value. Legacy rows may still hold the raw token;
       * SessionTable.get looks up the hash first, then the presented value. */
      token TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      installationId TEXT,
      sessionType TEXT NOT NULL DEFAULT 'REGISTERED_TEMPORARY',
      createdAt TEXT,
      lastSeenAt TEXT,
      expiresAt INTEGER NOT NULL,
      revokedAt TEXT
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
  /*
   * Order matters, and it cost a production database to learn it. Removing the
   * foreign key comes FIRST, because rebuilding the table it points AT is what
   * fires it.
   */
  dropConversationUserForeignKey(db);
  upgradeUsersToAccounts(db);
  /* Sessions predate installations; an old database has the two-column one. */
  addColumn(db, 'sessions', 'installationId', 'TEXT');
  addColumn(db, 'sessions', 'sessionType', "TEXT NOT NULL DEFAULT 'REGISTERED_TEMPORARY'");
  addColumn(db, 'sessions', 'createdAt', 'TEXT');
  addColumn(db, 'sessions', 'lastSeenAt', 'TEXT');
  addColumn(db, 'sessions', 'revokedAt', 'TEXT');
  carryOwnersIntoUsers(db);
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(userId)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_installations_user ON account_installations(userId)');
  /*
   * Whatever exists by now. It runs again once the community and profile
   * stores have made their own tables — this is idempotent, and running it
   * here means a store used on its own is correct too, rather than only
   * correct when it happens to be inside an application.
   */
  dropUserForeignKeys(db);
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

  /*
   * Foreign keys OFF, and this is not a formality.
   *
   * `DROP TABLE` with foreign keys enabled behaves as though every row were
   * deleted first, so each child with `ON DELETE CASCADE` fires -- and dropping
   * `users` in order to rebuild it therefore deleted every session and, where
   * the old constraint still stood, every reflection. That is what this
   * migration did to the live database on its first run: the rebuild was
   * intended to be invisible, and instead it emptied two tables.
   *
   * Turned off outside the transaction, because the pragma is a no-op inside
   * one, and `foreign_key_check` afterwards is what proves the rebuild left
   * nothing dangling.
   */
  db.exec('PRAGMA foreign_keys = OFF');
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
    db.exec('PRAGMA foreign_keys = ON');
    throw error;
  }
  db.exec('PRAGMA foreign_keys = ON');
  assertNothingDangling(db, 'Rebuilding users');
}

/**
 * After any rebuild that ran with foreign keys disabled.
 *
 * Disabling them is the only way to replace a table other tables point at, and
 * the price is that nothing is checked while they are off. This is where that
 * is paid back: a rebuild that orphaned a row fails loudly here rather than
 * leaving a database that reads fine until somebody opens the wrong page.
 */
function assertNothingDangling(db: DatabaseSync, what: string): void {
  const broken = db.prepare('PRAGMA foreign_key_check').all() as unknown[];
  if (broken.length > 0) {
    throw new Error(`${what} left ${broken.length} rows that no longer resolve.`);
  }
}

/**
 * Every foreign key into the local `users` table, removed.
 *
 * Accounts moved to MariaDB. A registered person therefore has no row in this
 * file's `users` table at all — and a dozen tables here still declared
 * `REFERENCES users(id)`, so the first write on behalf of a real account
 * failed with "FOREIGN KEY constraint failed". Creating a community did.
 * So did saving a profile, publishing, encouraging, saving and reporting.
 *
 * `conversations` was fixed one at a time when it broke. That was treating a
 * symptom: the constraint is wrong everywhere for the same reason, and the
 * remaining eleven were each waiting for somebody to reach them in production.
 * This finds them by reading the schema rather than by listing them, so a
 * table added later with the same mistake is also repaired.
 *
 * Nothing else about a table changes. Its other constraints, defaults and
 * indexes are preserved; only the reference to a table that no longer holds
 * these people is dropped.
 *
 * Called after every store has built its own tables, not from `migrate()`:
 * the community and profile tables are created by their own stores, so at
 * `migrate()` time most of the offenders do not exist yet.
 */
export function dropUserForeignKeys(db: DatabaseSync): void {
  const tables = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = @kind")
    .all({ kind: 'table' }) as { name: string; sql: string | null }[];

  const offenders = tables.filter(
    (table) =>
      table.sql &&
      table.name !== 'users' &&
      /REFERENCES\s+users\s*\(/i.test(table.sql),
  );
  if (offenders.length === 0) return;

  /* Indexes go with the table they belong to, so they are put back after. */
  const indexes = db
    .prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = @kind")
    .all({ kind: 'index' }) as { name: string; tbl_name: string; sql: string | null }[];

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    for (const table of offenders) {
      const original = table.sql as string;
      /*
       * Only the reference is removed — the column, its type and its NOT NULL
       * stay exactly as they were, along with any cascade action that was
       * attached to the reference and now has nothing to cascade from.
       */
      const rebuilt = original
        .replace(/REFERENCES\s+users\s*\([^)]*\)(\s+ON\s+(DELETE|UPDATE)\s+[A-Z ]+)*/gi, '')
        .replace(new RegExp(`\\b${table.name}\\b`), `${table.name}_rebuilt`);

      db.exec(rebuilt);
      db.exec(`INSERT INTO ${table.name}_rebuilt SELECT * FROM ${table.name}`);
      db.exec(`DROP TABLE ${table.name}`);
      db.exec(`ALTER TABLE ${table.name}_rebuilt RENAME TO ${table.name}`);

      for (const index of indexes) {
        if (index.tbl_name === table.name && index.sql) db.exec(index.sql);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON');
    throw error;
  }
  db.exec('PRAGMA foreign_keys = ON');
  assertNothingDangling(db, 'Removing the user foreign keys');
}

/**
 * The login wall, as it was actually written: a foreign key.
 *
 * `conversations.userId` used to be `NOT NULL REFERENCES users(id)`, and while
 * accounts and reflections lived in the same file that was merely tidy. It is
 * now false: accounts are in MariaDB, a guest is a user there, and a
 * reflection written by one has an owner SQLite has never heard of. The
 * constraint fails on the insert, which is the whole feature refusing to work.
 *
 * `CREATE TABLE IF NOT EXISTS` cannot fix this and neither can `ALTER TABLE`,
 * so the table is rebuilt. Foreign keys are disabled around the rebuild --
 * messages and sections point at this table and would be broken by the drop --
 * and `foreign_key_check` afterwards is what proves nothing was.
 *
 * Missed once already: the test fixture for the old shape was written without
 * the constraint, so the suite could not see the thing that broke in
 * production. It has one now.
 */
function dropConversationUserForeignKey(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(conversations)').all() as { name: string }[];
  if (!columns.some((column) => column.name === 'userId')) return;
  const keys = db.prepare('PRAGMA foreign_key_list(conversations)').all() as { table: string }[];
  if (!keys.some((key) => key.table === 'users')) return;

  /* Outside the transaction: this pragma is a no-op inside one. */
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE conversations_rebuilt (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        format TEXT NOT NULL DEFAULT 'full',
        title TEXT NOT NULL,
        scriptureReference TEXT,
        visibility TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      INSERT INTO conversations_rebuilt
        (id, userId, format, title, scriptureReference, visibility, tags, createdAt, updatedAt)
        SELECT id, userId, format, title, scriptureReference, visibility, tags, createdAt, updatedAt
          FROM conversations;
      DROP TABLE conversations;
      ALTER TABLE conversations_rebuilt RENAME TO conversations;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON');
    throw error;
  }
  db.exec('PRAGMA foreign_keys = ON');
  assertNothingDangling(db, 'Rebuilding conversations');
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
      createdAt: row['createdAt'] == null ? null : String(row['createdAt']),
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

  /**
   * A brand-new account reached through a provider rather than a password.
   *
   * The address is recorded on the account only when it is free. Two different
   * Google accounts can present the same address over time, and a password
   * account may already hold it — and since identities are matched on the
   * provider's subject and never on the address, an address that cannot be
   * stored here costs nothing: it stays on the identity row, where it is
   * descriptive rather than load-bearing.
   */
  createForIdentity(email: string | null): StoredAccount {
    const id = randomUUID();
    const now = new Date().toISOString();
    const free = email && !this.byEmail(email) ? email : null;
    this.db
      .prepare(
        `INSERT INTO users (id, accountType, email, registeredAt,
                            creationMethod, createdAt, lastSeenAt)
         VALUES (?, 'REGISTERED', ?, ?, 'REGISTRATION', ?, ?)`,
      )
      .run(id, free, now, now, now);
    return this.get(id) as StoredAccount;
  }

  /**
   * A guest becoming a registered account through a provider.
   *
   * The same upgrade `claim` performs, without a password: somebody signing in
   * with Google never chooses one, and inventing a hash for them would create
   * a credential nobody knows and nobody can use. The row, the id and
   * everything pointing at it are untouched — which is the whole reason the
   * guest keeps their reflections.
   */
  claimForIdentity(id: string, email: string | null): StoredAccount | undefined {
    /* Only if the address is not already somebody else's; see createForIdentity. */
    const taken = email ? this.byEmail(email) : undefined;
    const free = email && (!taken || taken.id === id) ? email : null;
    const changed = this.db
      .prepare(
        `UPDATE users
            SET accountType = 'REGISTERED',
                email = COALESCE(?, email),
                registeredAt = ?
          WHERE id = ? AND accountType = 'ANONYMOUS'`,
      )
      .run(free, new Date().toISOString(), id).changes;
    return changed > 0 ? this.get(id) : undefined;
  }

  /** A new password for somebody who already has an account. */
  setPassword(id: string, passwordHash: string): void {
    this.db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(passwordHash, id);
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

      /*
       * Everything else the guest owned, in the same transaction.
       *
       * Moving only the conversations left the rest of a guest's work behind
       * under an id nobody can sign in as: publications with no reachable
       * author, a membership that no longer belongs to anyone, Studio images
       * orphaned from the person who made them. The reflections arrived and
       * the community half of the same act did not.
       *
       * Two shapes here. A plain reassignment where nothing can collide, and a
       * delete-then-reassign where the same identity would end up twice in a
       * row that only allows it once -- both people having encouraged one
       * publication, or both being in one community. In every one of those the
       * target's row is the one kept: it is the identity that continues, and
       * its membership role and its history are the ones that stay true.
       */
      /*
       * Only the tables this database actually has.
       *
       * Community, profiles and Studio each create their own tables when their
       * store is constructed, so a database that never mounted a feature does
       * not have its tables at all. Asking sqlite_master once is the
       * difference between "this deployment has no communities" and a merge
       * that throws half way through and rolls the reflections back with it.
       */
      const present = new Set(
        (
          this.db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all() as Row[]
        ).map((row) => String(row['name'])),
      );

      const move = (table: string, column: string) => {
        if (!present.has(table)) return;
        this.db
          .prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`)
          .run(intoUserId, fromUserId);
      };

      /*
       * Drop the guest's row where the target already holds the same key, then
       * move what is left. Done in this order because the unique constraint is
       * what we are avoiding, not discovering.
       */
      const moveWithoutColliding = (table: string, column: string, key: string) => {
        if (!present.has(table)) return;
        this.db
          .prepare(
            `DELETE FROM ${table}
              WHERE ${column} = ?
                AND ${key} IN (SELECT ${key} FROM ${table} WHERE ${column} = ?)`,
          )
          .run(fromUserId, intoUserId);
        move(table, column);
      };

      moveWithoutColliding('publication_reactions', 'userId', 'publicationId');
      moveWithoutColliding('publication_saves', 'userId', 'publicationId');
      moveWithoutColliding('publication_hides', 'userId', 'publicationId');
      moveWithoutColliding('community_members', 'userId', 'communityId');

      move('publications', 'authorUserId');
      move('publications', 'hiddenByUserId');
      move('communities', 'createdByUserId');
      move('community_members', 'invitedByUserId');
      move('share_events', 'userId');
      move('publication_reports', 'reporterUserId');
      move('profile_reports', 'reporterUserId');
      move('profile_reports', 'subjectUserId');
      move('studio_image_assets', 'userId');
      move('notes', 'userId');

      /*
       * Both halves of a pair, and then the pairs that stopped making sense.
       * A guest who muted the account they are now merging into would be
       * muting themselves, which no interface can undo because no interface
       * can express it.
       */
      moveWithoutColliding('author_mutes', 'userId', 'mutedUserId');
      moveWithoutColliding('author_mutes', 'mutedUserId', 'userId');
      if (present.has('author_mutes')) {
        this.db.exec('DELETE FROM author_mutes WHERE userId = mutedUserId');
      }

      moveWithoutColliding('profile_blocks', 'blockerUserId', 'blockedUserId');
      moveWithoutColliding('profile_blocks', 'blockedUserId', 'blockerUserId');
      if (present.has('profile_blocks')) {
        this.db.exec('DELETE FROM profile_blocks WHERE blockerUserId = blockedUserId');
      }

      /*
       * The public identity is the target's and stays the target's. A guest
       * has no route to create one -- the profile endpoints require a
       * registered account -- so this is defensive, and it prefers the
       * identity people can already see over one that was never shown.
       */
      for (const table of ['profiles', 'profile_avatars', 'profile_preferences']) {
        if (!present.has(table)) continue;
        this.db
          .prepare(
            `DELETE FROM ${table}
              WHERE userId = ? AND EXISTS (SELECT 1 FROM ${table} WHERE userId = ?)`,
          )
          .run(fromUserId, intoUserId);
        move(table, 'userId');
      }

      this.db
        .prepare('UPDATE users SET mergedIntoUserId = ? WHERE id = ?')
        .run(intoUserId, fromUserId);
      this.db
        .prepare("UPDATE account_installations SET revokedAt = ? WHERE userId = ? AND revokedAt IS NULL")
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
 * Installations: the hash, never the secret.
 *
 * A row is found by its `installationId` and then the secret is checked
 * against the stored hash, so the lookup and the proof are separate steps and
 * neither is sufficient alone. Revocation is a timestamp rather than a delete,
 * because a credential that was retired has to stay distinguishable from one
 * that never existed -- a browser presenting a revoked credential is told it
 * is nobody, not treated as a stranger who might be handed a new account.
 */
/**
 * Pending password resets.
 *
 * Found by hash, never by user: a link is presented, and the question is
 * whether this exact one is live — not "does this person have a reset going",
 * which is a question nobody asks.
 */
/**
 * The doors an account can be reached through.
 *
 * Reads and writes only; every decision about *whether* to link is made in the
 * auth store, where the guest-upgrade rule and the already-taken case live
 * together and can be reasoned about in one place.
 */
class IdentityTable {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  byProvider(provider: string, providerUserId: string): { userId: string } | undefined {
    return this.db
      .prepare('SELECT userId FROM user_identities WHERE provider = ? AND providerUserId = ?')
      .get(provider, providerUserId) as { userId: string } | undefined;
  }

  /**
   * Attach an identity, or fail because somebody else already has it.
   *
   * The unique key decides races rather than a prior read: two sign-ins
   * landing together both see nothing, and only one insert can win.
   */
  link(input: {
    userId: string;
    provider: string;
    providerUserId: string;
    email: string | null;
  }): boolean {
    const now = new Date().toISOString();
    try {
      this.db
        .prepare(
          `INSERT INTO user_identities
             (id, userId, provider, providerUserId, email, createdAt, updatedAt, lastLoginAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), input.userId, input.provider, input.providerUserId, input.email, now, now, now);
      return true;
    } catch {
      return false;
    }
  }

  /** Record that this door was used, without touching who it belongs to. */
  touch(provider: string, providerUserId: string, email: string | null): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE user_identities
            SET lastLoginAt = ?, updatedAt = ?, email = COALESCE(?, email)
          WHERE provider = ? AND providerUserId = ?`,
      )
      .run(now, now, email, provider, providerUserId);
  }
}

class PasswordResetTable {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  create(userId: string, tokenHash: string, expiresAt: number): void {
    this.db
      .prepare(
        `INSERT INTO password_resets (id, userId, tokenHash, expiresAt, usedAt, createdAt)
         VALUES (?, ?, ?, ?, NULL, ?)`,
      )
      .run(randomUUID(), userId, tokenHash, expiresAt, new Date().toISOString());
  }

  /** Live means unused and unexpired. Anything else is not found. */
  live(tokenHash: string): { id: string; userId: string } | undefined {
    const row = this.db
      .prepare(
        `SELECT id, userId FROM password_resets
          WHERE tokenHash = ? AND usedAt IS NULL AND expiresAt > ?`,
      )
      .get(tokenHash, Date.now()) as Row | undefined;
    return row ? { id: String(row['id']), userId: String(row['userId']) } : undefined;
  }

  use(id: string): void {
    this.db
      .prepare('UPDATE password_resets SET usedAt = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  /**
   * Every other pending reset for this person, spent.
   *
   * Asking twice and using the first link should not leave the second one
   * live: a reset is finished when it is finished.
   */
  spendOthers(userId: string): void {
    this.db
      .prepare('UPDATE password_resets SET usedAt = ? WHERE userId = ? AND usedAt IS NULL')
      .run(new Date().toISOString(), userId);
  }
}

class InstallationTable {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  create(input: StoredInstallationInput): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO account_installations
           (id, userId, installationId, credentialHash, platform, deviceClass,
            browserFamily, osFamily, persistenceType, createdAt, lastSeenAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.installationId,
        input.credentialHash,
        input.platform,
        input.deviceClass ?? null,
        input.browserFamily ?? null,
        input.osFamily ?? null,
        input.persistenceType,
        now,
        now,
      );
    return id;
  }

  /** By id alone, so the caller can compare the secret in constant time. */
  find(installationId: string): StoredInstallation | undefined {
    const row = this.db
      .prepare(
        `SELECT id, userId, installationId, credentialHash, persistenceType
           FROM account_installations
          WHERE installationId = ? AND revokedAt IS NULL`,
      )
      .get(installationId) as Row | undefined;
    if (!row) return undefined;
    return {
      id: String(row['id']),
      userId: String(row['userId']),
      installationId: String(row['installationId']),
      credentialHash: String(row['credentialHash']),
      persistenceType: String(row['persistenceType']),
    };
  }

  touch(installationId: string): void {
    this.db
      .prepare('UPDATE account_installations SET lastSeenAt = ? WHERE installationId = ?')
      .run(new Date().toISOString(), installationId);
  }

  revoke(installationId: string): void {
    this.db
      .prepare(
        'UPDATE account_installations SET revokedAt = ? WHERE installationId = ? AND revokedAt IS NULL',
      )
      .run(new Date().toISOString(), installationId);
  }

  revokeForUser(userId: string): void {
    this.db
      .prepare(
        'UPDATE account_installations SET revokedAt = ? WHERE userId = ? AND revokedAt IS NULL',
      )
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
    const hashed = hashSessionToken(token);
    const lookup = this.db.prepare(
      'SELECT token, userId, installationId, sessionType, expiresAt, revokedAt FROM sessions WHERE token = ?',
    );
    /*
     * Hash first. A row whose primary key is still the cookie value is a
     * session issued before hashing: look it up as a fallback until every
     * such cookie has expired (SESSION_TTL_MS after this change shipped).
     */
    const row = (lookup.get(hashed) ?? lookup.get(token)) as Row | undefined;
    if (!row) return undefined;
    /* Revoked is not expired: the row stays, and it answers nobody. */
    if (row['revokedAt']) return undefined;

    if (Number(row['expiresAt']) <= Date.now()) {
      this.delete(token);
      return undefined;
    }
    return {
      token,
      userId: String(row['userId']),
      installationId: row['installationId'] == null ? null : String(row['installationId']),
      sessionType: String(row['sessionType']),
    };
  }

  /**
   * The sessions this account currently has, for the person who owns them.
   *
   * The identifier handed out is the stored key, which is a SHA-256 of the
   * cookie value. That is deliberately not a credential: authenticating still
   * requires the pre-image, which never leaves the browser that holds it. So
   * this can name a session in a list, and revoke one, without a page ever
   * touching a token that could be used to sign in.
   *
   * Coarse device facts only — the platform, browser and OS family recorded
   * when the device was first seen. Enough to answer "which of these is my
   * phone", and nothing that identifies a device beyond this account.
   */
  listForUser(userId: string): StoredSessionSummary[] {
    const rows = this.db
      .prepare(
        `SELECT s.token, s.sessionType, s.createdAt, s.lastSeenAt, s.expiresAt,
                i.platform, i.deviceClass, i.browserFamily, i.osFamily
           FROM sessions s
           LEFT JOIN account_installations i ON i.installationId = s.installationId
          WHERE s.userId = ? AND s.revokedAt IS NULL AND s.expiresAt > ?
          ORDER BY s.lastSeenAt DESC, s.createdAt DESC`,
      )
      .all(userId, Date.now()) as Row[];

    return rows.map((row) => ({
      id: String(row['token']),
      sessionType: String(row['sessionType']),
      createdAt: row['createdAt'] == null ? null : String(row['createdAt']),
      lastSeenAt: row['lastSeenAt'] == null ? null : String(row['lastSeenAt']),
      expiresAt: Number(row['expiresAt']),
      platform: row['platform'] == null ? null : String(row['platform']),
      deviceClass: row['deviceClass'] == null ? null : String(row['deviceClass']),
      browserFamily: row['browserFamily'] == null ? null : String(row['browserFamily']),
      osFamily: row['osFamily'] == null ? null : String(row['osFamily']),
    }));
  }

  /**
   * Revoke one session of this account.
   *
   * Scoped by user id in the WHERE clause rather than checked afterwards, so
   * an id belonging to somebody else matches nothing instead of matching and
   * then being refused.
   */
  revokeById(userId: string, id: string): RevokedSession | null {
    const row = this.db
      .prepare(
        `SELECT installationId, sessionType FROM sessions
          WHERE token = ? AND userId = ? AND revokedAt IS NULL`,
      )
      .get(id, userId) as Row | undefined;
    if (!row) return null;

    this.db
      .prepare('UPDATE sessions SET revokedAt = ? WHERE token = ? AND userId = ?')
      .run(new Date().toISOString(), id, userId);

    return {
      installationId: row['installationId'] == null ? null : String(row['installationId']),
      sessionType: String(row['sessionType']),
    };
  }

  /** Everything except the session making the request. "Sign out everywhere else". */
  revokeOthersForUser(userId: string, exceptToken: string): RevokedSession[] {
    const keep = hashSessionToken(exceptToken);
    const rows = this.db
      .prepare(
        `SELECT installationId, sessionType FROM sessions
          WHERE userId = ? AND token <> ? AND revokedAt IS NULL`,
      )
      .all(userId, keep) as Row[];

    this.db
      .prepare('UPDATE sessions SET revokedAt = ? WHERE userId = ? AND token <> ? AND revokedAt IS NULL')
      .run(new Date().toISOString(), userId, keep);

    return rows.map((row) => ({
      installationId: row['installationId'] == null ? null : String(row['installationId']),
      sessionType: String(row['sessionType']),
    }));
  }


  set(token: string, session: StoredSession): this {
    const now = new Date().toISOString();
    const hashed = hashSessionToken(token);
    this.db
      .prepare(
        `INSERT INTO sessions (token, userId, installationId, sessionType, createdAt, lastSeenAt, expiresAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(token) DO UPDATE SET expiresAt = excluded.expiresAt,
                                          lastSeenAt = excluded.lastSeenAt`,
      )
      .run(
        hashed,
        session.userId,
        session.installationId ?? null,
        session.sessionType ?? 'REGISTERED_TEMPORARY',
        now,
        now,
        Date.now() + SESSION_TTL_MS,
      );
    return this;
  }

  /**
   * Ending a session revokes it rather than forgetting it.
   *
   * A revoked row is what makes "sign out everywhere" answerable later, and it
   * is why presenting an old token is distinguishable from presenting one that
   * never existed.
   */
  revoke(token: string): void {
    const at = new Date().toISOString();
    const hashed = hashSessionToken(token);
    this.db
      .prepare('UPDATE sessions SET revokedAt = ? WHERE token = ? AND revokedAt IS NULL')
      .run(at, hashed);
    /* Legacy rows stored the cookie itself. */
    this.db
      .prepare('UPDATE sessions SET revokedAt = ? WHERE token = ? AND revokedAt IS NULL')
      .run(at, token);
  }

  /** Everything this account has open: used when an account is retired. */
  revokeForUser(userId: string): void {
    this.db
      .prepare('UPDATE sessions SET revokedAt = ? WHERE userId = ? AND revokedAt IS NULL')
      .run(new Date().toISOString(), userId);
  }

  /** Everything this browser established, whether or not it is signed in. */
  revokeForInstallation(installationId: string): void {
    this.db
      .prepare('UPDATE sessions SET revokedAt = ? WHERE installationId = ? AND revokedAt IS NULL')
      .run(new Date().toISOString(), installationId);
  }

  delete(token: string): boolean {
    const hashed = hashSessionToken(token);
    const byHash = this.db.prepare('DELETE FROM sessions WHERE token = ?').run(hashed).changes > 0;
    const byRaw = this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token).changes > 0;
    return byHash || byRaw;
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
   * One person's reflections.
   *
   * `idx_conversations_user` has always existed; the list route simply did not
   * ask in a way that could use it, reading every row in the file and then
   * discarding everybody else's in JavaScript. On a shared database that is
   * the whole product's writing materialised to answer one person's page.
   */
  byUser(userId: string): StoredConversation[] {
    return this.db
      .prepare('SELECT * FROM conversations WHERE userId = ?')
      .all(userId)
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
  readonly installations: InstallationTable;
  readonly identities: IdentityTable;
  readonly passwordResets: PasswordResetTable;
  readonly sessions: SessionTable;
  readonly conversations: ConversationTable;
  readonly messages: MessageTable;
  readonly sections: SectionTable;

  constructor(location = ':memory:') {
    this.db = new DatabaseSync(location);
    migrate(this.db);
    this.accounts = new AccountTable(this.db);
    this.installations = new InstallationTable(this.db);
    this.identities = new IdentityTable(this.db);
    this.passwordResets = new PasswordResetTable(this.db);
    this.sessions = new SessionTable(this.db);
    this.conversations = new ConversationTable(this.db);
    this.messages = new MessageTable(this.db);
    this.sections = new SectionTable(this.db);
  }

  close(): void {
    this.db.close();
  }
}
