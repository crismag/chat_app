# Messaging Data Model and Rules

## 1. Purpose

This document defines the minimum persistent model and security invariants for Simple Messaging V1. Cursor should adapt SQL types, UUID conventions, timestamps, and migration syntax to the repository's existing SQLite/MariaDB abstractions.

Do not copy these examples blindly if the repository already has stronger conventions.

## 2. Table ownership

Use an explicit `messaging_` prefix because the application already has reflection/chat/message concepts unrelated to private user messaging.

Recommended logical tables:

```text
messaging_threads
messaging_thread_members
messaging_messages
messaging_contacts
messaging_requests
messaging_blocks
messaging_preferences
```

This makes ownership obvious and reduces accidental coupling with existing C.H.A.T. conversations.

## 3. Threads

Logical fields:

```text
messaging_threads
-----------------
id
kind              direct | group
name              nullable; normally group only
created_by_user_id
created_at
updated_at
```

Rules:

- `direct` threads must contain exactly two active participants;
- `group` threads may contain three or more participants, while later membership changes can reduce that count;
- a user cannot change thread kind after creation;
- direct thread names should normally come from the other user's profile, not persisted display text.

### Canonical direct pair

Repeated attempts to create a direct thread between A and B must reuse the same logical thread.

Cursor should inspect database conventions and choose one safe strategy, for example:

```text
direct_pair_key = min(userA,userB) + ':' + max(userA,userB)
```

with a uniqueness constraint for direct threads, or an equivalent normalized pair table/transaction-safe lookup.

Service-only "check then insert" without uniqueness protection is insufficient under concurrent requests.

## 4. Thread members

Logical fields:

```text
messaging_thread_members
------------------------
thread_id
user_id
role                 owner | member
joined_at
left_at              nullable, if soft membership history is needed
last_read_message_id nullable
```

Use the smallest membership-history model consistent with existing repository conventions. If hard deletion is simpler and sufficient, do not add `left_at` merely for hypothetical analytics.

Rules:

- one membership row per user/thread;
- direct threads do not need meaningful owner powers;
- group creator is owner;
- V1 can omit a separate admin role;
- only current members may read current private thread data;
- removed/left members may not send new messages;
- whether former members can view historical messages must be decided explicitly during implementation. Prefer the simpler privacy-safe behavior supported by the existing API architecture.

## 5. Messages

Logical fields:

```text
messaging_messages
------------------
id
thread_id
sender_user_id
body
created_at
```

V1 messages are immutable plain text.

Do not add edit history, attachments, reactions, reply metadata, delivery receipts, encryption envelopes, or deletion tombstones unless they become an explicit feature requirement.

Rules:

- sender is derived from authenticated server context;
- sender must be a current thread member;
- body must be non-empty after repository-standard validation/normalization;
- define and test a reasonable body-size limit;
- message retrieval is ordered deterministically by the repository's preferred sortable key (`created_at` plus ID, monotonic ID, or equivalent);
- polling endpoint must support fetching only messages after a known message cursor/ID.

## 6. Contacts

Logical fields:

```text
messaging_contacts
------------------
user_id
contact_user_id
created_at
```

A contact means an accepted persistent direct-messaging relationship.

Rules:

- contacts are symmetric at the product level;
- implementation may store two directional rows or one normalized pair, whichever best fits existing queries and constraints;
- accepting a message request establishes the contact relationship;
- being in the same group does not establish contact;
- being in the same community does not establish contact;
- deleting/hiding a chat later must not silently remove the contact;
- blocking may suppress or supersede the effective contact relationship without requiring destructive contact history changes.

## 7. Message requests

Logical fields:

```text
messaging_requests
------------------
id
sender_user_id
recipient_user_id
thread_id           nullable or linked to pending direct thread
status              pending | accepted | declined | cancelled
created_at
responded_at
```

Cursor should choose either:

1. create the direct thread at request time and keep it pending, or
2. keep request data separate and create/reuse the direct thread on acceptance.

Choose the option that produces less duplication in the existing repository. Do not store the same first-message body in two independent sources of truth.

Rules:

- sender and recipient must differ;
- only recipient can accept/decline;
- sender may cancel if implemented, but cancellation UI is optional in V1;
- accepted request establishes contact and usable direct conversation;
- decline must prevent immediate repeated spam. A simple cooldown/one-active-request rule is enough for V1;
- request creation is still subject to block and recipient preference checks.

