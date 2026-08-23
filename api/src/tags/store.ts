import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { TAG_SUGGEST_LIMIT, type TagCandidate } from '@chat/shared';

/*
 * The tag registry: one canonical row per tag, and who has used it.
 *
 * ── What makes this more than a table of strings ────────────────────────────
 *
 * Tags were per-record strings. `publication_tags` held one row per
 * publication, `conversations.tags` held a JSON array, and neither knew that
 * the word already existed somewhere else. So nothing could suggest a tag,
 * nothing could count one, and two people writing about the same thing had no
 * way of arriving at the same word.
 *
 * ── The rule that shapes every query here ───────────────────────────────────
 *
 * **A count is a fact about people.** `hashtagsFor` in the community store
 * already says it: "a filter chip is a count with a name on it, and counts
 * leak." A registry built from everything anybody typed would take a word used
 * once, privately, by one person and offer it to strangers — and a suggestion
 * list is a slower way of publishing a private vocabulary, not a different one.
 *
 * So there are two counts and they are not the same number:
 *
 *   - `publicCount` — uses on content its author actually published. This is
 *     the only count that ranks a tag for somebody who has not used it, and
 *     the only reason a tag is offered to a stranger at all.
 *   - `user_tag_usage.usageCount` — one person's own use, private ones
 *     included. It ranks that tag for **that person only**, and is never read
 *     on anybody else's behalf.
 *
 * A tag typed only in private reflections is therefore in the registry, is
 * suggested back to its own author forever, and is invisible to everyone else
 * until the day its author shares something carrying it.
 *
 * ── Statuses ────────────────────────────────────────────────────────────────
 *
 * `active` is suggestable. `hidden` and `blocked` are not, and `blocked` also
 * refuses new use — an administrator can retire a tag without deleting the rows
 * that reference it, because destroying content relationships to moderate a
 * word is not a repair. `merged` carries `mergedIntoId` and exists for a
 * consolidation this version does not perform.
 *
 * ── Two implementations ─────────────────────────────────────────────────────
 *
 * SQLite is the real one; memory exists so `createApp(new MemoryStore())` keeps
 * working, as Notes does. Behaviour tests run against SQLite, because a ranking
 * that only holds in the lenient backing is not a ranking.
 */

/* ------------------------------------------------------------------- types */

export const TAG_STATUS = {
  ACTIVE: 'active',
  HIDDEN: 'hidden',
  BLOCKED: 'blocked',
  MERGED: 'merged',
} as const;

export type TagStatus = (typeof TAG_STATUS)[keyof typeof TAG_STATUS];

export type RegistryTag = {
  id: string;
  normalizedName: string;
  displayName: string;
  publicCount: number;
  status: TagStatus;
  createdAt: string;
  lastUsedAt: string;
};

/** A suggestion, as it crosses the wire. Counts stay on the server. */
export type TagSuggestion = { tag: string; label: string };

export type RecordInput = {
  userId: string;
  tags: readonly TagCandidate[];
  /**
   * Whether the content carrying these tags is published.
   *
   * The single input that decides whether a tag becomes visible to strangers,
   * so it is a required argument rather than an option with a default. A
   * default here would be a privacy decision made by whoever forgot to pass it.
   */
  published: boolean;
};

