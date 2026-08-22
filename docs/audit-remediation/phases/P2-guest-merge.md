# P2 — Guest merge and Scripture race

---

## B3 — Merge every SQLite owner-scoped table

**Today:** [`api/src/db.ts`](../../../api/src/db.ts) `accounts.merge` only:

```sql
UPDATE conversations SET userId = ? WHERE userId = ?
```

plus mark guest merged and revoke that guest’s installations.

**Must also move** (table names as in SQLite; grep `userId` / `authorUserId` / `createdByUserId` / `reporterUserId` in feature stores):

- `publications.authorUserId` (and any other publication owner columns)
- `community_members.userId` (conflicts: if both guest and target are members of the same community, keep the target row, drop or merge the guest row without violating PK)
- `profiles` (guest profile vs target profile — prefer target, delete guest row)
- `studio_creations` is keyed by `conversationId` and will follow conversations; `studio_image_assets.userId` must move
- `reflection_passages` keyed by `conversationId` — follows conversations
- `publication_saves`, `publication_reactions`, `publication_hides`, `author_mutes`, `share_events`, `publication_reports`, `profile_reports`, `profile_blocks`

Handle unique-key collisions explicitly (same publication saved by both identities, same mute pair, etc.): keep the target’s row, delete the guest’s duplicate. Do this **inside the same transaction** as the conversation move.

**MariaDB `auth.merge`:** keep as revoke sessions/installations + `mergedIntoUserId`. It correctly returns 0 for content. The HTTP handlers already call `store.accounts.merge` then `auth.merge`. Do not reverse that order without thinking about cookies: content should move while the guest id is still understood.

**Tests:** build a guest with at least: one conversation with a section, one publication, one community membership, one studio asset, one saved passage, one profile. Register or Google-login as a **different** existing user. Assert every owner column is the target id and the guest row is marked merged. Run on SqliteAuthStore **and** MysqlAuthStore + SqliteStore content.

Do not use MemoryStore for this test.

---

## Dual-store merge harness

[`api/src/index.ts`](../../../api/src/index.ts) is the production combination. Add an API-level test that constructs `createApp(sqliteStore, …, mysqlAuthStore)` like `auth/store.test.ts` HTTP suite, but with **SqliteStore not MemoryStore**, and exercises merge.

If MYSQL is unset, `skipIf` like the other MariaDB tests.

---

## B4 — Title Send-button race (Scripture field retired)

CodeReviewerAssist (2026-08-22): the free-typed Scripture field is gone. Passage identity is a Bible selector. Do not add the old input back.

1. Read [`web_app/src/chat/ChatPage.test.tsx`](../../../web_app/src/chat/ChatPage.test.tsx) (`the Send button path keeps a title typed during creation`) and `scripts/verify/reference-race.mjs` (comments already retarget title).
2. If Send+title is covered and passing, tick B4 in STATUS as closed with that evidence and stop.
3. If Send is not covered for **title**, add a unit test that types the title during create and clicks Send.
4. If that test fails, fix `openConversation` / view-generation so an in-progress title is not wiped when the conversation id appears.

Do not debounce user input into oblivion. The original diagnosis: creating a reflection looked like switching conversations, which ran the reset that discards drafts.

**Verify:** `npm test -w web_app`. Run `scripts/verify/reference-race.mjs` only if you can use a browser. Do not add it to CI unless P6 CI-verify is approved.

---

## B5 — `share_events` inside `publish()`

[`CommunityStore.publish`](../../../api/src/community/store.ts) commits the publication; [`community/routes.ts`](../../../api/src/community/routes.ts) then `recordShare`. A failure between those leaves a publication that did not count against ceilings.

Insert the share-event row in the same `BEGIN` as the publication. Keep `VISIBLE_TO` and the one-share unique index. Existing `community.test.ts` share-limit cases must still pass.

---

## B6 — Conversation delete in one transaction

[`api/src/app.ts`](../../../api/src/app.ts) delete path currently removes shares, then sections/messages/conversation as separate statements. Wrap in one SQLite transaction. Strangers still get 404. Skip this commit if you never open that handler in P2; do not combine it with B3.

---

## Verification

```bash
npm test -w api
npm test -w web_app
```
