# Approval gates

Cris must say yes before you implement anything in this file. If a finding is not listed here, and [`ROADMAP.md`](ROADMAP.md) puts it in the current phase, you may implement it.

When you ask, name the finding ID and the user-visible change in one paragraph.

---

## Blocked until explicitly approved

| ID | Change | Why it is gated |
|----|--------|-----------------|
| B1 | Reset emails always use a configured web origin, never request `Origin` | Emails users receive will point at a different URL than a forged Origin would have produced. Correct and intended, but it is an email-content change. |
| S2 | Production forgot-password fails without SMTP (or process refuses to boot) | Users currently get a success message even when mail was only logged. Fail-closed changes that. |
| S1 / S7 | HTTP 429 on login, register, guest | Abusive clients start seeing errors honest users might hit if NAT-sharing. |
| S4 | Google-only users pass `registeredUser` and can use community/profile | Intended fix of a fail-closed bug. Still a permission change for those accounts. |
| S6 | CSRF or required custom header on cookie mutations | Every client, including Capacitor, must send the header. |
| S7 optional | Stop returning `accountExists` on register | Register UX for “already exists” may get vaguer. Rate-limiting register/guest can proceed without this if S1-style limits are approved. |
| S8 | Wire disposable-email blocking and/or verification mail | Product/UX. Deleting the unused list (P1) does **not** need this approval. |
| P1 aliases | Delete `GET /api/library`, `GET /api/community`, `POST /api/creations` | Only if any external client still calls them. Internal web app does not. Confirm with Cris if unsure; default in the phase file is delete after a repo-wide grep shows no production caller. |
| Public share collapse | One POST instead of `/share` then `/publications` | API contract. |
| P5 | Content on MariaDB, SQLite retired, schema drops | Data migration. |
| S9 | Production API binds 127.0.0.1; ignore XFF except from loopback | Host/firewall change. If Node was accidentally public, it becomes unreachable except via PHP. |
| S10 | User export / account delete | New product capability. Operator procedure first. |
| O1 | Readiness probe that can fail | Existing `/api/health` clients may start seeing 503 if you change that path. Prefer a new path. |
| O2 | PHP gateway timeout | Long AI calls succeed or still fail; do not guess. |
| S11 | Rate-limit studio image generate (429) | Honest users on a NAT can hit it; billed-provider cost is the reason to do it. |
| P6 | CSP/HSTS, AI route merge, `AI_ENABLED`/`CHAT_AI_DISABLED` merge, CI `scripts/verify`, M1/M2 request-id and onError | User-visible or ops-visible. |

---

## Allowed without extra approval once you are told to execute that phase

These still change code. They should not change product meaning:

- Hash SQLite session tokens (S3) — cookie value stays the raw token; only the DB row changes. Need a migration/dual-read so existing sessions keep working or are reissued.
- `userIdByEmail` → `auth.findByEmail` (S5) — invites start working in MariaDB mode. That is a bugfix.
- Delete or fix unused `MessageTable.set` (B2).
- Delete unused disposable list file **without** wiring it (S8 deletion path).
- Reflections list payload enrichment (P3) — extra fields on an existing JSON object; old clients ignore them.
- Query `GET /api/reflections` by `userId` instead of loading every conversation (P3) — same list, cheaper.
- Community feed hydrate batching (P3) — same JSON, fewer queries.
- Lazy-load communities on Share (P3) — same UI, later fetch.
- ChatPage hook split, Sheet unification, ReportDialog unification (P4) — same UX.
- Stale documentation corrections listed in P1.
- Guest merge expanding to all owner-scoped **SQLite** tables (B3) — more complete ownership, not a new feature. Ask if you would also merge MariaDB content tables (there is no live content there yet).
- B5 / B6 wrapping existing writes in one transaction — same observable API.

---

## How to ask

Use one message:

```text
Finding: S4
User-visible: Google-only accounts will be able to publish to community and edit a public profile, matching password accounts.
Internal: registeredUser() keys off accountType === REGISTERED; markEmailVerified on Google email_verified.
Tests: google-signin + community route as a Google-only MysqlAuthStore user.
May I implement?
```