export interface TagRegistry {
  /** Register use of already-validated tags. Blocked tags are ignored. */
  record(input: RecordInput): void;
  suggest(input: { userId: string | null; query: string; limit?: number }): TagSuggestion[];
  /** Administrative. Not reachable over HTTP in this version. */
  setStatus(normalizedName: string, status: TagStatus): void;
  get(normalizedName: string): RegistryTag | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

/* ----------------------------------------------------------------- ranking */

/**
 * How a candidate is scored, in one place, for both backings.
 *
 * Deterministic and small on purpose. Every term is a fact somebody could check
 * against the database by hand, which is what "understandable ranking" has to
 * mean if a suggestion ever looks wrong.
 *
 * The user's own tags outrank global popularity by design: `USED_BY_USER`
 * alone exceeds anything `publicCount` can contribute, because a word this
 * person has already chosen is nearly always the word they are typing again.
 */
const SCORE = {
  EXACT: 10_000,
  PREFIX: 1_000,
  USED_BY_USER: 500,
  /** Their own uses, capped so a single much-used tag cannot own the list. */
  PER_USER_USE: 10,
  USER_USE_CAP: 20,
  /** Global uses, capped for the same reason and weighted below personal use. */
  PER_PUBLIC_USE: 1,
  PUBLIC_USE_CAP: 200,
} as const;

export type Scorable = {
  normalizedName: string;
  displayName: string;
  publicCount: number;
  userUsage: number;
  lastUsedAt: string;
};

export function scoreTag(candidate: Scorable, query: string): number {
  let score = 0;
  if (candidate.normalizedName === query) score += SCORE.EXACT;
  else if (candidate.normalizedName.startsWith(query)) score += SCORE.PREFIX;
  if (candidate.userUsage > 0) {
    score += SCORE.USED_BY_USER;
    score += Math.min(candidate.userUsage, SCORE.USER_USE_CAP) * SCORE.PER_USER_USE;
  }
  score += Math.min(candidate.publicCount, SCORE.PUBLIC_USE_CAP) * SCORE.PER_PUBLIC_USE;
  return score;
}

/** Score first, then most recently used, then alphabetical so it is stable. */
export function rankTags(
  candidates: readonly Scorable[],
  query: string,
  limit: number,
): TagSuggestion[] {
  return [...candidates]
    .sort((a, b) => {
      const byScore = scoreTag(b, query) - scoreTag(a, query);
      if (byScore !== 0) return byScore;
      const byRecency = b.lastUsedAt.localeCompare(a.lastUsedAt);
      if (byRecency !== 0) return byRecency;
      return a.normalizedName.localeCompare(b.normalizedName);
    })
    .slice(0, limit)
    .map((candidate) => ({ tag: candidate.normalizedName, label: candidate.displayName }));
}

/**
 * The server's own ceiling on how many suggestions it will return.
 *
 * A client asking for five hundred gets five. The limit is not a client's to
 * choose, it is a property of the interface it feeds.
 */
export function boundedLimit(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested) || requested < 1) return TAG_SUGGEST_LIMIT;
  return Math.min(Math.floor(requested), TAG_SUGGEST_LIMIT);
}

/* ------------------------------------------------------------------ sqlite */

function migrate(db: DatabaseSync): void {
  db.exec(`
    /*
     * One row per canonical tag.
     *
     * The UNIQUE on normalizedName is the concurrency guarantee, not a hint:
     * two requests inserting the same new tag at the same moment cannot both
     * succeed, so the registry cannot acquire two rows for one word. The
     * application-side lookup is an optimisation on top of it, never the rule.
     */
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      normalizedName TEXT NOT NULL UNIQUE,
      displayName TEXT NOT NULL,
      publicCount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      mergedIntoId TEXT,
      createdAt TEXT NOT NULL,
      lastUsedAt TEXT NOT NULL
    );

    /*
     * The suggestion query's index. normalizedName is already folded and
     * lowercase, so a prefix is a range scan over this index rather than a
     * scan of the table.
     */
    CREATE INDEX IF NOT EXISTS idx_tags_suggest
      ON tags (status, normalizedName);

    CREATE INDEX IF NOT EXISTS idx_tags_popular
      ON tags (status, publicCount DESC);

    /* One row per person per tag. Read only ever on that person's behalf. */
    CREATE TABLE IF NOT EXISTS user_tag_usage (
      userId TEXT NOT NULL,
      tagId TEXT NOT NULL,
      usageCount INTEGER NOT NULL DEFAULT 0,
      lastUsedAt TEXT NOT NULL,
      PRIMARY KEY (userId, tagId)
    );

    CREATE INDEX IF NOT EXISTS idx_user_tag_recent
      ON user_tag_usage (userId, lastUsedAt DESC);
  `);
}

type Row = Record<string, unknown>;

function tagFromRow(row: Row): RegistryTag {
  return {
    id: String(row['id']),
    normalizedName: String(row['normalizedName']),
    displayName: String(row['displayName']),
    publicCount: Number(row['publicCount'] ?? 0),
    status: String(row['status'] ?? TAG_STATUS.ACTIVE) as TagStatus,
    createdAt: String(row['createdAt'] ?? ''),
    lastUsedAt: String(row['lastUsedAt'] ?? ''),
  };
}

