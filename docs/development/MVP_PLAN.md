# MVP Plan

## Objective

Ship the smallest version of C.H.A.T. that proves users will return to their own Scripture conversations, can find them later, and can turn selected material into something worth keeping or sharing.

## Phase 0 — Foundation

Status: **done.** The web app and API start locally; CI runs lint, typecheck, test and build. Authentication is implemented, not merely documented — see Phase 1.

Deliverables:

- repository structure;
- React + TypeScript web scaffold;
- API scaffold;
- local development environment;
- shared configuration;
- lint/test/build commands;
- basic responsive design shell;
- authentication decision documented.

Exit criteria:

- web app starts locally;
- API starts locally;
- one documented command or small command set runs the development environment;
- CI can build/test the initial scaffold.

## Phase 1 — Private conversation loop

Status: **done.** Email/password registration and login with server-side
sessions in a `chat_session` cookie; SQLite persistence via `node:sqlite`;
conversations, messages and sections stored and re-openable; ownership checked
on every route. The one known defect is the Scripture-reference field losing
keystrokes when typed immediately after the first message. It has been fixed
once and is still reproducible when the message is sent with the send button
rather than the keyboard shortcut — see the known limitations in
[`AI_PROVIDER.md`](./AI_PROVIDER.md).

Deliverables:

- user authentication;
- create conversation;
- message history;
- conversation title/date;
- Scripture reference attachment;
- persistent storage;
- conversation list/history;
- private authorization enforcement.

Exit criteria:

A user can create several conversations, leave the app, return, and continue the correct conversation. Another user cannot retrieve those conversations.

## Phase 2 — AI assistance

Status: **done, and larger than planned.** A provider seam with Gemini behind
it (`gemini-3.5-flash-lite`), reflection guidance, improve writing, a bounded
reflection conversation that can return labelled drafts, and title suggestion
with a heuristic floor. Assistance is off by default and every failure is a
typed outcome. The deliverables below were written as five named text
operations; what shipped is a different and better-fenced set, and the ones not
built (`shorten`, `summarize` as standalone controls) are not missed. See
[`AI_PROVIDER.md`](./AI_PROVIDER.md) and
[`REFLECTION_CHAT.md`](./REFLECTION_CHAT.md).

A second connector, not in the original plan, arrived alongside it: YouVersion
passage lookup, on by default, 47 translations across 7 languages.

Deliverables:

- explain;
- grammar-only correction;
- polish;
- shorten;
- summarize;
- original/revised content preservation;
- explicit AI action UI;
- provider abstraction.

Exit criteria:

A user can request assistance without silently losing or overwriting the original message.

## Phase 3 — C.H.A.T. structure

Status: **largely done.** The four sections are the page, editable directly,
with provenance carried per section and extraction from the conversation
offered as a proposal that writes nothing until accepted. The C was renamed
from Context to Content and now holds the passage itself; stored writing was
carried across by migration.

Deliverables:

- structured C/H/A/T view;
- manual section editing;
- extract C.H.A.T. from a conversation;
- source/provenance references where practical;
- Heart- and Testimony-specific authorship safeguards.

Exit criteria:

A natural conversation can be transformed into a useful C.H.A.T. entry without forcing the original conversation itself into four rigid fields.

## Phase 4 — Reflections and search

The area is called **Reflections**, not Library. `GET /api/library` survives
only as an alias of `GET /api/reflections`, and `/library` in the web app
redirects.

Status: **done.** The list, its filters (`all` / `drafts` / `completed` /
`shared`), its sorts (`recent` / `title`) and a text query are built and
open back into the right reflection. Search also understands a Scripture
book, chapter or verse (so `Jn 15` finds `John 15:5`), a UTC date range,
a written C/H/A/T section, and tags — both tags saved on the reflection and
hashtags written in the body.

Deliverables:

- search conversations;
- search by Scripture reference;
- search by title/content;
- date filtering;
- tags if needed by observed usage;
- open result back into the correct conversation/C.H.A.T.

Exit criteria:

A user with enough saved content to make browsing inconvenient can reliably recover an older reflection.

## Phase 5 — Create engine V1

Status: **done.** Layout, style and format are independent host choices on top
of Create Studio. The four V1 layouts (quote focus, verse + reflection, full
C.H.A.T. stacked, full C.H.A.T. two-column) combine with five styles (cream
botanical, modern minimal, dark worship, warm photographic overlay, journal
paper) and two formats (1080×1080 square, 1080×1350 portrait). Short text
shrinks to a readable minimum; leftover words move onto following cards rather
than being dropped. Live preview and PNG export, including Export all for a
carousel, stay in Create Studio. Studio's own blank/quote templates stay off;
C.H.A.T. maps these layouts.

