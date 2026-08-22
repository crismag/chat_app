# Cursor Workflow for Simple Messaging

## Purpose

This file is the execution contract for Cursor or another coding agent implementing messaging while unrelated agents may be modifying the same repository.

The feature is intentionally structured to minimize merge conflicts and code bloat.

## Hard boundary

Create and own messaging code under:

```text
web_app/src/messaging/
api/src/messaging/
```

Use the repository's existing patterns inside those folders.

Changes outside those folders are exceptions and must be minimal, targeted, and listed in the agent's report before implementation.

Do not touch `web_app/src/create/` or `api/src/create/` for this feature.

Do not refactor unrelated `profile`, `community`, `reflections`, `auth`, `shared`, or application infrastructure.

Do not perform cleanup, formatting sweeps, renames, or reorganizations outside messaging-owned files.

## Branch

Use a dedicated branch, preferably:

```text
agent/simple-messaging
```

If that branch name is already used, choose a clearly equivalent isolated branch name.

Do not develop messaging directly on an unrelated agent branch.

## Before coding

Read:

```text
docs/development/DEVELOPMENT_INSTRUCTIONS.md
docs/development/messaging/README.md
docs/development/messaging/IMPLEMENTATION_PLAN.md
docs/development/messaging/DATA_MODEL_AND_RULES.md
```

Then inspect current repository code. Documentation describes intent; current code determines exact integration points.

### Produce an inspection report first

Report:

- current branch/base SHA;
- proposed files to create under `web_app/src/messaging/`;
- proposed files to create under `api/src/messaging/`;
- every existing file expected to be modified;
- why each external modification is required;
- current authentication accessor to reuse;
- current database/store/migration conventions to reuse;
- current profile/user summary API or seam to reuse;
- SQLite and MariaDB test mechanisms;
- likely merge-conflict hotspots;
- any deviation from the messaging docs.

Do not implement until this inspection is complete.

## External-file budget

The target is very few modifications outside the new messaging folders.

Likely acceptable integration categories are:

1. API route/module registration;
2. web app route registration;
3. one navigation/menu entry;
4. database migration/schema registration if required by current architecture;
5. narrow auth/profile adapter wiring if no existing reusable seam exists.

Do not treat this as permission to modify five files in each category. Reuse existing extension points.

If implementation appears to require broad modifications to `api/src/app.ts` or `api/src/db.ts`, first look for a domain registration/store seam. If none exists, make the smallest possible hook; do not use messaging as an excuse to refactor those large files.

## Commit discipline

Keep slices separately reviewable. Suggested commits:

```text
messaging: add isolated module and persistence model
messaging: add direct thread rules
messaging: add text send read and unread state
messaging: add contacts requests and blocks
messaging: add minimal messaging UI
messaging: add simple private groups
messaging: add minimal app integration
```

Exact commits may differ, but avoid one giant feature commit.

Each commit should leave tests passing for the completed slice when practical.

## Slice stop rule

After each implementation slice:

1. run relevant targeted tests;
2. run typecheck/lint for touched workspaces;
3. inspect `git diff --stat` and changed-file list;
4. verify no unrelated files were modified;
5. summarize what changed and what remains;
6. stop before beginning the next slice unless explicitly instructed to continue.

This stop rule exists to catch architectural drift early.

## No speculative abstractions

Reject unnecessary complexity.

Do not introduce for V1 unless existing repository architecture already requires them:

- event bus;
- command bus/CQRS;
- distributed queue;
- background worker system;
- WebSocket service;
- Redis;
- separate messaging microservice;
- elaborate notification pipeline;
- generic social-graph framework;
- separate repository layer wrapping an already sufficient repository/store layer;
- new state-management framework;
- new design system.

A normal domain folder, service/store logic, HTTP routes, React UI, and database tables are enough.

## Reuse before dependency

Do not add a package dependency until checking whether the repository already provides the needed capability.

For polling, use existing browser/API primitives.

For validation, use existing validation conventions.

For IDs, use existing ID generation.

For timestamps, use existing time format/conventions.

For database access, use existing abstractions.

For auth, use existing server auth/session context.

For UI, use existing application primitives and local CSS/components.

## Identity rule

Messaging must not become a second profile system.

Store `user_id` references only and consume profile summaries.

Do not add messaging-owned copies of:

```text
email
username
first_name
last_name
birth_date
city
region
country
avatar
bio
```

Do not expose email in messaging search/results as a convenient fallback.

If profile work is changing concurrently and no stable public-summary seam exists, define the narrow interface messaging needs inside messaging and defer the cross-feature adapter rather than rewriting profile code.

