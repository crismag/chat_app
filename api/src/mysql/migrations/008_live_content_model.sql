-- The reflection model the product actually edits.
--
-- MariaDB has carried a `reflections` table since the foundation migration,
-- with the C.H.A.T. sections inside a `chat_content` JSON document and a
-- revision table beside it. No HTTP route has ever read it. What the editor
-- writes, and what every live query filters and sorts by, is a different
-- shape: one row per reflection, one row per section, one row per message.
--
-- These tables are that shape. They are additive and unread: the legacy
-- `reflections` / `reflection_revisions` / `chat_content` tables are left
-- exactly as they are, because dropping them is a separate decision that needs
-- an inventory of whether anything has rows in them.
--
-- The names are prefixed rather than borrowed. `conversations` alone beside
-- `reflections` would leave two tables whose names both claim to be the thing
-- people write, and nothing in the schema to say which one is live.

-- One reflection.
--
-- `user_id` is a BIGINT into users, as everything else here is — but the id a
-- browser sees stays the UUID. The public identifier never becomes a number
-- somebody can count with.
CREATE TABLE conversations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_uuid CHAR(36) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    format VARCHAR(32) NOT NULL DEFAULT 'full',
    title TEXT NOT NULL,
    scripture_reference VARCHAR(255) NULL,
    visibility VARCHAR(32) NOT NULL DEFAULT 'private',
    -- The tags a person put on their own reflection. A JSON array in MariaDB
    -- is LONGTEXT with a validity check, and nothing queries inside it: the
    -- facets are built by reading a person's own rows, never by indexing here.
    tags LONGTEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_conversation_uuid (public_uuid),
    -- The collection reads one person's reflections, newest first, and filters
    -- them by whether they have been shared. Both orders are the ones the live
    -- list actually asks for.
    KEY idx_conversation_owner_recent (user_id, updated_at),
    KEY idx_conversation_owner_visibility (user_id, visibility),
    CONSTRAINT fk_conversation_owner
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One section of one reflection: Content, Heart, Application, Testimony, or
-- the two a Short reflection uses.
--
-- A row per section rather than a document, because that is what makes a
-- single field savable on its own and its authorship recordable beside it.
-- `author_origin` is the whole reason this is not JSON: whether words were
-- written, assisted or generated is a property of that section and has to
-- survive every later edit of the others.
CREATE TABLE conversation_sections (
    conversation_id BIGINT UNSIGNED NOT NULL,
    type VARCHAR(32) NOT NULL,
    content LONGTEXT NOT NULL,
    author_origin VARCHAR(32) NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (conversation_id, type),
    CONSTRAINT fk_section_conversation
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The thread beside the card.
--
-- `original_content` is kept next to `content` deliberately: when assistance
-- proposes a wording, what the person actually wrote is not overwritten by the
-- suggestion, and undo restores authorship rather than only text.
CREATE TABLE conversation_messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_uuid CHAR(36) NOT NULL,
    conversation_id BIGINT UNSIGNED NOT NULL,
    position INT UNSIGNED NOT NULL,
    role VARCHAR(32) NOT NULL,
    content LONGTEXT NOT NULL,
    original_content LONGTEXT NOT NULL,
    author_origin VARCHAR(32) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_conversation_message_uuid (public_uuid),
    -- Read in order, always, and only ever for one reflection at a time.
    KEY idx_message_conversation_position (conversation_id, position),
    CONSTRAINT fk_message_conversation
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
