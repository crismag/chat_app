# Messaging V2 — Feature Evaluation and Plan

V1 private messaging is tested and in use. This document evaluates the next
features against popular messaging applications, keeps C.H.A.T. from becoming
a general-purpose messenger, and names the next implementation set.

Read first:

1. [`../PRODUCT.md`](../PRODUCT.md) — C.H.A.T. is a private-first reflection
   product, not a social network.
2. [`README.md`](README.md) — V1 goal and isolation rules still apply.
3. [`DATA_MODEL_AND_RULES.md`](DATA_MODEL_AND_RULES.md) — invariants that V2
   must not break.
4. [`v2-wave-1.spec.md`](v2-wave-1.spec.md) — EARS requirements for the first
   implementation wave.

Do not begin V2 implementation from this document alone. Wave 1 work uses the
spec. Later waves need their own specs before code.

## 1. What V1 actually shipped

The original V1 pack listed groups. They were deferred. What is live today:

| Capability | Status |
|---|---|
| Registered-user 1:1 text | Shipped |
| Canonical A↔B direct thread | Shipped |
| History + 4s polling on an open thread | Shipped |
| Unread count and Messages badge (`/waiting`) | Shipped |
| People search by handle / display name | Shipped |
| Open from profile **Message** or search | Shipped |
| Message requests + accept / decline / block | Shipped |
| Directional contacts (own address book) | Shipped |
| Allow / refuse non-contact requests | Shipped |
| Email confirmation required to send | Shipped |
| Send and new-conversation rate limits | Shipped |
| Profile-block override | Shipped |
| Groups | Deferred — `kind` exists, no group routes |
| Attachments, replies, edit, delete, reactions | Not built |
| Seen-by-other, mute, archive, pin, search-in-chat | Not built |
| Typing, presence, push, WebSockets | Explicitly out of V1 |
| MariaDB messaging schema | Not built — SQLite is the live path |

V1 already behaves like Instagram / Messenger DMs on the relationship side
(request inbox, directional contacts, block) and like a small SMS app on the
thread side (plain text, timestamps, unread). The gap people will feel next is
not "more ways to start a chat." It is that a conversation cannot be managed
or completed the way every familiar messenger allows.

## 2. Product constraint

C.H.A.T. messaging exists so two registered people can talk privately —
encouragement, a verse, a question after a shared reflection — without leaving
the product.

It does **not** exist to compete with WhatsApp, Telegram, Signal, iMessage,
Messenger, Slack, or Discord.

[`PRODUCT.md`](../PRODUCT.md) already refuses a full social network.
[`README.md`](README.md) already refuses a WhatsApp clone. Community spaces
and join requests now exist as their own product surface. Messaging groups,
if added, are small private chats, not a second church-management layer.

A feature is in scope for V2 only if it is either:

1. **table-stakes conversation UX** that V1 users will miss within a week, or
2. **C.H.A.T.-native** — it uses reflections, publications, or Create cards
   inside a thread in a way a generic messenger cannot.

Everything else waits, however popular it is elsewhere.

## 3. Competitive evaluation

Compared against WhatsApp, Telegram, Signal, iMessage / RCS, Messenger /
Instagram DM, and Slack. Discord is listed only where a feature is distinctive.

Scoring:

- **Ship next** — Wave 1 or 2.
- **Later** — useful, but needs infrastructure or a separate spec.
- **Not for C.H.A.T.** — fights the product, or the cost is not justified.

### 3.1 Conversation completeness

These are the verbs people already expect in a thread.

| Feature | Who has it | Fit | Verdict |
|---|---|---|---|
| Reply / quote a specific message | All of the above | High. Turns a scroll of bubbles into a conversation. | **Ship next (Wave 1)** |
| Edit own message (short window) | WhatsApp, Telegram, Slack, Signal (limited) | High. Typos in a pastoral or personal message matter. | **Ship next (Wave 1)** |
| Delete for me / delete for everyone (short window) | All | High. V1 messages are immutable; that will not hold once people rely on this. | **Ship next (Wave 1)** |
| Reactions (small fixed set) | All | High if the set is tiny (for example ❤ 🙏 👍 ✅). Not a sticker store. | **Ship next (Wave 1)** |
| Seen / read receipts | WhatsApp, iMessage, Messenger, Slack | High and cheap: `last_read_message_id` already exists per member. | **Ship next (Wave 1)** |
| Forward a message | WhatsApp, Telegram, Signal, Messenger | Medium. Easy to leak a private pastoral sentence into another thread. | **Later, with consent rules** |
| Mentions / @name | Slack, Discord, Telegram groups | Low until groups exist. | After groups |
| Link previews | Most | Medium. Privacy and fetch cost. Plain URLs are enough for now. | Later |
| Markdown / rich text | Slack, Telegram, Discord | Low. Keep the composer boring. Notes already have formatting; messaging should stay speech. | Not for V2 |

### 3.2 Inbox hygiene

V1 can only grow a chat list. It cannot put a conversation aside.

