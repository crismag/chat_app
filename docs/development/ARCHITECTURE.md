# Architecture

## Architectural objective

C.H.A.T. should be developed as **one product with one primary frontend codebase**, not as separate Web, Android, and iOS applications.

The architecture should optimize for:

- rapid iteration;
- shared behavior across platforms;
- deterministic text and visual rendering;
- native mobile capabilities only where useful;
- clear privacy boundaries;
- replaceable AI providers;
- low operational complexity during early development.

## Recommended repository structure

```text
chat_app/
├── web_app/                  # React + TypeScript UI and product experience
├── api/                      # Backend API/domain services
├── packages/
│   ├── shared/               # Shared types, schemas, constants
│   └── create-engine/        # Reusable layout/style/rendering logic when extracted
├── android/                  # Capacitor-generated Android shell
├── ios/                      # Capacitor-generated iOS shell
├── docs/
│   └── development/
├── .gitignore
└── README.md
```

### Why not `mobile/android` and `mobile/ios`?

The Android and iOS directories are not intended to become independent product implementations. With Capacitor they are native host projects and integration surfaces around the shared web application.

Keeping the conventional top-level `android/` and `ios/` layout:

- follows normal Capacitor expectations;
- reduces custom build configuration;
- makes upstream documentation easier to follow;
- reinforces that platform-specific code should remain limited;
- avoids encouraging separate Android/iOS feature development.

If future requirements demand a genuinely independent native application, the repository can be reorganized deliberately at that time.

## Frontend

### Baseline

- TypeScript
- React
- Vite unless a concrete need for server-side rendering changes the decision
- modern CSS strategy, potentially CSS modules, Tailwind, or a small design-system layer
- responsive behavior from phone widths through desktop

### Product modules

Suggested logical modules:

```text
web_app/src/
├── app/
├── auth/
├── chat/
├── scripture/
├── library/
├── search/
├── ai/
├── community/
├── create/
├── profile/
└── shared/
```

Avoid premature micro-frontends or excessive package extraction. Start cohesive; extract shared packages when there is real reuse.

## Mobile

Capacitor should package the same built web application for Android and iOS.

Native integrations may include:

- share sheet;
- save image/photo;
- camera/photo library;
- secure storage;
- push notifications;
- deep links;
- app lifecycle handling;
- biometric authentication later if useful.

Platform-specific implementation should be treated as an adapter around common product behavior.

## Backend

The backend should expose one API to Web, Android, and iOS clients.

Initial responsibilities:

- authentication/session validation;
- user/profile data;
- conversations/messages;
- C.H.A.T. structures;
- Scripture references and metadata;
- search;
- publication state;
- community reads;
- AI orchestration;
- generated-asset metadata;
- storage references.

FastAPI/Python is a reasonable initial choice if Python AI/tooling is useful. A TypeScript backend is also valid if keeping one language across the application becomes more valuable. This choice should not change the client-facing domain model.

## Database

PostgreSQL is the preferred initial relational database.

Potential core entities:

```text
User
Profile
Conversation
Message
MessageRevision
ChatEntry
ChatSection
ScriptureReference
Tag
ConversationTag
Publication
Creation
CreationAsset
Template
StylePreset
AIInteraction
```

Do not over-normalize the earliest implementation. The schema should preserve history and authorship while allowing iteration.

## Privacy boundary

The backend must enforce privacy. UI hiding is not sufficient.

A community query must only return explicitly published records.

Conceptually:

```text
private content query:
  owner_id = current_user

community query:
  publication_state = PUBLISHED
```

No community endpoint should retrieve private content and rely on the frontend to filter it out.

## Conversation model

Conversation messages are the canonical chronology.

A structured C.H.A.T. may reference, copy, or derive from portions of the conversation.

Do not require every message to belong to C, H, A, or T.

A future data model may support section provenance, for example:

```text
ChatSection
- type: CONTEXT | HIGHLIGHT | APPLICATION | TESTIMONY
- content
- source_message_ids[]
- author_origin: USER | AI_ASSISTED | AI_GENERATED
- created_at
- updated_at
```

This provides traceability without making the UI complicated.

## AI architecture

Use a provider abstraction rather than coupling product logic directly to one vendor.

Example conceptual service:

```text
AIService
├── explain()
├── grammar()
├── polish()
├── summarize()
├── extractChat()
├── suggestRelatedScripture()
├── prepareSocialVersion()
└── generateBackgroundPrompt()
```

Image generation should be a separate capability from text assistance.

Do not make AI provider response formats part of the domain model.

## Create engine architecture

The Create engine should be deterministic for text.

Conceptual pipeline:

```text
Selected content
    ↓
Content preparation
    ↓
Layout selection
    ↓
Style selection
    ↓
Optional background source
  ├── solid/gradient
  ├── bundled artwork
  ├── uploaded image
  └── AI-generated topical image
    ↓
React/HTML/CSS composition
    ↓
Preview
    ↓
PNG/JPEG export
    ↓
Download or native share
```

### Separate layout and style

Prefer:

```text
layout = full-chat-two-column
style  = cream-botanical
```

over hard-coding every combination as a unique template.

### Text fitting

The rendering engine should measure content and apply explicit policies:

- safe font-size ranges;
- maximum line counts;
- content warnings;
- optional AI-assisted condensation;
- automatic carousel split where appropriate.

Readability is more important than forcing everything onto one image.

## Storage

Generated images should not automatically become permanent server assets unless required.

Early options:

- browser-side generation and immediate export;
- temporary object storage for AI-generated backgrounds;
- persistent storage only for creations the user chooses to save.

Storage policy should be revisited before large-scale public usage.

## Search

Start with PostgreSQL-backed structured and text search.

Search dimensions can include:

- message/content text;
- title;
- Scripture reference;
- tags;
- C/H/A/T section;
- date.

Semantic/vector search should be introduced only when it solves retrieval failures that conventional search cannot.

## Cross-platform rule

Before adding a frontend dependency or browser API, determine:

1. Does it work in the supported web browsers?
2. Does it work inside Capacitor WebView on Android?
3. Does it work inside Capacitor WebView on iOS?
4. If not, can it be isolated behind a small platform adapter?

Do not fork whole product screens for platform differences when a small adapter is sufficient.
