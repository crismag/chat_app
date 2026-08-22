# Context — what the system is

C.H.A.T. (Content · Heart · Application · Testimony) is a private-first conversational Scripture reflection app. One TypeScript monorepo: React web UI, Hono API, Capacitor Android/iOS hosts, shared types.

Read [`../development/PRODUCT.md`](../development/PRODUCT.md) for product intent. This file is the **implementation reality** the audit found, including where docs are behind the code.

---

## Repository map

```text
web_app/                 React + Vite UI
api/                     Hono API
packages/shared/         @chat/shared types and validators
android/, ios/           Capacitor hosts — not separate apps
scripts/deploy/          Hostinger release; PHP loopback gateway
scripts/verify/          Selenium checks; not in CI
docs/development/        Product/architecture contract
docs/audit-remediation/  This pack
```

There is no Docker-based production stack. Local MariaDB is optional (`MYSQL_*`). SQLite file default: `api/chat.sqlite` (`DATABASE_PATH`).

---

## Runtime architecture (today)

```text
Browser / Capacitor WebView
        │  credentials: include
        ▼
Vite proxy / VITE_API_BASE_URL / PHP gateway (prod)
        ▼
Hono createApp  (api/src/app.ts)
  ├── AuthStore
  │     ├── MysqlAuthStore → MariaDB     if MYSQL_* set   [LIVE for accounts]
  │     └── SqliteAuthStore → SQLite     otherwise        [LIVE for accounts]
  ├── SqliteStore                         conversations, messages, sections
  ├── CommunityStore / ProfileStore / studio / passages   [LIVE, SQLite]
  ├── AiService → Gemini | fake
  └── BibleService → YouVersion
        │
        └── ReflectionService → MysqlPersistence.reflections   [NOT MOUNTED]
```

Typical write:

`UI → web_app/src/shared/api/client.ts api() → route in app.ts or api/src/<domain>/routes.ts → store → SQLite`

Auth when MariaDB is configured:

`UI → /api/auth/* in app.ts → MysqlAuthStore → api/src/mysql/persistence.ts → MariaDB`

Content does not use that MariaDB persistence layer.

---

## Identity (load-bearing)

Two account types in `@chat/shared`: `ANONYMOUS` (shown as Guest) and `REGISTERED`.

- A visitor is nobody until they persist something. Then `api()` gets `401` + `needsAccount`, and [`AccountChoice`](../../web_app/src/auth/AccountChoice.tsx) offers guest or sign-in.
- Guests are real user rows. Their durability is an **installation** cookie (`chat_install`), not only a session (`chat_session`). Logout must **not** revoke a guest installation.
- Register/Google on a guest **upgrades in place** (same id) when that identity is new.
- Signing into an **existing** registered account **merges** guest work into it.

The string you see in HTTP and SQLite `userId` is MariaDB `users.public_uuid` when accounts live on MariaDB. There is no FK from conversations to MariaDB users.

**Bug to know while you work:** [`registeredUser`](../../api/src/app.ts) currently treats “has an email string” as “registered.” On MariaDB, Google-only users often have `email: null` after `userForToken` because email is loaded from `local_credentials`. That is finding **S4**.

---

## Naming (do not invent a third vocabulary)

| Name in code | Meaning now |
|--------------|-------------|
| conversation | HTTP + SQLite table for a private draft (`/api/conversations/*`) |
| reflection | Product name; `GET /api/reflections` lists the caller’s conversations |
| library | Old name. UI `/library` redirects. API `/api/library` is an alias. |
| visibility | `private` \| `shared` on the conversation (legacy stored value `published` still reads as shared) |
| publication | Community feed row — a **copy** of selected sections |
| audience | `public` \| `community` \| `only_me` on a publication |
| share | Verb + rate log + device export. Public in-app share currently sets visibility **and** creates a publication (two POSTs). |
| community (legacy GET) | `GET /api/community` — all `visibility=shared` summaries; tests only |

Frontend community URLs are `/community/publications/:id`. Some docs still say `/api/shares` and `/community/shares/:id`. Believe the code.

---

## Dual AI

Both are live and used by [`ChatPage.tsx`](../../web_app/src/chat/ChatPage.tsx):

| Path | Role |
|------|------|
| `POST /api/ai/reflection-chat` | Model chat beside the card |
| `POST /api/ai/reflection-guidance` | Ask questions on a section |
| `POST /api/ai/improve-writing` | Improve wording |
| `GET /api/ai/status` | Capabilities |
| `POST /api/conversations/:id/ai` | Heuristics + suggest title (`api/src/ai.ts`) |

Do not merge these in P0–P4. P6, with approval.

---

## Frontend shape

Providers: `AuthProvider`, `AccountChoiceProvider` (module handler, not React context), `MobileBarProvider`. No Redux.

Giant pages (line counts ~ 2026-08-22):

- `web_app/src/chat/ChatPage.tsx` ~2316, ~46 `useState`s
- `web_app/src/reflections/ReflectionsPage.tsx` ~1377
- `web_app/src/community/CommunityPage.tsx` ~1130

Community already has `web_app/src/community/api.ts`. Chat/Reflections/Create often call `api('/path')` with string paths.

Two Sheets: `web_app/src/chat/ChatSheets.tsx` vs `web_app/src/shared/mobile/Sheet.tsx`. Unify onto the shared one in P4.

---

## Minimum architecture (target, not a rewrite ticket)

One API process, one MariaDB, provider seams for Gemini and YouVersion, Capacitor as a host, PHP gateway only until hosting changes.

Keep: private-by-default, guests, publication-as-copy, community SQL authz, kill switches (`api/src/http/capabilities.ts`), `@chat/shared` validators, Create Studio as a hosted package.

Drop, eventually: SQLite as a live store, unused MariaDB revision/JSON reflection schema, alias routes, dual AI URLs, dual public-share POSTs, MemoryStore as the security test app, scrypt hasher once SqliteAuthStore is gone.

**P5 rule:** MariaDB content tables should look like **live SQLite**, not like unused `001_foundation.sql` reflections.

---

## What is already good (do not “improve” these)

- Community `VISIBLE_TO` interpolated into every publication read ([`api/src/community/store.ts`](../../api/src/community/store.ts) header).
- Parameterized SQL; no shelling out on the request path.
- Forgot-password **wording** does not enumerate accounts (the Origin bug is separate).
- Google sign-in verifies ID tokens (`api/src/auth/google.ts`).
- Owned conversations 404 for missing and for non-owners.
- AI/Bible logs redact content and secrets.
- Kill switches disable outward features without taking private writing down.
- CI pins **MariaDB 11.8**, not MySQL 8. JSON columns are LONGTEXT + `json_valid` on that server. Never copy MySQL 8 JSON assumptions.

---

## Hosting

`scripts/deploy/` installs a Node API on loopback and a PHP forwarder (`scripts/deploy/chatapi/index.php`) because the host may not allow `mod_proxy`. Cookie `Secure` is tied to `NODE_ENV === 'production'`. Do not “fix” that by setting Secure in development — localhost HTTP would then look like a broken login.
