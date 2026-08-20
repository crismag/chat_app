-- Getting back in when the password is gone.
--
-- Only the hash of the token is stored. The token itself is in somebody's
-- inbox, and for the hour it lives it is a way into their account — a database
-- that leaked must not contain a working one for every pending reset.
--
-- `used_at` rather than a delete, so a link that has already been used can be
-- told apart from one that never existed. The first deserves "that link has
-- been used"; the second deserves nothing at all.
CREATE TABLE password_resets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_password_reset_token (token_hash),
    KEY idx_password_reset_user (user_id),
    KEY idx_password_reset_expiry (expires_at),
    CONSTRAINT fk_password_reset_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
