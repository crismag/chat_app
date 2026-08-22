# Findings catalog

IDs are stable. Use them in commits (`fix S3: hash SQLite session tokens`) and in [`STATUS.md`](STATUS.md).

Line numbers were recorded 2026-08-22. Re-verify in the file.

Severity: Critical / High / Medium / Low.

Every finding includes: what is wrong, why it matters, the intended fix, tests, and whether external behavior changes.

---

## Bugs

### B1 — Password-reset links trust request `Origin`

- Severity: **Critical**
- Phase: P0 (gated — [`APPROVALS.md`](APPROVALS.md))
- Files: [`api/src/app.ts`](../../api/src/app.ts) ~207–208, ~959; [`api/src/auth/password-reset.ts`](../../api/src/auth/password-reset.ts) `resetUrl`, `resetEmail`
- What: `webOrigin(c)` is `c.req.header('origin')` with fallback to the first `CHAT_WEB_ORIGINS` entry. It is **not** checked against `webOrigins()` in [`api/src/http/origins.ts`](../../api/src/http/origins.ts). HTML is `` <a href="${link}"> ``.
- Why: Attacker sets `Origin: https://attacker.example`, victim receives a real token URL on the attacker host, replays the token on `/api/auth/reset-password`. Crafted Origin can also break the HTML attribute.
- Fix: Build the link only from configured allowlist (dedicated `CHAT_PUBLIC_WEB_ORIGIN` or first *deployed* origin, not a random `Origin` header). Ignore request Origin for this purpose. HTML-escape the href. Fail closed if no public origin is configured in production.
- Tests: forged Origin must not appear in `mailer.send` payload; allowlisted origin is used; missing production config does not emit an attacker URL.
- External behavior: reset emails always point at the real site.

### B2 — `MessageTable.set` has 9 placeholders and 10 binds

- Severity: Medium (latent; unused)
- Phase: P1
- Files: [`api/src/db.ts`](../../api/src/db.ts) ~1297–1321. `append` (~1277) is correct (10 `?`). Live callers use `append` only (`app.ts`).
- Fix: Delete `set` if nothing needs replace-all; otherwise add the tenth `?`.
- Tests: repo grep that `messages.set` is absent, or a round-trip test if kept.
- External behavior: none.

### B3 — Guest merge moves only SQLite `conversations`

- Severity: High
- Phase: P2
- Files: [`api/src/db.ts`](../../api/src/db.ts) `accounts.merge` ~840–854; [`api/src/auth/store.ts`](../../api/src/auth/store.ts) `MysqlAuthStore.merge` ~487–495 (returns 0 for content); login/Google in `app.ts` call both.
- What: Merge updates `conversations.userId` and marks the guest. It does not move publications, members, profiles, studio assets, passages, saves, etc.
- Why: Guest publishes or joins, then signs into an existing account → orphaned rows under the old id.
- Fix: One SQLite transaction that reassigns every owner-scoped table. Keep MariaDB merge as session/installation revoke + merged mark. Do not pretend MariaDB content moved until P5.
- Tests: guest with conversation + publication + membership + profile + studio asset + passage; after password or Google login into another account, all owner ids match the target.
- External behavior: more complete merge (correctness).

### B4 — Create-race may still wipe in-progress title (Scripture field retired)

- Severity: High if still present; likely **title-only** now
- Phase: P2
- Files: [`web_app/src/chat/ChatPage.tsx`](../../web_app/src/chat/ChatPage.tsx); [`web_app/src/chat/ChatPage.test.tsx`](../../web_app/src/chat/ChatPage.test.tsx) “Send button path keeps a title typed during creation”; `scripts/verify/reference-race.mjs`
- What: PRODUCT_READINESS recorded a Scripture-reference race on Send. CodeReviewerAssist (2026-08-22) found the free-typed reference field is gone (Bible selector). The unit test and verify script now target **title** typed while create is in flight. Verify scripts are not in CI.
- Fix: Confirm Send+title is covered. If the test exists and passes, close B4 as “title race covered; Scripture input retired.” Do not resurrect a free-typed reference field. If the test is missing or fails, fix the reset-on-open path so in-progress title edits are not treated as a conversation switch.
- Tests: existing ChatPage unit test; optional local `scripts/verify/reference-race.mjs`. Do not add Selenium to CI unless P6 CI-verify is approved.
- External behavior: none if already fixed; data-loss fix if not.

