-- Guests are users.
--
-- The alternative was a second table -- an "owner", or an "anonymous session"
-- -- that content could point at instead of a user. That design works right up
-- until somebody registers, at which point every row pointing at the owner has
-- to be found and rewritten, and a migration that runs during a sign-up is a
-- migration that will one day half-run during a sign-up.
--
-- So there is one kind of owner. A guest gets an ordinary `users` row with
-- `account_type = 'ANONYMOUS'`, and registering is an UPDATE of that row:
-- credentials are attached, the type changes, the id does not, and nothing
-- that belongs to them moves at all.
--
-- `account_type` is stored rather than inferred from `local_credentials` being
-- absent. "Has no password" and "has not registered" are different facts -- a
-- single-sign-on account would have the first and not the second -- and a
-- product rule that has to be derived from a join is a product rule that will
-- be derived differently in two places.

ALTER TABLE users
    ADD COLUMN account_type VARCHAR(16) NOT NULL DEFAULT 'REGISTERED' AFTER public_uuid,
    -- Display and audit metadata. Never an identity, and never a credential:
    -- nothing anywhere looks an account up by this column.
    ADD COLUMN guest_name VARCHAR(64) NULL AFTER account_type,
    ADD COLUMN guest_created_at DATETIME NULL AFTER guest_name,
    ADD COLUMN registered_at DATETIME NULL AFTER guest_created_at,
    ADD COLUMN email_verified_at DATETIME NULL AFTER registered_at,
    -- How the account came to exist. Kept because it cannot be reconstructed
    -- afterwards, and deliberately coarse: `device_class` has three buckets
    -- because the only question worth answering later is whether guests are
    -- being made on phones. A finer measurement of somebody's hardware would
    -- be a fingerprint, and this application does not build those.
    ADD COLUMN creation_method VARCHAR(32) NULL AFTER email_verified_at,
    ADD COLUMN creation_source VARCHAR(48) NULL AFTER creation_method,
    ADD COLUMN platform VARCHAR(16) NULL AFTER creation_source,
    ADD COLUMN device_class VARCHAR(16) NULL AFTER platform,
    ADD COLUMN last_seen_at DATETIME NULL AFTER device_class,
    -- Set when this guest's work was moved into an account that already
    -- existed. The row is retired rather than deleted, so a credential still
    -- sitting in somebody's browser resolves to something known.
    ADD COLUMN merged_into_user_id BIGINT UNSIGNED NULL AFTER last_seen_at,
    ADD UNIQUE KEY uq_users_guest_name (guest_name),
    ADD KEY idx_users_account_type (account_type),
    ADD CONSTRAINT fk_users_merged_into
        FOREIGN KEY (merged_into_user_id)
        REFERENCES users(id)
        ON DELETE SET NULL;

-- Every account that existed before this migration was registered by somebody.
UPDATE users SET registered_at = created_at, creation_method = 'REGISTRATION';

-- How a guest proves, on their next visit, that they are the same guest.
--
-- The credential is a long random value held in a cookie; what is stored here
-- is its SHA-256, for the same reason a password's hash is stored rather than
-- the password. A database that leaked would contain nothing replayable.
--
-- Separate from the user row because it is revocable and replaceable without
-- touching the account, and because a future native application installation
-- is another row here rather than another user.
--
-- Nothing in this table describes the device. `platform` is WEB or the name of
-- an app, and `installation_id` is a value an app generates for itself --
-- neither is derived from hardware, and neither is ever used to recognise
-- somebody who has lost their credential.
CREATE TABLE anonymous_credentials (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL,
    installation_id VARCHAR(128) NULL,
    platform VARCHAR(16) NOT NULL DEFAULT 'WEB',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NULL,
    revoked_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_anonymous_credential_token (token_hash),
    KEY idx_anonymous_credential_user (user_id),
    CONSTRAINT fk_anonymous_credential_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The next number for each guest base name.
--
-- A counter rather than random digits, so `QuietCedar-14` means what it looks
-- like it means and encodes nothing about the person. Allocated by an atomic
-- increment, because the entire value of a sequence is that two callers
-- arriving in the same millisecond cannot be handed the same number.
CREATE TABLE guest_name_sequences (
    base_name VARCHAR(48) NOT NULL,
    next_sequence BIGINT UNSIGNED NOT NULL DEFAULT 1,
    PRIMARY KEY (base_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
