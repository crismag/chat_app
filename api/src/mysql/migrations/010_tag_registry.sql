-- The tag registry, in the store content is moving to.
--
-- Additive and unread, exactly as 008 was: the live registry is the SQLite pair
-- of the same name, and these exist so the one-database phase has the tables
-- waiting rather than inventing them under a deadline. Nothing in `api/src`
-- queries them yet.
--
-- Two counts, and they are not the same number. The distinction is the whole
-- privacy design of this feature, so it is written into the schema comments as
-- well as the code: `public_count` is uses on content its author published and
-- is the only count that ranks a tag for a stranger; `user_tag_usage` is one
-- person's own use, private ones included, and is only ever read on that same
-- person's behalf.

-- One row per canonical tag.
--
-- `normalized_name` is what `canonicalHashtag` produces: NFC, lowercased, no
-- leading #, separators removed entirely, 40 characters at most. Because
-- separators are removed rather than normalised, `bible-study`, `biblestudy`
-- and `bible study` are already one tag here and need no merge.
--
-- The UNIQUE is the concurrency guarantee rather than a hint. Two requests
-- inserting the same new tag at the same moment cannot both succeed, so the
-- registry cannot acquire two rows for one word; the application-side lookup is
-- an optimisation on top of that, never the rule.
--
-- utf8mb4 at 191 characters, not 255: a unique index on utf8mb4 is limited by
-- InnoDB's key length, and 40 is the value the fold actually enforces.
CREATE TABLE tags (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_uuid CHAR(36) NOT NULL,
    normalized_name VARCHAR(191) NOT NULL,
    display_name VARCHAR(191) NOT NULL,
    public_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    -- active | hidden | blocked | merged. Only `active` is suggestable, and
    -- `blocked` also refuses new use — a tag is retired without deleting the
    -- rows that reference it, because destroying content relationships to
    -- moderate a word is not a repair.
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    -- Set only on a `merged` row, pointing at the tag it became. Future-facing:
    -- nothing merges tags in this version.
    merged_into_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_used_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_tag_uuid (public_uuid),
    UNIQUE KEY uq_tag_normalized (normalized_name),
    -- The suggestion query is a prefix over the normalized name within one
    -- status, and a popularity order within one status. Both orders are the
    -- ones the live query asks for.
    KEY idx_tag_suggest (status, normalized_name),
    KEY idx_tag_popular (status, public_count),
    CONSTRAINT fk_tag_merged_into
        FOREIGN KEY (merged_into_id) REFERENCES tags(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per person per tag.
--
-- Read only ever with a user_id in the WHERE. This is what lets somebody's own
-- vocabulary rank first for them without any of it becoming visible to anybody
-- else — a tag used once, privately, has a row here and a `public_count` of 0.
CREATE TABLE user_tag_usage (
    user_id BIGINT UNSIGNED NOT NULL,
    tag_id BIGINT UNSIGNED NOT NULL,
    usage_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    last_used_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_id, tag_id),
    KEY idx_user_tag_recent (user_id, last_used_at),
    CONSTRAINT fk_user_tag_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_tag_tag
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
