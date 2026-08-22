# Simple Messaging Implementation Plan

## 1. Objective

Add a deliberately small private messaging feature between registered C.H.A.T. users while minimizing merge conflicts with concurrent feature work.

The implementation must use new domain folders:

```text
web_app/src/messaging/
api/src/messaging/
```

Exact internal filenames should follow patterns already present in neighboring feature folders after Cursor inspects them.

## 2. First task: inspect only

Before writing implementation code, Cursor must inspect:

- `docs/development/DEVELOPMENT_INSTRUCTIONS.md`;
- this messaging package;
- `web_app/src/app/` routing/application composition;
- one or two nearby web feature folders such as `notes`, `community`, or `profile`;
- `api/src/app.ts` and API route registration conventions;
- `api/src/db.ts` and existing domain persistence seams;
- `api/src/mysql/` conventions;
- `api/src/auth/` server-side authenticated-user handling;
- `api/src/profile/` only to identify a narrow user-summary lookup seam;
- test organization in both workspaces.

Then report, without implementing:

1. proposed exact file tree under the two messaging folders;
2. minimum existing files that must be touched;
3. existing auth/user/store abstractions to reuse;
4. migration mechanism to reuse;
5. likely merge-conflict hotspots;
6. any reason the proposed folder isolation cannot be maintained.

Do not begin implementation until this boundary is acceptable.

## 3. Scope

### Include in V1

- registered-user access only;
- direct text conversations;
- list existing conversations;
- retrieve message history;
- send plain-text messages;
- timestamps;
- unread state;
- simple after-ID/newer-than polling;
- persistent accepted contacts;
- message requests for non-contacts;
- accept request;
- decline request;
- block user;
- recipient setting controlling whether non-contact requests are accepted;
- simple private group creation;
- group member list;
- group text messages;
- owner/member roles sufficient for V1;
- leave group;
- owner removes a member.

### Exclude from V1

- attachments or image messages;
- voice notes;
- voice/video calls;
- typing indicators;
- presence/last-seen;
- reactions;
- per-message replies/threads;
- forwarding;
- message editing;
- disappearing messages;
- public chat rooms;
- community-to-group automatic synchronization;
- invite links;
- push notifications;
- WebSockets;
- phone/address-book import;
- phone-number discovery;
- end-to-end-encryption claims.

## 4. Recommended web module ownership

Cursor should adapt naming to existing conventions, but all messaging-owned web implementation should stay conceptually inside:

```text
web_app/src/messaging/
├── api/ or client/
├── components/
├── hooks/
├── pages/ or views/
├── types.ts
├── messaging.css or local styles
└── *.test.ts(x)
```

Expected UI pieces are intentionally small:

- Messages page/shell;
- conversation list;
- direct/group conversation view;
- message bubble/row;
- text composer;
- contacts view;
- requests view;
- group create/member-management UI.

Reuse existing app-level styling primitives where safe. Do not move shared components into messaging or perform global style cleanup.

## 5. Recommended API module ownership

Keep messaging backend behavior conceptually inside:

```text
api/src/messaging/
├── types.ts
├── validation.ts
├── permissions.ts
├── service.ts
├── store.ts
├── routes.ts
└── *.test.ts
```

If existing domains use a different shape, follow the established shape instead of imposing these filenames. The important boundary is ownership under `api/src/messaging/`.

The acting user must always come from server-side authenticated session/context. Never accept client-provided `senderUserId` as authority.

## 6. Suggested HTTP resource surface

Follow existing API routing style. Conceptually, V1 needs equivalents of:

```text
GET    /api/messaging/threads
POST   /api/messaging/threads/direct
GET    /api/messaging/threads/:threadId/messages
POST   /api/messaging/threads/:threadId/messages
POST   /api/messaging/threads/:threadId/read

GET    /api/messaging/contacts

GET    /api/messaging/requests
POST   /api/messaging/requests
POST   /api/messaging/requests/:requestId/accept
POST   /api/messaging/requests/:requestId/decline
POST   /api/messaging/requests/:requestId/block

POST   /api/messaging/groups
POST   /api/messaging/groups/:threadId/members
DELETE /api/messaging/groups/:threadId/members/:userId
POST   /api/messaging/groups/:threadId/leave
```

This list is a product/API requirement, not a mandate to create one file per endpoint.

## 7. Slice 1 — module skeleton and persistence seam

Implement only:

- new messaging folders;
- messaging types/domain constants;
- database migration/schema additions using existing migration conventions;
- store/service seam using existing database abstractions;
- persistence tests for threads, members, and messages.

Do not build UI or route integration yet.

Acceptance:

- SQLite tests pass;
- MariaDB-path tests exist or are wired into the existing gated pattern;
- messaging tables cannot collide with existing generic `messages`/conversation concepts;
- no unrelated refactor occurs.

