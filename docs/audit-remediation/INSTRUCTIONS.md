# Operating instructions

These rules govern implementation of the 2026-08-22 audit. They sit on top of [`../development/DEVELOPMENT_INSTRUCTIONS.md`](../development/DEVELOPMENT_INSTRUCTIONS.md). If they conflict, **privacy, authorship, and “do not expand the product”** in the development instructions win; **small commits and no rewrite** in this file win over a tidy-looking mega-diff.

You are implementing findings. You are not continuing the audit. You are not inventing new features. A CodeReviewerAssist pass already ran; new IDs are in [`CODEREVIEWERASSIST.md`](CODEREVIEWERASSIST.md). Do not re-run those ten reviews.

---

## 1. Branch and commits

- Work on a dedicated branch. Do not commit to `main` unless Cris asks.
- One architectural simplification or one finding per commit.
- Do not combine unrelated refactors.
- Commit messages: why, not a file list. Follow the repository’s existing style (`git log`).
- Only commit when Cris asks, unless Cris has already told you to commit as you go.

---

## 2. Before you touch code

For the finding you are about to do:

1. Re-read the finding in [`FINDINGS.md`](FINDINGS.md) and its phase file.
2. Open the cited files and confirm the defect still exists. Line numbers drift.
3. Check [`APPROVALS.md`](APPROVALS.md). If the finding is gated, stop and ask Cris.
4. Run the relevant existing tests **before** the change (`npm test` in the affected workspace, or a focused vitest file).
5. Add a regression test that would have failed before the fix, unless the phase file says the existing suite already covers it.
6. Implement the smallest change that closes the finding.
7. Run the same tests after. Run `npm run lint` and `npm run typecheck` on the workspaces you touched if the change is more than a comment.
8. Do not modify tests merely so a behavior change looks intended.

---

## 3. Preserve externally observable behavior

Default: users, cookies, URLs, JSON shapes, and emails stay the same.

Exceptions are listed per finding. If a fix **must** change:

- an API path, status, or body;
- a schema or persisted format;
- session/cookie behavior;
- password-reset email contents or destination;
- who is treated as registered;
- share/publish semantics;

it is either already called out in [`APPROVALS.md`](APPROVALS.md) or you must ask before coding.

---

## 4. Prefer deletion over new abstraction

Order of preference:

**deletion > consolidation > simplification > new abstraction**

Do not add a helper, adapter, interface, context, or package because the change “might be reused.” Add one only when it removes more complexity than it introduces, and the phase file asks for it.

Do not extract `app.ts` into modules until **P5** (one store) is decided. Extracting the dual-store mess is not simplification.

---

## 5. Dual store is load-bearing until P5

Production wiring is [`api/src/index.ts`](../../api/src/index.ts):

- If `MYSQL_*` is set: **accounts** come from `MysqlAuthStore` / MariaDB.
- **Reflections, community, profiles, studio, passages** still live on SQLite (`SqliteStore` and feature stores).
- Identity that crosses the boundary is the account **string id** (`public_uuid` on MariaDB).

Do not assume a row in MariaDB `users` implies a SQLite `users` row. Foreign keys from content to local `users` were already stripped.

Guest merge, invites-by-email, and “is this person registered?” are where this split currently lies. Fixes in P0/P2 must work in **both** modes:

- no `MYSQL_*` (SqliteAuthStore + SqliteStore);
- `MYSQL_*` set (MysqlAuthStore + SqliteStore content).

---

## 6. Tests that must remain behavioral

Keep these contracts, even if you change internals:

- Private content is not readable by another user (404, not 403, for owned conversations).
- Community authorization happens in SQL (`VISIBLE_TO`), not as a filter after fetch.
- A publication is a **copy**, not a pointer that mutates the source.
- Guest upgrade-in-place keeps the same account id.
- Forgot-password responses do not disclose whether the email has an account.
- Original user wording is preserved when AI suggests an edit.
- Completing a C.H.A.T. does not share it.

Do **not** keep tests that only exist to lock in:

- `MemoryStore` as the default app under test for security paths (migrate those paths to SqliteStore, and to MysqlAuthStore when the finding is about MariaDB);
- `/api/library` and `GET /api/community` once those routes are deleted (P1);
- `publicationState` in frontend fixtures (update to `visibility`).

Community tests already refuse `MemoryStore` on purpose. Do not add an in-memory CommunityStore.

---

## 7. How to run checks

From the repo root:

```bash
npm test
npm run lint
npm run typecheck
```

API-only:

```bash
npm test -w api
# focused:
npx vitest run api/src/auth/password-reset.test.ts
```

MariaDB suites skip when `MYSQL_*` is unset. CI sets them. For P0 findings that touch MysqlAuthStore, run with the same env as [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) or say you could not.

Do not add `scripts/verify` to CI unless you are on **P6** and Cris approved it. You may run a verify script locally if you are fixing B4 (Send-button race).

---

## 8. Documentation you may edit

- Update [`STATUS.md`](STATUS.md) when a finding is done.
- Update [`../development/`](../development/) **only** when the change actually alters the product or architecture contract (development instruction 15). P1 includes specific stale-doc corrections.
- Do not edit [`../plans/`](../plans/) or [`../requirements/`](../requirements/). They are frozen transcripts.
- Do not rewrite this pack to match a shortcut you took. If the implementation has to diverge, say so in the commit and ask.
- Update [`CODEREVIEWERASSIST.md`](CODEREVIEWERASSIST.md) tree-state section only if you find it is now wrong (one sentence in the commit is enough). Do not add new review essays.

---

## 9. Report when you finish a unit of work

State:

1. finding IDs closed;
2. files changed;
3. tests added or run;
4. external behavior that changed (or “none”);
5. anything still blocked on approval;
6. anything you inspected that no longer matches this pack.

Never claim a finding is done from generated files or types compiling.
