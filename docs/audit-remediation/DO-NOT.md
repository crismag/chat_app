# Do not

Read this before writing code. These are the ways this repository has already accumulated sediment, and the ways an agent will make it worse.

---

## Do not rewrite the application

No repository-wide move to a new framework, store, folder layout, or “clean architecture.” Implement one finding at a time.

Do not start P5 (one database) because P0 felt adjacent.

---

## Do not treat existing layers as load-bearing

The audit question was: if this were designed today from current requirements, what would not be built this way?

Do **not** add:

- another AuthStore implementation;
- another reflection schema;
- another share/publish table;
- a third Sheet or report dialog;
- a global client store (Redux, Zustand, React Query) to “manage complexity.”

ChatPage is large because it owns too many `useState`s, not because it lacks a state library. P4 splits it into hooks. That is the allowed shape.

---

## Do not migrate onto the unused MariaDB reflection model

MariaDB already has `reflections`, `reflection_revisions`, `chat_content` JSON, `reflection_images`, `user_settings`, `ai_usage_events`, `ai_usage_daily`. HTTP does not use them. [`api/src/reflections/service.ts`](../../api/src/reflections/service.ts) is not mounted.

The **live** model is SQLite `conversations` + `sections` + `messages`. That is what the UI edits.

If you reach P5, clone **SQLite semantics** onto MariaDB. Do not ETL live data into revisions and JSON documents. Do not grow the unused schema “for later.”

---

## Do not add infrastructure

No Redis, queues, workers, extra Node services, API gateways, or new caches unless a phase file names them. It will not.

In-memory rate limiters are acceptable on the current single process. Do not introduce a shared limiter store in P0.

Do not add Helmet/CSP “for security” in P0. That is P6 and needs care not to break the Vite/Capacitor shells.

---

## Do not leave old and new paths indefinitely

If you replace a route, delete the old one in the same phase (P1 aliases) or document the exact removal condition (P5 dual-write).

Do not add `/api/v2/` beside `/api/`.

---

## Do not “fix” tests to match a behavior change

If a test fails because you changed user-visible or API behavior that was not approved, revert or ask. Do not weaken the assertion.

Updating tests that targeted a **deleted** alias (`/api/library`) to the live path (`/api/reflections`) is required in P1, not a behavior change.

---

## Do not use MemoryStore as the security SUT for new tests

[`api/src/app.test.ts`](../../api/src/app.test.ts) historically used `createApp(new MemoryStore())`. Community already returns 503 on MemoryStore on purpose.

New tests for authz, merge, reset, login limits, and registered gates should use `SqliteStore`, and `MysqlAuthStore` when the finding is MariaDB-specific.

You may keep MemoryStore for pure in-process unit tests that do not claim to prove production authz.

---

## Do not silently expand product scope

No comments, following, ranking, uploaded artwork, production image model, magic-link login, or church-management features. The audit is not a backlog of new product.

---

## Do not log secrets

Never log session tokens, installation secrets, password-reset URLs, password hashes, Gemini keys, or YouVersion keys. P0-S2 exists because reset tokens already hit the log when SMTP is unset.

---

## Do not bind the API to the public internet as a shortcut

If you touch [`api/src/index.ts`](../../api/src/index.ts) in P5, production should listen on `127.0.0.1`. The PHP gateway in `scripts/deploy/chatapi/index.php` is a hosting constraint. Do not delete it until Node owns the hostname.

---

## Do not “simplify” guest accounts away

Writing before register is a product requirement. Installation cookies for guests surviving “log out” is intentional. Do not make every visitor a registered user, and do not destroy guest installations on logout.
