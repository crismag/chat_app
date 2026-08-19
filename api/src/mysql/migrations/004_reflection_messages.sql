-- The conversation held beside a reflection.
--
-- This table reverses an earlier decision, and the reversal is deliberate
-- rather than a drift: migration 001 and `privacy.ts` were written on the rule
-- that AI conversation content never reaches the central database and lives on
-- the device instead. The published Privacy Policy says otherwise — "we may
-- collect ... AI conversations" — and a policy the product does not follow is
-- the worse of the two things to leave standing. The owner chose the policy.
--
-- What did NOT change is the rule beside it: `ai_usage_events` remains
-- non-content telemetry, and `schema.privacy.test.ts` still fails if a prompt
-- or a response is added to it. Storing a conversation the author can see and
-- delete is a different thing from keeping an archive inside usage metering.

CREATE TABLE reflection_messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_uuid CHAR(36) NOT NULL,
    reflection_id BIGINT UNSIGNED NOT NULL,
    -- Ordering is explicit rather than by id, so a message can be inserted or
    -- re-ordered later without the sequence depending on insert order.
    position INT NOT NULL,
    role VARCHAR(32) NOT NULL,
    content MEDIUMTEXT NOT NULL,
    -- What the model first said, kept beside what is shown, so an edited reply
    -- can never quietly become the record of what was generated.
    original_content MEDIUMTEXT NOT NULL,
    author_origin VARCHAR(32) NOT NULL,
    -- A draft offered by a reply, and the section it was offered for. Stored
    -- rather than held in the browser: a draft that vanishes on reload leaves
    -- a lead-in sentence pointing at nothing.
    draft_text MEDIUMTEXT NULL,
    draft_section VARCHAR(32) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_message_uuid (public_uuid),
    UNIQUE KEY uq_message_position (reflection_id, position),
    KEY idx_message_reflection (reflection_id, created_at),
    CONSTRAINT fk_message_reflection
        FOREIGN KEY (reflection_id)
        REFERENCES reflections(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
