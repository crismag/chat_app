# Feature: Messaging Wave 1 — Conversation Completeness

## Overview

Give V1 direct threads the verbs and inbox controls people expect from a
familiar messenger, without adding media, groups, push, or a realtime
transport. User value: a conversation can be answered in place, corrected,
acknowledged, found later, and put aside. The other person's copy remains
theirs.

This spec is the implementation contract for Wave 1. The evaluation that
chose these features is [`V2_FEATURE_PLAN.md`](V2_FEATURE_PLAN.md).

## Functional Requirements

### FR-001: Actor identity

The system shall derive the acting user from the server session on every
messaging write and shall ignore any client-supplied sender, owner, or
membership flag.

### FR-002: V1 gates unchanged

While a user is a guest, unverified for a send path, blocked either way, or
facing a pending incoming request they have not accepted, the system shall
refuse the new Wave 1 writes with the same status classes V1 already uses.

### FR-003: Reply

While the actor is a current member of a direct thread and the parent
message belongs to that thread and is not hidden-for-them as a tombstone
they cannot see, when they send a message with `parentMessageId`, the
system shall store the reply and return the parent summary (id, sender,
truncated body) with the new message.

### FR-004: Reply to missing parent

When `parentMessageId` is unknown, in another thread, or a tombstone the
actor may not quote, the system shall reject the send and shall not create
an orphan reply.

### FR-005: Edit own message

While the actor is the sender, the message is not deleted, and the edit
window (15 minutes from `createdAt`) is still open, when they submit a new
body, the system shall replace the body, set `editedAt`, and keep the
original id.

### FR-006: Edit refused

When the actor is not the sender, the window has closed, or the message is
deleted, the system shall refuse the edit.

### FR-007: Delete for me

While the actor is a thread member, when they delete a message for
themselves, the system shall hide that message from their own reads and
shall leave it visible to the other member.

### FR-008: Delete for everyone

While the actor is the sender and the delete-for-everyone window (15
minutes from `createdAt`) is still open, when they delete for everyone, the
system shall store a tombstone: same id, empty/replaced body, `deletedAt`
set, and both members see that the message was removed.

### FR-009: Delete-for-everyone window closed

When the window has closed, the system shall offer only delete-for-me.

### FR-010: Reactions

While the actor is a current member and the message is visible to them,
when they toggle one emoji from the fixed set `❤` `🙏` `👍` `✅`, the
system shall add or remove that single reaction for that user on that
message. A user may have at most one emoji per message.

### FR-011: Reaction set closed

When a client sends any other emoji or a custom string, the system shall
reject the reaction.

### FR-012: Seen receipts

While both members participate in seen receipts, when a member's
`lastReadMessageId` advances, the system shall expose that cursor to the
other member as `otherLastReadMessageId` on the thread.

### FR-013: Seen reciprocity

Where the actor has disabled seen receipts, the system shall not expose
the other member's read cursor to the actor and shall not expose the
actor's read cursor to the other member.

### FR-014: Mute

While the actor is a member, when they mute a thread (indefinitely or until
a timestamp), the system shall keep the thread in Chats, continue storing
new messages, and exclude that thread's unread count from `waiting.total`
and `waiting.messages` until unmuted or the timestamp passes.

### FR-015: Archive

While the actor is a member, when they archive a thread, the system shall
remove it from the default Chats list, keep history, and restore it to
Chats on the next inbound message from the other person or when the actor
unarchives it.

### FR-016: Pin

While the actor is a member and they have fewer than 3 pinned threads,
when they pin a thread, the system shall sort it above unpinned Chats.
When they already have 3 pins, the system shall refuse a fourth.

### FR-017: Hide conversation for me

While the actor is a member, when they remove the conversation from their
inbox, the system shall hide the thread from their lists, shall not destroy
messages for the other member, and shall recreate visibility for the actor
if they open the same A↔B pair again.

### FR-018: In-thread search

While the actor is a member, when they search a thread with at least two
characters, the system shall return matching messages in that thread that
are visible to them, newest first, limited to 50.

### FR-019: History pagination

When listing messages, the system shall return a bounded page (default 50,
maximum 100) plus a cursor for older messages. Polling `after` shall keep
working for newer messages.

### FR-020: List filters

When listing threads, the system shall default to non-archived, non-hidden
chats, ordered by pin then `updatedAt`, and shall expose an explicit
archived list.

### FR-021: Payload fold

The system shall include reply, edit, delete, reaction summary, and seen
cursor fields on existing thread and message resources so the open-thread
poll does not require extra round trips.

## Non-Functional Requirements

### Performance

- Open-thread poll remains 4s and one messages request (plus existing
  thread refresh if the UI already does it).
- Message page of 50: p95 under the same budget as today's full-thread
  read for short threads.
- Search is thread-scoped in Wave 1. Do not scan all messages for a user.

### Security

- Session auth as today. No client-provided actor ids.
- Block, request, cooldown, and email-confirmation rules unchanged.
- Delete-for-me must not leak the hidden body back through search, poll,
  or reply quotes.
- Delete-for-everyone tombstones must not return the original body.
- Do not log message bodies on edit or delete.

