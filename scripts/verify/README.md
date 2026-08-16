# Verification scripts

Browser-driven checks against a running dev server. **They belong here**, inside
this repository, and so does everything they need.

That is not a style preference. These scripts were briefly written into an
unrelated repository because that is where `selenium-webdriver` happened to be
installed — which put one project's files inside another project's working tree
and made this repo's verification depend on a checkout it has no relationship
with. A repository owns its own tooling; if it needs a package, the package is
installed here.

## Running

The dev server must be up (`npm run dev` from the repo root — web on 5173, API
on 8000):

```bash
node scripts/verify/<name>.mjs
```

Screenshots and other output go to `scripts/verify/out/`, which is ignored.

## `ai-assist.mjs` — the assistance controls

Needs the API started with the deterministic provider, so the run costs nothing
and cannot flake on someone else's network:

```bash
AI_ENABLED=true AI_PROVIDER=fake npm run dev
node scripts/verify/ai-assist.mjs
```

It never uses a real credential.

## `ai-conversation.mjs` — the bounded conversation

Drives a real conversation: sends a message, waits for a reply, checks the reply
is visibly the assistant's, throws a prompt injection at it, asks it something
off-topic, and carries a reply into a section.

It asserts on **shape and provenance, never on wording**, so it passes against
the deterministic provider and against the real one. Point it at either:

```bash
# deterministic, free
AI_ENABLED=true AI_PROVIDER=fake npm run dev
node scripts/verify/ai-conversation.mjs

# the real thing
node scripts/verify/ai-conversation.mjs
```

With AI switched off it takes its other branch and checks the composer still
stores messages as notes to self — which is the path that must never break.

## `ai-companion.mjs` — the conversation as a companion

Drafts for all four sections, the per-response icon and its menu, adding over
existing text, scoped mode, a human detour, and injection. Asserts on shape,
provenance and stored state rather than on wording, so it passes against the
deterministic provider and against Gemini.

## `ai-suggest-title.mjs` — titles rather than truncated sentences

Prints the candidates, then checks the mechanical parts: three or four options,
inside the format's limit, distinct in angle, declining leaves the title
byte-identical, accepting survives a reload.

The quality claim is not machine-checkable. **Read the candidates it prints.**
If they read as sentences, the prompt is not finished.

## `ai-live-smoke.mjs` — one real Gemini call

The only thing in this repository that talks to Gemini. It is opt-in **twice**:
it runs when `GEMINI_API_KEY` is present in the environment *and*
`AI_LIVE_TEST=1` is set. Two switches rather than one, because a key exported
for ordinary development should not be enough on its own to start spending on
it.

```bash
AI_LIVE_TEST=1 node scripts/verify/ai-live-smoke.mjs
```

It sends synthetic, impersonal content — never anyone's actual reflection — and
reports only latency, counts, token usage and an outcome code. It never prints
the key, the prompt or the response, because this output is the sort of thing
that gets pasted into an issue. Do not run it in CI.
