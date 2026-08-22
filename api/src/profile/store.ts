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
import { CHAT_FORMATS, type Preferences, normalisePreferences } from '@chat/shared';
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
  /*
   * When the picture last changed, or null when this person has never set one.
   *
   * The bytes deliberately live in their own table and are never part of a
   * profile read. A profile is read to render a name; an avatar is read to
   * render one image, on a URL a browser can cache. Keeping the blob out of
   * `SELECT * FROM profiles` means the common path stays a small row.
   *
   * This stamp is what makes that cache safe: it goes into the image URL, so a
   * replaced picture is a new URL rather than a stale one behind a long TTL.
   */
  avatarUpdatedAt: string | null;
};

/** The stored picture itself, read only by the route that serves it. */
export type StoredAvatar = {
  bytes: Uint8Array;
  contentType: AvatarContentType;
  updatedAt: string;
};

/*
 * No SVG. An avatar is shown on pages belonging to other people, and an SVG is
 * a document that can carry script, so it is not a picture format here.
 */
export const AVATAR_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type AvatarContentType = (typeof AVATAR_CONTENT_TYPES)[number];

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
  /**
   * Profiles whose handle or display name contains `query`.
   *
   * ── What this does and does not expose ────────────────────────────────────
   *
   * Every profile it can return is already readable by anyone at
   * `/profile/<handle>`, and its handle and display name are already printed
   * beside every reflection its owner has published. So this changes how
   * findable a public profile is, not whether it is public — a distinction
   * worth stating plainly, because "already public" is not the same as
   * "already easy to enumerate", and only the first is true before this.
   *
   * What keeps the second from becoming a directory dump lives at the route:
   * a minimum query length, a per-caller ceiling, and a small cap on results.
   * Somebody who has never opened a profile has no row here and cannot be
   * found at all.
   *
   * Empty for a query shorter than `MIN_SEARCH_LENGTH`: a one-letter search
   * is not a search, it is a page of the directory.
   */
  search(query: string, limit: number): StoredProfile[];
  /** True when some *other* account already holds this handle. */
  handleTaken(handle: string, exceptUserId: string): boolean;
  save(profile: StoredProfile): void;
  preferences(userId: string): Preferences;
  savePreferences(userId: string, preferences: Preferences, at: string): void;
  avatar(userId: string): StoredAvatar | null;
  setAvatar(userId: string, bytes: Uint8Array, contentType: AvatarContentType, at: string): void;
  clearAvatar(userId: string): void;
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

    CREATE TABLE IF NOT EXISTS profile_avatars (
      userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      bytes BLOB NOT NULL,
      contentType TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    /*
     * One row per person, holding a JSON document rather than a column per
     * preference. Preferences are a list that grows, every one of them is
     * optional and cosmetic, and normalisePreferences already treats any
     * missing or unknown field as a default — so a new preference is a shared
     * constant rather than a migration on a live table.
     */
    CREATE TABLE IF NOT EXISTS profile_preferences (
      userId TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      preferencesJson TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

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
    avatarUpdatedAt: row['avatarUpdatedAt'] == null ? null : String(row['avatarUpdatedAt']),
  };
}

/*
 * The stamp travels with the profile; the bytes never do. A LEFT JOIN keeps a
 * person with no picture a perfectly ordinary row rather than a missing one.
 */
const SELECT_PROFILE = `
  SELECT p.*, a.updatedAt AS avatarUpdatedAt
    FROM profiles p
    LEFT JOIN profile_avatars a ON a.userId = p.userId
`;

/** Below this a search is not a search; see `ProfileStore.search`. */
export const MIN_SEARCH_LENGTH = 2;

/**
 * How many matches are looked at before the best few are chosen.
 *
 * A ceiling on the read, not on the answer: the caller asks for ten and gets
 * ten, but a two-letter substring that matches half the table is examined this
 * far and no further.
 */
const SEARCH_SCAN_LIMIT = 200;

/**
 * The typed text, as a LIKE pattern that means only itself.
 *
 * `%` and `_` are wildcards to LIKE and letters to the person typing. Somebody
 * looking for `a_b` means those three characters, and without escaping they
 * would match `aab` and every other three-letter run — a search that quietly
 * answers a different question than the one asked.
 */