Stop after Slice 1.

## 8. Slice 2 — direct conversations

Implement:

- create or reuse one direct thread for the same two users;
- list threads for authenticated user;
- retrieve one thread only if the user is a member;
- thread membership authorization.

Direct-thread invariant:

> A direct thread contains exactly two users and repeated A↔B creation returns/reuses the canonical thread rather than creating duplicates.

If necessary, use a normalized direct-pair key or equivalent unique constraint/service logic that is safe under concurrent requests.

Acceptance tests:

- A→B and B→A resolve to the same direct thread;
- a third user cannot read it;
- duplicate concurrent creation cannot produce uncontrolled duplicate direct threads;
- guest/anonymous users are rejected.

Stop after Slice 2.

## 9. Slice 3 — send/read/unread/polling

Implement:

- plain text body validation;
- message insertion;
- chronological retrieval/pagination adequate for V1;
- `after`/newer-than retrieval suitable for polling;
- member read marker;
- unread count/state.

Do not add WebSockets.

The open conversation may poll approximately every 3–5 seconds. Inactive screens should avoid aggressive polling.

Acceptance tests:

- sender identity cannot be spoofed;
- non-member cannot send or read;
- removed member cannot continue posting;
- read marker belongs to the same thread;
- unread count changes correctly;
- empty/oversized/invalid body is rejected consistently.

Stop after Slice 3.

## 10. Slice 4 — contacts, requests, permissions, block

Implement persistent concepts separately:

- contact;
- pending/accepted/declined request;
- block;
- recipient preference for non-contact requests.

V1 policy:

- accepted contacts may direct-message each other;
- non-contacts may create a message request only if recipient policy allows it;
- accepted request creates/activates the direct relationship and persistent contact state;
- decline does not create contact;
- decline must not permit immediate repeated request spam;
- block overrides contact/request permission;
- removing/contact-state changes and blocking are distinct concepts.

Do not implement the full future public/community discovery policy here. Messaging should expose a narrow permission function that can later consume those rules.

Conceptual service functions:

```text
canSendDirectMessage(actor, recipient)
canSendMessageRequest(actor, recipient)
acceptMessageRequest(actor, request)
blockMessagingUser(actor, target)
```

Acceptance tests:

- user cannot accept/decline someone else’s request;
- blocked user cannot create a fresh request/thread to bypass block;
- client UI state is irrelevant to backend permission;
- contacts persist independently of whether a conversation is hidden/deleted from UI later.

Stop after Slice 4.

## 11. Slice 5 — minimal UI

Build only enough UI for the complete workflow:

```text
Messages
├── Chats
├── Contacts
├── Requests
└── Groups
```

Required states:

- loading;
- empty;
- error;
- conversation selected;
- request pending;
- blocked/permission denied where applicable;
- mobile narrow viewport;
- desktop.

No global design-system rewrite. Keep messaging styles local when possible.

The UI may initially consume username/display-name/avatar through a small user-summary adapter. Never display email as the public identity fallback.

Stop after Slice 5.

## 12. Slice 6 — groups

Implement private groups using the same thread/message model:

- create group;
- group name;
- selected initial members;
- owner/member roles;
- add member;
- owner remove member;
- member leave;
- send/read messages.

Do not automatically add group members to each other’s contacts.

Do not synchronize communities to groups in V1.

Acceptance tests:

- group members only can read/send;
- removed member cannot read new private content/send;
- member cannot perform owner-only removal;
- leaving group works without corrupting message history;
- group membership never creates `messaging_contacts` rows implicitly.

Stop after Slice 6.

## 13. Slice 7 — cross-feature integration

Do this only after the core works and after checking for concurrent modifications.

Potential tiny integration points:

- app navigation entry for Messages;
- profile action that can initiate a request/message;
- community/member or public-author surfaces later, when those feature owners are stable.

If profile/community files are under active concurrent modification, leave documented integration TODOs instead of forcing conflicting edits.

## 14. Performance and storage

Keep V1 simple, but add normal indexes for:

- thread membership by user/thread;
- messages by thread + ordering/id;
- requests by recipient + status;
- contacts by user/contact;
- blocks by user/blocked user;
- direct-pair uniqueness if implemented as a key.

Do not add caching infrastructure until measurements justify it.

## 15. Definition of done

Messaging V1 is complete only when:

- registered users can complete direct request→accept→chat flow;
- accepted contacts are browsable;
- direct thread authorization is server-enforced;
- unread state works;
- simple groups work;
- block cannot be bypassed through normal API paths;
- polling works without WebSockets;
- mobile and desktop flows are usable;
- SQLite suite passes;
- MariaDB-gated coverage exists and is exercised before production declaration;
- no email address is exposed as normal contact identity;
- no unrelated feature was refactored to make messaging fit;
- docs reflect any intentional deviation from this plan.