### Privacy

- Seen receipts are reciprocal (FR-013).
- Hide/archive/mute/pin are per-member and never disclosed to the other
  person as a notification.
- Contacts remain a directional address book. Wave 1 does not make them
  symmetric.

### Compatibility

- Existing V1 clients that ignore new JSON fields must still send, list,
  and poll.
- `kind` remains `direct` only.
- SQLite remains the messaging store unless a separate one-store project
  has already moved it.

## Acceptance Criteria

### AC-001: Reply in place

Given two contacts in an accepted direct thread and a visible message M,
When A sends a reply with `parentMessageId` = M,
Then the thread shows A's message quoted under M's truncated body,
And B sees the same quote on the next poll,
And a non-member cannot read either message.

### AC-002: Reply rejected across threads

Given message M in thread T1,
When A posts to T2 with `parentMessageId` = M,
Then the API returns 400,
And no message is stored in T2.

### AC-003: Edit typo

Given A sent message M 2 minutes ago,
When A edits M to a valid new body,
Then both members see the new body and an edited marker,
And the id is unchanged,
And B's unread/seen cursors still refer to that id.

### AC-004: Edit window closed

Given A sent message M 16 minutes ago,
When A tries to edit M,
Then the API refuses the edit,
And the body is unchanged.

### AC-005: Delete for me only

Given A and B can both see message M (from either person),
When A deletes M for themselves,
Then A's history and search omit M,
And B still sees M,
And B can still reply to M.

### AC-006: Delete for everyone

Given A sent M 2 minutes ago,
When A deletes M for everyone,
Then both A and B see a tombstone at the same id,
And neither history nor search returns the original body,
And a reply to M is rejected.

### AC-007: React and toggle

Given A and B are members and M is visible,
When A reacts with 🙏,
Then both see one 🙏 from A,
When A reacts with ❤,
Then 🙏 is gone and ❤ is present,
When A reacts with ❤ again,
Then A has no reaction on M.

### AC-008: Closed reaction set

Given a visible message,
When A reacts with 🔥,
Then the API returns 400,
And no reaction is stored.

### AC-009: Seen when both allow it

Given A and B both allow seen receipts and A has sent M,
When B opens the thread and the client marks M read,
Then A's thread payload includes `otherLastReadMessageId` = M
within one poll.

### AC-010: Seen reciprocity

Given A has disabled seen receipts,
When B reads A's message,
Then A does not receive B's cursor,
And B does not receive A's cursor.

### AC-011: Mute keeps mail, quiets badge

Given A has 2 unread in thread T and T is muted,
When `/waiting` is fetched,
Then those 2 are not in `messages` or `total`,
And T still appears in Chats,
And new messages still arrive when A opens T.

### AC-012: Archive until they write back

Given A archives T,
When A opens Chats,
Then T is absent,
And T appears in the archived list,
When B sends a new message,
Then T returns to A's Chats with unread state.

### AC-013: Pin cap

Given A has 3 pinned threads,
When A pins a fourth,
Then the API refuses,
And the existing 3 remain pinned.

### AC-014: Hide for me, reopen canonical pair

Given A hides the A↔B conversation,
When A lists Chats,
Then that thread is absent,
And B still sees it,
When A opens B's handle again,
Then the same `directPairKey` thread is reused and becomes visible to A.

### AC-015: Search skips hidden and deleted-for-everyone bodies

Given a thread with a matching word in a live message, a delete-for-me
message, and a tombstone,
When A searches for that word,
Then only the live visible message is returned.

### AC-016: Pagination and poll

Given a thread with 120 visible messages,
When A lists messages with no cursor,
Then they receive the newest ≤ 50 and a cursor for older pages,
When A polls `after` the newest id,
Then only later messages arrive.

### AC-017: V1 request still blocks reply

Given A has a pending inbound request from B,
When A tries to reply, react, or edit in that thread,
Then the write is forbidden until A accepts,
And decline/block still work as in V1.

### AC-018: Narrow and desktop UI

Given a phone-width and a desktop two-pane layout,
When A uses reply, edit, delete, react, mute, archive, pin, hide, and
search,
Then each action is reachable without a dead control,
And the Messages badge still matches `/waiting`.

## Error Handling

| Error condition | HTTP | User message |
|---|---|---|
| Not signed in | 401 | Sign in to use Messages. |
| Email unconfirmed on a send/edit/react path | 403 | Confirm your email address before sending messages. … |
| Not a member / unknown thread or message | 404 | Not found. |
| Pending inbound request | 403 | Accept this request before replying. |
| Block either way | 403 | You cannot message this person. |
| Invalid / empty body | 400 | Existing V1 body errors. |
| Unknown or foreign parentMessageId | 400 | That message cannot be replied to. |
| Edit or delete-for-everyone window closed | 400 | That message can no longer be changed. |
| Not the sender on edit / delete-for-everyone | 403 | You can only change your own messages. |
| Reaction not in the fixed set | 400 | That reaction is not available. |
| Fourth pin | 400 | You can pin up to 3 conversations. |
| Search query shorter than 2 characters | 200 | `{ items: [] }` (same courtesy as people search). |
| Send rate limit | 429 | You are sending very fast. Take a moment. |

