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

## `card-marks.mjs` — the decluttered card, from both sides

The reflection card lost its C.H.A.T. letters, its section headings, "Not yet",
"Written", "Your words", "Unsaved", the word "recommended" and a separate Save
button. Half of this script reads the text the card actually *paints* — walking
the tree and dropping `sr-only`, `visibility: hidden` and zero-opacity nodes,
because `textContent` would count the very sentences that exist so the marks can
stay wordless — and asserts those words are gone.

The other half is the half that gets quietly lost. It asks Chrome for its own
accessibility tree (`Accessibility.queryAXTree`) rather than reading our
`aria-label`s back to ourselves, prints every accessible name it finds, and
requires each mark to carry one with its state inside it. Then it puts focus on
each mark and measures the tooltip's computed opacity — a hint that opens only
for a mouse is a hint half the users never get — and finally measures non-text
contrast in both themes, because these marks are now the only visible carrier of
what they say.

```bash
node scripts/verify/card-marks.mjs
```

**Look at `out/card-marks-1280.png` and `out/card-marks-390.png`.** The claim
being made is that the card is less busy, and no assertion can make it.

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

## `bible.mjs` — the passage card on Reflect

Drives the card above the four sections: loads the catalog, checks the selected
translation, looks a passage up, changes translation on the same reference, and
forces a failure to prove the previous passage and the draft survive it.

It also drives the translation search, and **every search assertion reads the
rendered rows rather than any internal state**. That is deliberate: the bug
report behind that work was "the search does not work", and a check that
inspected state would have passed while the list on screen did not change.
The queries it runs are the ones people actually type — `berean`, `bsb`,
`tagalog`, `tl`, `TLAB`, `reina`, `niv`, a misspelling, and nonsense.

Needs the API started with a real `YVP_APP_KEY`, because there is no
deterministic stand-in for a Bible:

```bash
set -a; . ~/.config/chat_app/youversion.env; set +a
npm run dev
node scripts/verify/bible.mjs
```

With no key it takes its other branch and checks the card says "Bible passage
lookup is not configured" without revealing *why* it is not configured — which
is the path that must never leak.

## `bible-live-smoke.mjs` — one real conversation with YouVersion

The only thing in this repository that talks to a Bible provider. Opt-in
**twice**: it runs when `YVP_APP_KEY` is present *and* `BIBLE_LIVE_TEST=1` is
set. Two switches rather than one, because a key exported for ordinary
development should not be enough on its own to start spending against it.

```bash
set -a; . ~/.config/chat_app/youversion.env; set +a
BIBLE_LIVE_TEST=1 node scripts/verify/bible-live-smoke.mjs
```

It never prints the key, a prefix of it, its length, or the URL it was sent to,
and it fetches its sample verses from a **public-domain** translation (the World
English Bible, id 206) so the text it prints is nobody's licensed property. It
re-establishes the four facts the connector depends on: `page_size` tops out at
99, NIV is id 111 with abbreviation `NIV11`, attribution comes from
`GET /bibles/{id}` and not from the list, and passage content is plain text.

Do not run either of these in CI.