## Permission rule

Backend authorization is mandatory.

The browser must never choose authoritative values such as:

```text
senderUserId
actingUserId
isOwner
isContact
challengePassed-style booleans
```

Derive the actor from server auth/session state and calculate permissions server-side.

Centralize messaging authorization in a small number of messaging-owned functions rather than duplicating conditions across routes.

## Direct-message rule

There must be one canonical direct conversation for a pair of users.

Do not create duplicate A↔B and B↔A threads.

The solution must remain safe if two create requests race.

## Request/contact rule

Keep contact and request state explicit.

```text
non-contact + allowed preference
    -> message request

accepted request
    -> contact + normal direct conversation

declined request
    -> no contact; apply anti-repeat/cooldown rule

block
    -> overrides direct request/message permission
```

Group membership does not create contacts.

## Polling rule

V1 uses simple polling, not WebSockets.

Prefer an `after`/cursor parameter so only new messages are returned while a thread is open.

Use a reasonable active interval around 3–5 seconds unless current app conventions suggest otherwise.

Do not aggressively poll every messaging resource when the user is elsewhere in the app.

## Group rule

Groups are private messaging threads, not communities.

V1 supports only what is necessary:

- create private group;
- name;
- owner;
- members;
- add/remove/leave;
- text messaging.

Do not connect group membership automatically to community membership.

Do not add public discovery/invite links in V1.

## Testing checklist

Before calling a slice complete, cover the relevant items below.

### Authentication and authorization

- [ ] anonymous/guest messaging API access is rejected;
- [ ] sender cannot be spoofed;
- [ ] non-member cannot read a thread;
- [ ] non-member cannot post to a thread;
- [ ] user cannot accept/decline another recipient's request;
- [ ] group member cannot use owner-only operations;
- [ ] removed/left member cannot keep posting.

### Direct threads

- [ ] A→B and B→A resolve to one direct thread;
- [ ] repeated creation reuses it;
- [ ] concurrent creation is protected by a database/data-integrity rule, not only a race-prone pre-check.

### Messages

- [ ] empty text rejected;
- [ ] oversized text rejected according to defined limit;
- [ ] deterministic message order;
- [ ] after/cursor polling returns only newer messages;
- [ ] read marker cannot be assigned from another thread;
- [ ] unread count/state is correct.

### Contacts/requests/blocks

- [ ] accepted request establishes contact;
- [ ] declined request does not establish contact;
- [ ] declined request cannot be immediately spammed repeatedly;
- [ ] recipient preference is enforced by backend;
- [ ] block prevents new direct requests/messages through normal paths;
- [ ] block cannot be bypassed with a second direct thread;
- [ ] group membership does not create contact rows.

### Groups

- [ ] only members read group messages;
- [ ] only members send group messages;
- [ ] owner can remove member;
- [ ] normal member cannot remove arbitrary members;
- [ ] member can leave;
- [ ] group change does not corrupt existing message history.

### Privacy

- [ ] email is absent from public messaging summaries unless an explicit private account endpoint already requires it;
- [ ] message bodies are not written to normal request logs;
- [ ] list endpoints return only necessary fields;
- [ ] profile privacy is not bypassed by messaging UI/API.

### Database portability

- [ ] SQLite tests pass;
- [ ] MariaDB-gated tests compile/run using existing test mechanism;
- [ ] no SQLite-only SQL was introduced into production paths;
- [ ] uniqueness/index behavior is verified under MariaDB before production declaration.

## Full-suite check before integration

Before the final cross-feature integration commit:

```text
npm test
npm run typecheck
npm run lint
```

or the repository's current equivalent if scripts changed.

If failures are unrelated and pre-existing, document them precisely rather than modifying unrelated code to make the messaging branch green.

## Merge-conflict check before touching shared files

Immediately before the final integration slice:

1. fetch/rebase or otherwise compare with current target branch using the team's normal workflow;
2. inspect whether profile, community, Create, app routing, `api/src/app.ts`, or `api/src/db.ts` changed since the messaging branch began;
3. adapt only the minimal integration changes;
4. never resolve a conflict by discarding concurrent work wholesale.

## Completion report

When done, report:

- branch and commit list;
- exact files added;
- exact existing files modified;
- LOC/diff size;
- migrations added;
- V1 workflows demonstrated;
- tests added and test totals/results;
- MariaDB execution status;
- known limitations;
- deferred integration points;
- deviations from this plan and why;
- any follow-up security/privacy work required before deployment.

The desired result is a small, isolated, comprehensible messaging feature—not a platform rewrite.