---

## Security

### S1 — Password login is not rate-limited

- Severity: High
- Phase: P0 (gated)
- Files: `POST /api/auth/login` in [`api/src/app.ts`](../../api/src/app.ts) ~747–753. Google uses `SlidingWindowRateLimiter(10)`; forgot-password uses 5/hour.
- Threat: Online brute force. Register already discloses existence (409 + `accountExists`).
- Fix: Per-email and per-IP sliding window, same helper as Google. `429` + `Retry-After`. Do not add CAPTCHA or Redis.
- Tests: burst → 429; later attempt allowed; limiter must not change the generic `Invalid email or password` body for 401s.
- External behavior: abusive clients get 429.

### S2 — Unconfigured SMTP logs the reset URL

- Severity: High
- Phase: P0 (gated for fail-closed production)
- Files: [`api/src/mail/mailer.ts`](../../api/src/mail/mailer.ts) `LoggingMailer` ~107–128
- Threat: Logs become bearer tokens. API still returns the same success message (intentional anti-enumeration).
- Fix: Never log token material. Redact to `to` + token id/hash prefix if you must log. In `NODE_ENV=production`, do not use LoggingMailer for reset (fail the send path internally without changing enumeration wording — wait, fail-closed that still returns the generic message is possible: do not send, do not log token, still return `RESET_REQUESTED_MESSAGE`. Prefer that over disclosing mail failure only for existing accounts. If Cris wants a hard boot failure without SMTP, that is the other option in APPROVALS.)
- Tests: LoggingMailer never contains `reset-password?token=`; production configuration documented.
- External behavior: only if you choose boot-fail. Prefer silent generic success + no token in logs unless Cris asks for boot-fail.

### S3 — SQLite stores raw session tokens

- Severity: High on SQLite path
- Phase: P0
- Files: [`api/src/db.ts`](../../api/src/db.ts) `sessions.token` PK ~186–195; contrast MariaDB `token_hash` in persistence.
- Threat: Stolen `chat.sqlite` is stolen sessions. Installations are already hashed on both paths.
- Fix: Store `sha256(token)` (same helper as MariaDB `hashSessionToken`). Look up by hash. Cookie still holds the raw token. Dual-read during rollout or revoke all SQLite sessions once.
- Tests: authenticate with cookie; row in DB is not the cookie value; old raw-token rows either still work (dual-read) or are documented as logged-out.
- External behavior: none for clients if dual-read; users may need to sign in again if you revoke.

### S4 — Registered gate uses `user.email`, not `accountType`

- Severity: High on MariaDB + Google
- Phase: P0 (gated)
- Files: `registeredUser` in [`api/src/app.ts`](../../api/src/app.ts) ~389–394; `MysqlAuthStore.account` / `userForToken` in [`api/src/auth/store.ts`](../../api/src/auth/store.ts) ~278–288, ~453–456; Google route never calls `markEmailVerified`.
- What: Community and profile routes get `registeredUser`. Google-only MariaDB users have no `local_credentials` username, so later `account(id)` yields `email: null`.
- Why: They are fail-closed out of community/profile. Hydrating unverified provider email into the same check would be fail-open later.
- Fix: `accountType === REGISTERED`. Persist provider email if you need it for display. Call `markEmailVerified` when Google `email_verified` is true. Do not use “string present” as the authz predicate.
- Tests: Google-only MysqlAuthStore user; `GET /api/profiles/me` and a community write succeed; a guest still cannot.
- External behavior: Google users get registered capabilities.

