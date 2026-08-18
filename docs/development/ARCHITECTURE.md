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
│   └── shared/               # Shared types, schemas, constants
├── android/                  # Capacitor-generated Android shell
├── ios/                      # Capacitor-generated iOS shell
├── scripts/verify/           # Browser-driven checks against a running dev server
├── docs/
│   ├── development/
│   └── examples/             # Observed real-world usage the design answers to
├── .env.example
├── .gitignore
└── README.md
```

`android/` and `ios/` are the Capacitor hosts; see [`MOBILE.md`](./MOBILE.md).
Everything else above is present.

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
- CSS custom properties plus CSS modules for the initial design shell
- responsive behavior from phone widths through desktop

### Product modules

What is there, which is close to the original sketch but not identical to it:

```text
web_app/src/
├── app/           # routing
├── auth/          # sign in / register, session context
├── bible/         # passage card, translation picker (the old "scripture/")
├── chat/          # the Reflect page: card, conversation panel, sheets
├── reflections/   # the personal list (the old "library/")
├── community/     # published entries
├── create/        # visual export
├── shared/        # layout shell, API client, icons, design tokens
└── styles/
```

Search has no module of its own — it is part of `reflections/`, against
`GET /api/reflections`. There is no `ai/` module: assistance is rendered by the
components it belongs to, in `chat/`. `library/` still exists on disk but
nothing routes to it; `/library` redirects to `/reflections`.

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

**Decision (Phase 0):** the API is TypeScript on Node, using Hono.

Keeping one language across `web_app/`, `api/`, and `packages/shared/` is more valuable at this stage than a Python stack. AI providers will still sit behind an HTTP abstraction, so this choice does not lock the product to a particular model vendor.

A later Python service remains possible if a specific AI/tooling need appears. It should not change the client-facing domain model.

## Database

**Decision (durable store): MariaDB / MySQL-compatible SQL**, via `api/src/mysql/`,
environment-driven and applied with versioned migrations. The hosted database
is Hostinger **MariaDB 11.8**. Internal rows use `BIGINT`; anything shown to a
browser, URL, or mobile client uses a `CHAR(36)` UUID. Credentials never leave
the API process.

The live demonstrable app still uses **SQLite** (`api/src/db.ts`, `DATABASE_PATH`)
so local development does not require Hostinger. When `MYSQL_HOST` is set, the
API applies migrations on boot. Application routes are not switched onto this
store in the foundation phase.

### The target is MariaDB, not MySQL 8

The environment variables are named `MYSQL_*` and the driver is `mysql2`, so it
is easy to read this as a MySQL 8 deployment. It is not. The server is
**MariaDB 11.8.8**, and the difference is not cosmetic.

**`JSON` is not a type on this server.** MariaDB accepts the keyword and stores
a `LONGTEXT` with a `json_valid()` check. Verified against the hosted database
after migration — every column the schema declares as `JSON` reports back as
`longtext`:

| column | declared | stored as |
| --- | --- | --- |
| `reflections.chat_content` | `JSON` | `longtext` + `json_valid(chat_content)` |
| `reflection_revisions.chat_content` | `JSON` | `longtext` + `json_valid(chat_content)` |
| `reflection_images.design_config` | `JSON` | `longtext` + `json_valid(design_config)` |
| `user_identities.provider_data` | `JSON` | `longtext` + `json_valid(provider_data)` |
| `user_settings.settings` | `JSON` | `longtext` + `json_valid(settings)` |

What follows from that, and what to avoid assuming:

- There is no binary JSON representation, so no partial in-place update and no
  MySQL 8 performance characteristics. Every write rewrites the whole document.
- There is no functional index on a JSON path. Anything that needs to be
  queried or sorted belongs in its own column, not inside `chat_content`.
- `JSON_EXTRACT` and `->` / `->>` do work; `JSON_TABLE`, `JSON_OVERLAPS` and
  `JSON_VALUE` differ or are absent. None are used today — keep it that way
  without checking MariaDB's manual rather than MySQL's.
- The collation is `utf8mb4_unicode_ci` throughout. MySQL 8's default
  `utf8mb4_0900_ai_ci` does not exist here, so never copy a `CREATE TABLE` that
  names it.

The migrations themselves are portable — plain InnoDB tables, foreign keys and
ordinary indexes — so a local MySQL will accept them. That is exactly the trap:
it will accept them and behave differently. **Develop and test against MariaDB
11.8** (`docker run mariadb:11.8`), and if CI ever runs these tests, pin the
same image rather than the `mysql:8` default.

**Privacy boundary:** the central database stores users, identities, profiles,
settings, sessions, reflections, revisions, generated-image records, and
**non-content** AI usage metadata. It does **not** store AI conversation
transcripts, prompts, or responses. Those remain device-local working data
(IndexedDB on the web, later).

What is actually implemented for the live SQLite path, in `api/src/db.ts`:

- one file, `chat.sqlite`, overridable with `DATABASE_PATH`;
- `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`;
- tables `users`, `sessions`, `conversations`, `messages`, `sections`, plus
  `reflection_passages` owned by the Bible connector
  (`api/src/bible/passage-store.ts`);
- idempotent migrations run on every construction — `CREATE TABLE IF NOT
  EXISTS`, a `PRAGMA table_info` guard before each added column, and a
  transactional rename of the `context` section type to `content`.

`MemoryStore` (`api/src/store.ts`) implements the same interface and is what the
test suite uses. **Nothing user-facing is in-memory.** The caches that are —
the Bible catalog and passage caches, and the rate-limit windows — are named as
caches and are documented as per-process.

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

## Authentication

**Decision (Phase 0):** Phase 1 will use first-party email and password authentication with server-side sessions.

Chosen model:

- email + password registration and login;
- session records stored by the API;
- HTTP-only cookies rather than tokens in `localStorage`;
- the same session API for Web and later Capacitor WebViews;
- authorization checked on every data boundary, not only in the UI.

**Built (Phase 1).** `POST /api/auth/register`, `POST /api/auth/login`,
`POST /api/auth/logout`, `GET /api/auth/me`, all in `api/src/app.ts`:

- passwords are `scrypt` with a per-user 16-byte random salt, stored as
  `salt:hash` and compared with `timingSafeEqual`; minimum length 8;
- the session cookie is **`chat_session`**: `httpOnly`, `sameSite=Lax`,
  `path=/`, and **`secure` whenever `NODE_ENV === 'production'`** — so it is
  sent in the clear only in development, deliberately, because a `secure`
  cookie never arrives over plain-HTTP `localhost`;
- **sessions expire.** `expiresAt` is 30 days out, stored on the row, and
  checked on every read — an expired row is deleted and the request is
  anonymous. Expiry is lazy: there is no sweeper, and `MemoryStore` (tests
  only) does not enforce it at all;
- ownership is re-checked on every conversation route, not inherited from the
  session alone.

Not required for MVP:

- OAuth / social login;
- magic links;
- passkeys;
- biometrics.

If Capacitor WebViews later need help persisting the session cookie, add a small native secure-storage adapter around this same session model. Do not introduce a second auth protocol.

**Phase 8.** Packaged WebViews enable CapacitorCookies and CapacitorHttp. Login
from those origins sets `SameSite=None; Secure` on `chat_session`. Live-reload
against Vite keeps the original Lax cookie because `/api` is still first-party
through the proxy.

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
- type: CONTENT | HEART | APPLICATION | TESTIMONY
- content
- source_message_ids[]
- author_origin: USER | AI_ASSISTED | AI_GENERATED
- created_at
- updated_at
```