| Feature | Who has it | Fit | Verdict |
|---|---|---|---|
| Mute (with optional duration) | All | High. Requests and encouragement threads will otherwise nag via badge/polling. | **Ship next (Wave 1)** |
| Archive / hide from Chats | WhatsApp, Messenger, Telegram | High. Distinct from delete and from removing a contact. | **Ship next (Wave 1)** |
| Pin a few chats | WhatsApp, Telegram, Signal, Slack | Medium-high. Small cap (3). | **Ship next (Wave 1)** |
| Search inside a thread | All | High once threads are more than a greeting. | **Ship next (Wave 1)** |
| Search across all messages | Slack, Telegram, iMessage | Medium. Needs indexes and a privacy review. | Wave 2 |
| Delete / leave a conversation for myself | All | High. Must not destroy the other person's copy. | **Ship next (Wave 1)** |
| Star / bookmark a message | WhatsApp, Telegram, Slack | Medium. Reflections already are the keep-worthy store. | Later |
| Unsend after long delay | Telegram | Low. A short delete window is enough. | Not for V2 |

### 3.3 Rich content

| Feature | Who has it | Fit | Verdict |
|---|---|---|---|
| Share a reflection or publication into a thread | None of them as a first-class object | **The** C.H.A.T. differentiator. A card, not a pasted URL. | **Wave 2** |
| Image / verse-card attachment | All messengers have photos | High if the first image type is a Create export or a single photo, not a file dump. | **Wave 2** |
| Documents / arbitrary files | WhatsApp, Telegram, Slack | Low. Storage, malware, moderation. | Not for V2 |
| Voice notes | WhatsApp, Telegram, Signal, Messenger | Medium. Useful, but new media pipeline and mobile permissions. | Later |
| Stickers, GIFs, emoji marketplace | Most | Low. Noise in a reflection product. | Not for C.H.A.T. |
| Location | WhatsApp, Messenger, Telegram | Low. Wrong product. | Not for C.H.A.T. |
| Polls | WhatsApp, Telegram, Slack | Low until groups. | After groups |
| In-thread Scripture reference chip | None | High, C.H.A.T.-native. Reuse the existing passage lookup. | **Wave 2** |

### 3.4 People and spaces

| Feature | Who has it | Fit | Verdict |
|---|---|---|---|
| Private groups (named, owner, add/remove, leave) | All | High. Already designed in V1 and deferred. Must not become Community. | **Wave 2** |
| Community / church spaces | WhatsApp Communities, Slack workspaces | Already a Community product. Do not rebuild it in messaging. | Not in messaging |
| Invite links | WhatsApp, Telegram, Signal | Medium. Abuse surface. Owner-only, expiring, after groups exist. | After groups stabilize |
| Channels / broadcast lists | Telegram, WhatsApp Channels | Low. That is publishing, which Community already does. | Not for C.H.A.T. messaging |
| Phone-book import / SMS identity | WhatsApp, Signal | Refused in V1. Handle + profile remains the identity. | Not for C.H.A.T. |
| Username / handle search | Telegram, Signal, Discord | Shipped in V1. | Done |
| Message requests | Instagram, Messenger, iMessage (unknown senders) | Shipped in V1. | Done |
| Stories / status | WhatsApp, Instagram, Signal | Social-network creep. | Not for C.H.A.T. |
| Bots / automation | Telegram, Slack, Discord | Out of product scope. | Not for C.H.A.T. |

### 3.5 Realtime and reach

| Feature | Who has it | Fit | Verdict |
|---|---|---|---|
| Push notifications | All mobile messengers | High for a packaged app. Capacitor Phase 8 left this out. | **Wave 3** |
| Typing indicator | All | Medium. Needs faster transport than 4s polling. | Wave 3, with transport |
| Presence / last seen | WhatsApp, Messenger, Telegram | Low-medium. Pastoral privacy problem. Default off if ever added. | Later, opt-in only |
| Delivery receipts (sent vs delivered) | WhatsApp, Signal | Low while there is no offline queue or push. | After push |
| WebSockets / SSE | All modern messengers | Infrastructure, not a feature. Keep polling until Wave 3 forces a change. | Wave 3 decision |
| Voice / video calls | WhatsApp, Signal, Messenger, FaceTime, Slack huddles | Wrong product and a new media stack. | Not for C.H.A.T. |
| Disappearing messages | Signal, WhatsApp, Messenger | Medium for sensitive pastoral talk, but retention policy is a separate decision. V1 said not to invent destructive cleanup. | Later, explicit policy |
| End-to-end encryption claims | Signal, WhatsApp, iMessage | Do not claim what the server-stored model is not. Messages remain application data. | Not claimed |

## 4. Recommended waves

Three waves. Each is a complete vertical slice. Do not start the next wave
until the current one is testable on phone and desktop.

```text
Wave 1  Conversation completeness   (this spec)
        reply · edit · delete · reactions
        seen · mute · archive · pin · hide-for-me
        in-thread search · history pagination

Wave 2  C.H.A.T. in the thread + groups
        share reflection / publication
        verse-card / single image
        Scripture chip
        private groups (V1 design, still valid)

Wave 3  Reach
        push notifications
        transport decision (keep polling, or SSE)
        typing indicators only after transport exists
```