### S5 — Invites resolve email on SQLite accounts

- Severity: Medium
- Phase: P0
- Files: [`api/src/app.ts`](../../api/src/app.ts) ~647 `userIdByEmail: (email) => store.accounts.byEmail(email)?.id`
- Fix: `await auth.findByEmail(email)` then `.id`. The community routes type is currently sync — you may need to make that callback async. Do the smallest typing change.
- Tests: with MysqlAuthStore + SqliteStore content, invite by the MariaDB user’s email resolves.
- External behavior: invites work in production MariaDB mode (bugfix).

### S6 — No CSRF; native cookies are `SameSite=None`

- Severity: Medium
- Phase: P6 (gated)
- Files: [`api/src/auth/session-cookie.ts`](../../api/src/auth/session-cookie.ts); [`api/src/auth/identity.ts`](../../api/src/auth/identity.ts)
- Threat: Cross-site POST from a page opened in a WebView can carry cookies. CORS does not block the state change.
- Fix: Require `X-Requested-With` (or double-submit) on cookie-authenticated mutations; send it from `web_app/src/shared/api/client.ts`.
- External behavior: clients must send the header.

### S7 — Register enumerates; register/guest unmetered

- Severity: Medium
- Phase: P0 for rate limits (gated); enumeration body change separately gated
- Files: register ~715–728, guest ~665+ in `app.ts`
- Fix: Rate-limit both, same limiter style. Keep `accountExists` unless Cris approves removing it.
- External behavior: 429 under abuse.

### S8 — Disposable list unused; no email verification

- Severity: Medium
- Phase: P1 delete unused file **or** P6 wire it (gated)
- Files: [`config/email-lists/disposable-domains.txt`](../../config/email-lists/disposable-domains.txt) (~8500 domains, zero TS imports)
- Fix in P1: delete the unused artifact (and any generator script if one exists) unless Cris wants it kept for a later P6. Do not wire “while you’re here.”
- External behavior: none if deleted; yes if wired.

### Low notes (do not start work unless in P6)

- No CSP / HSTS / `frame-ancestors` on the web shell.
- Studio may serve `image/svg+xml` (profile upload correctly rejects SVG). Drop SVG from generated assets only if Cris names it; not S11.
- `profile_preferences` (SQLite, live) vs MariaDB `user_settings` (unused by profile routes) — drop the unused one in P5.
- Password minimum is 8 characters.
- Installation cookies ~400 days, no server idle timeout for registered persistent installs.
- In-memory limiters do not span processes (single process today).

### S9 — API binds every interface; IP limiters trust `X-Forwarded-For`

- Severity: High if port 8000 is reachable besides the PHP forwarder
- Phase: P6 (or the bind step of P5). Gated as ops — [`APPROVALS.md`](APPROVALS.md)
- Files: [`api/src/index.ts`](../../api/src/index.ts) `serve({ fetch, port })` (no `hostname`); [`api/src/http/address.ts`](../../api/src/http/address.ts); [`scripts/deploy/chatapi/index.php`](../../scripts/deploy/chatapi/index.php) (assumes `127.0.0.1:8000`, sets `X-Forwarded-For` to `REMOTE_ADDR`)
- Threat: Guest, register, and forgot-password are IP-metered. A client that can hit Node directly can send `X-Forwarded-For` and rotate the bucket. Login still has a per-email cap. The original audit filed this as a low note *if* Node is loopback-only; the process is **not** bound to loopback in code.
- Fix: `hostname: '127.0.0.1'` when `NODE_ENV=production`. Trust `X-Forwarded-For` only from a loopback peer. Keep PHP gateway. Do not add Redis.
- Tests: production serve options include loopback; a non-loopback request’s spoofed XFF does not become `addressOf` (or is irrelevant because the port is unreachable). Do not weaken per-email login limits.
- External behavior: none if Node was already firewalled; if it was public, it becomes unreachable except via PHP.

