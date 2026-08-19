/*
 * Public profiles, and the one query that decides what a stranger may see.
 *
 * ── Why this owns its storage ───────────────────────────────────────────────
 *
 * Same reasoning as the Bible connector's passage store: the tables, the
 * migration and the queries live in this directory, so the feature is one
 * directory to read and one set of tables to drop, and adding it does not mean
 * editing a schema file another piece of work is in the middle of.
 *
 * ── The rule this file exists to enforce ────────────────────────────────────
 *
 * A public profile is a public surface listing a private person's work, so the
 * dangerous shape is obvious: read everything the author has, hand it over, and
 * let the page show the shared ones. That leaks through titles, excerpts and
 * counts long before anyone notices the rendering is doing the filtering.
 *
 * So **`visibility = 'shared'` is in the WHERE clause of every query
 * here.** Not in a `.filter()` after the read, not in the route, and certainly
 * not in the browser. The SQLite implementation never selects a private row at
 * all; the in-memory implementation, which exists only so the test suite can
 * run against `MemoryStore`, applies the same predicate at the point of
 * retrieval rather than downstream of it. Counts come from the same predicate,
 * because a count is the channel that leaks after everything else is secured.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { CHAT_FORMATS } from '@chat/shared';
import type { StoredConversation, StoredSection } from '../store.ts';
import { normaliseHandle } from './limits.ts';

export type StoredProfile = {
  userId: string;
  handle: string;
  displayName: string;
  tagline: string;
  favouriteVerses: string[];
  createdAt: string;
  updatedAt: string;
};

/**
 * One shared reflection, as a stranger may see it.
 *
 * Note what is absent: no `userId`, no publication state (everything here is
 * public by construction), no message content, no private counts. `sections`
 * is the list of section *names* that carry writing, which is what the C/H/A/T
 * markers need; it is not the writing itself beyond the single excerpt.
 */
export type PublicShare = {
  id: string;
  format: string;
  title: string;
  scriptureReference: string | null;
  updatedAt: string;
  sections: string[];
  excerpt: string;
};

export type ProfileReport = {
  id: string;
  reporterUserId: string;
  subjectUserId: string;
  reason: string;
  detail: string;
  createdAt: string;
};

export interface ProfileStore {
  byUserId(userId: string): StoredProfile | null;
  byHandle(handle: string): StoredProfile | null;
  /** True when some *other* account already holds this handle. */
  handleTaken(handle: string, exceptUserId: string): boolean;
  save(profile: StoredProfile): void;
  /** Only shared reflections. The predicate is applied during retrieval. */
  publicShares(userId: string): PublicShare[];
  /** The same predicate, so the count can never disagree with the list. */
  publicShareCount(userId: string): number;
  addReport(report: Omit<ProfileReport, 'id' | 'createdAt'>): ProfileReport;
  reportsAgainst(subjectUserId: string): ProfileReport[];
  isBlocked(blockerUserId: string, blockedUserId: string): boolean;
  setBlocked(blockerUserId: string, blockedUserId: string, blocked: boolean): void;
}

/* ------------------------------------------------------------------ shared */

const SHARED = 'shared';

/** Section order for an excerpt, per format. */
const EXCERPT_ORDER: Record<string, readonly string[]> = {
  [CHAT_FORMATS.CONDENSED]: ['reflection', 'verse'],
  [CHAT_FORMATS.FULL]: ['content', 'heart', 'application', 'testimony'],
};

const EXCERPT_LENGTH = 240;

function excerptFrom(format: string, sections: Record<string, string>): string {
  const order = EXCERPT_ORDER[format] ?? EXCERPT_ORDER[CHAT_FORMATS.FULL] ?? [];
  for (const type of order) {
    const text = (sections[type] ?? '').trim();
    if (text.length > 0) {
      return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH).trimEnd()}…` : text;
    }
  }
  return '';
}

function writtenSections(format: string, sections: Record<string, string>): string[] {
  const order = EXCERPT_ORDER[format] ?? EXCERPT_ORDER[CHAT_FORMATS.FULL] ?? [];
  return order.filter((type) => (sections[type] ?? '').trim().length > 0);
}

function shareFrom(
  conversation: Pick<
    StoredConversation,
    'id' | 'format' | 'title' | 'scriptureReference' | 'updatedAt'
  >,
  sections: Record<string, string>,
): PublicShare {
  return {
    id: conversation.id,
    format: conversation.format,
    title: conversation.title,
    scriptureReference: conversation.scriptureReference,
    updatedAt: conversation.updatedAt,
    sections: writtenSections(conversation.format, sections),
    excerpt: excerptFrom(conversation.format, sections),
  };
}

function newestFirst(a: PublicShare, b: PublicShare): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

/* ------------------------------------------------------------------ sqlite */

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      handle TEXT NOT NULL,
      displayName TEXT NOT NULL,
      tagline TEXT NOT NULL DEFAULT '',
      favouriteVerses TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    /*
     * Uniqueness is on the folded handle, not the typed one, so @Cris cannot
     * be registered alongside @cris and read as the same person.
     */
    CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle
      ON profiles(lower(handle));

    CREATE TABLE IF NOT EXISTS profile_reports (
      id TEXT PRIMARY KEY,
      reporterUserId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subjectUserId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profile_blocks (
      blockerUserId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blockedUserId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      createdAt TEXT NOT NULL,
      PRIMARY KEY (blockerUserId, blockedUserId)
    );
  `);
}