function likeFragment(needle: string): string {
  return needle.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * How well a profile answers the query, lowest first.
 *
 * An exact handle is what somebody typing a handle wanted. A handle that
 * starts with it comes next, then a name that starts with it, then everything
 * that merely contains it — which is the order the matches stop being about
 * what was typed and start being coincidence.
 */
function searchRank(profile: StoredProfile, needle: string): number {
  const handle = profile.handle.toLowerCase();
  const name = profile.displayName.toLowerCase();
  if (handle === needle) return 0;
  if (handle.startsWith(needle)) return 1;
  if (name.startsWith(needle)) return 2;
  return 3;
}

/** Rank, then the shortest handle, then alphabetical — so the order is stable. */
function bySearchRank(needle: string) {
  return (a: StoredProfile, b: StoredProfile): number =>
    searchRank(a, needle) - searchRank(b, needle) ||
    a.handle.length - b.handle.length ||
    a.handle.localeCompare(b.handle);
}

class SqliteProfileStore implements ProfileStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    migrate(db);
  }

  byUserId(userId: string): StoredProfile | null {
    const row = this.db.prepare(`${SELECT_PROFILE} WHERE p.userId = ?`).get(userId) as
      | Row
      | undefined;
    return row ? profileFromRow(row) : null;
  }

  byHandle(handle: string): StoredProfile | null {
    const row = this.db
      .prepare(`${SELECT_PROFILE} WHERE lower(p.handle) = ?`)
      .get(normaliseHandle(handle)) as Row | undefined;
    return row ? profileFromRow(row) : null;
  }

  search(query: string, limit: number): StoredProfile[] {
    const needle = query.trim().toLowerCase();
    if (needle.length < MIN_SEARCH_LENGTH || limit < 1) return [];
    const pattern = `%${likeFragment(needle)}%`;
    /*
     * Two limits, and they are not the same limit.
     *
     * SQL takes a bounded window of candidates — that is what stops a common
     * substring reading the whole table — and the ranking happens after, in
     * one function the memory store uses too. Ranking in a CASE expression
     * instead would put the same intent in two places, and applying the
     * caller's small limit in SQL would be wrong outright: it would cut
     * candidates before anything had judged them, so an exact handle match
     * could be dropped in favour of a coincidence with a shorter handle.
     *
     * The honest consequence: past SEARCH_SCAN_LIMIT matches the ranking sees
     * a window rather than the field, so a very common substring gives good
     * answers but not provably the best ones. A search for two letters was
     * never going to be precise, and the alternative is an unbounded read.
     */
    const rows = this.db
      .prepare(
        `${SELECT_PROFILE}
          WHERE lower(p.handle) LIKE ? ESCAPE '\\'
             OR lower(p.displayName) LIKE ? ESCAPE '\\'
          ORDER BY length(p.handle), lower(p.handle)
          LIMIT ?`,
      )
      .all(pattern, pattern, SEARCH_SCAN_LIMIT) as Row[];
    return rows.map(profileFromRow).sort(bySearchRank(needle)).slice(0, limit);
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


  preferences(userId: string): Preferences {
    const row = this.db
      .prepare('SELECT preferencesJson FROM profile_preferences WHERE userId = ?')
      .get(userId) as Row | undefined;
    if (!row) return normalisePreferences(undefined);
    try {
      return normalisePreferences(JSON.parse(String(row['preferencesJson'])));
    } catch {
      /* A malformed row is somebody with default settings, never a 500. */
      return normalisePreferences(undefined);
    }
  }

  savePreferences(userId: string, preferences: Preferences, at: string): void {
    this.db
      .prepare(
        `INSERT INTO profile_preferences (userId, preferencesJson, updatedAt)
         VALUES (?, ?, ?)
         ON CONFLICT(userId) DO UPDATE SET
           preferencesJson = excluded.preferencesJson,
           updatedAt = excluded.updatedAt`,
      )
      .run(userId, JSON.stringify(preferences), at);
  }

  avatar(userId: string): StoredAvatar | null {
    const row = this.db.prepare('SELECT * FROM profile_avatars WHERE userId = ?').get(userId) as
      | Row
      | undefined;
    if (!row) return null;
    return {
      bytes: new Uint8Array(row['bytes'] as Uint8Array),
      contentType: String(row['contentType']) as AvatarContentType,
      updatedAt: String(row['updatedAt']),
    };
  }

  setAvatar(userId: string, bytes: Uint8Array, contentType: AvatarContentType, at: string): void {
    this.db
      .prepare(
        `INSERT INTO profile_avatars (userId, bytes, contentType, updatedAt)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(userId) DO UPDATE SET
           bytes = excluded.bytes,
           contentType = excluded.contentType,
           updatedAt = excluded.updatedAt`,
      )
      .run(userId, Buffer.from(bytes), contentType, at);
  }

  clearAvatar(userId: string): void {
    this.db.prepare('DELETE FROM profile_avatars WHERE userId = ?').run(userId);
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
  /* A profile shows an account's shared reflections, and an account reaches
   * them through the owner it holds. */
  owners: { forUser(userId: string): { id: string } | undefined };
};

class MemoryProfileStore implements ProfileStore {
  private readonly profiles = new Map<string, StoredProfile>();
  private readonly reports: ProfileReport[] = [];
  private readonly blocks = new Set<string>();
  private readonly avatars = new Map<string, StoredAvatar>();
  private readonly prefs = new Map<string, Preferences>();
  private readonly source: ConversationSource;

  constructor(source: ConversationSource) {
    this.source = source;
  }

  byUserId(userId: string): StoredProfile | null {
    const found = this.profiles.get(userId);
    return found ? this.stamped(found) : null;
  }

  byHandle(handle: string): StoredProfile | null {
    const wanted = normaliseHandle(handle);
    for (const profile of this.profiles.values()) {
      if (normaliseHandle(profile.handle) === wanted) return this.stamped(profile);
    }
    return null;
  }

  /*
   * The stamp is derived from the picture rather than stored beside it, for
   * the same reason the SQLite implementation joins for it: one fact, one
   * home. Setting a picture cannot then leave a profile claiming it has none.
   */
  private stamped(profile: StoredProfile): StoredProfile {
    return { ...profile, avatarUpdatedAt: this.avatars.get(profile.userId)?.updatedAt ?? null };
  }

  search(query: string, limit: number): StoredProfile[] {
    const needle = query.trim().toLowerCase();
    if (needle.length < MIN_SEARCH_LENGTH || limit < 1) return [];
    return [...this.profiles.values()]
      .filter(
        (profile) =>
          profile.handle.toLowerCase().includes(needle) ||
          profile.displayName.toLowerCase().includes(needle),
      )
      .sort(bySearchRank(needle))
      .slice(0, limit)
      .map((profile) => this.stamped(profile));
  }

  handleTaken(handle: string, exceptUserId: string): boolean {
    const found = this.byHandle(handle);
    return found !== null && found.userId !== exceptUserId;
  }

  save(profile: StoredProfile): void {
    this.profiles.set(profile.userId, { ...profile });
  }


  preferences(userId: string): Preferences {
    return normalisePreferences(this.prefs.get(userId));
  }

  savePreferences(userId: string, preferences: Preferences): void {
    this.prefs.set(userId, { ...preferences });
  }

  avatar(userId: string): StoredAvatar | null {
    const found = this.avatars.get(userId);
    return found ? { ...found, bytes: new Uint8Array(found.bytes) } : null;
  }

  setAvatar(userId: string, bytes: Uint8Array, contentType: AvatarContentType, at: string): void {
    this.avatars.set(userId, { bytes: new Uint8Array(bytes), contentType, updatedAt: at });
  }

  clearAvatar(userId: string): void {
    this.avatars.delete(userId);
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
    return this.blocks.has(`${blockerUserId}\u0000${blockedUserId}`);
  }

  setBlocked(blockerUserId: string, blockedUserId: string, blocked: boolean): void {
    const key = `${blockerUserId}\u0000${blockedUserId}`;
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