## Data model deltas

Additive columns and one new table. Do not rename V1 tables.

```text
messaging_messages
  parent_message_id   nullable
  edited_at           nullable
  deleted_at          nullable      -- tombstone for delete-for-everyone

messaging_message_hides
  user_id
  message_id
  created_at
  PRIMARY KEY (user_id, message_id)

messaging_reactions
  message_id
  user_id
  emoji               -- one of ❤ 🙏 👍 ✅
  created_at
  PRIMARY KEY (message_id, user_id)

messaging_thread_members
  muted_until         nullable      -- null = not muted; far-future = until on
  archived_at         nullable
  pinned_at           nullable
  hidden_at           nullable      -- hide conversation for me

messaging_preferences
  allow_seen_receipts INTEGER NOT NULL DEFAULT 1
```

Suggested public message shape (additive):

```ts
type PublicMessage = {
  id: string
  threadId: string
  senderUserId: string
  body: string
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
  parent: { id: string; senderUserId: string; body: string } | null
  reactions: { emoji: string; count: number; me: boolean }[]
}
```

`body` on a tombstone is empty. `parent.body` is truncated server-side
(240 characters) and omitted when the parent is a tombstone or hidden
from the reader.

Suggested public thread additions:

```ts
otherLastReadMessageId: string | null
mutedUntil: string | null
archived: boolean
pinned: boolean
```

## Suggested HTTP surface

Follow existing `/api/messaging` style. Conceptual additions:

```text
GET    /api/messaging/threads?view=chats|archived
POST   /api/messaging/threads/:id/messages          // body may include parentMessageId
PATCH  /api/messaging/threads/:id/messages/:mid     // { body }
POST   /api/messaging/threads/:id/messages/:mid/delete
       { scope: "me" | "everyone" }
PUT    /api/messaging/threads/:id/messages/:mid/reaction
       { emoji } | { emoji: null }
GET    /api/messaging/threads/:id/messages?before=&after=&limit=
GET    /api/messaging/threads/:id/search?q=
POST   /api/messaging/threads/:id/mute              { until: string | null }
POST   /api/messaging/threads/:id/archive           { archived: boolean }
POST   /api/messaging/threads/:id/pin               { pinned: boolean }
POST   /api/messaging/threads/:id/hide
PATCH  /api/messaging/preferences                   // + allowSeenReceipts
```

Exact filenames stay inside `api/src/messaging/` and
`web_app/src/messaging/`. Do not add a new package.

## Implementation TODO

### Backend

- [ ] Additive SQLite schema for the columns/tables above
- [ ] Pagination + `before` cursor on `listMessages`
- [ ] Reply validation and parent summary
- [ ] Edit window and body re-validation via `parseMessageBody`
- [ ] Delete-for-me hides; delete-for-everyone tombstones
- [ ] Reaction toggle with closed set
- [ ] Seen cursor on thread + `allowSeenReceipts`
- [ ] Mute / archive / pin / hide on membership
- [ ] `waitingFor` ignores muted (and hidden) threads
- [ ] Thread-scoped search that respects hides and tombstones
- [ ] Route tests for every refusal in the error table

### Frontend

- [ ] Long-press or message menu: reply, edit, delete, react
- [ ] Quote preview in the composer
- [ ] Edited / deleted markers on bubbles
- [ ] Reaction row under a bubble
- [ ] Seen line when reciprocal ("Seen" under the last delivered-to-them)
- [ ] Thread menu: mute, pin, archive, remove for me
- [ ] Archived list
- [ ] In-thread search field
- [ ] Older-history load on scroll up
- [ ] Preferences: allow requests (existing) + allow seen receipts
- [ ] Desktop two-pane and narrow stacked layouts

### Testing

- [ ] Store tests for edit window, tombstone, hide-for-me, pin cap
- [ ] Authorization tests: non-member, wrong sender, block, pending request
- [ ] `waitingFor` mute / archive / request double-count still correct
- [ ] MessagesPage / ThreadView tests for menu actions and empty/error
- [ ] MariaDB not required for Wave 1; do not add a second schema here

## Out of Scope

- Groups, invite links, @mentions
- Attachments, verse cards, reflection share
- Forwarding
- Push, WebSockets, typing, presence
- Voice notes, calls, stories, stickers, GIFs, location
- Cross-inbox search
- E2E-encryption claims
- Changing V1 contact directionality

## Open Questions

- [ ] Confirm 15 minutes as the edit and delete-for-everyone window.
- [ ] Confirm the four reactions. A fifth (for example 😂) is a product
      choice, not an implementation one — do not add it in the slice.
- [ ] Confirm archive-on-new-message (WhatsApp-style) rather than
      staying archived until manually restored.
- [ ] Confirm hide-for-me reopens the same canonical thread (recommended)
      rather than creating a fresh empty one.

Default answers if implementation starts without a reply: 15 minutes; the
four emojis above; WhatsApp-style unarchive on inbound; reuse the
canonical thread.
