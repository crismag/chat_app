# Simple Messaging Development Pack

This package defines private registered-user messaging for C.H.A.T. It is written for Cursor/AI-assisted implementation while other agents may be modifying Create Studio, profile, reflections, authentication, or community code concurrently.

## Status

**V1 is complete and tested.** Direct text, requests, directional contacts, unread, polling, people search, and profile intake are live. Groups were designed here and deferred.

**V2 Wave 1 is implemented** (reply, edit, delete, reactions, seen, mute, archive, pin, hide-for-me, search, pagination). Evaluation and later waves: [`V2_FEATURE_PLAN.md`](V2_FEATURE_PLAN.md). Wave 1 spec: [`v2-wave-1.spec.md`](v2-wave-1.spec.md).

## Read first

Before implementation, read:

1. `../DEVELOPMENT_INSTRUCTIONS.md`
2. `IMPLEMENTATION_PLAN.md` (V1 — historical contract)
3. `DATA_MODEL_AND_RULES.md`
4. `CURSOR_WORKFLOW.md`
5. `V2_FEATURE_PLAN.md` and `v2-wave-1.spec.md` when changing messaging after V1

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
- people search;
- polling for new messages.

V1 deferred simple private group chats. They remain a Wave 2 item.

V1 explicitly excludes attachments, voice/video, calls, typing indicators, presence, reactions, forwarding, disappearing messages, WebSockets, push notifications, phone-contact synchronization, and end-to-end-encryption claims. Wave 1 adds some of those conversation verbs; it does not add media, groups, or a new transport.

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

V1 slices 1–6 and the profile/nav seams are done. Slice 7 (groups) was deferred; it is Wave 2 in [`V2_FEATURE_PLAN.md`](V2_FEATURE_PLAN.md).

New messaging work after V1 starts from that plan and [`v2-wave-1.spec.md`](v2-wave-1.spec.md), still stopping after each slice for review.

See `IMPLEMENTATION_PLAN.md` for the original V1 acceptance criteria and `CURSOR_WORKFLOW.md` for isolation rules that still apply.
