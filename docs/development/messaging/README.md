# Simple Messaging Development Pack

This package defines the first deliberately small registered-user messaging feature for C.H.A.T. It is written for Cursor/AI-assisted implementation while other agents may be modifying Create Studio, profile, reflections, authentication, or community code concurrently.

## Read first

Before implementation, read:

1. `../DEVELOPMENT_INSTRUCTIONS.md`
2. `IMPLEMENTATION_PLAN.md`
3. `DATA_MODEL_AND_RULES.md`
4. `CURSOR_WORKFLOW.md`

The repository development rules remain authoritative. This package narrows those rules for messaging; it does not replace them.

## Goal

Provide familiar, minimal private text messaging between registered users without turning C.H.A.T. into a WhatsApp/Telegram clone.

V1 includes:

- registered users only;
- direct text conversations;
- conversation history;
- unread state;
- accepted contacts;
- message requests from non-contacts, subject to recipient settings;
- accept, decline, and block;
- simple private group chats;
- polling for new messages.

V1 explicitly excludes attachments, voice/video, calls, typing indicators, presence, reactions, forwarding, disappearing messages, WebSockets, push notifications, phone-contact synchronization, and end-to-end-encryption claims.

## Concurrent-work isolation is a primary requirement

The current repository already organizes web features by domain under `web_app/src/` and API domains under `api/src/`. Messaging should follow that convention and own new folders:

```text
web_app/src/messaging/
api/src/messaging/
```

Messaging-specific components, hooks, API clients, service/store code, validation, permissions, types, and tests belong inside those folders whenever practical.

Do not create a new package or framework merely to isolate messaging. Folder ownership is sufficient for V1.

Changes outside those folders must be kept to the smallest integration seams needed for routing/navigation, application registration, database migration/schema wiring, authentication context, and user/profile lookup.

Do not modify `web_app/src/create/` or `api/src/create/` as part of messaging.

Do not refactor profile, community, reflections, auth, or shared infrastructure merely because messaging could theoretically improve their architecture.

If broader changes appear necessary, stop that portion, document the dependency, and continue with work that remains isolated.

## Identity boundary

Messaging stores user IDs. It does not own public identity fields.

Username, display name, first/last name, birth date, location, avatar, and profile privacy belong to the profile/identity feature. Messaging may consume a narrow profile view such as:

```ts
interface MessagingUserSummary {
  id: string;
  username?: string;
  displayName: string;
  avatarUrl?: string;
}
```

Never expose email as the normal public messaging identity or search result fallback.

## Relationship model

Keep these concepts separate:

- **discoverable user**: someone visible through public sharing, shared communities, groups, or future username search;
- **message request**: a non-contact asks to begin private conversation;
- **contact**: an accepted persistent messaging relationship;
- **thread member**: a participant in one direct or group thread;
- **block**: overrides direct-message/request permissions.

Group membership does not automatically create contacts.

## V1 product rule

Keep the implementation boring and understandable. Prefer a small service, a small store boundary, normal HTTP endpoints, MariaDB/SQLite persistence using existing repository conventions, and simple polling.

Do not add an event bus, queue, realtime service, notification pipeline, repository-of-repository abstraction, or new infrastructure layer unless an existing repository convention requires it.

## Implementation sequence

Cursor should work in slices and stop after each slice for review:

1. inspection and boundary report — no code;
2. isolated module skeleton and schema/store seam;
3. direct threads;
4. send/read/unread/polling;
5. contacts, requests, blocking, and messaging preference check;
6. minimal messaging UI;
7. simple group chat;
8. tiny cross-feature integration points only after the core is stable.

See `IMPLEMENTATION_PLAN.md` for acceptance criteria and `CURSOR_WORKFLOW.md` for the exact agent workflow.