type Row = Record<string, unknown>;

function profileFromRow(row: Row): StoredProfile {
  let verses: string[] = [];
  try {
    const parsed: unknown = JSON.parse(String(row['favouriteVerses'] ?? '[]'));
    if (Array.isArray(parsed)) verses = parsed.map((value) => String(value));
  } catch {
    /* A malformed row is a profile with no favourite verses, never a 500. */
  }
  return {
    userId: String(row['userId']),
    handle: String(row['handle']),
    displayName: String(row['displayName']),
    tagline: String(row['tagline'] ?? ''),
    favouriteVerses: verses,
    createdAt: String(row['createdAt']),
    updatedAt: String(row['updatedAt']),
  };
}

class SqliteProfileStore implements ProfileStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    migrate(db);
  }

  byUserId(userId: string): StoredProfile | null {
    const row = this.db.prepare('SELECT * FROM profiles WHERE userId = ?').get(userId) as
      | Row
      | undefined;
    return row ? profileFromRow(row) : null;
  }

  byHandle(handle: string): StoredProfile | null {
    const row = this.db
      .prepare('SELECT * FROM profiles WHERE lower(handle) = ?')
      .get(normaliseHandle(handle)) as Row | undefined;
    return row ? profileFromRow(row) : null;
  }

  handleTaken(handle: string, exceptUserId: string): boolean {
    const row = this.db
      .prepare('SELECT userId FROM profiles WHERE lower(handle) = ? AND userId <> ?')
      .get(normaliseHandle(handle), exceptUserId) as Row | undefined;
    return row !== undefined;
  }

  save(profile: StoredProfile): void {
    this.db
      .prepare(
        `INSERT INTO profiles
           (userId, handle, displayName, tagline, favouriteVerses, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(userId) DO UPDATE SET
           handle = excluded.handle,
           displayName = excluded.displayName,
           tagline = excluded.tagline,
           favouriteVerses = excluded.favouriteVerses,
           updatedAt = excluded.updatedAt`,
      )
      .run(
        profile.userId,
        profile.handle,
        profile.displayName,
        profile.tagline,
        JSON.stringify(profile.favouriteVerses),
        profile.createdAt,
        profile.updatedAt,
      );
  }

  /*
   * The authorisation query.
   *
   * Two statements, and `visibility = 'shared'` is in the WHERE of
   * both — including the one that reads section text, so a private
   * reflection's words are never loaded into this process at all, let alone
   * serialised towards a browser. The join on the second statement is what
   * makes that true: sections are reached *through* the shared conversation,
   * never listed independently and matched up afterwards.
   */
  publicShares(userId: string): PublicShare[] {
    const conversations = this.db
      .prepare(
        `SELECT id, format, title, scriptureReference, updatedAt
           FROM conversations
          WHERE userId = ? AND visibility = ?
          ORDER BY updatedAt DESC`,
      )
      .all(userId, SHARED) as unknown as Pick<
      StoredConversation,
      'id' | 'format' | 'title' | 'scriptureReference' | 'updatedAt'
    >[];
    if (conversations.length === 0) return [];

    const sectionRows = this.db
      .prepare(
        `SELECT s.conversationId AS conversationId, s.type AS type, s.content AS content
           FROM sections AS s
           JOIN conversations AS c ON c.id = s.conversationId
          WHERE c.userId = ? AND c.visibility = ?`,
      )
      .all(userId, SHARED) as unknown as {
      conversationId: string;
      type: string;
      content: string;
    }[];

    const byConversation = new Map<string, Record<string, string>>();
    for (const row of sectionRows) {
      const bucket = byConversation.get(row.conversationId) ?? {};
      bucket[row.type] = row.content;
      byConversation.set(row.conversationId, bucket);
    }

    return conversations
      .map((conversation) => shareFrom(conversation, byConversation.get(conversation.id) ?? {}))
      .sort(newestFirst);
  }

  publicShareCount(userId: string): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS n FROM conversations WHERE userId = ? AND visibility = ?',
      )
      .get(userId, SHARED) as Row | undefined;
    return Number(row?.['n'] ?? 0);
  }

  addReport(report: Omit<ProfileReport, 'id' | 'createdAt'>): ProfileReport {
    const stored: ProfileReport = {
      ...report,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO profile_reports
           (id, reporterUserId, subjectUserId, reason, detail, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        stored.id,
        stored.reporterUserId,
        stored.subjectUserId,
        stored.reason,
        stored.detail,
        stored.createdAt,
      );
    return stored;
  }

  reportsAgainst(subjectUserId: string): ProfileReport[] {
    return this.db
      .prepare('SELECT * FROM profile_reports WHERE subjectUserId = ? ORDER BY createdAt')
      .all(subjectUserId) as unknown as ProfileReport[];
  }

  isBlocked(blockerUserId: string, blockedUserId: string): boolean {
    const row = this.db
      .prepare(
        'SELECT 1 AS present FROM profile_blocks WHERE blockerUserId = ? AND blockedUserId = ?',
      )
      .get(blockerUserId, blockedUserId) as Row | undefined;
    return row !== undefined;
  }

  setBlocked(blockerUserId: string, blockedUserId: string, blocked: boolean): void {
    if (blocked) {
      this.db
        .prepare(
          `INSERT INTO profile_blocks (blockerUserId, blockedUserId, createdAt)
           VALUES (?, ?, ?)
           ON CONFLICT(blockerUserId, blockedUserId) DO NOTHING`,
        )
        .run(blockerUserId, blockedUserId, new Date().toISOString());
      return;
    }
    this.db
      .prepare('DELETE FROM profile_blocks WHERE blockerUserId = ? AND blockedUserId = ?')
      .run(blockerUserId, blockedUserId);
  }
}

