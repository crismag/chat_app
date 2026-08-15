# MVP Plan

## Objective

Ship the smallest version of C.H.A.T. that proves users will return to their own Scripture conversations, can find them later, and can turn selected material into something worth keeping or sharing.

## Phase 0 — Foundation

Status: scaffolded. The web app and API start locally; CI runs lint, typecheck, test, and build. Authentication is documented, not implemented.

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

Deliverables:

- structured C/H/A/T view;
- manual section editing;
- extract C.H.A.T. from a conversation;
- source/provenance references where practical;
- Heart- and Testimony-specific authorship safeguards.

Exit criteria:

A natural conversation can be transformed into a useful C.H.A.T. entry without forcing the original conversation itself into four rigid fields.

## Phase 4 — Library and search

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

Deliverables:

- generate background intent from the selected content;
- user-selectable mood/direction;
- AI image provider abstraction;
- negative-space-aware prompting;
- background regeneration;
- use generated image underneath deterministic text layout.

Exit criteria:

AI artwork enhances the composition without being responsible for rendering Scripture or user text.

## Phase 7 — Internal publication/community

Deliverables:

- explicit Publish to Community action;
- publication state stored server-side;
- community feed/query returning published entries only;
- published entry view;
- basic Scripture/topic discovery;
- unpublish if included in V1 publication model.

Exit criteria:

A user can have many private entries and selectively publish one without exposing the rest of the library.

## Phase 8 — Mobile packaging

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
