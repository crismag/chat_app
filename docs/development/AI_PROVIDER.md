# AI assistance — setup, configuration and failure modes

How the AI backbone is put together, how to run it, what it will not do, and
how to put a different provider behind it.

The rules it exists to serve are in [AI_AND_CONTENT_RULES.md](./AI_AND_CONTENT_RULES.md).
This document is the mechanism; that one is the reason.

---

## The principle

> Human reflection, assisted by AI. The AI must not impersonate the user or
> manufacture the user's faith, feelings, experience, prayer, or testimony.

**C.H.A.T.** is **Context** (what is happening in and around the passage),
**Heart** (how it personally touches the writer), **Application** (how it
applies and what they may do), **Testimony** (their declaration of faith,
conviction or prayer).

The second section is **Heart**. It is never called "Highlight" — not in code,
copy, prompts, schemas, tests or documentation. There is a regression test in
`api/src/ai/ai.test.ts` that reads the source of `api/src/ai`,
`packages/shared/src` and `web_app/src` and fails on the word anywhere it is
not being explicitly ruled out.

---

## What V1 does

Two operations, both triggered by an explicit press:

| Operation | Endpoint | What it returns |
|---|---|---|
| Suggest reflection questions | `POST /api/ai/reflection-guidance` | 1–3 guiding questions per requested section |
| Improve wording | `POST /api/ai/improve-writing` | A suggested rewording, with the original |
| Capability state | `GET /api/ai/status` | `{ enabled, provider, capabilities }` |

**Out of scope, deliberately:** auto-filling Heart or Testimony; generating a
personal story, emotion, conviction, prayer or experience; claiming divine
authority or certainty about God's will; replacing pastoral, mental-health,
medical, legal or emergency help; auto-publishing anything; calls on
keystrokes; open-ended chat, agents, function calling, search grounding, RAG,
vector stores, image generation.

---

## Setup

