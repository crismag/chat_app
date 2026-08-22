/*
 * Community storage, and the queries that decide who may see what.
 *
 * ── Why this owns its tables ────────────────────────────────────────────────
 *
 * Same reasoning as the Bible connector and the profile module: the schema, the
 * migration and the queries live in this directory, so the feature is one
 * directory to read and one set of tables to drop, and adding it does not mean
 * editing a schema file another piece of work is in the middle of.
 *
 * ── The rule this file exists to enforce ────────────────────────────────────
 *
 * **Authorisation is applied before or during retrieval, never as a filter
 * afterwards.**
 *
 * The dangerous shape is the obvious one: select the publications, hand them to
 * a route, and let the route drop the ones the viewer may not see. That leaks
 * through whatever the route forgets — and the things it forgets are always the
 * same two, named in the specification because they are the channels that leak
 * after everything visible has been secured: **counts** and **AI answers**. A
 * count computed over all rows and printed beside a filtered list says "and
 * eleven more you may not see" in a single integer.
 *
 * So there is exactly one visibility predicate in this file — `VISIBLE_TO` — and
 * it is interpolated into the WHERE clause of **every** statement that touches
 * `publications`: the feed, the single fetch, the search, the tag facets, the
 * counts, and the reaction and save lookups that hang off them. Section text is
 * reached only *through* a publication that already passed it, by join, so an
 * unauthorised reflection's words are never loaded into this process at all.
 *
 * ── Why there is no in-memory implementation ────────────────────────────────
 *
 * The profile module carries two implementations of its store so the suite can
 * run against `MemoryStore`. That is a reasonable trade for a read-only public
 * surface; it is a bad one here. Two implementations of an authorisation
 * predicate is precisely the arrangement this repository has already been
 * burned by — `store.ts` records it: "the same call merged in one store and
 * replaced in the other, and the tests ran against the forgiving one." An
 * access check that passes its tests in the lenient backing and fails in the
 * real one is worse than no test.
 *
 * There is therefore one implementation, over SQLite, and the tests run against
 * it with `:memory:` — the same statements, the same predicate, a clean
 * database per test. Membership cannot live in a `Map` anyway: membership that
 * disappears on restart is not membership.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { ShareHistory, WindowCount } from './share-limits.ts';
import {
  COMMUNITY_ROLES,
  MEMBERSHIP_STATES,
  MODERATION_STATES,
  AUDIENCES,
  REPORT_STATES,
  canModerate,
  readCommunityRole,
  readCommunitySettings,
  type Audience,
  type CommunityRole,
  type CommunitySettings,
  type MembershipState,
  type ModerationState,
  type ReflectionVisibility,
} from '@chat/shared';

/* ------------------------------------------------------------------- types */

export type StoredCommunity = {
  id: string;
  name: string;
  description: string;
  createdByUserId: string;
  /** The four settings, read through the shared reader rather than raw. */
  settings: CommunitySettings;
  createdAt: string;
  closedAt: string | null;
};

/** A row as it comes back, before the settings are read out of it. */
function communityFromRow(row: Row): StoredCommunity {
  return {
    id: String(row['id']),
    name: String(row['name']),
    description: String(row['description'] ?? ''),
    createdByUserId: String(row['createdByUserId']),
    settings: readCommunitySettings(row),
    createdAt: String(row['createdAt']),
    closedAt: row['closedAt'] ? String(row['closedAt']) : null,
  };
}