### S10 — No user data export or account-delete product path

- Severity: Medium (privacy / operator)
- Phase: P6, gated
- Files: `MysqlPersistence.deleteUserGraph` (tests); no authenticated user route
- What: Reports and blocks have write endpoints and no operator inbox. Users cannot export or delete an account in-product.
- Fix: Only if Cris names S10. First a documented operator procedure, then a registered-user delete that covers **SQLite content and MariaDB accounts**. Do not build an admin UI “while you’re in profiles.”
- External behavior: yes (new capability). Do not implement unasked.

### O1 — `GET /api/health` never checks a store

- Severity: Medium (operations)
- Phase: P6, gated (probe change)
- Files: [`api/src/app.ts`](../../api/src/app.ts) `/api/health`; frontend `web_app/src/shared/api/health.ts` (this is `/api` + `/health` → `/api/health`, which is correct)
- Fix: Add a readiness check that opens SQLite and, when configured, MariaDB. Prefer a new path or query so existing `{ status: 'ok' }` liveness stays stable unless Cris wants the old path to fail closed.
- External behavior: only if the existing path starts returning 503.

### O2 — PHP gateway timeout is 30s; assistance can exceed it

- Severity: Medium
- Phase: P6, gated
- Files: [`scripts/deploy/chatapi/index.php`](../../scripts/deploy/chatapi/index.php) `TIMEOUT_SECONDS = 30`
- Fix: Align with API/AI timeouts or document the 30s ceiling. Do not change it inside P0/P1.
- External behavior: longer (or still failing) AI calls through production.

### M1 — Request IDs only on AI and Bible calls

- Severity: Low
- Phase: P6 (logging; extra error field allowed)
- Files: `api/src/ai/routes.ts`, `api/src/bible/routes.ts`; no generic Hono middleware
- Fix: Assign a request id per HTTP request; log it; optionally echo on error JSON. Never log tokens, reset URLs, or message bodies.
- Tests: an auth 401 JSON may include `requestId`; logs for that request contain the same id in a test double if you inject a logger.
- External behavior: additive JSON field only.

### S11 — Studio image generation is unmetered

- Severity: **High** when a billed provider is wired; Low with the deterministic local provider
- Phase: P6, gated (429s)
- Files: [`api/src/create/image-routes.ts`](../../api/src/create/image-routes.ts) ~79–137 (auth + ownership only). Contrast AI `AiRateLimiter` / `AI_RATE_LIMIT_PER_MINUTE`.
- Threat: Cost / DoS once `STUDIO_IMAGE_PROVIDER` is a real model.
- Fix: Reuse the existing sliding-window helper (per-user and per-address). Kill switch `IMAGE_GENERATION` stays. Do not add Redis.
- Tests: burst generate → 429 + Retry-After; one honest generate still 200.
- External behavior: abusive clients get 429.

### B5 — `share_events` written after the publication commit

- Severity: Medium
- Phase: P2 (integrity; separate commit from B3)
- Files: [`api/src/community/store.ts`](../../api/src/community/store.ts) `publish()` commits ~1100–1155; [`api/src/community/routes.ts`](../../api/src/community/routes.ts) `recordShare` after ~1152–1171
- Why: A crash between insert and `share_events` leaves a publication that did not count against share ceilings.
- Fix: Insert `share_events` in the same `BEGIN` as the publication row.
- Tests: existing share-limit tests; if you can inject failure after insert, both rows roll back.
- External behavior: none when the happy path already records both.

### B6 — Conversation delete is not one SQLite transaction

