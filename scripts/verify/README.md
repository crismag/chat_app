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
