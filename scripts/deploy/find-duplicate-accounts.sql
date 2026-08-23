-- Addresses that ended up owning more than one account.
--
-- Read-only. Run it against the live database before changing anything:
--
--   mysql -h "$MYSQL_HOST" -u "$MYSQL_USER" -p "$MYSQL_DATABASE" \
--     < scripts/deploy/find-duplicate-accounts.sql
--
-- ── Why an address can be in two places ─────────────────────────────────────
--
-- There is no `email` column on `users`. An address reaches an account by one
-- of two routes and they are different tables:
--
--   local_credentials.username                   a password account
--   user_identities.provider_data->>'$.email'    a Google account
--
-- `local_credentials.username` is unique and `(provider, provider_user_id)` is
-- unique, but no key spans the two — so nothing in the schema ever refused the
-- same address appearing once in each. That is what these queries find.
--
-- The application no longer creates them: signing in with Google now joins the
-- identity to the account that already holds the confirmed address, and
-- registering with an address a provider identity already holds is refused.
-- These queries are for the accounts that were split before that.

-- 1. Every address held by more than one account.
SELECT
    held.address,
    COUNT(DISTINCT held.user_id)                     AS accounts,
    GROUP_CONCAT(DISTINCT held.via ORDER BY held.via) AS routes,
    GROUP_CONCAT(DISTINCT u.public_uuid ORDER BY u.public_uuid) AS account_uuids
FROM (
    SELECT user_id, LOWER(TRIM(username)) AS address, 'password' AS via
      FROM local_credentials
     WHERE username IS NOT NULL
    UNION ALL
    SELECT user_id,
           LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(provider_data, '$.email')))) AS address,
           provider AS via
      FROM user_identities
     WHERE JSON_UNQUOTE(JSON_EXTRACT(provider_data, '$.email')) IS NOT NULL
) AS held
JOIN users u ON u.id = held.user_id
WHERE u.deleted_at IS NULL
GROUP BY held.address
HAVING COUNT(DISTINCT held.user_id) > 1
ORDER BY accounts DESC, held.address;

-- 2. One address in full, so the owner is decided on evidence rather than guess.
--
-- Set @address first:
--     SET @address = 'csmagala@gmail.com';
--
-- `confirmed_at` is the column that decides it. Whoever proved the mailbox owns
-- the address; the other row is the accident. `reflections` says which one the
-- work is actually sitting in — and it is not always the same row, which is the
-- whole reason to look before merging rather than after.
SET @address = LOWER(TRIM(COALESCE(@address, '')));

SELECT
    u.public_uuid                                   AS account_uuid,
    held.via                                        AS reached_by,
    u.status,
    u.email_verified_at                             AS confirmed_at,
    u.created_at,
    u.last_login_at,
    (SELECT COUNT(*) FROM reflections r
      WHERE r.user_id = u.id AND r.deleted_at IS NULL) AS reflections,
    (SELECT COUNT(*) FROM reflections r
      WHERE r.user_id = u.id AND r.deleted_at IS NULL
        AND r.visibility <> 'PRIVATE')                AS shared,
    (SELECT COUNT(*) FROM user_sessions s
      WHERE s.user_id = u.id)                         AS sessions
FROM (
    SELECT user_id, LOWER(TRIM(username)) AS address, 'password' AS via
      FROM local_credentials
     WHERE username IS NOT NULL
    UNION ALL
    SELECT user_id,
           LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(provider_data, '$.email')))) AS address,
           provider AS via
      FROM user_identities
     WHERE JSON_UNQUOTE(JSON_EXTRACT(provider_data, '$.email')) IS NOT NULL
) AS held
JOIN users u ON u.id = held.user_id
WHERE held.address = @address
  AND u.deleted_at IS NULL
ORDER BY u.email_verified_at IS NULL, u.created_at;
