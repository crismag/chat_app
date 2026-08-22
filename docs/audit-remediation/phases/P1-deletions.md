# P1 — Deletions and documentation truth

Goal: remove code that only exists because of old names, unused endpoints, or unused files. No behavior change for the running web app.

Grep the whole repo (including `scripts/verify` and `ios`/`android` if any hardcoded paths) before deleting a route.

**Tree note (CodeReviewerAssist 2026-08-22):** `GET /api/library` and `GET /api/community` handlers and `MessageTable.set` may already be gone. `POST /api/creations` and tests/docs may not. Do not restore deleted aliases. Finish what is left. See [`../CODEREVIEWERASSIST.md`](../CODEREVIEWERASSIST.md).

---

## Dead HTTP

### `GET /api/library`

- Defined as an alias of `GET /api/reflections` in [`api/src/app.ts`](../../../api/src/app.ts) (~1612–1693). Comment claims the web app has not been renamed; it has (`ReflectionsPage` calls `/reflections`).
- UI `/library` **page** redirect in [`web_app/src/app/App.tsx`](../../../web_app/src/app/App.tsx) is separate. Keep the **page** redirect unless Cris wants it gone; only remove the **API** alias here.
- Tests: [`api/src/app.test.ts`](../../../api/src/app.test.ts) uses `/api/library`. Point those tests at `/api/reflections`.

### `GET /api/community`

- Legacy list of `visibility=shared` summaries. Frontend uses `/api/publications` and `/api/communities`.
- Tests in `app.test.ts` call it. Move assertions to the live publications/community routes **or** drop tests that only existed to prove the alias. Do not lose the privacy assertion that private items stay off a shared list — that belongs on `/api/publications` / profile, which already have tests.

### `POST /api/creations`

- Snapshot endpoint ~1737–1766. No frontend caller (Create uses `/api/studio-creations/:conversationId`). Delete handler.

**Commit suggestion:** one commit for the three API deletions + test updates.

---

## B2 — `MessageTable.set`

[`api/src/db.ts`](../../../api/src/db.ts) ~1297. Live code uses `append`. **Delete `set`** unless you find a caller. Grep `messages.set`. Do not “fix the placeholders and keep it” without a caller.

---

## S8 — Unused disposable list

[`config/email-lists/disposable-domains.txt`](../../../config/email-lists/disposable-domains.txt) is not imported. Delete the file. If a generator script exists (grep `disposable-domains` / `email-lists`), delete or stop generating it.

Do **not** wire registration against the list in this phase.

If Cris says keep the file for a future P6, leave it and note that in STATUS.

---

## Stale documentation (same phase, can be a second commit)

Fix only these lies; do not rewrite PRODUCT_READINESS as a new browser tour.

1. [`docs/development/ARCHITECTURE.md`](../../development/ARCHITECTURE.md) — accounts **are** served from MariaDB when `MYSQL_*` is set (`api/src/index.ts`). The sentence that application routes are not switched is still true for **content**, false if it implies accounts never moved.
2. [`docs/development/README.md`](../../development/README.md) — “conversation transcripts stay off the central database” is false after migration `004_reflection_messages.sql`. The privacy policy and ARCHITECTURE already record the reversal. Align README.
3. [`docs/development/MOBILE.md`](../../development/MOBILE.md) and any remaining `GET /api/shares` / `/community/shares/` — live routes are publications (`/community/publications/:id`, `GET /api/publications`).
5. [`scripts/deploy/README.md`](../../scripts/deploy/README.md) — accounts **are** read from MariaDB when `MYSQL_*` is set; listen address in code is **not** `127.0.0.1` until S9; backup must mention both the SQLite file and MariaDB (O3).
6. [`.env.example`](../../.env.example) — document `CHAT_DISABLE_*` (absent = on), `SMTP_*`, `GOOGLE_CLIENT_ID`, `CHAT_AI_DISABLED`. Values stay empty. Do not invent new switches.

Do not edit `docs/plans/` or `docs/requirements/`.

---

## Verification

```bash
rg -n "/api/library|/api/community|/api/creations" --glob '!docs/audit-remediation/**' --glob '!docs/plans/**' --glob '!docs/requirements/**'
npm test -w api
npm test -w web_app
```

CreatePage tests that still send `publicationState` should be updated to `visibility` if they fail; that is fixture drift, not a product change.
