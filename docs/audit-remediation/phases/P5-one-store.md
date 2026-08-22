# P5 — One database

**Do not start this phase without Cris’s explicit approval.** It is a data migration, not a refactor.

---

## Decision that is already made in the audit (confirm before DDL)

The live product model is SQLite:

- `conversations` + `sections` + `messages`
- community tables **including** `discoverability`, `joinPolicy`, `reflectionVisibility`, `approvalPolicy`, `shareVisibility`, `publication_hides`, `author_mutes`, `share_events`, one-share unique index
- profiles with handle + favourite verses
- studio_creations / studio_image_assets
- reflection_passages

The unused MariaDB model in `001`–`004` (`chat_content` JSON, `reflection_revisions`, `reflection_images`, `user_settings`, `ai_usage_*`) is **not** the cutover target.

If any production MariaDB already has rows in those unused tables, inventory them before DROP. If empty, they may be dropped or left unused — prefer drop only with approval.

MariaDB 11.8 stores declared `JSON` as `LONGTEXT` + `json_valid`. Do not rely on JSON path indexes. Anything you query belongs in a column. See [`../development/ARCHITECTURE.md`](../../development/ARCHITECTURE.md).

---

## Suggested sequence (each step its own commit or PR)

1. **Schema gap-fill** — additive migration `007_…sql` that adds missing community columns/tables/indexes to match SQLite semantics. No route flip.
2. **Write path dual-write or backfill scripts** — copy SQLite content keyed by `public_uuid` / conversation id. Guest merge (P2) must already be complete so you do not copy orphans.
3. **Read path feature flag** — one env var, default off, to read reflections/community from MariaDB. Keep SQLite write until reads are proven.
4. **Flip writes** — still keep SQLite until a soak.
5. **Retire SQLite** — `SqliteStore` / SqliteAuthStore / scrypt `local-password.ts` / `DATABASE_PATH` for product data.
6. **Tests** — HTTP tests against MariaDB the way `community.test.ts` hits SQLite today. Stop using MemoryStore as the default `createApp` for IDOR tests.
7. **Bind** `serve({ hostname: '127.0.0.1', port })` in production. Keep PHP gateway until the host exposes Node without it. This is also **S9**: `addressOf` must not trust `X-Forwarded-For` from a non-loopback peer, because guest/register/forgot-password are IP-metered. PHP already sets XFF to `REMOTE_ADDR`. See [`../CODEREVIEWERASSIST.md`](../CODEREVIEWERASSIST.md).

Define the **removal condition** in the PR for any dual-write: e.g. “remove SQLite reads when `CONTENT_STORE=mysql` has been default in production for N days and backups restored cleanly.”

---

## What you must not do

- Flip routes onto `ReflectionService` as it exists today without mapping it to the live section/message model.
- Introduce a second user id in URLs (keep UUID public ids).
- Drop PHP gateway as part of “simplification” while Hostinger still needs it.
- Add Redis to make dual-write feel safer.

---

## Indexes to include when you write the real content schema

Match actual WHERE/ORDER BY:

- conversations `(userId, updatedAt)`, `(userId, visibility)`
- sessions already hashed; index `userId`
- `studio_image_assets (conversationId)`, `(userId)`
- publications feed `createdAt` as used by the live feed query

---

## Verification

- CI MariaDB 11.8 migrate + full `npm test`
- Restore drill: backup **SQLite content file and MariaDB accounts** (O3), restore, login, open a private reflection, open a publication
- Do not leave live prefs on SQLite `profile_preferences` and unused MariaDB `user_settings` — pick one in the target store
- Privacy: stranger 404s, community VISIBLE_TO still in SQL on the new store