## 8. Blocks

Logical fields:

```text
messaging_blocks
----------------
user_id
blocked_user_id
created_at
```

Rules:

- block is directional;
- duplicate block rows must be prevented;
- blocked user cannot send a new direct message request to blocker;
- blocked user cannot bypass block by creating a second direct thread;
- normal direct-message permission must treat block as a hard override;
- group membership does not necessarily disappear because of a direct-message block; V1 should avoid inventing complex group moderation semantics unless required.

## 9. Messaging preferences

Start with the smallest preference that gives users control over non-contact messages.

Logical model:

```text
messaging_preferences
---------------------
user_id
allow_non_contact_requests
updated_at
```

Future policy may become richer (contacts only, shared communities, publicly discoverable users, etc.), but V1 should expose the permission through a service function rather than scattering a boolean check across routes and UI.

Do not build the future discovery matrix yet.

## 10. User/profile dependency

Messaging references the existing user identity by `user_id` only.

Public contact rendering should consume a profile summary through an existing or narrow new adapter:

```text
id
username
preferred display name
avatar reference/url
```

Do not duplicate profile fields into messaging tables.

Email is authentication/account information and must not become the normal public messaging identifier or search fallback.

If a registered account lacks a completed profile during transition, use a neutral application fallback display, not the email address.

## 11. Discoverability is not authorization

Future users may be discoverable from:

- a public reflection they shared;
- a community where the viewer is a member;
- a shared group;
- accepted contacts;
- explicit username search.

Discovery only determines whether UI can present a person/profile. It does not automatically create a contact or bypass message-request preference.

Keep separate service decisions:

```text
canDiscoverUser(viewer, target)          # future/shared profile concern
canSendMessageRequest(sender, recipient) # messaging concern
canSendDirectMessage(sender, recipient)  # messaging concern
canReadThread(user, thread)              # messaging concern
```

## 12. Authorization invariants

Backend enforcement is mandatory.

For every protected operation, derive actor identity from server auth/session state and verify ownership/membership.

Must be impossible through normal API calls to:

- provide another user's sender ID and send as them;
- read a thread without membership;
- send to a thread without membership;
- accept/decline a request addressed to another user;
- add/remove group members without group authority;
- continue posting after removal/leave;
- bypass block by opening another direct thread;
- manipulate another member's read cursor;
- infer private email fields from messaging responses.

UI hiding is never considered an authorization mechanism.

## 13. Transaction/data-integrity points

Use transactions where existing repository conventions support them for operations that must change multiple records atomically, particularly:

- accept request → request status + contact + direct thread/member state;
- group creation → thread + owner membership + initial memberships;
- block → block row + request-state cleanup if required;
- canonical direct-thread creation under concurrency.

Avoid a new transaction abstraction if `db.ts` or domain stores already provide one.

## 14. Indexes and constraints

At minimum evaluate constraints/indexes for:

```text
thread members:      UNIQUE(thread_id, user_id)
messages:            INDEX(thread_id, message-order-key)
contacts:            UNIQUE normalized contact pair or directional pair
requests:            INDEX(recipient_user_id, status)
blocks:              UNIQUE(user_id, blocked_user_id)
direct conversation: UNIQUE normalized direct pair
```

Foreign-key behavior should match the repository's established database strategy.

## 15. SQLite and MariaDB

The application supports SQLite tests and MariaDB production paths. Messaging schema must work with both using the repository's existing portability patterns.

Cursor must not introduce SQLite-only SQL and assume production compatibility.

MariaDB-gated tests should cover at least:

- migration/schema creation;
- canonical direct-thread uniqueness;
- message insertion/retrieval;
- request acceptance transaction;
- block uniqueness/permission-sensitive queries.

## 16. Privacy and retention

V1 should not claim special encryption or disappearing-message properties.

Messages are persisted server-side as application data. Avoid logging message bodies in normal request logs or error telemetry unless an existing explicit debugging policy requires it.

Do not include message bodies, birth dates, emails, or unrelated profile fields in list APIs when only summaries/counts are needed.

Retention/deletion policy can be defined separately before broader release; do not invent destructive automatic cleanup in V1.