### Why Wave 1 is not groups

Groups were the leftover V1 item, so they look like the obvious next commit.
They are the wrong next commit.

1. A group without mute, hide, search, and delete-for-me is harder to live in
   than today's 1:1 inbox.
2. Community just grew ownership and join requests. Shipping messaging groups
   in the same season invites two overlapping "people spaces."
3. Group membership, history-after-leave, and owner removal are the heaviest
   authorization work still open. They should land on a thread model that
   already has per-member inbox state.

Wave 1 adds that per-member state and the message verbs. Wave 2 reuses both.

### Why Wave 2 is where C.H.A.T. becomes itself

WhatsApp cannot attach a private reflection. Telegram cannot open a Create
card. That is the only messaging expansion that strengthens the core loop:

```text
CONVERSE → REMEMBER → REFLECT → CREATE → optionally SHARE
                                         ↳ also: send to one person
```

A shared reflection in a DM is still private to the thread members. It is not
a Community publication unless the author already shared it there.

### Why Wave 3 waits

Push and typing require native plugins, a device-token store, and a wakeup
path the API does not have. Polling is tested and enough for an open thread.
Do not introduce WebSockets "so messaging feels modern" while the inbox still
cannot archive a chat.

## 5. Foundation work that is not a feature

Do this beside Wave 1, in the messaging folders, without a product announcement:

- **Paginate message history.** `listMessages` currently returns the whole
  thread. Replies, search, and long encouragement threads will make that a
  defect.
- **Keep SQLite as the V2 store** unless the one-store migration is already
  underway. Do not start a MariaDB messaging port as a side effect of replies.
  Record the gap; do not deepen it with a second schema unless Wave 1 is
  blocked by it.
- **Do not log message bodies.** Edit and delete increase the temptation to
  put body text in error telemetry. Same V1 rule.
- **Isolation still holds.** Own new code under `web_app/src/messaging/` and
  `api/src/messaging/`. Do not modify Create to make Wave 1 possible. Wave 2
  share-a-card is the first time Create or reflections may grow a narrow seam.

## 6. What V2 will not do

These stay out even if a reviewer asks for feature-parity:

- voice or video calls;
- stories / status;
- sticker or GIF keyboards;
- phone-number identity or address-book sync;
- channels, broadcast lists, or bots;
- E2E-encryption marketing;
- public chatrooms;
- automatic Community ↔ group sync;
- forwarding without an explicit later spec;
- presence that defaults to visible.

## 7. Pre-mortem

If V2 fails, it will fail in one of these ways:

1. **Clone drift.** Reactions become a sticker picker; images become a generic
   camera roll; groups become Community. Mitigation: Wave 1 set is closed.
   New verbs need a new spec.
2. **Authorization holes.** Edit/delete/reaction/hide-for-me are easy to
   implement as "the client said this id." Mitigation: actor always from
   session; every write checks membership and ownership the way send does
   today.
3. **Delete that erases history for the other person by default.** Mitigation:
   delete-for-me is the default control; delete-for-everyone is time-boxed
   and leaves a tombstone.
4. **Seen receipts as surveillance.** Mitigation: a preference to hide one's
   own seen state, which also hides others' seen state from that user
   (WhatsApp's reciprocity rule).
5. **Badge lies.** Mute and archive must not double-count the way an unread
   request used to. `waitingFor` stays the source of the badge and must
   ignore muted threads.
6. **Polling cost.** Extra endpoints for reactions and seen will tempt a
   faster poll. Mitigation: fold new fields into existing thread/message
   payloads; keep 4s on the open thread; do not poll archived lists.

## 8. Implementation sequence for agents

Work in slices. Stop after each slice for review. Details and acceptance
tests live in [`v2-wave-1.spec.md`](v2-wave-1.spec.md).

1. Inspection report only — confirm current thread/message/member shapes.
2. Per-member inbox state: mute, archive, pin, hide-for-me.
3. Seen receipts + seen preference.
4. Message pagination.
5. Reply / quote.
6. Edit and delete (tombstones).
7. Reactions (fixed emoji set).
8. In-thread search.
9. UI for all of the above on desktop and narrow viewports.
10. Waiting-badge rules updated for mute/archive.

Wave 2 and Wave 3 are intentionally unspecified here beyond the table in
§3. Write those specs when Wave 1 is done.

## 9. Success

Wave 1 is done when a registered user can:

- reply to one message rather than pasting it;
- fix a typo or take a message back within the allowed window;
- react without sending a new sentence;
- see whether the other person has read the thread, or choose not to
  participate in seen receipts;
- mute, pin, archive, or remove a conversation from their own inbox
  without breaking the other person's copy;
- find a sentence in a long thread;
- still be blocked, rate-limited, and request-gated exactly as in V1.

The product still must not look like a WhatsApp clone. If a slice needs a
new infrastructure service to finish, the slice is in the wrong wave.
