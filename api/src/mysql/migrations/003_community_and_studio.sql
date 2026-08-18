-- Community, Create Studio and saved passages.
--
-- These follow the SQLite tables they replace rather than reinterpreting them,
-- because the rules they encode are load-bearing and already tested:
--
--   * a publication is a COPY of a reflection, not a pointer to one, so
--     choosing which sections appear cannot mutate the source;
--   * `audience` is one column with no join table, so "exactly one audience
--     per publication" is a property of the schema rather than a rule someone
--     has to remember;
--   * a reaction's primary key is (publication, user), so a doubled request
--     cannot inflate a count;
--   * a tag is stored folded AND as typed, and grants access to nothing.
--
-- Internal keys are BIGINT to match the tables already here. Anything a
-- browser, URL or mobile client sees is the CHAR(36) public UUID.

CREATE TABLE communities (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_uuid CHAR(36) NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    created_by_user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    closed_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_community_uuid (public_uuid),
    KEY idx_community_creator (created_by_user_id),
    CONSTRAINT fk_community_creator
        FOREIGN KEY (created_by_user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per person per community, carrying role and lifecycle state.
-- `muted_at` is a timestamp rather than a state so a mute restricts publishing
-- without disturbing the meaning of "currently active member", which is what
-- every access check compares against.
CREATE TABLE community_members (
    community_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'member',
    state VARCHAR(32) NOT NULL,
    muted_at DATETIME NULL,
    invited_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (community_id, user_id),
    KEY idx_member_user (user_id),
    KEY idx_member_state (community_id, state),
    CONSTRAINT fk_member_community
        FOREIGN KEY (community_id)
        REFERENCES communities(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_member_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE publications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_uuid CHAR(36) NOT NULL,
    author_user_id BIGINT UNSIGNED NOT NULL,
    reflection_id BIGINT UNSIGNED NOT NULL,
    audience VARCHAR(32) NOT NULL,
    community_id BIGINT UNSIGNED NULL,
    chat_type VARCHAR(32) NOT NULL,
    title VARCHAR(255) NOT NULL,
    scripture_reference VARCHAR(255) NULL,
    caption TEXT NOT NULL,
    moderation_state VARCHAR(32) NOT NULL DEFAULT 'visible',
    hidden_by_user_id BIGINT UNSIGNED NULL,
    hidden_at DATETIME NULL,
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_publication_uuid (public_uuid),
    KEY idx_publication_author (author_user_id),
    KEY idx_publication_reflection (reflection_id),
    KEY idx_publication_audience (audience, moderation_state),
    KEY idx_publication_community (community_id, created_at),
    CONSTRAINT fk_publication_author
        FOREIGN KEY (author_user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_publication_reflection
        FOREIGN KEY (reflection_id)
        REFERENCES reflections(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_publication_community
        FOREIGN KEY (community_id)
        REFERENCES communities(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The copied section text. `position` orders them; the primary key on
-- (publication, type) is what stops one section being published twice.
CREATE TABLE publication_sections (
    publication_id BIGINT UNSIGNED NOT NULL,
    type VARCHAR(32) NOT NULL,
    position INT NOT NULL,
    content MEDIUMTEXT NOT NULL,
    author_origin VARCHAR(32) NOT NULL,
    PRIMARY KEY (publication_id, type),
    CONSTRAINT fk_pubsection_publication
        FOREIGN KEY (publication_id)
        REFERENCES publications(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE publication_tags (
    publication_id BIGINT UNSIGNED NOT NULL,
    tag VARCHAR(190) NOT NULL,
    label VARCHAR(190) NOT NULL,
    PRIMARY KEY (publication_id, tag),
    KEY idx_tag (tag),
    CONSTRAINT fk_pubtag_publication
        FOREIGN KEY (publication_id)
        REFERENCES publications(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE publication_reactions (
    publication_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (publication_id, user_id),
    CONSTRAINT fk_reaction_publication
        FOREIGN KEY (publication_id)
        REFERENCES publications(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_reaction_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Saves are private to the person who made them. No count derived from this
-- table may reach the author of the publication.
CREATE TABLE publication_saves (
    publication_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (publication_id, user_id),
    KEY idx_save_user (user_id, created_at),
    CONSTRAINT fk_save_publication
        FOREIGN KEY (publication_id)
        REFERENCES publications(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_save_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE publication_reports (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_uuid CHAR(36) NOT NULL,
    publication_id BIGINT UNSIGNED NOT NULL,
    reporter_user_id BIGINT UNSIGNED NOT NULL,
    reason VARCHAR(64) NOT NULL,
    detail TEXT NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'open',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_report_uuid (public_uuid),
    KEY idx_report_publication (publication_id, state),
    CONSTRAINT fk_report_publication
        FOREIGN KEY (publication_id)
        REFERENCES publications(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_report_reporter
        FOREIGN KEY (reporter_user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The Create Studio document for a reflection. One per reflection, replaced
-- whole: the document is the editor's canonical state, not a set of fields
-- this application interprets.
CREATE TABLE studio_creations (
    reflection_id BIGINT UNSIGNED NOT NULL,
    document_json LONGTEXT NOT NULL,
    template_id VARCHAR(128) NOT NULL,
    template_version INT NOT NULL,
    asset_references_json LONGTEXT NOT NULL,
    export_metadata_json LONGTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (reflection_id),
    CONSTRAINT fk_studio_reflection
        FOREIGN KEY (reflection_id)
        REFERENCES reflections(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Generated and uploaded image bytes, owner-scoped.
--
-- LONGBLOB holds the same bytes SQLite held. It is bounded by the application
-- rather than by the column, and the row carries its provenance so an image's
-- origin travels with it rather than being inferred later.
CREATE TABLE studio_image_assets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_uuid CHAR(36) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    reflection_id BIGINT UNSIGNED NOT NULL,
    bytes LONGBLOB NOT NULL,
    content_type VARCHAR(128) NOT NULL,
    width INT NOT NULL,
    height INT NOT NULL,
    provenance_json LONGTEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_studio_asset_uuid (public_uuid),
    KEY idx_studio_asset_owner (user_id),
    KEY idx_studio_asset_reflection (reflection_id),
    CONSTRAINT fk_studio_asset_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_studio_asset_reflection
        FOREIGN KEY (reflection_id)
        REFERENCES reflections(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The passage a reflection was written against, exactly as it was retrieved.
--
-- Stored in full rather than re-fetched, and that is the point: looking it up
-- again "to be fresh" is how a year-old reflection quietly changes Bibles. The
-- reflections table carries the reference for display; this carries the words
-- and the attribution they must be shown with.
CREATE TABLE reflection_passages (
    reflection_id BIGINT UNSIGNED NOT NULL,
    provider VARCHAR(64) NOT NULL,
    translation_id INT NOT NULL,
    abbreviation VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    passage_id VARCHAR(128) NOT NULL,
    reference VARCHAR(255) NOT NULL,
    content MEDIUMTEXT NOT NULL,
    copyright TEXT NULL,
    publisher_url VARCHAR(1024) NULL,
    you_version_url VARCHAR(1024) NULL,
    retrieved_at DATETIME NOT NULL,
    PRIMARY KEY (reflection_id),
    CONSTRAINT fk_passage_reflection
        FOREIGN KEY (reflection_id)
        REFERENCES reflections(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
