# CodeReviewerAssist addendum

**For Claude (implementer).** A second, lens-based review was run against this repository on 2026-08-22. It does **not** replace the original audit. It does **not** ask you to re-audit.

The reviewer is not the implementer. Do not wait for that reviewer to write code. Implement from this pack.

Source prompts: [crismag/CodeReviewerAssist](https://github.com/crismag/CodeReviewerAssist) `reviews/01`–`10` (quality, architecture, security, messaging, usability/admin, documentation, testing, persistence, operations, cross-review).

Interactive summary (not an implementation spec): Cursor canvas `codereviewerassist-chat-app.canvas.tsx` beside the chat. If it disagrees with this folder, **this folder wins**.

---

## What you should do with this file

1. Read it after [`FINDINGS.md`](FINDINGS.md) and [`STATUS.md`](STATUS.md).
2. Inspect the **current tree**. The working tree at review time already contained uncommitted P0 work and a **partial P1**. Line numbers in the original findings may be wrong.
3. If a finding is already fixed in code with tests, tick [`STATUS.md`](STATUS.md) and do not re-implement it.
4. If P1 is half-applied (handlers gone, tests still calling them), **finish P1** from [`phases/P1-deletions.md`](phases/P1-deletions.md). Do not restore the deleted aliases.
5. Implement only the phase Cris named. Default remains **P0 leftovers, then P1**.

Do not run the ten CodeReviewerAssist prompts again. Do not open a new architecture debate. The target architecture is already decided in [`CONTEXT.md`](CONTEXT.md) and [`phases/P5-one-store.md`](phases/P5-one-store.md).

---

## Tree state at review (2026-08-22, branch `agent/profile-upgrade`)

Verify each bullet in the files. If the tree has moved, believe the files.

**Appears already implemented in the working tree (uncommitted at review; STATUS.md still unchecked):**

| ID | What to grep before re-doing it |
|----|----------------------------------|
| B1 | `publicWebOrigin()` in `api/src/http/origins.ts`; forgot-password uses it, not request `Origin` |
| S2 redaction | `LoggingMailer` logs `to` + `subject` and says the body is omitted |
| S1 / S7 | login 10/email + 40/IP; register/guest 10/IP; `refused()` 429 |
| S3 | SQLite/Memory sessions store `hashSessionToken`; dual-read hash then raw |
| S4 | `registeredUser` uses `accountType === REGISTERED`; Google `markEmailVerified` |
| S5 | `userIdByEmail: async (email) => (await auth.findByEmail(email))?.id` |

**Appears half-applied (P1):**

- `GET /api/library` and `GET /api/community` **handlers removed** from `api/src/app.ts`
- `MessageTable.set` **removed** from `api/src/db.ts`
- `POST /api/creations` **still present** (~1771)
- `api/src/app.test.ts` **still calls** `/api/library` and `/api/community`
- `web_app/src/create/CreatePage.test.tsx` still uses `publicationState`
- Disposable list file still on disk
- Stale docs listed in P1 still stale

**Still open, confirmed in source:**

- B3 guest merge still `UPDATE conversations` only (`api/src/db.ts`)
- Dual share: `POST /api/conversations/:id/share` vs `POST /api/publications`
- Reflections N+1: `ReflectionsPage.tsx` fetches `/conversations/:id` per card
- ChatPage `useEffect` loads `/communities` on mount
- `serve({ fetch, port })` has no `hostname` (`api/src/index.ts`)
- MariaDB `003_community_and_studio.sql` lacks live SQLite community settings columns
- `GET /api/reflections` still materializes every conversation then filters by owner (`store.conversations.values()`)
- Studio image generate has no rate limiter (`api/src/create/image-routes.ts`)
- `share_events` recorded after `publish()` commits
- `.env.example` omits `CHAT_DISABLE_*`, `SMTP_*`, `GOOGLE_CLIENT_ID`, `CHAT_AI_DISABLED`

---

## Mapping — CodeReviewerAssist IDs → this pack

Use the **pack IDs** (B*, S*, O*, M*) in commits and STATUS. CRA IDs are for traceability only.

| CRA | Pack | Phase | New? |
|-----|------|-------|------|
| SEC-P0 | B1, S1–S5, S7 | P0 | No — verify, tick STATUS |
| SEC-002 | S2 remainder | P0 gated | No — redaction done; fail-closed still gated |
| DATA-001 | B3 | P2 | No |
| ARCH-001 / DATA-002 | P5 | P5 gated | No — schema gap restated with evidence |
| ARCH-002 | dual share + dual AI flags | P6 gated | No |
| ARCH-003 | ChatPage / app.ts size | P4 | No |
| QUALITY-001 | P1 | P1 | **Half-done in tree** |
| PERF-001 | P3 | P3 | No |
| TEST-001 | MemoryStore as authz SUT | ongoing rule | No |
| TEST-002 | B4 | P2 | **Retargeted** — see B4 below |
| DOC-001 | P1 stale docs | P1 | No |
| UX-001 | two report UIs, MoreMenu | P4 | No |
| SEC-003 | S6 | P6 gated | No |
| SEC-001 | **S9** | P6 (or with P5 bind) | **Yes** |
| SEC-004 | **S10** | P6 gated | **Yes** |
| OPS-001 | **O1** | P6 gated | **Yes** |
| OPS-001 (PHP timeout) | **O2** | P6 gated | **Yes** |
| MSG-001 | **M1** | P6 | **Yes** (logging; extra error field is allowed) |
| SEC-002 (studio images) | **S11** | P6 gated | **Yes** — unmetered generate |
| DATA-004 | **B5** | P2 | **Yes** — share_events after commit |
| DATA-006 | **B6** | P2 | **Yes** — conversation delete txn |
| OPS-006 | **O3** | P5 / P1 deploy docs | **Yes** — two backup targets |
| MSG-001 (onError) | **M2** | P6 with M1 | **Yes** |
| ARCH-001 (server scan) | P3 | P3 | **Yes** — `SELECT *` all conversations |

Root cause the cross-review kept: **dual store without a join**, plus **historical names kept as live APIs**. Fix those; do not add layers.

---

## New findings (implement only when the phase is named)

Full catalog entries live in [`FINDINGS.md`](FINDINGS.md). Short form:

### S9 — Loopback bind and X-Forwarded-For (High)

`api/src/index.ts` binds every interface. PHP and deploy docs assume `127.0.0.1:8000`. `addressOf` takes the first `X-Forwarded-For` hop. Guest, register, and forgot-password are IP-metered only.

If `:8000` is reachable besides PHP, IP limits are spoofable. Login still has a per-email cap.

**Do:** `hostname: '127.0.0.1'` when `NODE_ENV=production`. Ignore `X-Forwarded-For` unless the peer is loopback (the PHP gateway). Do not add Redis.

**Approval:** ops change; listed in [`APPROVALS.md`](APPROVALS.md). May ship with P5 bind or as a named P6 item. Do not do it inside an unrelated P0 commit.

### S10 — No user export or account-delete product path (Medium, compliance)

`deleteUserGraph` is test cleanup. There is no `DELETE /me`, no export, no operator inbox for reports.

**Do not invent** an admin UI or a GDPR product in an audit commit. If Cris names S10, implement a documented operator procedure first, then a registered-user delete covering **both** stores.

### O1 — `/api/health` is liveness only (Medium)

Returns `{ status: 'ok' }` with no SQLite or MariaDB ping.

If named: add `/api/health/ready` (or a `?ready=1` that does not change the existing body for old clients). Do not make the current `/api/health` start failing if a replica is slow unless Cris approves a probe change.

### O2 — PHP gateway 30s timeout vs long AI (Medium)

`scripts/deploy/chatapi/index.php` `TIMEOUT_SECONDS = 30`. Assistance can exceed that; the browser sees a gateway failure.

If named: align timeout with the API/AI client, or document that AI must finish under 30s. Do not raise it silently in a P0 commit.

### M1 — Request IDs only on AI and Bible (Low)

If named: one Hono middleware that assigns a request id, logs it, and may echo it on error JSON. Never log tokens or message bodies.

### B4 — retarget (P2)

The free-typed Scripture field is gone; passage identity is a Bible selector. `ChatPage.test.tsx` covers **title** typed during create, including the Send button. `scripts/verify/reference-race.mjs` comments say the same and is **not** in CI.

**Do:** Confirm the title Send path is covered. If yes, tick B4 as “title race covered; Scripture field retired” and do not resurrect a reference input. Rename or comment the verify script only if you are already in P2/P6. Do not add Selenium to CI unless P6 CI-verify is approved.

### S11 — Studio generate unmetered (P6)

`image-routes.ts` checks auth, ownership, and the `IMAGE_GENERATION` kill switch. It does not call a rate limiter. AI assist does.

If Cris names S11 (or a billed provider is about to go live): per-user + per-IP window, 429 + Retry-After. Reuse existing limiter. Do not invent a daily-budget product.

### B5 / B6 — wrap the other SQLite writes (P2)

After B3, one small commit each (or skip B6 if you never touch delete): `share_events` inside `publish()`’s transaction; conversation delete in one `BEGIN`.

### O3 — two backup targets

Accounts = MariaDB; content = SQLite file. `scripts/deploy/README.md` currently describes only the file and incorrectly says handlers do not read MariaDB.

### M2 — `app.onError`

With M1: JSON `{ error }` for uncaught throws; log the request id; never put a stack in the body.

---

## Confirmed non-findings (do not “fix”)

- Community `VISIBLE_TO` is a constant SQL predicate, not user-string concatenation. Do not rewrite it.
- Publication IDOR tests on SqliteStore are the real SUT. Do not add a MemoryStore CommunityStore.
- PHP gateway is required on the current host. Do not delete it as simplification.
- Forgot-password always returning the same success message is intentional anti-enumeration. Do not return 404 for unknown emails.
- UI `/library` → `/reflections` redirect stays until P1 says otherwise.
- Do not build an admin UI because reports have no inbox (S10). A SQL runbook or softer “recorded” copy is the allowed shape if Cris names it.

---

## Dangerous changes (same as APPROVALS)

P5 content cutover, CSRF header, production SMTP fail-closed, S10 account deletion, collapsing public share to one POST, changing `VISIBLE_TO`, ETL onto `chat_content` / `reflection_revisions`.

Prefer **deletion** of dead MariaDB reflection tables over wrapping them — and only after P5 approval and an inventory of whether those tables have rows.
