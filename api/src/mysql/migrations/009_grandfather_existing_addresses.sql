-- Accounts that existed before confirming was asked of anybody.
--
-- Publishing now requires a confirmed address. That rule is about accounts
-- opened with a mailbox nobody can read, and it should apply to accounts
-- opened from here on — not reach backwards and stop people who have been
-- sharing for months, who never had a link to open because nothing sent one.
--
-- So every account that exists at this moment is treated as confirmed. Not
-- because their addresses have been proved, but because they were accepted
-- under the rules of the day and a migration is not the place to revoke that.
-- Anyone registering after this runs gets the link and the requirement.
--
-- Deliberately not conditional on a date written into this file: "before this
-- migration ran" is exactly the set of rows present when it runs, and a
-- migration runs once.
UPDATE users
   SET email_verified_at = COALESCE(email_verified_at, created_at, NOW())
 WHERE email_verified_at IS NULL
   AND account_type = 'REGISTERED';
