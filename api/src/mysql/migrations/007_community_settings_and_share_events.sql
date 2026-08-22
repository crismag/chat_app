-- The community rules SQLite already enforces, brought over as columns.
--
-- MariaDB's community tables were written before the product had settings on a
-- community, moderation that a member can act on, or a ceiling on sharing. The
-- live SQLite store has all three, and a cutover cannot begin while the target
-- cannot express them. Nothing reads these yet: this migration is additive and
-- flips no route.
--
-- Two conventions are kept, deliberately, rather than copying SQLite's shape:
-- ids are BIGINT with a public UUID beside them, and names are snake_case.
-- Matching SQLite *semantics* is the goal; matching its spelling is not, and a
-- second identifier style in one schema would outlive this migration.

-- How a community is found, entered and read.
--
-- Defaults are the closed ones. A community that existed before these columns
-- did was created under rules that assumed invitation, so it keeps them: no
-- migration should widen who can see somebody's writing.
ALTER TABLE communities
    ADD COLUMN discoverability VARCHAR(32) NOT NULL DEFAULT 'hidden',
    ADD COLUMN join_policy VARCHAR(32) NOT NULL DEFAULT 'invite',
    ADD COLUMN reflection_visibility VARCHAR(32) NOT NULL DEFAULT 'members',
    ADD COLUMN approval_policy VARCHAR(32) NOT NULL DEFAULT 'owner_admin';

-- Who may read this particular share, decided once when it was made.
--
-- Fixed at the moment of sharing and never read back through to the community,
-- which is what stops a later settings change from publishing something its
-- author shared under different rules.
ALTER TABLE publications
    ADD COLUMN share_visibility VARCHAR(32) NOT NULL DEFAULT 'members';

-- A reader hiding one publication from their own feed. Theirs alone: nothing
-- aggregates this table, so an author cannot learn that it happened.
CREATE TABLE publication_hides (
    publication_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (publication_id, user_id),
    KEY idx_publication_hide_user (user_id),
    CONSTRAINT fk_publication_hide_publication
        FOREIGN KEY (publication_id) REFERENCES publications(id) ON DELETE CASCADE,
    CONSTRAINT fk_publication_hide_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One reader choosing not to see another author. Also theirs alone.
CREATE TABLE author_mutes (
    user_id BIGINT UNSIGNED NOT NULL,
    muted_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, muted_user_id),
    KEY idx_author_mute_muted (muted_user_id),
    CONSTRAINT fk_author_mute_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_author_mute_muted
        FOREIGN KEY (muted_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every share that has happened, whether or not it still exists.
--
-- Nothing deletes from this table. If the ceilings counted live publications,
-- then share, unshare, share would cost nothing and the limit would be on how
-- much is visible rather than on how much somebody is doing -- which is
-- precisely the evasion a rate limit exists to prevent.
--
-- created_at is a BIGINT of epoch milliseconds rather than a DATETIME. The
-- windows are computed in milliseconds against a clock the tests can supply,
-- and a DATETIME here would mean converting on every read of a hot path.
CREATE TABLE share_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_uuid CHAR(36) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    reflection_id BIGINT UNSIGNED NOT NULL,
    audience VARCHAR(32) NOT NULL,
    community_id BIGINT UNSIGNED NULL,
    created_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_share_event_uuid (public_uuid),
    KEY idx_share_event_user (user_id, created_at),
    KEY idx_share_event_reflection (reflection_id, created_at),
    CONSTRAINT fk_share_event_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One live share per destination.
--
-- SQLite expresses this as a partial unique index -- unique WHERE deleted_at IS
-- NULL -- because a deleted share really was removed and sharing again is a new
-- share that deserves its own row. MariaDB has no partial indexes, so the same
-- rule is expressed as a generated column that is NULL for a deleted row: a
-- UNIQUE key ignores NULLs, so deleted rows stop competing for the slot while
-- live ones still cannot be duplicated.
ALTER TABLE publications
    ADD COLUMN live_share_key VARCHAR(180)
        AS (IF(deleted_at IS NULL,
               CONCAT_WS('\n', author_user_id, reflection_id, audience, COALESCE(community_id, 0)),
               NULL)) VIRTUAL,
    ADD UNIQUE KEY uq_one_live_share_per_destination (live_share_key);

-- The feed reads newest first across an audience.
ALTER TABLE publications
    ADD KEY idx_publication_feed (audience, community_id, created_at);
