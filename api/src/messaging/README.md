# Messaging

Private, Messenger / Instagram DM-style text between registered C.H.A.T. users.

## Slice 0 — inspection (locked)

| Question | Answer |
|---|---|
| Auth | `registeredUser` in `api/src/app.ts`. Guests and visitors get 401 without `needsAccount`. |
| Store | SQLite `CREATE TABLE IF NOT EXISTS` in this folder, like Notes. No MariaDB messaging schema. |
| Identity | `ProfileStore.byUserId` / `byHandle`. Fallback display name `Someone`. Never email. |
| Block | Reuse `profile_blocks` via `ProfileStore.isBlocked` / `setBlocked`. No `messaging_blocks`. |
| Branch | `cursor/simple-messaging-9fae` from `main`. |
| Groups | Deferred. No group tables beyond unused `kind`, no group routes. |

### Files owned here

```
api/src/messaging/
  limits.ts
  permissions.ts
  store.ts
  routes.ts
  messaging.test.ts
  README.md
web_app/src/messaging/
  api.ts
  icons.tsx
  MessagesPage.tsx
  MessagesPage.module.css
  MessagesPage.test.tsx
  ThreadView.tsx
  ThreadView.module.css
```

### Shared files (minimum)

- `api/src/app.ts` — store + `/api/messaging` with `registeredUser`
- `api/src/db.ts` — `merge()` moves for messaging tables
- `api/src/auth/guest-merge.test.ts` — seed + assert
- `web_app/src/app/App.tsx` — `/messages`, `/messages/:threadId`
- `web_app/src/shared/layout/AppShell.tsx` — Messages nav
- `web_app/src/app/App.test.tsx` — mock + nav test
- `web_app/src/profile/ProfilePage.tsx` — Message action

Do not touch `web_app/src/create/` or `api/src/create/`.

## Product

Chats (accepted / outgoing) · Requests (inbound pending) · Contacts. Two-pane desktop, stacked phone. Polling 4s on an open thread. Profile **Message** is the intake.

## Groups

Not in this V1. Same thread model can grow a `group` kind later without renaming tables.