/* ------------------------------------------------------------------ memory */

/**
 * The same store over `MemoryStore`, for the test suite.
 *
 * It reads `conversations` and `sections` from the surrounding store, and the
 * shared predicate is the *first* thing applied — before a title, an
 * excerpt or a section is touched — so this implementation cannot pass an
 * authorisation test that the SQLite one would fail, or the reverse.
 */
type ConversationSource = {
  conversations: { values(): Iterable<StoredConversation> };
  sections: { get(conversationId: string): Record<string, StoredSection> | undefined };
};

class MemoryProfileStore implements ProfileStore {
  private readonly profiles = new Map<string, StoredProfile>();
  private readonly reports: ProfileReport[] = [];
  private readonly blocks = new Set<string>();
  private readonly source: ConversationSource;

  constructor(source: ConversationSource) {
    this.source = source;
  }

  byUserId(userId: string): StoredProfile | null {
    return this.profiles.get(userId) ?? null;
  }

  byHandle(handle: string): StoredProfile | null {
    const wanted = normaliseHandle(handle);
    for (const profile of this.profiles.values()) {
      if (normaliseHandle(profile.handle) === wanted) return profile;
    }
    return null;
  }

  handleTaken(handle: string, exceptUserId: string): boolean {
    const found = this.byHandle(handle);
    return found !== null && found.userId !== exceptUserId;
  }

  save(profile: StoredProfile): void {
    this.profiles.set(profile.userId, { ...profile });
  }

  private shared(userId: string): StoredConversation[] {
    return [...this.source.conversations.values()].filter(
      (conversation) =>
        conversation.userId === userId && conversation.visibility === SHARED,
    );
  }

  publicShares(userId: string): PublicShare[] {
    return this.shared(userId)
      .map((conversation) => {
        const stored = this.source.sections.get(conversation.id) ?? {};
        const sections: Record<string, string> = {};
        for (const [type, section] of Object.entries(stored)) sections[type] = section.content;
        return shareFrom(conversation, sections);
      })
      .sort(newestFirst);
  }

  publicShareCount(userId: string): number {
    return this.shared(userId).length;
  }

  addReport(report: Omit<ProfileReport, 'id' | 'createdAt'>): ProfileReport {
    const stored: ProfileReport = {
      ...report,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.reports.push(stored);
    return stored;
  }

  reportsAgainst(subjectUserId: string): ProfileReport[] {
    return this.reports.filter((report) => report.subjectUserId === subjectUserId);
  }

  isBlocked(blockerUserId: string, blockedUserId: string): boolean {
    return this.blocks.has(`${blockerUserId} ${blockedUserId}`);
  }

  setBlocked(blockerUserId: string, blockedUserId: string, blocked: boolean): void {
    const key = `${blockerUserId} ${blockedUserId}`;
    if (blocked) this.blocks.add(key);
    else this.blocks.delete(key);
  }
}

/** SQLite when the store has a database handle; memory otherwise. */
export function createProfileStore(store: unknown): ProfileStore {
  const handle = (store as { db?: DatabaseSync }).db;
  if (handle && typeof handle.prepare === 'function') {
    return new SqliteProfileStore(handle);
  }
  return new MemoryProfileStore(store as ConversationSource);
}