export type StoredMembership = {
  communityId: string;
  userId: string;
  role: CommunityRole;
  state: MembershipState;
  mutedAt: string | null;
  invitedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicationSection = {
  type: string;
  content: string;
  authorOrigin: string;
};

export type PublicationHashtag = { tag: string; label: string };

/**
 * A publication as the viewer who asked for it may see it.
 *
 * Note what this shape does not carry: no `authorUserId` for anyone but the
 * author's own use, no save *count*, no report list, no membership roster. A
 * field cannot leak from a shape that never held it, and the shape is built by
 * the query rather than trimmed afterwards.
 *
 * `savedByViewer` is per-requester by construction. There is no
 * `saveCount` anywhere in this file — **the author must never see who saved a
 * publication or how many private saves it has**, and the way to guarantee
 * that is to never compute the number.
 */
export type PublicationView = {
  id: string;
  audience: Audience;
  community: { id: string; name: string } | null;
  author: { handle: string; displayName: string };
  isAuthor: boolean;
  format: string;
  title: string;
  scriptureReference: string | null;
  caption: string;
  sections: PublicationSection[];
  hashtags: PublicationHashtag[];
  encouragedCount: number;
  encouragedByViewer: boolean;
  savedByViewer: boolean;
  moderationState: ModerationState;
  /** Present only for a viewer who may act on it — the author or a moderator. */
  canModerate: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NewPublication = {
  authorUserId: string;
  conversationId: string;
  audience: Audience;
  communityId: string | null;
  /** Who may read this particular share, decided once and kept. */
  shareVisibility: ReflectionVisibility;
  caption: string;
  /** Which section types the author chose to include, in order. */
  sectionTypes: readonly string[];
  hashtags: readonly PublicationHashtag[];
};

export type FeedScope = 'shared' | 'public' | 'mine';

export type FeedQuery = {
  scope: FeedScope;
  query?: string;
  tag?: string;
  communityId?: string;
};

/* -------------------------------------------------------------- migration */

/** Safe on every start: SQLite has no ADD COLUMN IF NOT EXISTS. */
function addColumn(db: DatabaseSync, table: string, column: string, type: string): void {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (existing.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    /*
     * A community is four settings, not one isPrivate flag.
     *
     * Public and Private are what somebody chooses; they are presets over
     * these columns and are not stored. That is what lets a church group be
     * discoverable so newcomers can find it while everything shared inside
     * stays members-only -- a combination a single flag would have forced
     * somebody to name "semi-private".
     */
    CREATE TABLE IF NOT EXISTS communities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      createdByUserId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      discoverability TEXT NOT NULL DEFAULT 'hidden',
      joinPolicy TEXT NOT NULL DEFAULT 'invite',
      reflectionVisibility TEXT NOT NULL DEFAULT 'members',
      approvalPolicy TEXT NOT NULL DEFAULT 'owner_admin',
      createdAt TEXT NOT NULL,
      closedAt TEXT
    );

    /*
     * Membership. One row per person per community, carrying both the role and
     * the lifecycle state — and mutedAt as a timestamp rather than a state,
     * so a mute restricts publishing without disturbing the meaning of
     * "currently active member", which is what every access check compares to.
     */
    CREATE TABLE IF NOT EXISTS community_members (
      communityId TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      state TEXT NOT NULL,
      mutedAt TEXT,
      invitedByUserId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      PRIMARY KEY (communityId, userId)
    );

    /*
     * A publication is a *copy*, not a pointer.
     *
     * Title, Scripture reference, caption and the chosen section text are
     * written here at publish time and never read back through to the
     * reflection. That is what makes two of the rules true at once: choosing
     * which sections appear cannot mutate the source reflection, and separate
     * audiences get separate publications with their own captions, dates,
     * reactions and moderation state — because they are separate rows.
     *
     * audience is one value. There is no second audience column and no join
     * table, so "exactly one audience per publication" is a property of the
     * schema rather than a rule someone has to remember.
     */
    CREATE TABLE IF NOT EXISTS publications (
      id TEXT PRIMARY KEY,
      authorUserId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversationId TEXT NOT NULL,
      audience TEXT NOT NULL,
      communityId TEXT REFERENCES communities(id) ON DELETE CASCADE,
      format TEXT NOT NULL,
      title TEXT NOT NULL,
      scriptureReference TEXT,
      caption TEXT NOT NULL DEFAULT '',
      /*
       * Who may read THIS share, fixed at the moment it was made.
       *
       * Deliberately a copy rather than a lookup through to the community's
       * current setting. Somebody shared into a twelve-person group on the
       * understanding that twelve people would read it; an owner changing a
       * setting six months later must not be able to reach back and publish
       * it. The setting decides what new shares get, and nothing else.
       */
      shareVisibility TEXT NOT NULL DEFAULT 'members',
      moderationState TEXT NOT NULL DEFAULT 'visible',
      hiddenByUserId TEXT,
      hiddenAt TEXT,
      deletedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS publication_sections (
      publicationId TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      authorOrigin TEXT NOT NULL,
      PRIMARY KEY (publicationId, type)
    );

    /*
     * Tags are stored folded *and* as typed. The folded value is what a filter
     * compares; the label is what the card shows. Neither grants access to
     * anything — there is no query in this file that reads a tag and returns a
     * permission, and there must never be one.
     */
    CREATE TABLE IF NOT EXISTS publication_tags (
      publicationId TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      label TEXT NOT NULL,
      PRIMARY KEY (publicationId, tag)
    );

    /*
     * One row per person per publication. The primary key is the "one per user"
     * rule — a second Encouraged cannot be inserted, so the count cannot be
     * inflated by a client that sends the request twice.
     */
    CREATE TABLE IF NOT EXISTS publication_reactions (
      publicationId TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      createdAt TEXT NOT NULL,
      PRIMARY KEY (publicationId, userId)
    );

    /* A private bookmark. Read only ever by the person who made it. */
    CREATE TABLE IF NOT EXISTS publication_saves (
      publicationId TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      createdAt TEXT NOT NULL,
      PRIMARY KEY (publicationId, userId)
    );

    /*
     * Every share that has happened, whether or not it still exists.
     *
     * Nothing deletes from this table. If the limits counted live
     * publications, then share, unshare, share would cost nothing and the
     * ceiling would be on how much is visible rather than on how much somebody
     * is doing -- which is precisely the evasion a rate limit is for.
     *
     * It holds no content. A reflection id, a destination and a time: enough
     * to answer how much and how widely, and nothing anybody wrote.
     */
    /*
     * Personal controls, which are not moderation.
     *
     * Hiding something and muting somebody change what one reader sees and
     * nothing else: no report is filed, no author is told, no moderator has to
     * agree. That separation is the point. Most of what people want is simply
     * not to see a thing again, and routing that through an enforcement
     * process turns every irritation into a case somebody has to judge -- and
     * leaves the reader waiting for a verdict to get what they could have had
     * immediately.
     */
    CREATE TABLE IF NOT EXISTS publication_hides (
      publicationId TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
      userId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      PRIMARY KEY (publicationId, userId)
    );

    CREATE TABLE IF NOT EXISTS author_mutes (
      userId TEXT NOT NULL,
      mutedUserId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      PRIMARY KEY (userId, mutedUserId)
    );

    CREATE TABLE IF NOT EXISTS share_events (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      conversationId TEXT NOT NULL,
      audience TEXT NOT NULL,
      communityId TEXT,
      createdAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_share_events_user ON share_events(userId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_share_events_reflection
      ON share_events(conversationId, createdAt);

    CREATE TABLE IF NOT EXISTS publication_reports (
      id TEXT PRIMARY KEY,
      publicationId TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
      reporterUserId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'open',
      createdAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_members_user ON community_members(userId, state);
    CREATE INDEX IF NOT EXISTS idx_pubs_author ON publications(authorUserId);
    CREATE INDEX IF NOT EXISTS idx_pubs_audience ON publications(audience, communityId);
    CREATE INDEX IF NOT EXISTS idx_pub_tags ON publication_tags(tag);
    CREATE INDEX IF NOT EXISTS idx_reports_open ON publication_reports(publicationId, state);
  `);

  /*
   * Columns added after these tables existed. Every default is the private
   * answer, so a community written before there were settings does not become
   * readable by acquiring them.
   */
  addColumn(db, 'communities', 'discoverability', "TEXT NOT NULL DEFAULT 'hidden'");
  addColumn(db, 'communities', 'joinPolicy', "TEXT NOT NULL DEFAULT 'invite'");
  addColumn(db, 'communities', 'reflectionVisibility', "TEXT NOT NULL DEFAULT 'members'");
  addColumn(db, 'communities', 'approvalPolicy', "TEXT NOT NULL DEFAULT 'owner_admin'");
  addColumn(db, 'publications', 'shareVisibility', "TEXT NOT NULL DEFAULT 'members'");

  /*
   * A public publication is public whatever a column says.
   *
   * Rows written before shares carried their own visibility take the default,
   * which is `members` -- correct for a community share and wrong for one that
   * was already on the public feed. Run once: afterwards no public row is
   * marked members-only.
   */
  db.exec("UPDATE publications SET shareVisibility = 'public' WHERE audience = 'public'");

  collapseDuplicateShares(db);

  /*
   * And the rule, in the schema, so it cannot be broken by a code path that
   * forgets to look first. Partial, because a deleted share really was
   * removed: sharing again afterwards is a new share and gets a new row.
   */
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_share_per_destination
      ON publications (authorUserId, conversationId, audience, COALESCE(communityId, ''))
      WHERE deletedAt IS NULL
  `);
}

/**
 * The copies that were made before a share had an identity.
 *
 * Sharing the same reflection into the same community wrote another row every
 * time, so a feed could show three of one reflection differing only by
 * timestamp. The first one is kept -- it is the one people may have
 * encouraged or saved -- and the later copies are removed.
 *
 * Removed rather than marked deleted: these rows were never a distinct share
 * of anything, and leaving them would leave the duplicates in every count that
 * reads deleted rows.
 */
function collapseDuplicateShares(db: DatabaseSync): void {
  const duplicates = db
    .prepare(
      `SELECT id FROM publications AS p
        WHERE deletedAt IS NULL
          AND EXISTS (
            SELECT 1 FROM publications AS first
             WHERE first.authorUserId = p.authorUserId
               AND first.conversationId = p.conversationId
               AND first.audience = p.audience
               AND COALESCE(first.communityId, '') = COALESCE(p.communityId, '')
               AND first.deletedAt IS NULL
               AND (first.createdAt < p.createdAt
                    OR (first.createdAt = p.createdAt AND first.id < p.id))
          )`,
    )
    .all() as { id: string }[];
  if (duplicates.length === 0) return;

  db.exec('BEGIN');
  try {
    const remove = db.prepare('DELETE FROM publications WHERE id = ?');
    for (const duplicate of duplicates) remove.run(duplicate.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/* ---------------------------------------------------- the one predicate */

/**
 * The visibility predicate. **This is the whole authorisation model.**
 *
 * It is a SQL fragment rather than a function returning rows, so it can be
 * pasted into the WHERE clause of every statement that reads publications — the
 * feed, the single fetch, the search, the counts. A predicate that has to be
 * *called* can be forgotten; a predicate that is part of the query cannot be,
 * because the query does not compile without it.
 *
 * It takes the viewer's id twice (`$viewer` is used repeatedly by position, so
 * callers bind it once) and admits exactly three things:
 *
 *  1. the viewer's own publications, at any audience, including `only_me`;
 *  2. public publications that are not hidden;
 *  3. community publications that are not hidden, **where the viewer holds an
 *     `active` membership in that community right now**.
 *
 * The membership test is an `EXISTS` against the live row, evaluated on every
 * statement — so a removed member loses access on their next request and an old
 * URL preserves nothing. There is no cached grant, no token carrying a
 * membership claim, and no place for one.
 *
 * A deleted publication is invisible to everyone including its author; the row
 * survives for an open report to point at, which is the difference between
 * hiding and erasing.
 */
const VISIBLE_TO = `
  p.deletedAt IS NULL
  /*
   * The reader's own choices, applied in the same statement as the
   * authorisation. Hiding and muting are theirs alone: nothing here is visible
   * to the author, and neither ever reaches anybody else's feed.
   *
   * Their own writing is exempt from the mute -- muting yourself by muting
   * somebody is not a thing anybody means to do -- and a publication they
   * hid stays hidden even from a direct link, which is what hiding means.
   */
  AND NOT EXISTS (
    SELECT 1 FROM publication_hides AS ph
     WHERE ph.publicationId = p.id AND ph.userId = $viewer
  )
  AND (
    p.authorUserId = $viewer
    OR NOT EXISTS (
      SELECT 1 FROM author_mutes AS am
       WHERE am.userId = $viewer AND am.mutedUserId = p.authorUserId
    )
  )
  AND (
    p.authorUserId = $viewer
    OR (
      p.moderationState = 'visible'
      AND (
        p.audience = 'public'
        OR (
          p.audience = 'community'
          AND (
            /*
             * A community share that was made public when it was made.
             *
             * shareVisibility is the share's own copy, taken at publish
             * time, which is why this cannot be turned on retroactively by an
             * administrator changing a setting: existing rows keep the answer
             * they were written with.
             */
            p.shareVisibility = 'public'
            OR EXISTS (
              SELECT 1 FROM community_members AS m
               WHERE m.communityId = p.communityId
                 AND m.userId = $viewer
                 AND m.state = 'active'
            )
          )
        )
      )
    )
  )
`;

/**
 * The same predicate for a community's *own* page.
 *
 * A community publication is visible to an active member; the author of a
 * hidden one still sees it, so they know what happened to it.
 */
const SCOPE_SHARED = `p.audience = 'community'`;
const SCOPE_PUBLIC = `p.audience = 'public'`;
const SCOPE_MINE = `p.authorUserId = $viewer`;

type Row = Record<string, unknown>;

/* ------------------------------------------------------------------ store */

export class CommunityStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    migrate(db);
  }

  /* ------------------------------------------------------- communities */

  createCommunity(input: {
    name: string;
    description: string;
    createdByUserId: string;
    settings: CommunitySettings;
  }): StoredCommunity {
    const timestamp = new Date().toISOString();
    const community: StoredCommunity = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      createdByUserId: input.createdByUserId,
      settings: input.settings,
      createdAt: timestamp,
      closedAt: null,
    };

    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO communities
             (id, name, description, createdByUserId, discoverability, joinPolicy,
              reflectionVisibility, approvalPolicy, createdAt, closedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          community.id,
          community.name,
          community.description,
          community.createdByUserId,
          input.settings.discoverability,
          input.settings.joinPolicy,
          input.settings.reflectionVisibility,
          input.settings.approvalPolicy,
          community.createdAt,
        );
      /*
       * The creator is the owner, active immediately. "Every community must
       * have at least one owner" is enforced by never creating one without.
       */
      this.db
        .prepare(
          `INSERT INTO community_members
             (communityId, userId, role, state, mutedAt, invitedByUserId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
        )
        .run(
          community.id,
          input.createdByUserId,
          COMMUNITY_ROLES.OWNER,
          MEMBERSHIP_STATES.ACTIVE,
          timestamp,
          timestamp,
        );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return community;
  }

  community(id: string): StoredCommunity | null {
    const row = this.db.prepare('SELECT * FROM communities WHERE id = ?').get(id) as
      | Row
      | undefined;
    return row ? communityFromRow(row) : null;
  }

  /**
   * The viewer's membership, read fresh.
   *
   * Every caller that needs to know whether someone may do something calls
   * this rather than trusting anything the request carried. There is no
   * membership cache — a removed member must lose access immediately, and the
   * cheapest way to guarantee "immediately" is to never remember.
   */
  membership(communityId: string, userId: string): StoredMembership | null {
    const row = this.db
      .prepare('SELECT * FROM community_members WHERE communityId = ? AND userId = ?')
      .get(communityId, userId) as Row | undefined;
    return row ? (row as unknown as StoredMembership) : null;
  }

  /** Communities the viewer is an active member of. Never a directory. */
  myCommunities(userId: string): (StoredCommunity & {
    role: CommunityRole;
    memberCount: number;
  })[] {
    return this.db
      .prepare(
        `SELECT c.*, m.role AS role,
                (SELECT COUNT(*) FROM community_members AS x
                  WHERE x.communityId = c.id AND x.state = 'active') AS memberCount
           FROM communities AS c
           JOIN community_members AS m ON m.communityId = c.id
          WHERE m.userId = ? AND m.state = 'active'
          ORDER BY c.name COLLATE NOCASE`,
      )
      .all(userId) as unknown as (StoredCommunity & {
      role: CommunityRole;
      memberCount: number;
    })[];
  }

  /** Invitations addressed to this person and not yet answered. */
  myInvitations(userId: string): (StoredCommunity & { invitedAt: string })[] {
    return this.db
      .prepare(
        `SELECT c.*, m.createdAt AS invitedAt
           FROM communities AS c
           JOIN community_members AS m ON m.communityId = c.id
          WHERE m.userId = ? AND m.state = 'invited'
          ORDER BY m.createdAt DESC`,
      )
      .all(userId) as unknown as (StoredCommunity & { invitedAt: string })[];
  }

  members(communityId: string): (StoredMembership & {
    handle: string | null;
    displayName: string | null;
  })[] {
    return this.db
      .prepare(
        `SELECT m.*, pr.handle AS handle, pr.displayName AS displayName
           FROM community_members AS m
           LEFT JOIN profiles AS pr ON pr.userId = m.userId
          WHERE m.communityId = ?
          ORDER BY m.role, m.createdAt`,
      )
      .all(communityId) as unknown as (StoredMembership & {
      handle: string | null;
      displayName: string | null;
    })[];
  }

  /** Invite, re-invite, or change a membership. One write, stated plainly. */
  setMembership(input: {
    communityId: string;
    userId: string;
    role?: CommunityRole;
    state: MembershipState;
    mutedAt?: string | null;
    invitedByUserId?: string | null;
  }): void {
    const timestamp = new Date().toISOString();
    const existing = this.membership(input.communityId, input.userId);
    this.db
      .prepare(
        `INSERT INTO community_members
           (communityId, userId, role, state, mutedAt, invitedByUserId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(communityId, userId) DO UPDATE SET
           role = excluded.role,
           state = excluded.state,
           mutedAt = excluded.mutedAt,
           updatedAt = excluded.updatedAt`,
      )
      .run(
        input.communityId,
        input.userId,
        input.role ?? existing?.role ?? COMMUNITY_ROLES.MEMBER,
        input.state,
        input.mutedAt === undefined ? (existing?.mutedAt ?? null) : input.mutedAt,
        input.invitedByUserId ?? existing?.invitedByUserId ?? null,
        existing?.createdAt ?? timestamp,
        timestamp,
      );
  }

  /**
   * Change what a community is, without changing what it has already held.
   *
   * `shareVisibility` on existing publications is deliberately not touched.
   * Turning a members-only community public is a decision about future shares;
   * reaching back through it would publish, on somebody else's behalf, work
   * they gave to twelve people. Reducing exposure the other way needs no such
   * care and still does not rewrite rows -- a share that was public when it
   * was made stays what its author chose.
   */
  updateSettings(communityId: string, settings: CommunitySettings): void {
    this.db
      .prepare(
        `UPDATE communities
            SET discoverability = ?, joinPolicy = ?, reflectionVisibility = ?, approvalPolicy = ?
          WHERE id = ?`,
      )
      .run(
        settings.discoverability,
        settings.joinPolicy,
        settings.reflectionVisibility,
        settings.approvalPolicy,
        communityId,
      );
  }

  /**
   * Communities somebody could find and ask to join.
   *
   * Discoverability only. Being able to see that a community exists is not
   * being able to see what is written in it, which is the whole point of a
   * discoverable private group -- so this returns names and descriptions and
   * nothing that was shared inside.
   */
  discoverable(viewerUserId: string, query: string): (StoredCommunity & {
    memberState: MembershipState | null;
    memberCount: number;
  })[] {
    const like = `%${query.trim().toLowerCase()}%`;
    const rows = this.db
      .prepare(
        `SELECT c.*,
                (SELECT state FROM community_members
                  WHERE communityId = c.id AND userId = $viewer) AS memberState,
                (SELECT COUNT(*) FROM community_members
                  WHERE communityId = c.id AND state = 'active') AS memberCount
           FROM communities AS c
          WHERE c.closedAt IS NULL
            AND c.discoverability = 'public'
            AND ($q = '%%' OR LOWER(c.name) LIKE $q OR LOWER(c.description) LIKE $q)
          ORDER BY c.name`,
      )
      .all({ viewer: viewerUserId, q: like }) as Row[];
    return rows.map((row) => ({
      ...communityFromRow(row),
      memberState: row['memberState'] ? (String(row['memberState']) as MembershipState) : null,
      memberCount: Number(row['memberCount'] ?? 0),
    }));
  }

  /** Everybody waiting on a decision, oldest first. */
  joinRequests(communityId: string): (StoredMembership & {
    handle: string | null;
    displayName: string | null;
  })[] {
    return this.db
      .prepare(
        `SELECT m.*, pr.handle AS handle, pr.displayName AS displayName
           FROM community_members AS m
           LEFT JOIN profiles AS pr ON pr.userId = m.userId
          WHERE m.communityId = ? AND m.state = 'pending'
          ORDER BY m.updatedAt`,
      )
      .all(communityId) as unknown as (StoredMembership & {
      handle: string | null;
      displayName: string | null;
    })[];
  }

  /**
   * Delete a community, and nothing that belongs to a person.
   *
   * Memberships, join requests and the sharing associations go. The
   * reflections do not: a share was never the reflection, and closing a space
   * cannot be a way to delete other people's writing. The publications are
   * removed because they are this community's copies -- the authors' originals
   * are in their own reflections, untouched.
   */
  deleteCommunity(communityId: string): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM publications WHERE communityId = ?').run(communityId);
      this.db.prepare('DELETE FROM community_members WHERE communityId = ?').run(communityId);
      this.db.prepare('DELETE FROM communities WHERE id = ?').run(communityId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * The author deleted the reflection, so its shares go with it.
   *
   * A publication is a copy taken at share time, which is what lets a
   * community show it without reaching into somebody's private writing. The
   * price of that copy is this method: without it, deleting a reflection
   * leaves the copies standing, and a community keeps something its author has
   * destroyed and can no longer reach. Nothing may outlive the thing it was
   * taken from.
   */
  removeSharesOfConversation(conversationId: string, authorUserId: string): number {
    return this.db
      .prepare('DELETE FROM publications WHERE conversationId = ? AND authorUserId = ?')
      .run(conversationId, authorUserId).changes as number;
  }

  /* -------------------------------------------------- personal controls */

  /** Out of this reader's sight, immediately, with nobody's permission. */
  hidePublicationForViewer(publicationId: string, userId: string, hidden: boolean): void {
    if (!hidden) {
      this.db
        .prepare('DELETE FROM publication_hides WHERE publicationId = ? AND userId = ?')
        .run(publicationId, userId);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO publication_hides (publicationId, userId, createdAt) VALUES (?, ?, ?)
         ON CONFLICT(publicationId, userId) DO NOTHING`,
      )
      .run(publicationId, userId, new Date().toISOString());
  }

  /** The same, for everything one author shares. Reversible, and private. */
  muteAuthor(userId: string, mutedUserId: string, muted: boolean): void {
    if (userId === mutedUserId) return;
    if (!muted) {
      this.db
        .prepare('DELETE FROM author_mutes WHERE userId = ? AND mutedUserId = ?')
        .run(userId, mutedUserId);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO author_mutes (userId, mutedUserId, createdAt) VALUES (?, ?, ?)
         ON CONFLICT(userId, mutedUserId) DO NOTHING`,
      )
      .run(userId, mutedUserId, new Date().toISOString());
  }

  /** Who wrote it, for a mute. Never served to anybody as part of a view. */
  authorOf(publicationId: string): string | null {
    const row = this.db
      .prepare('SELECT authorUserId FROM publications WHERE id = ?')
      .get(publicationId) as Row | undefined;
    return row ? String(row['authorUserId']) : null;
  }

  /* ------------------------------------------------------ share history */

  /** Written on every successful share. Never removed. */
  /**
   * Everything the sharing ceilings need, in one read.
   *
   * Assembled here so the rule itself stays a rule: no database, no clock of
   * its own, and testable by handing it numbers.
   */
  shareHistory(input: {
    userId: string;
    conversationId: string;
    communityId: string | null;
    now: number;
  }): ShareHistory {
    const hour = input.now - 60 * 60 * 1000;
    const day = input.now - 24 * 60 * 60 * 1000;

    const window = (sql: string, params: unknown[]): WindowCount => {
      const row = this.db.prepare(sql).get(...(params as never[])) as Row | undefined;
      return {
        count: Number(row?.['n'] ?? 0),
        oldestAt: row?.['oldest'] == null ? null : Number(row['oldest']),
      };
    };

    const counted = (extra: string, params: unknown[]) =>
      window(
        `SELECT COUNT(*) AS n, MIN(createdAt) AS oldest FROM share_events
          WHERE userId = ? AND createdAt >= ? ${extra}`,
        params,
      );

    const reflectionCommunities = this.db
      .prepare(
        `SELECT DISTINCT communityId, MIN(createdAt) AS oldest FROM share_events
          WHERE conversationId = ? AND userId = ? AND audience = 'community'
            AND communityId IS NOT NULL AND createdAt >= ?
          GROUP BY communityId`,
      )
      .all(input.conversationId, input.userId, day) as Row[];

    return {
      publicHour: counted("AND audience = 'public'", [input.userId, hour]),
      publicDay: counted("AND audience = 'public'", [input.userId, day]),
      communitiesHour: counted("AND audience = 'community'", [input.userId, hour]),
      communitiesDay: counted("AND audience = 'community'", [input.userId, day]),
      thisCommunityHour: input.communityId
        ? counted("AND audience = 'community' AND communityId = ?", [
            input.userId,
            hour,
            input.communityId,
          ])
        : { count: 0, oldestAt: null },
      communitiesForReflectionDay: {
        communityIds: reflectionCommunities.map((row) => String(row['communityId'])),
        oldestAt: reflectionCommunities.length
          ? Math.min(...reflectionCommunities.map((row) => Number(row['oldest'])))
          : null,
      },
      everythingDay: counted("AND audience IN ('public', 'community')", [input.userId, day]),
    };
  }

  /** How many owners a community has, so the last one cannot be demoted away. */
  ownerCount(communityId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM community_members
          WHERE communityId = ? AND role = 'owner' AND state = 'active'`,
      )
      .get(communityId) as Row | undefined;
    return Number(row?.['n'] ?? 0);
  }

  /* ------------------------------------------------------ publications */

  /**
   * Publish — a copy is taken, and the reflection is not touched.
   *
   * The section rows written here are the publication's own presentation. The
   * author chose which sections appear; that choice writes *these* rows and
   * issues no write at all against `sections`. `authorOrigin` is copied across
   * with the text, so provenance survives into published content rather than
   * being reset by the act of sharing it.
   */
  /**
   * The share this reflection already has at this destination, if any.
   *
   * A share is identified by where it went — this reflection, into this
   * community, or to Public — not by the row that happened to be written. Any
   * other reading makes "share" mean "post again", and the feed fills with
   * copies of one reflection that differ only in their timestamp.
   *
   * Deleted rows are excluded: unsharing really did remove it, so sharing
   * again is a new share and gets a new row.
   */
  existingShare(input: {
    authorUserId: string;
    conversationId: string;
    audience: string;
    communityId: string | null;
  }): string | null {
    const row = this.db
      .prepare(
        `SELECT id FROM publications
          WHERE authorUserId = $author AND conversationId = $conversation
            AND audience = $audience
            AND COALESCE(communityId, '') = COALESCE($community, '')
            AND deletedAt IS NULL
          ORDER BY createdAt
          LIMIT 1`,
      )
      .get({
        author: input.authorUserId,
        conversation: input.conversationId,
        audience: input.audience,
        community: input.communityId,
      }) as Row | undefined;
    return row ? String(row['id']) : null;
  }

  /**
   * Bring an existing share up to date with the reflection behind it.
   *
   * Re-sharing something already shared here is not a second share; it is the
   * author saying "use what it says now". So the snapshot is replaced and the
   * row keeps its identity — with its reactions, its saves, its date and its
   * moderation state, none of which anybody meant to reset.
   */
  refreshShare(
    id: string,
    input: { caption: string; sectionTypes: readonly string[]; hashtags: readonly PublicationHashtag[] },
    source: {
      format: string;
      title: string;
      scriptureReference: string | null;
      sections: Record<string, { content: string; authorOrigin: string }>;
    },
  ): void {
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `UPDATE publications
              SET format = $format, title = $title, scriptureReference = $reference,
                  caption = $caption, updatedAt = $now
            WHERE id = $id`,
        )
        .run({
          format: source.format,
          title: source.title,
          reference: source.scriptureReference,
          caption: input.caption,
          now: new Date().toISOString(),
          id,
        });

      this.db.prepare('DELETE FROM publication_sections WHERE publicationId = ?').run(id);
      const insertSection = this.db.prepare(
        `INSERT INTO publication_sections (publicationId, position, type, content, authorOrigin)
         VALUES (?, ?, ?, ?, ?)`,
      );
      input.sectionTypes.forEach((type, position) => {
        const section = source.sections[type];
        if (!section || !section.content.trim()) return;
        insertSection.run(id, position, type, section.content, section.authorOrigin);
      });

      this.db.prepare('DELETE FROM publication_tags WHERE publicationId = ?').run(id);
      const insertTag = this.db.prepare(
        `INSERT INTO publication_tags (publicationId, tag, label) VALUES (?, ?, ?)
         ON CONFLICT(publicationId, tag) DO NOTHING`,
      );
      for (const hashtag of input.hashtags) insertTag.run(id, hashtag.tag, hashtag.label);

      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  publish(
    input: NewPublication,
    source: {
      format: string;
      title: string;
      scriptureReference: string | null;
      sections: Record<string, { content: string; authorOrigin: string }>;
    },
  ): string {
    const id = randomUUID();
    const timestamp = new Date().toISOString();

    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO publications
             (id, authorUserId, conversationId, audience, communityId, format, title,
              scriptureReference, caption, shareVisibility, moderationState, hiddenByUserId,
              hiddenAt, deletedAt, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
        )
        .run(
          id,
          input.authorUserId,
          input.conversationId,
          input.audience,
          input.communityId,
          source.format,
          source.title,
          source.scriptureReference,
          input.caption,
          /*
           * Fixed here, at the moment of sharing, from what the community was
           * when the author chose to share into it. Never read back through to
           * the community afterwards -- that is what makes a later settings
           * change unable to publish this.
           */
          input.shareVisibility,
          MODERATION_STATES.VISIBLE,
          timestamp,
          timestamp,
        );

      const insertSection = this.db.prepare(
        `INSERT INTO publication_sections (publicationId, position, type, content, authorOrigin)
         VALUES (?, ?, ?, ?, ?)`,
      );
      input.sectionTypes.forEach((type, position) => {
        const section = source.sections[type];
        if (!section || !section.content.trim()) return;
        insertSection.run(id, position, type, section.content, section.authorOrigin);
      });

      const insertTag = this.db.prepare(
        `INSERT INTO publication_tags (publicationId, tag, label) VALUES (?, ?, ?)
         ON CONFLICT(publicationId, tag) DO NOTHING`,
      );
      for (const hashtag of input.hashtags) {
        insertTag.run(id, hashtag.tag, hashtag.label);
      }

      /*
       * The share event is written here, not by the caller afterwards.
       *
       * It is what the sharing ceilings are counted from, so a crash between
       * the publication row and this one would leave a share that exists and
       * cost the author nothing. Inside the same BEGIN, either both rows are
       * there or neither is.
       *
       * Only Me is not a share. It reaches nobody, so it is not metered, and
       * the audience is the thing that decides that -- which is why the
       * decision lives with the insert rather than at the call site.
       */
      if (input.audience !== AUDIENCES.ONLY_ME) {
        this.db
          .prepare(
            `INSERT INTO share_events (id, userId, conversationId, audience, communityId, createdAt)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            input.authorUserId,
            input.conversationId,
            input.audience,
            input.communityId,
            Date.now(),
          );
      }

      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return id;
  }

  /**
   * One publication, if this viewer may see it.
   *
   * `null` covers every reason equally — no such publication, hidden, deleted,
   * a community the viewer never belonged to, a community they were removed
   * from. The route turns all of them into the same 404, because saying "this
   * exists but you may not see it" is itself a disclosure: it confirms a
   * community publication is there to someone who was told nothing.
   */
  publication(viewerUserId: string, id: string): PublicationView | null {
    const row = this.db
      .prepare(`${SELECT_PUBLICATION} WHERE ${VISIBLE_TO} AND p.id = $id`)
      .get({ viewer: viewerUserId, id }) as Row | undefined;
    if (!row) return null;
    return this.hydrate(viewerUserId, row);
  }

  /**
   * The feed for a scope, authorised during retrieval.
   *
   * Search is applied inside the same statement as the visibility predicate,
   * so an unauthorised publication is never a candidate to be matched — its
   * title, its excerpt, its Scripture reference and its hashtags are not read,
   * not scored and not returned. Filtering after a search would have made the
   * search itself the leak.
   */
  feed(viewerUserId: string, options: FeedQuery): PublicationView[] {
    const clauses: string[] = [VISIBLE_TO];
    /*
     * Named, not numbered. `?1` repeated in one statement binds differently
     * across Node releases — it works on 22.23 and raises SQLITE_RANGE on
     * 22.18, which is what the production host runs. Named parameters mean
     * the same thing everywhere, and a value used in five places is still
     * supplied once.
     */
    const params: Record<string, unknown> = { viewer: viewerUserId };

    if (options.scope === 'public') clauses.push(SCOPE_PUBLIC);
    else if (options.scope === 'shared') clauses.push(SCOPE_SHARED);
    else clauses.push(SCOPE_MINE);

    if (options.communityId) {
      params['community'] = options.communityId;
      clauses.push('p.communityId = $community');
    }

    if (options.tag) {
      params['tag'] = options.tag;
      clauses.push(
        `EXISTS (SELECT 1 FROM publication_tags AS t
                  WHERE t.publicationId = p.id AND t.tag = $tag)`,
      );
    }

    if (options.query) {
      /*
       * The search terms are bound once and referenced by position, so the
       * same value serves the title, the reference, the caption, the section
       * text and the tags without five copies drifting apart.
       */
      params['q'] = `%${options.query.toLowerCase()}%`;
      const like = '$q';
      clauses.push(`(
        lower(p.title) LIKE ${like}
        OR lower(COALESCE(p.scriptureReference, '')) LIKE ${like}
        OR lower(p.caption) LIKE ${like}
        OR EXISTS (SELECT 1 FROM publication_sections AS s
                    WHERE s.publicationId = p.id AND lower(s.content) LIKE ${like})
        OR EXISTS (SELECT 1 FROM publication_tags AS t
                    WHERE t.publicationId = p.id AND lower(t.label) LIKE ${like})
        OR lower(COALESCE(author.displayName, '')) LIKE ${like}
        OR lower(COALESCE(author.handle, '')) LIKE ${like}
      )`);
    }

    const rows = this.db
      .prepare(
        `${SELECT_PUBLICATION} WHERE ${clauses.join(' AND ')} ORDER BY p.createdAt DESC LIMIT 100`,
      )
      .all(params as never) as Row[];

    return rows.map((row) => this.hydrate(viewerUserId, row));
  }

  /**
   * The hashtags a viewer may actually be offered.
   *
   * Derived from the same predicate as the feed, so a chip cannot advertise a
   * tag that exists only on content the viewer cannot open. A filter chip is a
   * count with a name on it, and counts leak.
   */
  hashtagsFor(viewerUserId: string, scope: FeedScope): PublicationHashtag[] {
    const scopeClause =
      scope === 'public' ? SCOPE_PUBLIC : scope === 'shared' ? SCOPE_SHARED : SCOPE_MINE;
    return this.db
      .prepare(
        `SELECT t.tag AS tag, MIN(t.label) AS label, COUNT(*) AS n
           FROM publication_tags AS t
           JOIN publications AS p ON p.id = t.publicationId
          WHERE ${VISIBLE_TO} AND ${scopeClause}
          GROUP BY t.tag
          ORDER BY n DESC, t.tag
          LIMIT 12`,
      )
      .all({ viewer: viewerUserId }) as unknown as PublicationHashtag[];
  }

  /* --------------------------------------------------------- reactions */

  /**
   * Encouraged, toggled.
   *
   * The insert is `ON CONFLICT DO NOTHING`, so pressing it twice is pressing it
   * once — the primary key is what makes "one per user per publication" true
   * rather than a rule the client is trusted to keep. Removing is a delete.
   *
   * Authorisation is the caller's `publication()` call: encouraging something
   * requires being able to see it, and that check is the same predicate.
   */
  setEncouraged(publicationId: string, userId: string, encouraged: boolean): void {
    if (encouraged) {
      this.db
        .prepare(
          `INSERT INTO publication_reactions (publicationId, userId, createdAt)
           VALUES (?, ?, ?) ON CONFLICT(publicationId, userId) DO NOTHING`,
        )
        .run(publicationId, userId, new Date().toISOString());
      return;
    }
    this.db
      .prepare('DELETE FROM publication_reactions WHERE publicationId = ? AND userId = ?')
      .run(publicationId, userId);
  }

  /**
   * Save, a private bookmark.
   *
   * There is deliberately no `saveCount` method on this class and no query
   * anywhere in this file that aggregates this table. The author must never
   * learn who saved their publication or how many did — and the reliable way
   * to keep a number secret is for no code path to be able to produce it.
   */
  setSaved(publicationId: string, userId: string, saved: boolean): void {
    if (saved) {
      this.db
        .prepare(
          `INSERT INTO publication_saves (publicationId, userId, createdAt)
           VALUES (?, ?, ?) ON CONFLICT(publicationId, userId) DO NOTHING`,
        )
        .run(publicationId, userId, new Date().toISOString());
      return;
    }
    this.db
      .prepare('DELETE FROM publication_saves WHERE publicationId = ? AND userId = ?')
      .run(publicationId, userId);
  }

  /** The viewer's own saved publications, authorised the same way. */
  savedFeed(viewerUserId: string): PublicationView[] {
    const rows = this.db
      .prepare(
        `${SELECT_PUBLICATION}
          WHERE ${VISIBLE_TO}
            AND EXISTS (SELECT 1 FROM publication_saves AS sv
                         WHERE sv.publicationId = p.id AND sv.userId = $viewer)
          ORDER BY p.createdAt DESC LIMIT 100`,
      )
      .all({ viewer: viewerUserId }) as Row[];
    return rows.map((row) => this.hydrate(viewerUserId, row));
  }

  /**
   * What this person has encouraged, most recent first.
   *
   * Ordered by when the publication was written rather than when it was
   * encouraged, matching every other feed here. `VISIBLE_TO` still applies:
   * encouraging something does not grant standing access to it, so a
   * publication withdrawn or moved out of reach drops out of this list too.
   *
   * The viewer is always the person themselves — there is no query here that
   * produces somebody else's encouragements, and deliberately so. A list of
   * what a named person approved of is a profile of them.
   */
  encouragedFeed(viewerUserId: string): PublicationView[] {
    const rows = this.db
      .prepare(
        `${SELECT_PUBLICATION}
          WHERE ${VISIBLE_TO}
            AND EXISTS (SELECT 1 FROM publication_reactions AS er
                         WHERE er.publicationId = p.id AND er.userId = $viewer)
          ORDER BY p.createdAt DESC LIMIT 100`,
      )
      .all({ viewer: viewerUserId }) as Row[];
    return rows.map((row) => this.hydrate(viewerUserId, row));
  }

  /* -------------------------------------------------------- moderation */

  /** Raw row access for the routes' authorisation decisions. Never served. */
  raw(id: string): {
    id: string;
    authorUserId: string;
    audience: Audience;
    communityId: string | null;
    moderationState: ModerationState;
    deletedAt: string | null;
  } | null {
    const row = this.db
      .prepare(
        `SELECT id, authorUserId, audience, communityId, moderationState, deletedAt
           FROM publications WHERE id = ?`,
      )
      .get(id) as Row | undefined;
    return row ? (row as never) : null;
  }

  setHidden(publicationId: string, byUserId: string, hidden: boolean): void {
    const timestamp = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE publications
            SET moderationState = ?, hiddenByUserId = ?, hiddenAt = ?, updatedAt = ?
          WHERE id = ?`,
      )
      .run(
        hidden ? MODERATION_STATES.HIDDEN : MODERATION_STATES.VISIBLE,
        hidden ? byUserId : null,
        hidden ? timestamp : null,
        timestamp,
        publicationId,
      );
  }

  /**
   * Delete — a tombstone, not a DROP.
   *
   * `deletedAt` takes the row out of every read (the visibility predicate tests
   * it first, before anything else), while the text, the reactions and the
   * reports stay on disk. A route refuses this outright while a report is
   * open; the separation exists so that refusal is meaningful rather than
   * cosmetic, because a delete that had already erased the section rows would
   * leave nothing for a reviewer to look at.
   */
  softDelete(publicationId: string): void {
    const timestamp = new Date().toISOString();
    this.db
      .prepare('UPDATE publications SET deletedAt = ?, updatedAt = ? WHERE id = ?')
      .run(timestamp, timestamp, publicationId);
  }

  addReport(input: {
    publicationId: string;
    reporterUserId: string;
    reason: string;
    detail: string;
  }): { id: string } {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO publication_reports
           (id, publicationId, reporterUserId, reason, detail, state, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.publicationId,
        input.reporterUserId,
        input.reason,
        input.detail,
        REPORT_STATES.OPEN,
        new Date().toISOString(),
      );
    return { id };
  }

  /** Whether evidence is attached to this publication that must be preserved. */
  openReportCount(publicationId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM publication_reports
          WHERE publicationId = ? AND state = 'open'`,
      )
      .get(publicationId) as Row | undefined;
    return Number(row?.['n'] ?? 0);
  }

  /* ----------------------------------------------------------- private */

  /**
   * Turn an authorised row into the view.
   *
   * Everything here runs *after* the row has already passed `VISIBLE_TO`, so
   * these follow-up reads cannot widen what was returned — they can only
   * describe a publication the viewer was already entitled to. Section text is
   * fetched by publication id, and the only ids reaching this point are ones
   * the predicate admitted.
   */
  private hydrate(viewerUserId: string, row: Row): PublicationView {
    const id = String(row['id']);
    const sections = this.db
      .prepare(
        `SELECT type, content, authorOrigin FROM publication_sections
          WHERE publicationId = ? ORDER BY position`,
      )
      .all(id) as unknown as PublicationSection[];
    const hashtags = this.db
      .prepare('SELECT tag, label FROM publication_tags WHERE publicationId = ? ORDER BY tag')
      .all(id) as unknown as PublicationHashtag[];

    const isAuthor = String(row['authorUserId']) === viewerUserId;
    const communityId = row['communityId'] ? String(row['communityId']) : null;
    const viewerRole = communityId
      ? (this.membership(communityId, viewerUserId)?.role ?? null)
      : null;

    return {
      id,
      audience: String(row['audience']) as Audience,
      community: communityId
        ? { id: communityId, name: String(row['communityName'] ?? 'Community') }
        : null,
      author: {
        handle: String(row['authorHandle'] ?? ''),
        displayName: String(row['authorDisplayName'] ?? 'A C.H.A.T. writer'),
      },
      isAuthor,
      format: String(row['format']),
      title: String(row['title']),
      scriptureReference: row['scriptureReference']
        ? String(row['scriptureReference'])
        : null,
      caption: String(row['caption'] ?? ''),
      sections,
      hashtags,
      encouragedCount: Number(row['encouragedCount'] ?? 0),
      encouragedByViewer: Number(row['encouragedByViewer'] ?? 0) > 0,
      /* Per-viewer by construction. No aggregate of this table exists. */
      savedByViewer: Number(row['savedByViewer'] ?? 0) > 0,
      moderationState: String(row['moderationState']) as ModerationState,
      /* Rows still say `moderator`; the role is read, not compared raw. */
      canModerate: isAuthor || canModerate(readCommunityRole(viewerRole)),
      createdAt: String(row['createdAt']),
      updatedAt: String(row['updatedAt']),
    };
  }
}

/**
 * The one projection every read uses.
 *
 * The Encouraged count is a correlated subquery *inside* the authorised
 * statement rather than a second pass, so it counts reactions on a row the
 * viewer was already entitled to and cannot become the channel that reports the
 * existence of one they were not. The same is true of the viewer's own
 * reaction and save flags: per-viewer, computed here, never aggregated.
 */
const SELECT_PUBLICATION = `
  SELECT p.*,
         c.name AS communityName,
         author.handle AS authorHandle,
         author.displayName AS authorDisplayName,
         (SELECT COUNT(*) FROM publication_reactions AS r WHERE r.publicationId = p.id)
           AS encouragedCount,
         (SELECT COUNT(*) FROM publication_reactions AS r
           WHERE r.publicationId = p.id AND r.userId = $viewer) AS encouragedByViewer,
         (SELECT COUNT(*) FROM publication_saves AS sv
           WHERE sv.publicationId = p.id AND sv.userId = $viewer) AS savedByViewer
    FROM publications AS p
    LEFT JOIN communities AS c ON c.id = p.communityId
    LEFT JOIN profiles AS author ON author.userId = p.authorUserId
`;

/**
 * A store when the backing can carry one, and `null` when it cannot.
 *
 * `MemoryStore` has no database handle. Rather than build a second
 * authorisation implementation over it — the arrangement this module's header
 * explains at length — Community reports itself unavailable, and the routes
 * answer 503 with a sentence saying why. Every existing test that hands in
 * `MemoryStore` keeps working; none of them touch Community.
 */
export function createCommunityStore(store: unknown): CommunityStore | null {
  const handle = (store as { db?: DatabaseSync }).db;
  if (handle && typeof handle.prepare === 'function') {
    return new CommunityStore(handle);
  }
  return null;
}
