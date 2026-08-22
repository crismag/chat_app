# P4 — Frontend modularization

Behavior-neutral. If a user can tell the UI changed, you went too far.

Do **not** add Redux, Zustand, React Query, or a new global context. AuthContext and MobileBar stay.

Do this as several commits, not one 2000-line move.

---

## 1. Reflections/conversations API module

Add `web_app/src/reflections/api.ts` (name may be `conversations.ts` if that matches HTTP). Mirror [`web_app/src/community/api.ts`](../../../web_app/src/community/api.ts): typed helpers for list, get, patch sections, share, make-private, messages.

Replace string `api('/conversations/...')` in ChatPage, ReflectionsPage, ReflectionViewPage, CreatePage.

**Commit:** module + call-site swap only. No hook extraction yet.

---

## 2. Split ChatPage state into hooks

[`web_app/src/chat/ChatPage.tsx`](../../../web_app/src/chat/ChatPage.tsx) ~2316 lines, ~46 `useState`s.

Extract **in this page folder**, used only by ChatPage:

| Hook | Owns |
|------|------|
| `useConversationWorkspace` | list, active id, URL `?c=` `?new=` `?share=`, open/create/delete |
| `useSectionEdits` | `edits`, autosave, `saveAll`, origins |
| `useReflectionAssist` | disclosure, guidance, improve, pending assist |
| `useReflectionChat` | helper thread, chips, reply |
| share/format/passage | may stay in page as thin handlers calling sheets |

Do not pass 25 loose props into ChatHelper if you can pass one controller object (same idea as existing `AssistState`).

After extraction the page should mostly layout-compose. If a hook file exceeds ~400 lines, stop and split along the table above rather than inventing a sixth concept.

**Tests:** existing ChatPage / ChatHelper / share-gate tests must stay green. Move tests with the code they cover if imports demand it; do not weaken them.

---

## 3. One Sheet

Migrate ChatSheets (`ShareSheet`, `FormatSheet`, passage, delete, …) onto [`web_app/src/shared/mobile/Sheet.tsx`](../../../web_app/src/shared/mobile/Sheet.tsx) (focus trap, `open`, history back). Delete the Chat-local `Sheet` (~lines 22–73 of ChatSheets).

Keep Chat CSS if visual parity requires it; the **behavior** (Escape, focus, scrim) must be the shared component.

---

## 4. One ReportDialog

[`web_app/src/community/ReportDialog.tsx`](../../../web_app/src/community/ReportDialog.tsx) vs inline `ReportForm` in [`ProfilePage.tsx`](../../../web_app/src/profile/ProfilePage.tsx). Parameterize target (publication vs profile) and submit function. Shared `reportIsSubmittable` already exists for publications in `@chat/shared`; use the same submit-gate idea for profiles.

---

## 5. Delete `MoreMenu`

[`web_app/src/chat/MoreMenu.tsx`](../../../web_app/src/chat/MoreMenu.tsx) wraps ActionMenu with a hardcoded ⋯. Call ActionMenu at the call site.

---

## Out of scope

- Merging AccountChoice and `useAccountRequired`. At most add a comment at both sites stating: AccountChoice = persist (guest allowed); AccountRequired = registered-only community actions. Do not add a third gate.
- Collapsing public share to one POST (P6, gated).
- CreatePage / CommunityPage splits unless ChatPage is done and Cris asks.

---

## Verification

```bash
npm test -w web_app
npm run typecheck -w web_app
```