- Severity: Low–Medium
- Phase: P2 (same “wrap the writes” work as B3/B5) or skip until you touch that handler
- Files: [`api/src/app.ts`](../../api/src/app.ts) ~1318–1321 (shares, then sections/messages/conversation separately)
- Fix: One transaction. Do not change the 404-for-strangers contract.
- Tests: delete still 404s the conversation; no leftover share row for that id.
- External behavior: none if delete already appears atomic to clients.

### O3 — Dual-store backup is undocumented / SQLite-only in deploy docs

- Severity: High as an ops gap, not a runtime bug
- Phase: P5 (restore drill already listed) — documenting the two targets is allowed in P1 stale-docs if you are already editing deploy README
- Files: [`scripts/deploy/README.md`](../../scripts/deploy/README.md) ~246–251 (SQLite file copy; also wrongly says no handler reads MariaDB)
- Fix: Document `mysqldump` (accounts) + SQLite file (content). P5 restore drill: login + one private reflection + one publication.
- External behavior: none.

### M2 — No Hono `onError`; store crashes can be opaque 500s

- Severity: Medium
- Phase: P6 with M1
- Files: [`api/src/app.ts`](../../api/src/app.ts) — no `app.onError`
- Fix: Catch uncaught throws, log with request id (M1), return `{ error }` JSON 500/503 without leaking SQL. Do not change existing per-route `{ error }` bodies.
- Tests: injected throw → JSON `{ error }` and no stack in the body.
- External behavior: same status family; body becomes the usual shape instead of an empty/HTML 500.

**Reviewed and not treated as open vulns:** SQL injection, command injection, global admin surface, magic login, arbitrary upload, secrets in git, legal-markdown XSS, conversation IDOR (404). Community `VISIBLE_TO` is a constant predicate, not attacker-controlled SQL.

---

## Sediment (not all are tickets)

See [`ROADMAP.md`](ROADMAP.md) for when to touch them.

| Item | Status |
|------|--------|
| Dual AuthStore | Required until P5 |
| Unused MariaDB reflection stack | Do not grow; P5 replaces or deletes |
| `GET /api/library` | P1 remove |
| `GET /api/community` | P1 remove |
| `POST /api/creations` | P1 remove |
| `/library` UI redirect | Keep until P1 says otherwise; bookmarks |
| `readVisibility('published')` | Keep |
| SQLite owners / publicationState migrations | Keep until old files gone |
| scrypt + argon2 | Keep until SqliteAuthStore gone |
| PHP gateway | Keep on current host |
| `CHAT_DISABLE_*` | Keep |
| `AI_ENABLED` + `CHAT_AI_DISABLED` | Keep until P6 |
| Dual AI URL families | Keep until P6 |
| Dual public share POSTs | P6/optional, gated |
| Two Sheets / two report UIs | P4 |
| MemoryStore as default `app.test.ts` harness | Improve when you add tests; full migrate is gradual |
| Stale docs (shares vs publications, transcripts-off-DB, library on disk) | P1 |

---

## Classification

- **Essential:** private-by-default, guest then register, publication-as-copy, AI authorship marks, Bible licensing (`BIBLE_SCRIPTURE_IN_PROMPTS` default off), Capacitor share, kill switches, MariaDB JSON-as-LONGTEXT.
- **Useful:** AuthStore seam until one DB, community SQL predicate, shared validators, provider interfaces.
- **Historical:** two databases, conversations vs reflections names, `/library`, `published`→`shared`, PHP gateway, dual AI, dual share POSTs, scrypt+argon2, unused revision schema.
- **Accidental:** ChatPage god-object, two Sheets, `registeredUser` via email, reflections N+1, MemoryStore as security SUT, unused disposable list.
- **Dead:** `/api/community`, `/api/creations`, `MessageTable.set`, unmounted `ReflectionService`, disposable list with no reader.

A 2026-08-22 CodeReviewerAssist pass added S9–S11, S10, O1–O3, M1–M2, B5–B6 and retargeted B4. See [`CODEREVIEWERASSIST.md`](CODEREVIEWERASSIST.md). Do not re-audit.
