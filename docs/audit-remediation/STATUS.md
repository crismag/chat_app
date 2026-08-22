# Status

Living checklist for the 2026-08-22 audit. Default: **open**.

When a finding is done, set it to **done** and add the commit hash if you have one.

Do not mark done without tests named in the phase file.

**2026-08-22.** P0 was verified present in the working tree with green tests
rather than re-implemented, per [`CODEREVIEWERASSIST.md`](CODEREVIEWERASSIST.md).
P1–P4 are committed and merged to `main`; P5 is in progress on
`agent/audit-p5`. The MariaDB suites were run against a real server (10.11
locally; CI pins 11.8), so the durable tests that used to skip now pass.

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

- [x] B3 Merge all SQLite owner-scoped tables — publications, communities, memberships, reactions, saves, hides, mutes, blocks, share events, reports, Studio assets and profiles, in the same transaction as the conversations; `api/src/auth/guest-merge.test.ts`
- [x] Dual-store merge test (MysqlAuthStore + SqliteStore) — **executed** against MariaDB 10.11 on 2026-08-22 and passing, with all 50 previously-skipped MariaDB tests (642 api tests green with `MYSQL_*` set). Note the local version is 10.11; CI pins 11.8.
- [x] B4 Closed by evidence — `ChatPage.test.tsx` “the Send button path keeps a title typed during creation” passes; the free-typed Scripture field is retired (Bible selector), and `scripts/verify/reference-race.mjs` already targets the title. No code change.
- [x] B5 `share_events` inside the publish transaction — written by `publish()` in the same `BEGIN`; `share-atomicity.test.ts`
- [x] B6 Conversation delete in one SQLite transaction — publications, sections, messages and the conversation in one `BEGIN`; covered by the existing delete tests on both backings

## P3

- [x] Reflections list includes excerpt/preview/written — `cardOf` in the list route; `api/src/reflections/list-cards.test.ts`
- [x] ReflectionsPage no longer N+1 fetches details — the card reads the payload; only `full` density still fetches, and a test asserts a page makes no per-card request
- [x] `GET /api/reflections` queries by `userId` (no full-table scan) — `ConversationTable.byUser`, served by the existing `idx_conversations_user`; `api/src/reflections/list-scope.test.ts`
- [x] Community hydrate batched — one sections query, one tags query and one membership query per page instead of three per row; `community.test.ts` payloads unchanged plus a crossed-sections test
- [x] ChatPage loads communities when Share opens, not on every mount — via `fetchCommunities`; tests assert mount makes no request and `?share=1` does

## P4

- [~] ChatPage split into hooks — **assist** (`useReflectionAssist`) and **helper thread** (`useReflectionChat`) extracted, 2316 → 2078 lines. Workspace, edits and share still in the page.
- [ ] Chat sheets use shared `Sheet` — **attempted and reverted.** The shared Sheet pushes a history entry on open and pops it on cleanup; React's development double-mount delivers that pop to the remounted instance, which reads it as Back and closes. Chat sheets mount already-open (`{shareOpen ? <ShareSheet/> : null}`), so the share sheet stopped opening in a browser while every unit test still passed. Needs either the sheets kept mounted with `open` toggled, or the shared Sheet's history handling reworked — neither is a small change.
- [x] `web_app/src/reflections/api.ts` exists; pages stop scattering paths — ChatPage, ReflectionsPage, ReflectionViewPage and CreatePage all go through it; no raw `/conversations` path left outside the module
- [x] One report dialog — `shared/ui/ReportDialog.tsx` serves both publications and profiles; the profile's inline `ReportForm` is deleted
- [x] `MoreMenu` removed — ActionMenu called at the site; ChatPage tests unchanged

## P5

- [~] **In progress** (approved 2026-08-22). Schema is done and tested against a real MariaDB; the cutover itself — backfill, read flag, write flip, retirement — is not.
- [x] Schema decision recorded: live SQLite shape — `007` mirrors SQLite *semantics* while keeping MariaDB conventions (BIGINT + `public_uuid`, snake_case). The unused `chat_content`/`reflection_revisions` model is untouched and is not the target.
- [x] Community columns missing from MariaDB `003` added — migration `007`: community settings, `share_visibility`, `publication_hides`, `author_mutes`, `share_events`, the one-live-share rule and the feed index; `api/src/mysql/community-schema.test.ts` proves the rules against a real MariaDB
- [~] Backfill written and tested — `api/src/mysql/backfill-content.ts` copies live SQLite content into MariaDB keyed by `public_uuid`: re-runnable, replaces sections and messages rather than merging, skips (never reassigns) a reflection whose owner has no MariaDB account, and never writes to the source.
- [ ] Routes flipped — **not started.** Needs a content store on MariaDB, a backfill keyed by `public_uuid`, and a read flag defaulting off. Steps 4–5 (flip writes, retire SQLite) also need a production soak, so they cannot be closed from a development machine.
- [ ] SQLite live path retired
- [x] API loopback bind in production (S9) — done in P6
- [ ] Restore drill documented for **both** SQLite content and MariaDB accounts (O3)

## P6

- [~] **In progress** (approved 2026-08-22). Items below are ticked as they land; the ones still open are open on purpose — see the report.
- [ ] S6 CSRF/header
- [ ] S8 verification / disposable wiring
- [ ] AI route family merge
- [ ] `AI_ENABLED` / `CHAT_AI_DISABLED` merge
- [ ] Security headers
- [ ] CI subset of `scripts/verify`
- [ ] Public share single POST
- [x] S9 Loopback bind + XFF only from loopback — production binds `127.0.0.1`; `x-forwarded-for` is believed only from a loopback peer, and the two duplicate address readers in `bible/routes.ts` and `app.ts` now go through the one helper. `api/src/http/address.test.ts`
- [ ] S10 Account export/delete (only if named)
- [x] O1 Readiness probe — `GET /api/health/ready` pings content and, where accounts live across a network, MariaDB; `/api/health` is untouched liveness. `api/src/http/readiness.test.ts`
- [ ] O2 PHP gateway timeout
- [x] M1 Request IDs on generic HTTP — one middleware, echoed on every response, a client's own id honoured after being made safe to log; `api/src/http/request-id.test.ts`
- [x] M2 `app.onError` JSON `{ error }` — uncaught throws answer JSON with the request id; the driver's message goes to the log and never to a browser
- [x] S11 Studio image generate rate limit — 6/minute per account and 24/minute per address, 429 + `Retry-After`, using the existing sliding window; `image-routes.test.ts`