Section meaning:

- **Content** holds the passage itself — the verse text, usually with its reference and translation — with an optional explanation after it. See [`docs/examples/REAL_CHAT_SAMPLES.md`](../examples/REAL_CHAT_SAMPLES.md) for the observed usage this is drawn from. A Content section containing only the passage is complete, and no validator, progress count or empty state may say otherwise. AI may assist with historical, literary or textual background, but the stored section is the person's own.
- **Heart** is personal reflection on how the passage touched, convicted, encouraged, challenged, or affected the person. Do not silently manufacture it.
- **Application** is how the person says the passage applies to them and how they intend to respond.
- **Testimony** may be a testimony, declaration of faith or conviction, commitment, prayer, or statement of belief. It is not limited to recounting a past event, and must never be invented for the user.

This provides traceability without making the UI complicated.

## AI architecture

Use a provider abstraction rather than coupling product logic directly to one
vendor. That is no longer aspirational: it is built, and the provider behind the
seam is **Google Gemini**, model `gemini-3.5-flash-lite`.

```text
CHAT UI  →  /api/ai/*  →  AiService  →  AIProvider  →  GeminiProvider
                                          (seam)
```

`AIProvider` (`api/src/ai/types.ts`) has four methods and no free-form prompt
parameter, so there is no argument through which it could be asked to do
something outside the reflection it belongs to:

```text
AIProvider
├── generateReflectionGuidance()   POST /api/ai/reflection-guidance
├── improveReflectionWriting()     POST /api/ai/improve-writing
├── discussReflection()            POST /api/ai/reflection-chat
└── suggestReflectionTitles()      POST /api/conversations/:id/ai (suggest_title)
```

Gating, input ceilings, timeout, single retry, rate limiting and logging live
**above** the seam in `AiService`, so a second adapter inherits them. The SDK is
imported in exactly one file, and lazily, so a server running without assistance
never loads it.