1. Copy `.env.example` to `.env` (gitignored) and fill it in.
2. Get a key from [Google AI Studio](https://aistudio.google.com/apikey).
3. Put it in `.env` as `GEMINI_API_KEY=…`, or export it in the shell that runs
   the API.
4. Set `AI_ENABLED=true`.

```bash
AI_ENABLED=true AI_PROVIDER=gemini GEMINI_API_KEY=… npm run dev
```

Check it took:

```bash
curl -s localhost:8000/api/ai/status
# {"enabled":true,"provider":"gemini","capabilities":{...}}
```

### Where the key must live

Only in the environment of the process running the API.

- The key is read **only** from `process.env.GEMINI_API_KEY`, and **only** by
  `api/src/ai/providers/gemini.ts`, at the moment a client is constructed.
- It is never placed in `AiConfig`. That object records `configured: boolean` —
  whether a credential is present — and never the credential. Config objects
  get logged, spread into errors and serialised by someone in a hurry; if the
  key is not in one, none of those can be the mistake that leaks it.
- No path to a key file appears anywhere in this repository. Where you keep
  yours is your workstation's business, not the codebase's.
- The browser never sees it and never calls Gemini. Only the backend does. This
  is verified: the built client bundle contains no provider SDK and no key
  material.
- `.env*` (except `.env.example`), `*.api_keys`, `*.pem` and `*.key` are
  gitignored.

**Never commit a key.** If one is ever committed, revoke it in AI Studio first
and rewrite history second — in that order, because a revoked key in history is
an embarrassment while a live one in history is an incident.

---

## Configuration

All environment-driven. Read fresh on **every request**, so the kill switch
works without a redeploy.

| Variable | Default | What it does |
|---|---|---|
| `AI_ENABLED` | `false` | The kill switch. `false` means no provider call is made, for any reason. |
| `AI_PROVIDER` | `gemini` | `gemini`, or `fake` for the deterministic stand-in. Anything unrecognised resolves to nothing rather than falling back to a real provider. |
| `GEMINI_API_KEY` | — | Your credential. Backend only. |
| `GEMINI_MODEL` | `gemini-2.5-flash-lite` | **Configuration, not a constant.** Changing which model answers needs a variable and a restart, never a code edit. |
| `AI_REQUEST_TIMEOUT_MS` | `15000` | How long one call may take before it is abandoned. |
| `AI_MAX_INPUT_CHARS` | `12000` | Ceiling on text sent to the provider, enforced server-side. |
| `AI_RATE_LIMIT_PER_MINUTE` | `12` | Per signed-in user. The per-address ceiling is four times this. |
| `CHAT_AI_DISABLED` | unset | Predates `AI_ENABLED` and switches off **all** assistance, including the heuristic title suggestion that needs no provider. |

Assistance is **off by default**. A feature that sends a person's private
reflection to a paid third party should not begin working because a variable
was forgotten.

### Changing the model

```bash
GEMINI_MODEL=gemini-2.5-flash npm run dev -w api
```

Use a **stable** model, never a preview one — a preview name can be withdrawn
underneath a running server. Check the current list at
<https://ai.google.dev/gemini-api/docs/models>.

---

## Architecture

```text
CHAT UI  →  /api/ai/*  →  AiService  →  AIProvider  →  GeminiProvider
                                          (seam)
```

| File | Responsibility |
|---|---|
| `packages/shared/src/ai.ts` | Sections, outcomes, copy, wire types. Provider-free; safe for the browser. |
| `api/src/ai/config.ts` | Environment → `AiConfig`. Never holds the key. |
| `api/src/ai/types.ts` | The `AIProvider` contract and `AiFailure`. |
| `api/src/ai/prompt.ts` | System instruction, task text, JSON Schemas, delimiting. Versioned. |
| `api/src/ai/validation.ts` | Request and response validation. |
| `api/src/ai/service.ts` | Gating, limits, timeout, retry policy, logging. |
| `api/src/ai/rate-limit.ts` | Per-user and per-address sliding windows. |
| `api/src/ai/logging.ts` | Allow-listed log fields and redaction. |
| `api/src/ai/routes.ts` | The three endpoints. |
| `api/src/ai/providers/fake.ts` | Deterministic stand-in for tests and verification. |
| `api/src/ai/providers/gemini.ts` | **The only file that imports the SDK.** |

The SDK is imported in one file. It is never imported in UI components, route
handlers, domain models or persistence code — and it is loaded lazily, so a
server running without assistance does not load it at all.

`AIProvider` has two methods and no free-form escape hatch. An interface that
can be asked anything eventually is.

---

## The prompt and the schema

Both live in `api/src/ai/prompt.ts` and carry a `PROMPT_VERSION`, which is
recorded on every log line so a change in answer quality can be traced to the
change in wording that caused it. Bump it whenever the instruction or a schema
changes meaning.

The system instruction enforces: assist the writer and do not become the
writer; keep C/H/A/T distinct; ask rather than assert what the person feels;
work only from the supplied passage and reflection and invent no historical or
scriptural facts; ask when context cannot responsibly be inferred; avoid
denominational overreach; never claim the output is God's direct message;
return only schema-conforming data.

### Structured output

Requested with `responseMimeType: 'application/json'` and `responseJsonSchema`
([docs](https://ai.google.dev/gemini-api/docs/structured-output)), then
**parsed and validated again** against the application's own rules. A schema
handed to a vendor describes what was asked for, not what arrived.

The guidance schema is built **per request** from the sections actually asked
about, so the model cannot return questions about a section the writer was not
working on.

> The API supports only a subset of JSON Schema — `type`, `items`, `minItems`,
> `maxItems`, `properties`, `required`, `enum`, `description`,
> `additionalProperties` and a few others. `maxLength` on a string is **not**
> among them, so per-question length ceilings are stated in the instruction and
> enforced in `validation.ts`. Do not add unsupported keywords: they look like
> a guarantee while being nothing of the kind.

### Untrusted input

Passage text and reflection text are **data, never instructions**. They are
wrapped in fences carrying a per-request random nonce — a fixed delimiter can
be closed by anyone who guesses it — and the instruction names them as data
explicitly.

That is defence in depth, not the defence. The real defence is that output is
schema-constrained and validated, so even a successful injection can only
produce questions, and questions are shown to the writer for review before
anything is kept.

---

## Failure modes

Every failure is a typed outcome. Clients never see a raw provider message or a
stack trace.

| Outcome | HTTP | When | Retried? |
|---|---|---|---|
| `ai_disabled` | 503 | `AI_ENABLED=false` | — no provider is touched |
| `ai_not_configured` | 503 | No key, unknown provider, or credential rejected | No |
| `rate_limited` | 429 | Per-user or per-address ceiling, or provider 429 | Provider 429 once |
| `timeout` | 504 | `AI_REQUEST_TIMEOUT_MS` reached | No |
| `provider_unavailable` | 502 | Outage, network, 5xx, unconverted exception | 5xx once |
| `invalid_provider_response` | 502 | Malformed JSON, schema mismatch, truncated output | **Never** |
| `content_not_supported` | 422 | Prompt or candidate blocked by safety | No |
| `needs_user_clarification` | **200** | Meaning was uncertain; the model asked instead of guessing | — a success |
| `invalid_request` | 400 | Bad body, unknown section | — never reaches a provider |
| `input_too_long` | 413 | Over `AI_MAX_INPUT_CHARS` | — never reaches a provider |

**Retry policy:** transient provider failures are retried **at most once**,
after a short jittered pause. Validation failures are **never** retried —
asking the same question again to get a different shape only spends quota to
reach the same refusal.

`needs_user_clarification` is a success, not a failure. When preserving the
intended meaning is uncertain, the model asks rather than guesses, because
guessing at a sentence describing what God did for someone is how an
application starts manufacturing testimony one clarification at a time.

**When anything fails, the manual workflow is untouched.** The app starts,
loads and saves with AI disabled, unconfigured, rate-limited or unavailable.
The failure copy says so: *"AI assistance is unavailable right now. You can
continue writing normally."*

---

## Privacy and logging

- **Opt-in and marked.** A disclosure is shown before the first real request,
  naming what is sent and where. Declining sends nothing.
- **Only the fields the action needs.** The passage reference, the sections
  being asked about, and what has been written in them. Never profile data,
  unrelated drafts, comments, contacts, analytics identifiers or whole records.
- **Logs carry facts, never content.** Request id, operation, provider,
  configured model, prompt version, latency, outcome, retry flag and token
  counts — built field by field from a typed event, so a new field has to be
  added deliberately before it can be printed. Never the passage, the
  reflection, the prompt or the model's output. Authorization headers, cookies,
  keys and content are redacted at any depth by `redact()`.
- **No retention.** V1 stores no prompt or response. No context caching, no
  file upload, no conversation history.
- **Authentication required**, plus per-user and per-IP rate limiting.
- `GET /api/ai/status` returns capability state only — never project numbers,
  key fragments, environment values, internal errors, quotas or credentials.

The logging trade-off is deliberate and it costs something real: a bad
suggestion cannot be reproduced from the logs. Given that the content is a
person's private reflection on Scripture, often the most personal thing they
wrote that week, that is the right trade.

---

## Testing

```bash
npm test          # never calls Gemini
npm run typecheck
npm run lint
npm run build
```

The suite runs against `FakeProvider`, which can be told to hang, to fail once
or to fail always, so timeouts and the retry policy are observed rather than
assumed. A suite that reaches a paid third party is slow, flaky, expensive and
unrunnable offline.

Browser verification, with the deterministic provider:

```bash
AI_ENABLED=true AI_PROVIDER=fake npm run dev
node scripts/verify/ai-assist.mjs
```

One real call, opt-in twice over and never in CI:

```bash
AI_LIVE_TEST=1 node scripts/verify/ai-live-smoke.mjs
```

It sends synthetic, impersonal content and prints only latency, counts, token
usage and an outcome code — never the key, the prompt or the response.

---

## Adding another provider

1. Write `api/src/ai/providers/<name>.ts` implementing `AIProvider`. It is the
   only file that may import that vendor's SDK.
2. Reuse `prompt.ts` for the instruction and schemas, and `validation.ts` for
   the response. Do not re-implement either — product rules must not live only
   inside one vendor's prompt.
3. Convert every SDK exception into an `AiFailure` with one of the outcomes
   above. Nothing vendor-shaped may escape the adapter. Keep the original as
   `cause`; it is never serialised.
4. Add the name to `AI_PROVIDER_NAMES` in `config.ts` and a branch to
   `AiService.buildProvider`. Import it lazily, so a server not using it does
   not load its SDK.
5. Read the credential from the environment inside the adapter. Never add it to
   `AiConfig`.
6. Test it the way `gemini.ts` is tested: export the error-mapping and
   response-reading functions and call them directly, so blocked content, a
   truncated answer and a rejected credential are exercised without a network.

Gating, limits, timeouts, cancellation, retry, logging and rate limiting all
live **above** the seam in `AiService` and are inherited for free. If you find
yourself re-implementing one of them in an adapter, it is in the wrong place.

---

## Known limitations

Written down rather than discovered later.

- **Rate limiting is in-memory and per-process.** It does not survive a restart
  and does not span instances, so a multi-instance deployment needs a shared
  store (Redis, or the database) before the ceiling means anything. Single
  process today, which is what this is sized for.
- **The disclosure is remembered in `localStorage`.** It is therefore per
  browser rather than per account: the same person on a second device sees it
  again. That is the safe direction to be wrong in, but it is not a consent
  record, and anything that needs to be auditable belongs on the user row.
- **No structured-output conformance has been measured against the live API.**
  The schema is what the docs specify and validation catches anything that
  disagrees, but how often a real model returns something the validator rejects
  is unmeasured. Run `ai-live-smoke.mjs` a few times before trusting a number.
- **Guidance sends every written section, not only the one being asked about.**
  That is what makes a question follow on from what the person has already
  written rather than repeating it, and it is more than the strict minimum for
  the request. It is bounded by `AI_MAX_INPUT_CHARS` and is the one place the
  minimum-fields rule is traded for answer quality.
- **`x-forwarded-for` is spoofable**, which is why the per-address ceiling sits
  *behind* the per-user one rather than in front of it. Behind a proxy that does
  not set it, all traffic shares one bucket.

---

## Project identifiers

Display name `DEVOTIONAL_CHAT_APP`, project `projects/584923326390`, project ID
`gen-lang-client-0841320716`.

Safe to reference here. They must **never** appear in an API response to a
client, and there is a test asserting they do not.