Deliverables:

- reusable layout system;
- reusable style system;
- live preview;
- short-text fitting;
- overflow detection;
- PNG export;
- initial polished style set;
- initial formats such as square and portrait.

Suggested first layouts:

- quote focus;
- verse + reflection;
- full C.H.A.T. stacked;
- full C.H.A.T. two-column.

Suggested first styles:

- cream botanical;
- modern minimal;
- dark worship;
- warm photographic overlay;
- journal/paper.

Exit criteria:

A user can choose content, apply a style/layout, produce a readable polished image, and export it without manual graphic design.

## Phase 6 — Topical AI backgrounds

Status: **host boundary implemented; production provider not selected.** Create
Studio supplies provider-neutral generation, cancellation, retry, regeneration,
variation and provenance behavior. C.H.A.T. supplies authenticated permanent
asset storage and a server-only provider seam. An original deterministic local
fixture proves the integration without network access, credentials, cost, or a
claim of AI generation. Mood/direction UX, prompt derivation and an
owner-approved production provider remain.

Deliverables:

- generate background intent from the selected content;
- user-selectable mood/direction;
- AI image provider abstraction;
- negative-space-aware prompting;
- background regeneration;
- use generated image underneath deterministic text layout.

Exit criteria:

AI artwork enhances the composition without being responsible for rendering Scripture or user text.

## Phase 7 — Internal share/community

Status: **done for V1.** Sharing is an explicit action from a reflection. A
share is a copy with one audience — public, or one community the author
belongs to. Membership is stored in SQLite and re-checked on every read.
Authorisation is a single SQL visibility predicate applied before retrieval,
not a filter after the list is loaded.

The Community page is a reading feed (Shared, Public, Communities) with
openable share cards and a dedicated `/community/shares/:id`
address. Possessing that URL grants nothing: a member reads it; someone who
has left the community gets the same 404 as a missing record. Encouraged and
private Save exist; comment threads, following, and ranking do not.

`GET /api/community` remains as a shared-conversation listing for older
callers. The live feed is `GET /api/shares`.

Deliverables:

- explicit Share to Community action;
- share state stored server-side;
- community feed/query returning shared entries only;
- shared entry view;
- basic Scripture/topic discovery;
- make private if included in V1 share model.

Exit criteria:

A user can have many private entries and selectively share one without exposing the rest of the library.

## Phase 8 — Mobile packaging

Status: **done for V1.** Capacitor 7 hosts the same Vite web build. `android/`
and `ios/` are conventional native projects. Share, PNG export, keyboard
resize, status bar, and `chat:` deep links are adapters around the existing
product. Session login is still the `chat_session` cookie; a packaged WebView
gets `SameSite=None; Secure` so the native HTTP stack can store it.

Build and run steps are in [`MOBILE.md`](./MOBILE.md). CI does not sign
store binaries. Push, camera, biometrics, and a production API host remain
out of this phase.

Deliverables:

- Capacitor integration;
- Android project;
- iOS project;
- native share adapter;
- save-image adapter where required;
- safe-area/mobile keyboard validation;
- deep-link foundation if needed;
- platform build documentation.

Exit criteria:

The same core application runs as Web, Android, and iOS builds with only narrowly scoped native adapters.

## Deferred until validated

Do not block the MVP on:

- comments;
- reactions;
- follow graphs;
- church/group spaces;
- sophisticated recommendation feed;
- vector/semantic search;
- subscriptions/payments;
- elaborate moderation workflows;
- dozens of export formats;
- full drag-and-drop design editor;
- direct integrations to individual social networks.

## Vertical-slice preference

When possible, development should deliver complete vertical slices instead of large disconnected layers.

For example, prefer:

```text
Create conversation UI
+ API
+ persistence
+ authorization
+ tests
```

before implementing ten unfinished screens that depend on nonexistent backend behavior.

## Product checkpoint

After Phases 1–5, stop and evaluate the actual experience before expanding scope.

The crucial question is not how many features exist. It is whether a user can:

1. have a meaningful conversation;
2. trust that it is preserved privately;
3. find it later;
4. turn the best part into an attractive visual artifact.

If that loop is not compelling, community and additional AI features will not fix the core product.