`api/src/ai.ts` is the deterministic remainder — no model, no network, no key.
It is the title heuristic that answers when the provider cannot, the named
transforms behind the legacy `POST /api/conversations/:id/ai`, and the
store→DTO shaping. It used to be all of the assistance; treat it now as the
floor beneath it.

Assistance is **off by default** (`AI_ENABLED=false`). Setup, configuration,
failure modes, prompt and schema design, privacy and logging, and how to add
another provider are all in [`AI_PROVIDER.md`](./AI_PROVIDER.md). The
conversation panel's own brief is in
[`REFLECTION_CHAT.md`](./REFLECTION_CHAT.md).

Image generation is a separate capability from text assistance. Create Studio
requests a background through an optional host callback; C.H.A.T. owns the
server-only provider seam, credentials, permanent storage, and provenance.
The current `STUDIO_IMAGE_PROVIDER=deterministic` adapter is a local fixture
for the integration, not a production model. No image-provider SDK belongs in
the browser or in Create Studio.

Do not make AI provider response formats part of the domain model.

## Scripture retrieval

A second connector, built to the same shape as the AI one and deliberately
separate from it: `api/src/bible/`, provider `youversion`, with `YVP_APP_KEY`
read only inside the adapter.

- `GET /api/bible/translations` assembles a catalog from the languages in
  `BIBLE_LANGUAGES` — default `en,tl,ceb,es,fr,de,zh`, which produced **47
  translations across 7 languages** when verified against the key on
  2026-08-16. The provider has no "list every Bible" call, so that list *is* the
  catalog: a language nobody adds is a language whose Bibles do not exist here.
- `GET /api/bible/passages` looks a reference up. `GET`/`PUT`/`DELETE
  /api/bible/reflections/:id/passage` store the chosen passage against the
  reflection, in its own `reflection_passages` table, and it is read back from
  storage rather than re-fetched.
- **On by default** (`BIBLE_ENABLED=true`), unlike assistance: a lookup sends a
  reference and nothing anyone wrote, and a Bible app whose Bible has to be
  switched on is a broken Bible app.
- Passage **text** is never put in an AI prompt unless
  `BIBLE_SCRIPTURE_IN_PROMPTS` says so, and it does not by default. The
  reference always is. That is a licensing decision, not an engineering one.
- The retrieved passage belongs in **Content**, which is the connector's whole
  point: Content is the section that holds Scripture.

## Create engine architecture

Create Studio is a separate private package and is deterministic for text. The
C.H.A.T. host adapter owns reflection semantics; the package owns neutral
document editing, Fabric-backed preview, and export. Host persistence stores
versioned Studio documents rather than raw Fabric JSON. See
[`CREATE_STUDIO_INTEGRATION.md`](CREATE_STUDIO_INTEGRATION.md).

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
Create Studio canonical document
    ↓
Fabric-backed preview
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

Generated Studio images are registered as permanent host assets when a user
applies them to a saved composition. The canonical document stores a stable
`studio-asset.*` identifier; authenticated C.H.A.T. storage owns the encoded
bytes and provenance. Provider URLs and temporary signed URLs never become
document state.

The provider remains replaceable behind a server-only interface. The browser
and Create Studio never receive provider credentials, vendor SDK types, billing
logic, or raw provider URLs. The current deterministic fixture is a development
proof, not an AI provider.

Future storage-policy options still include:

- browser-side generation and immediate export;
- temporary object storage for AI-generated backgrounds;
- persistent storage only for creations the user chooses to save.

Storage policy should be revisited before large-scale public usage.

## Search

Start with structured and text search in the relational store — SQLite today,
PostgreSQL if and when the product moves there. `GET /api/reflections` does this
now: a `q` term, `filter`, `sort`, `book`, `section`, `tag`, `from` and `to`.

Search dimensions can include:

- message/content text;
- title;
- Scripture reference, including book/chapter/verse locators;
- tags saved on the reflection and hashtags in the writing;
- C/H/A/T section;
- date (`from` / `to` as `YYYY-MM-DD`).

`GET /api/reflections` answers with `{ items, tags, books }` so the page can
offer chips it did not invent. `/api/library` is the same payload.

Semantic/vector search should be introduced only when it solves retrieval failures that conventional search cannot.

## Cross-platform rule

Before adding a frontend dependency or browser API, determine:

1. Does it work in the supported web browsers?
2. Does it work inside Capacitor WebView on Android?
3. Does it work inside Capacitor WebView on iOS?
4. If not, can it be isolated behind a small platform adapter?

Do not fork whole product screens for platform differences when a small adapter is sufficient.
