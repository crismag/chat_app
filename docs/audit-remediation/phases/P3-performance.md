# P3 — List and feed query shape

No Redis. No new services. Same JSON meaning; extra fields are allowed on list items.

---

## Reflections list enrichment (kill client N+1)

**Today:**

- [`GET /api/reflections`](../../../api/src/app.ts) ~1616–1684 already loads each conversation’s sections via `draftOf` / `matchesReflection` / `store.sections.get`.
- [`ReflectionsPage.tsx`](../../../web_app/src/reflections/ReflectionsPage.tsx) ~788–837 then `GET /conversations/:id` per visible card for excerpt, preview, written sections.

**Do:**

1. Put excerpt / preview / written (whatever the page actually needs — match `excerptFrom`, `previewFor`, `writtenSections` in the reflections module) on each list item in the API response. Keep `summaryOf` as the base; add fields rather than inventing a second list endpoint.
2. Stop the enrichment effect on the page. Use payload fields. Keep a fallback GET only if you must support old servers — you do not; this is one app.

**Do not** change paging semantics (`total`, `page`, `pageCount`, last-page clamp).

**Also:** `GET /api/reflections` today does `[...store.conversations.values()]` then filters by `userId`. That is every conversation in the file. Query `WHERE userId = ?` (or the SqliteStore equivalent) **before** section/message loads. Extra fields on the list item still belong in this phase.

**Tests:** API returns the new fields for a conversation with Heart written; page test should not expect N detail fetches (update mocks). A second user’s conversation never appears in the list (already true — keep it on SqliteStore).

---

## Community `hydrate` batching

**Today:** [`CommunityStore.hydrate`](../../../api/src/community/store.ts) ~1430 runs per row:

- sections query
- tags query
- optional `membership()`

Feed maps `rows.map((row) => this.hydrate(...))` (~1239).

**Do:** For a page of ids, `WHERE publicationId IN (...)` once for sections and once for tags; membership role can be joined or selected in `SELECT_PUBLICATION` if it does not weaken `VISIBLE_TO`. Preserve the rule: **authorization stays in the SELECT**. Hydration must not load sections for a publication the predicate rejected.

**Tests:** existing `community.test.ts` payloads stay identical. Add a test that two publications’ sections are not crossed. Do not add an in-memory store.

---

## Lazy communities on Reflect

**Today:** ChatPage fetches `/communities` on mount (~427) for the share sheet.

**Do:** Fetch when Share opens (`shareOpen` becomes true) or when the share sheet first mounts. Use `fetchCommunities` from [`web_app/src/community/api.ts`](../../../web_app/src/community/api.ts) instead of a raw `api('/communities')` if that helper already exists.

**Tests:** ChatPage test that mount does not request `/communities`; opening share does.

---

## Out of scope

- Autosave combining PATCHes (tempting; not this phase unless a single extra commit is requested).
- SQL-filter `GET /api/reflections` (wait for P5 unless the in-process scan is already a measured problem and Cris asks).

---

## Verification

```bash
npm test -w api
npm test -w web_app
```
