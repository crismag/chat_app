# P6 — Optional follow-ons

Each item is separately gated. Do not implement a list; implement the one Cris named.

---

## S6 — CSRF / mutation header

Require a custom header on cookie-authenticated POST/PATCH/DELETE (e.g. `X-Requested-With: chat-web`). Send it from [`web_app/src/shared/api/client.ts`](../../../web_app/src/shared/api/client.ts). CORS already allowlists origins; this stops simple form POST CSRF for `SameSite=None` native cookies.

Tests: mutation without header → 403; with header → existing success. Do not break GET.

---

## S8 — Disposable email / verification (product)

Only if Cris wants it. Wiring the deleted P1 list means restoring a list **and** a loader. Prefer a maintained fetch-at-build or a small code allow/deny, not a 8500-line committed blob, unless Cris wants that file back.

Verification mail is a new user flow ( paler register until click ). Do not hide it inside a “while I’m in auth” P0 commit.

---

## Collapse AI routes

Move named actions from `POST /api/conversations/:id/ai` to `/api/ai/…` **or** keep heuristics internal and point the frontend at one family. Update ChatPage. Deprecate the old path with a deadline, then delete. `GET /api/ai/status` should describe both model and heuristic capabilities in one object (it already composes some of this in `app.ts`).

---

## Collapse `CHAT_AI_DISABLED` into `AI_ENABLED`

Document the env change in `.env.example`. Accept both during one release if production might set the old name, then remove.

---

## Security headers

CSP on the static app, `frame-ancestors 'none'`, HSTS only on HTTPS production. Capacitor and Vite inline assumptions will fight a naive CSP. Test web and a packaged WebView.

---

## CI subset of `scripts/verify`

Not live Gemini/YouVersion smokes. Candidates: smoke, Send-button reference race, community-states. Needs a started web+api in CI. Cost vs flake: ask Cris.

---

## Public share: one POST

Today ChatPage:

```ts
await api(`/conversations/${activeId}/share…`)
await api(`/publications…`, { body: { audience: 'public' } })
```

Server should set visibility and create the publication atomically. Frontend one call. Community-only share already does not set public visibility — keep that invariant.

---

## Loopback bind and XFF (S9)

[`api/src/index.ts`](../../../api/src/index.ts) `serve({ fetch, port })` — set `hostname: '127.0.0.1'` when `NODE_ENV=production` so port 8000 is not reachable past PHP.

Also stop treating `X-Forwarded-For` as the client address unless the connection peer is loopback (the PHP script). Guest, register, and forgot-password rate limits are IP-only; a public Node port makes them spoofable. Login’s per-email cap must stay.

If this ships in P5, tick S9 in STATUS in the same change. Do not do S9 inside P0/P1.

---

## O1 — Readiness

Add `/api/health/ready` (preferred) that pings SQLite and MariaDB when configured. Leave `GET /api/health` as liveness unless Cris wants that path to fail closed.

---

## O2 — PHP timeout

`scripts/deploy/chatapi/index.php` `TIMEOUT_SECONDS = 30`. Align with AI timeouts or document the ceiling. Do not change it unasked.

---

## M1 — Request IDs

One middleware. Log the id. Optional error-JSON field (gated if you add it to every error body). Never log tokens or message bodies.

## M2 — `onError`

Hono `app.onError`: uncaught throws → `{ error }` JSON, 500 or 503, log with the request id. No stack in the body. Do not change existing per-route error strings.

---

## S11 — Studio image generate limiter

[`api/src/create/image-routes.ts`](../../../api/src/create/image-routes.ts) has auth + ownership + kill switch, no window. Reuse `SlidingWindowRateLimiter` / AI pattern. Per-user and per-address. 429 + Retry-After. Only when Cris names S11 (or immediately before a billed provider).

---

## S10 — Account delete / export

Only if Cris names it. Operator procedure first. Then a registered-user delete across both stores. No admin UI.