/**
 * The end of a prefix range.
 *
 * `pray` matches everything from `pray` up to but not including `praz`, which
 * is a range the index can walk. LIKE would express the same thing and would
 * not always use the index; this is that query without depending on it.
 */
function prefixEnd(query: string): string {
  const codePoints = [...query];
  const last = codePoints.pop();
  if (last === undefined) return '';
  const next = last.codePointAt(0);
  if (next === undefined) return '';
  return [...codePoints, String.fromCodePoint(next + 1)].join('');
}

class SqliteTagRegistry implements TagRegistry {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    migrate(db);
  }

  record(input: RecordInput): void {
    if (input.tags.length === 0) return;
    const at = nowIso();
    this.db.exec('BEGIN');
    try {
      for (const candidate of input.tags) {
        /*
         * Upsert on the unique key. Whichever request gets there first creates
         * the row; the other updates it. Neither has to look first, and no
         * interleaving of the two produces a duplicate.
         *
         * displayName is set on insert only. The first person to use a word
         * decides how it is written; letting every later use overwrite it would
         * make one shared label flicker between spellings.
         */
        this.db
          .prepare(
            `INSERT INTO tags (id, normalizedName, displayName, publicCount, status, createdAt, lastUsedAt)
             VALUES ($id, $name, $label, 0, $active, $at, $at)
             ON CONFLICT(normalizedName) DO UPDATE SET lastUsedAt = $at`,
          )
          .run({
            id: randomUUID(),
            name: candidate.tag,
            label: candidate.label,
            active: TAG_STATUS.ACTIVE,
            at,
          });

        const row = this.db
          .prepare('SELECT id, status FROM tags WHERE normalizedName = ?')
          .get(candidate.tag) as Row | undefined;
        if (!row) continue;
        /* A blocked tag records nothing: not a count, not a use, not a rank. */
        if (String(row['status']) === TAG_STATUS.BLOCKED) continue;
        const tagId = String(row['id']);

        if (input.published) {
          this.db.prepare('UPDATE tags SET publicCount = publicCount + 1 WHERE id = ?').run(tagId);
        }

        this.db
          .prepare(
            `INSERT INTO user_tag_usage (userId, tagId, usageCount, lastUsedAt)
             VALUES ($user, $tag, 1, $at)
             ON CONFLICT(userId, tagId)
             DO UPDATE SET usageCount = usageCount + 1, lastUsedAt = $at`,
          )
          .run({ user: input.userId, tag: tagId, at });
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  suggest(input: { userId: string | null; query: string; limit?: number }): TagSuggestion[] {
    const query = input.query;
    if (!query) return [];
    const limit = boundedLimit(input.limit);
    const candidates = new Map<string, Scorable>();

    /*
     * This person's own matching tags, private ones included. Read with their
     * id in the WHERE — there is no query in this file that reads one person's
     * usage on behalf of another.
     */
    if (input.userId) {
      const rows = this.db
        .prepare(
          `SELECT t.normalizedName AS normalizedName, t.displayName AS displayName,
                  t.publicCount AS publicCount, u.usageCount AS userUsage,
                  u.lastUsedAt AS lastUsedAt
             FROM user_tag_usage AS u
             JOIN tags AS t ON t.id = u.tagId
            WHERE u.userId = $user
              AND t.status = $active
              AND t.normalizedName >= $from AND t.normalizedName < $to
            ORDER BY u.usageCount DESC
            LIMIT 20`,
        )
        .all({
          user: input.userId,
          active: TAG_STATUS.ACTIVE,
          from: query,
          to: prefixEnd(query),
        }) as unknown as Row[];
      for (const row of rows) {
        candidates.set(String(row['normalizedName']), {
          normalizedName: String(row['normalizedName']),
          displayName: String(row['displayName']),
          publicCount: Number(row['publicCount'] ?? 0),
          userUsage: Number(row['userUsage'] ?? 0),
          lastUsedAt: String(row['lastUsedAt'] ?? ''),
        });
      }
    }

    /*
     * Everyone else's, and only what has actually been published. `publicCount
     * > 0` is the privacy rule expressed as a WHERE clause: a tag nobody has
     * shared has no global standing and is not offered to a stranger.
     */
    const globalRows = this.db
      .prepare(
        `SELECT normalizedName, displayName, publicCount, lastUsedAt
           FROM tags
          WHERE status = $active
            AND publicCount > 0
            AND normalizedName >= $from AND normalizedName < $to
          ORDER BY publicCount DESC
          LIMIT 20`,
      )
      .all({ active: TAG_STATUS.ACTIVE, from: query, to: prefixEnd(query) }) as unknown as Row[];
    for (const row of globalRows) {
      const name = String(row['normalizedName']);
      if (candidates.has(name)) continue;
      candidates.set(name, {
        normalizedName: name,
        displayName: String(row['displayName']),
        publicCount: Number(row['publicCount'] ?? 0),
        userUsage: 0,
        lastUsedAt: String(row['lastUsedAt'] ?? ''),
      });
    }

    return rankTags([...candidates.values()], query, limit);
  }

  setStatus(normalizedName: string, status: TagStatus): void {
    this.db
      .prepare('UPDATE tags SET status = ? WHERE normalizedName = ?')
      .run(status, normalizedName);
  }

  get(normalizedName: string): RegistryTag | null {
    const row = this.db.prepare('SELECT * FROM tags WHERE normalizedName = ?').get(normalizedName) as
      | Row
      | undefined;
    return row ? tagFromRow(row) : null;
  }
}

/* ------------------------------------------------------------------ memory */

type MemoryState = {
  tags: Map<string, RegistryTag>;
  usage: Map<string, { usageCount: number; lastUsedAt: string }>;
};

const MEMORY = new WeakMap<object, MemoryState>();

function stateFor(key: object): MemoryState {
  const found = MEMORY.get(key);
  if (found) return found;
  const fresh: MemoryState = { tags: new Map(), usage: new Map() };
  MEMORY.set(key, fresh);
  return fresh;
}

class MemoryTagRegistry implements TagRegistry {
  private readonly state: MemoryState;

  constructor(key: object) {
    this.state = stateFor(key);
  }

  record(input: RecordInput): void {
    const at = nowIso();
    for (const candidate of input.tags) {
      let tag = this.state.tags.get(candidate.tag);
      if (!tag) {
        tag = {
          id: randomUUID(),
          normalizedName: candidate.tag,
          displayName: candidate.label,
          publicCount: 0,
          status: TAG_STATUS.ACTIVE,
          createdAt: at,
          lastUsedAt: at,
        };
        this.state.tags.set(candidate.tag, tag);
      }
      tag.lastUsedAt = at;
      if (tag.status === TAG_STATUS.BLOCKED) continue;
      if (input.published) tag.publicCount += 1;
      const key = `${input.userId} ${tag.id}`;
      const usage = this.state.usage.get(key) ?? { usageCount: 0, lastUsedAt: at };
      usage.usageCount += 1;
      usage.lastUsedAt = at;
      this.state.usage.set(key, usage);
    }
  }

  suggest(input: { userId: string | null; query: string; limit?: number }): TagSuggestion[] {
    const query = input.query;
    if (!query) return [];
    const limit = boundedLimit(input.limit);
    const candidates: Scorable[] = [];
    for (const tag of this.state.tags.values()) {
      if (tag.status !== TAG_STATUS.ACTIVE) continue;
      if (!tag.normalizedName.startsWith(query)) continue;
      const usage = input.userId ? this.state.usage.get(`${input.userId} ${tag.id}`) : undefined;
      /* The same privacy rule as the SQL: unpublished and not yours is unseen. */
      if (!usage && tag.publicCount === 0) continue;
      candidates.push({
        normalizedName: tag.normalizedName,
        displayName: tag.displayName,
        publicCount: tag.publicCount,
        userUsage: usage?.usageCount ?? 0,
        lastUsedAt: usage?.lastUsedAt ?? tag.lastUsedAt,
      });
    }
    return rankTags(candidates, query, limit);
  }

  setStatus(normalizedName: string, status: TagStatus): void {
    const tag = this.state.tags.get(normalizedName);
    if (tag) tag.status = status;
  }

  get(normalizedName: string): RegistryTag | null {
    return this.state.tags.get(normalizedName) ?? null;
  }
}

/** SQLite when the store has a database handle; memory otherwise. */
export function createTagRegistry(store: unknown): TagRegistry {
  const handle = (store as { db?: DatabaseSync }).db;
  if (handle && typeof handle.prepare === 'function') {
    return new SqliteTagRegistry(handle);
  }
  return new MemoryTagRegistry(store as object);
}
