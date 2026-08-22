# Roadmap

Execute **one phase at a time**. Finish P0 before P1 unless Cris names a single finding.

Rank used by the audit: correctness/security, then deletion, then one store, then page splits, then optional hardening.

Each phase file lists commits. Do not invent extra commits that “clean up while you’re there.”

---

## P0 — Security and authz bugs

File: [`phases/P0-security.md`](phases/P0-security.md)

- B1 reset Origin (gated)
- S2 token logging (gated for fail-closed; redaction is required either way)
- S1 login rate limit (gated)
- S7 register/guest rate limit (gated)
- S3 hash SQLite sessions
- S4 registered = `accountType` (gated)
- S5 `userIdByEmail` via AuthStore

Do not extract routes. Do not start P5.

---

## P1 — Deletions and doc truth

File: [`phases/P1-deletions.md`](phases/P1-deletions.md)

- Dead HTTP: `/api/library`, `GET /api/community`, `POST /api/creations`
- B2 `MessageTable.set`
- S8 unused disposable list (delete, do not wire)
- Stale docs listed in the phase file

---

## P2 — Guest merge and Scripture race

File: [`phases/P2-guest-merge.md`](phases/P2-guest-merge.md)

- B3 merge all SQLite owner-scoped tables
- Dual-store merge test matching `index.ts`
- B4 title Send-button race (Scripture field retired — verify and close, do not resurrect)
- B5 `share_events` inside publish transaction
- B6 conversation delete in one transaction

---

## P3 — Query shape (no new infra)

File: [`phases/P3-performance.md`](phases/P3-performance.md)

- Enrichment fields on `GET /api/reflections`; remove client N+1
- Query reflections by `userId` (do not `SELECT *` then filter)
- Batch community `hydrate`
- Lazy-load communities when Share opens

---

## P4 — Frontend modularization

File: [`phases/P4-frontend.md`](phases/P4-frontend.md)

- Split ChatPage into hooks
- One Sheet
- Reflections API module
- One ReportDialog
- Delete `MoreMenu` wrapper

Same UX. No new state library.

---

## P5 — One database (large, gated)

File: [`phases/P5-one-store.md`](phases/P5-one-store.md)

MariaDB content **cloned from live SQLite**, not from unused revisions. Then retire SQLite auth/content. Bind API to loopback in production (S9). Document backups of **both** stores (O3).

Do not begin this phase without Cris.

---

## P6 — Optional (gated item by item)

File: [`phases/P6-optional.md`](phases/P6-optional.md)

CSRF, email verification, AI route merge, flag merge, CSP, CI verify subset, public-share single POST, S9 loopback/XFF, O1 readiness, O2 PHP timeout, M1–M2 request ids/onError, S10 account delete (do not invent), S11 studio generate limiter.

---

## After a phase

1. Tests for that phase are green.
2. [`STATUS.md`](STATUS.md) updated.
3. Summarize remaining gated items.
4. Stop. Do not roll into the next phase unasked.
