# P0 — Security and authz

Implement only this phase unless Cris named a subset. One finding per commit. Re-read [`../APPROVALS.md`](../APPROVALS.md) before each finding.

**Tree note:** CodeReviewerAssist found P0 likely already in the working tree. Grep the table in [`../CODEREVIEWERASSIST.md`](../CODEREVIEWERASSIST.md) before writing. If present with tests, tick STATUS and do not re-implement. S2 **redaction** may be done; S2 **fail-closed without SMTP** is still gated.

Suggested commit order (dependencies first):

1. S3 session hashing (unblocks nothing else, low UX risk)
2. S5 invite email lookup
3. S2 log redaction (then production policy if approved)
4. B1 reset origin if approved
5. S1 login limiter if approved
6. S7 register/guest limiter if approved
7. S4 registered gate if approved (touches community/profile authz)

If Cris says “do all approved P0,” skip gated items that were not approved and say which.

---

## Shared tools already in the tree

- Rate limiter: [`api/src/ai/rate-limit.ts`](../../../api/src/ai/rate-limit.ts) (`SlidingWindowRateLimiter`). Google and forgot-password already construct one in `createApp`.
- Client address: [`api/src/http/address.ts`](../../../api/src/http/address.ts)
- Origins allowlist: [`api/src/http/origins.ts`](../../../api/src/http/origins.ts) `webOrigins()`
- Session hash on MariaDB: `hashSessionToken` in [`api/src/mysql/tokens.ts`](../../../api/src/mysql/tokens.ts) (or adjacent crypto helpers — grep it)
- Tests to extend: [`api/src/auth/password-reset.test.ts`](../../../api/src/auth/password-reset.test.ts), [`api/src/auth/session-cookie.test.ts`](../../../api/src/auth/session-cookie.test.ts), [`api/src/auth/google-signin.test.ts`](../../../api/src/auth/google-signin.test.ts), [`api/src/auth/store.test.ts`](../../../api/src/auth/store.test.ts)

Do not copy-paste a second limiter implementation.

---

## S3 — Hash SQLite session tokens

**Approval:** not gated.

**Today:** `sessions.token` is the cookie value (`api/src/db.ts`).

**Do:**

- Store sha256 hex of the token as the primary lookup key, matching MariaDB.
- `startSession` / `userForToken` / `endSession` on `SqliteAuthStore` must hash before query.
- Existing rows: dual-read (hash first, raw token fallback) **or** treat as logout. Dual-read is kinder. Add a short comment stating when the fallback can die (all sessions issued after this deploy have expired).
- Do not change cookie flags.

**Tests:** insert via API login; SELECT from sqlite that the stored value ≠ cookie; `userForToken` still resolves. If dual-read, a raw legacy row still authenticates.

---

## S5 — `userIdByEmail` uses AuthStore

**Approval:** not gated (bugfix).

**Today:** [`api/src/app.ts`](../../../api/src/app.ts) ~647:

```ts
userIdByEmail: (email) => store.accounts.byEmail(email)?.id ?? null,
```

**Do:** resolve through `auth.findByEmail`. If `createCommunityRoutes` expects a sync callback, change that option to `async` and `await` at the invite site ([`api/src/community/routes.ts`](../../../api/src/community/routes.ts) ~508). Do not keep a SQLite fallback that can disagree with MariaDB.

**Tests:** `MysqlAuthStore` + `SqliteStore` (empty SQLite users); registered user exists only on MariaDB; invite by that email finds them. SkipIf no MYSQL in local runs; CI has MYSQL.

---

## S2 — Do not log reset tokens

**Approval:** redaction is required. Fail-closed production / boot-fail is gated.

**Today:** `LoggingMailer` prints `message.text`, which includes the full URL.

**Do:**

- LoggingMailer: log `to`, `subject`, and a line that mail was not sent. Never log body if it may contain `token=`.
- Prefer a structured redact: if `text` matches reset URLs, strip the query.
- Production: still return `RESET_REQUESTED_MESSAGE` for anti-enumeration. Do not start using LoggingMailer bodies. If SMTP is missing in production, do not write the token anywhere. Optional boot-fail only if approved.

**Tests:** instantiate LoggingMailer with a capturing logger; send a reset-shaped message; assertion `not.toMatch(/reset-password\?token=/)` and `not.toMatch(/[a-f0-9]{32,}/)` on logged lines if easy without being brittle.

---

## B1 — Reset URL from configured origin

**Approval:** gated.

**Today:** `webOrigin(c)` uses request `Origin`.

**Do:**

- Add something like `publicWebOrigin(env)` that returns a configured absolute origin (e.g. `CHAT_PUBLIC_WEB_ORIGIN` or the first **non-localhost** entry of `CHAT_WEB_ORIGINS`). Do not use `c.req.header('origin')`.
- `resetUrl` still concatenates path + encoded token.
- Escape `link` for HTML (`&`, `"`, `'`, `<`).
- If production has no configured public origin, do not send a link with an empty or attacker origin. Still do not enumerate accounts in the HTTP response.

**Tests:** `app.request` with `Origin: https://evil.example` and a capturing mailer; sent HTML/text contain only the configured origin. Cover missing config.

**Do not** change forgot-password success JSON.

---

## S1 — Rate-limit login

**Approval:** gated.

**Do:** `SlidingWindowRateLimiter` per IP (`addressOf`) and per normalized email. Limits should be stingy for scripts and survivable for a person (Google’s 10/min is a reference, not a requirement — pick documented constants next to the limiter). On block: `429` and `Retry-After` if the limiter already exposes a wait. Unchanged 401 body on bad passwords.

**Tests:** N failures then 429; different email not blocked by the other email’s budget if you implemented per-email; IP limit still exists so attackers cannot rotate emails forever from one address without bound.

---

## S7 — Rate-limit register and guest

**Approval:** gated.

**Do:** Same pattern, separate limiter instances (guest creation is easier to spam). Do **not** remove `accountExists` unless separately approved.

**Tests:** burst guest → 429; burst register → 429; honest single register still 200/409 as today.

---

## S4 — Registered means `accountType`

**Approval:** gated.

**Today:** `registeredUser` returns null without `user.email`.

**Do:**

```ts
return user?.accountType === ACCOUNT_TYPES.REGISTERED
  ? { id: user.id, email: user.email ?? '', createdAt: user.createdAt }
  : null;
```

(or equivalent). Empty string email must not be used as a “not registered” signal anywhere else — grep `user?.email` in `api/src`.

On Google success with `email_verified`, `auth.markEmailVerified(user.id)`.

`MysqlAuthStore.account`: for registered users without local username, expose provider email if you persist it on `user_identities` (already has email on SQLite identities; MariaDB `linkIdentity` stores email). `userForToken` must not drop that. Do **not** treat provider email as the authz check; `accountType` is the check.

**Tests:**

- Guest: community/profile still 401/403 as today.
- Password registered: unchanged.
- Google-only MariaDB: can hit a registered-only route.
- Negative: cannot `claimUserId` a REGISTERED account as if it were a guest (if not already tested).

---

## Verification for the phase

```bash
npm test -w api
npm run typecheck -w api
```

Plus MariaDB-backed files when `MYSQL_*` is set.

Update [`../STATUS.md`](../STATUS.md) checkboxes you actually closed.
