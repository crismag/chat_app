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

Several of these were written against `AI_PROVIDER=fake` and are documented as
such below. Run one of those against a live provider and it can fail for a
reason that has nothing to do with what it is checking — most often the
first-use disclosure sheet, which is modal and lands over the card on the first
send.

## `smoke.mjs` — the app boots, authenticates and renders

The shortest check there is: register a throwaway account, land signed in,
screenshot, and print any severe console errors. Run it first when something is
broken, because it tells you whether the problem is the app or the check.

## `reflect.mjs` — Reflect, driven end to end

The claims a unit test cannot make honestly: that a person can register and
write without meeting a title form first, that the four sections stay away
until something has been written, that the sidebar collapses and comes back,
that only one section card is open at a time, and that saving says so without
being asked. It ends by photographing the result at both widths, because the
point of the redesign is how it looks.

**Targets `AI_PROVIDER=fake`.** Against a live provider the first-use
disclosure sheet opens over the card and the script aborts on
`ElementClickInterceptedError` part-way through, so the checks after that point
never run at all.

```bash
AI_ENABLED=true AI_PROVIDER=fake npm run dev
node scripts/verify/reflect.mjs
```

## `reflect-integrity.mjs` — does anything on Reflect destroy what was written?

The owner reported controls with no visible effect that were also clearing work
in progress. This script does not reason about which ones: it types a sentence
into a section, presses every control on the page one at a time, and reads the
sentence back after each press, so a control that loses it fails here by name.

It then checks what was missing rather than broken — a visible save state, a
delete that deletes, a format that survives a reload, a title and a Scripture
reference that can be set at all, and a share sheet that names the field at
fault when the format gate refuses.

## `reflections.mjs` — the list follows its container, not the window

The claim a screenshot cannot make: that the page's layout responds to the
width of its *container* rather than the width of the window. The interesting
measurement holds the viewport at 1280, squeezes only the element the page sits
inside, and reads back the computed `grid-template-columns` — because a
viewport media query would keep answering "three columns" the whole way down,
which is exactly the bug a collapsible sidebar otherwise produces.

It creates its own fixtures and publishes some of them, so a development
database it has been run against will contain published entries. That is where
the rows on the Community page come from; they are real records, not seeded
placeholders.

## `readiness-tour.mjs` — every page, both widths, no assertions

Signs up and walks Auth, Reflect, Reflections, Community, Create, the `/library`
redirect and an unknown route, at 1280 and 390, printing the visible text and
every control's accessible name. It claims almost nothing; it exists so a
readiness review can be written from pictures rather than from source.

## `readiness-use.mjs` — the same pages with something written in them

Empty states are one story and populated ones are another. Sends a first
message, then reports the assistance controls, the card's scroll region and the
Create selects with a real reflection to choose from.

## `readiness-reference.mjs` — the reference field losing keystrokes

Types the Scripture reference character by character immediately after the first
message creates the reflection, which is the only way to see the defect: setting
the value directly is exactly what hides it. Also photographs the disclosure
sheet over the card, and measures the card's scroll region with four full
sections.

It asserts the control case too — the same typing into an existing reflection,
which works — so a fix can be told apart from a change in timing.

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
