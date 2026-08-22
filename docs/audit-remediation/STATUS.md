# Status

Living checklist for the 2026-08-22 audit. Default: **open**.

When a finding is done, set it to **done** and add the commit hash if you have one.

Do not mark done without tests named in the phase file.

**2026-08-22, branch `agent/audit-p1`.** P0 was verified present in the working
tree with green tests rather than re-implemented, per
[`CODEREVIEWERASSIST.md`](CODEREVIEWERASSIST.md). P1 is finished. Nothing in
this round is committed yet — see the report; `api/src/app.ts` carries three
separate uncommitted bodies of work and cannot be staged cleanly per finding.

A CodeReviewerAssist pass on 2026-08-22, plus three specialized lens reviews, added S9–S11, O1–O3, M1–M2, B5–B6 and retargeted B4. Inspect the tree before ticking P0 — those items may already be in uncommitted code. See [`CODEREVIEWERASSIST.md`](CODEREVIEWERASSIST.md).

---

## P0

- [x] B1 Reset URL allowlist + HTML escape — in tree; `publicWebOrigin()` in `api/src/http/origins.ts`, `origins.test.ts` + `password-reset.test.ts` green
- [x] S2 Reset tokens never logged — `LoggingMailer` omits the body; `api/src/mail/mailer.test.ts` asserts no token. **Production fail-closed policy still gated** (APPROVALS).
- [x] S1 Login rate limit — in tree; `api/src/auth/rate-limit.test.ts` green
- [x] S7 Register/guest rate limit — in tree; same suite. **Dropping `accountExists` remains gated.**
- [x] S3 SQLite session token hashing — `hashSessionToken` in `api/src/db.ts` with dual-read; `db.test.ts` green
- [x] S4 `registeredUser` uses `accountType`; Google verification — in tree; `google-signin.test.ts` green
- [x] S5 Invites use `auth.findByEmail` — in tree (`userIdByEmail` is async)

## P1

- [x] Delete `GET /api/library` — handler already gone; `app.test.ts` retargeted to `/api/reflections`
- [x] Delete `GET /api/community` — handler already gone; alias-only tests removed (live coverage: `community.test.ts` “a private reflection never appears in any Community response”)
- [x] Delete `POST /api/creations` — handler removed, with the imports and `requireUser` helper it was the last caller of
- [x] B2 `MessageTable.set` — already absent; no `messages.set` caller in the repo
- [x] S8 Deleted `config/email-lists/disposable-domains.txt` — zero readers repo-wide; **not wired** (wiring stays gated)
- [x] Stale docs corrected — ARCHITECTURE (accounts on MariaDB, content on SQLite), dev README (transcripts reversed by `004`), shares→publications (MOBILE, MVP_PLAN, PRODUCT_READINESS), deleted-alias claims (README, PRODUCT, MVP_PLAN, ARCHITECTURE, PRODUCT_READINESS), deploy README (two backup targets, bind is not loopback yet), `.env.example` (`CHAT_DISABLE_*`, `SMTP_*`, `GOOGLE_CLIENT_ID`)

## P2

- [ ] B3 Merge all SQLite owner-scoped tables
- [ ] Dual-store merge test (MysqlAuthStore + SqliteStore)
- [ ] B4 Title Send-button race verified or closed (do not resurrect Scripture input)
- [ ] B5 `share_events` inside the publish transaction
- [ ] B6 Conversation delete in one SQLite transaction

## P3

- [ ] Reflections list includes excerpt/preview/written
- [ ] ReflectionsPage no longer N+1 fetches details
- [ ] `GET /api/reflections` queries by `userId` (no full-table scan)
- [ ] Community hydrate batched
- [ ] ChatPage loads communities when Share opens, not on every mount

## P4

- [ ] ChatPage split into hooks (workspace, edits, assist, helper, share)
- [ ] Chat sheets use shared `Sheet`
- [ ] `web_app/src/reflections/api.ts` (or equivalent) exists; pages stop scattering paths
- [ ] One report dialog
- [ ] `MoreMenu` removed

## P5

- [ ] Not started (requires approval)
- [ ] Schema decision recorded: live SQLite shape
- [ ] Community columns missing from MariaDB `003` added
- [ ] Routes flipped
- [ ] SQLite live path retired
- [ ] API loopback bind in production (S9 — also listed under P6)
- [ ] Restore drill documented for **both** SQLite content and MariaDB accounts (O3)

## P6

- [ ] Not started (item-by-item approval)
- [ ] S6 CSRF/header
- [ ] S8 verification / disposable wiring
- [ ] AI route family merge
- [ ] `AI_ENABLED` / `CHAT_AI_DISABLED` merge
- [ ] Security headers
- [ ] CI subset of `scripts/verify`
- [ ] Public share single POST
- [ ] S9 Loopback bind + XFF only from loopback
- [ ] S10 Account export/delete (only if named)
- [ ] O1 Readiness probe
- [ ] O2 PHP gateway timeout
- [ ] M1 Request IDs on generic HTTP
- [ ] M2 `app.onError` JSON `{ error }`
- [ ] S11 Studio image generate rate limit
