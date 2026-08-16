# Product readiness

What is actually finished, page by page, written from driving the running
application in a browser at 1280 and 390 rather than from reading source.
Everything below was observed on **2026-08-16** against the dev server with
Gemini and YouVersion live.

The other documents in this directory describe intent. This one is the
counterweight, and it is deliberately unflattering. Where it disagrees with
them, believe this one and fix the code.

Severities:

- **Blocker** — this must be fixed before a stranger sees the page.
- **Important** — a person will hit it, notice it, and think less of the
  product.
- **Polish** — real, worth doing, not urgent.

Evidence: `scripts/verify/readiness-tour.mjs`, `readiness-use.mjs` and
`readiness-reference.mjs`, whose screenshots are in `scripts/verify/out/`.

---

## Shell — header, navigation, routing

**Verdict: finished, and it looks it. The only shell defect is what happens
when a URL is wrong.**

- **Blocker — an unknown URL renders a blank white page.**
  `web_app/src/app/App.tsx` L13–27 has no `path="*"` route. Visiting
  `/nope` leaves the document body empty: no header, no navigation, no message,
  no way back. Not a 404, not a redirect — nothing. A mistyped or stale link
  ends the session.
- **Polish — two navigation landmarks share one name.**
  `web_app/src/shared/layout/AppShell.tsx` L104 and L149 both render
  `aria-label="Primary"`. A screen-reader user listing landmarks gets "Primary
  navigation" twice with no way to tell the desktop bar from the bottom tabs.
- **Polish — the wordmark letters carry `title` on a non-interactive
  `<span>`** (AppShell L93), which is not reliably exposed to assistive
  technology and never appears on touch.

Working, and worth saying: the skip link (L84) is real and lands on `#main`;
the responsive switch to a bottom tab bar at 390 is clean; `/library` correctly
redirects to `/reflections`.

---

## Auth — sign in and register

**Verdict: the best-looking page in the application, and it opens by telling
the reader something untrue about the product's central idea.**

- **Blocker — the sign-in page still defines C the Context way.**
  `web_app/src/auth/AuthPage.tsx` L10: *"What the passage is saying, and what
  is happening around it."* That is the definition the product spent a whole
  migration abandoning. Content holds **the passage itself** — the verse text,
  its reference and its translation, with explanation optional. The very first
  screen a stranger sees teaches them the wrong model, and every other surface
  then contradicts it.

  Sharpening the point: `api/src/ai/ai.test.ts` L183 asserts that the phrase
  *"what the passage means and what is happening"* has been removed from the AI
  prompt. There is a regression test guarding the model's instructions against
  wording that is still printed on the marketing panel.

- **Important — the submit button never disables.** `AuthPage.tsx` L363–365
  has no pending state, so a double-click on a slow network sends two
  registrations. The second returns 409 and the user sees "email already
  exists" for an account they just successfully created.
- **Important — the error is not connected to the field that caused it.**
  L357–361 renders one `<p role="alert">`; there is no `aria-invalid`, no
  `aria-describedby`, and focus does not move. On a failed sign-in a
  keyboard user is left where they were with an announcement that may not be
  read.
- **Polish — the mode-switch control is a 21px-tall target** ("Create an
  account", measured 115×21), below any reasonable touch minimum, and it is
  the only route to registration.
- **Polish — the decorative "C. H. A. T." wordmark (L292–313) is not
  `aria-hidden`**, so it is announced letter by letter before the form.

Working end to end: register, sign in, sign out, bad credentials producing
*"Invalid email or password."* without disclosing which half was wrong, and
session survival across a restart.

---

## Reflect — the reflection card and the conversation panel

This is the product. It is also where the two worst defects are.

**Verdict: the loop works and the writing is preserved, but the card is
illegible to a newcomer and the reference field destroys typed input.**

- **Blocker — the Scripture-reference field throws away keystrokes, and
  corrupts what it keeps.** Reproduced live by
  `scripts/verify/readiness-reference.mjs`: typing `Psalm 23` immediately after
  the first message left the field reading **`alm 23`**, the stored
  `scriptureReference` **`null`**, and the conversation panel headed *"Reflect
  on alm 23"* — so every subsequent AI request was scoped to a passage that
  does not exist. Typing the same thing into an existing reflection works, so a
  person meets this exactly once: on their first reflection.

  It is not a remount. `referenceDraft` (`web_app/src/chat/ChatPage.tsx` L126)
  is reset to `null` twice while creation is in flight — L565 when
  `POST /conversations` resolves, and L315 inside `openConversation`, which
  still sees `switching === true` because `openedRef` is assigned only after
  its own awaited GET (L303–306). The input falls back to the server's value
  when the draft is null (L1324), so each reset silently discards whatever has
  been typed since. Screenshot: `out/ref-card-full-1280.png`.

- **Blocker — the four sections are visually indistinguishable.** The only
  section heading is `sr-only` (`web_app/src/chat/ChatArtifact.tsx` L116). On
  screen, a reflection with all four sections written is four identical rounded
  boxes with identical button rows beneath them. The letters, the names, "Not
  yet", "Written" and "Your words" were removed to declutter, and the
  decluttering went one step past the point where a person can tell Heart from
  Application. The names survive in `aria-label`, `title` and the placeholder —
  all three of which vanish the moment the field has text in it. See
  `out/ref-card-full-1280.png`: four boxes, no labels.

- **Blocker — the card's scroll region is a third of the card.** At 1280 the
  section scroller (`.artifactBody`, `ChatPage.module.css` L675–681) measures
  **345px visible of 1006px** with four sections written. The frame above it is
  fixed at `calc(100svh - 10.5rem)` (L22–26), and the empty "Bible passage" card
  eats 145px of the 345 before a single word of the reflection is visible. A
  person writing their Testimony cannot see their Content. This is the "one page
  you can hold in your head" that the whole format is built around, delivered
  through a letterbox.

- **Important — the reflection is named after a truncated sentence.** The
  first message becomes the title: the two reflections created during this
  review are stored as *"Sitting with Psalm 23 tonight."* and *"Reading Romans
  8 today and wondering how to hold on to…"*. This is precisely the defect
  `AI_PROVIDER.md` describes the title heuristic as existing to prevent —
  *"a sentence someone interrupted rather than a name"* — and it is shipped as
  the default for every reflection. "Suggest title" fixes it, but only if the
  author notices and presses it.

- **Important — the assistance row is the busiest thing on the card, and it is
  bigger than reported.** Each section carries **three** labelled buttons —
  *Discuss in chat*, *Ask me questions*, *Improve wording*
  (`web_app/src/chat/FieldAssist.tsx` L88–126, `ChatArtifact.tsx` L177) —
  so the full form is **twelve labelled buttons**, not eight, plus a save
  toggle, two focusable marks and a counter per section. Measured on a written
  reflection: 38 visible buttons on the page.

- **Important — the first message raises a modal dialog.** With a provider
  configured, the first send opens *"Before you use AI assistance"*
  (`aria-modal="true"`, full-page scrim, measured 544×305 at 361,298) over the
  card, before the reply arrives. Consent-wise it is right; as a first
  impression it interrupts the one moment the product is trying to make feel
  effortless. It also breaks `scripts/verify/reflect.mjs`, which targets
  `AI_PROVIDER=fake`: against a live provider that script fails one assertion
  and then aborts on `ElementClickInterceptedError`, so every check after that
  point silently never runs. Screenshot:
  `out/ref-disclosure-over-card.png`.

- **Important — Enter does not send.** The composer requires the send button;
  Enter inserts a newline (verified: the textarea still held the message).
  Every chat interface a person has used sends on Enter. There is no hint that
  this one does not.

- **Important — "Draft Content" was never renamed.** `web_app/src/chat/chips.ts`
  L78 and L93. `docs/examples/REAL_CHAT_SAMPLES.md` names this framing as the
  thing that "asks for a commentary nobody writes"; the fix reached the prompt
  and the section copy but not the button. *"Add passage"* would say what it
  does.

- **Important — the two reference fields can disagree.** The header field and
  the passage card's own field are separate state:
  `web_app/src/bible/ScripturePassage.tsx` L105 initialises from
  `initialReference` **once** and ignores the prop afterwards, so editing one
  leaves the other stale.

- **Polish — the passage card occupies its full height while empty.** "Bible
  passage / Choose a passage" plus two lines of explanation is 145px of the
  345px a person has to write in, whether or not they want a passage.
- **Polish — the left rail abbreviates reflections to two letters.** "SI",
  "RO" (see `out/ref-card-full-1280.png`). Unreadable as navigation.
- **Polish — accessibility inside the panel.** The message list
  (`ChatHelper.tsx` L272) scrolls but has no `tabIndex` and no accessible name,
  so keyboard-only users cannot scroll it. The narrow-screen drawers
  (`ChatPage.tsx` L1596–1640) are `role="dialog"` without `aria-modal`, without
  a focus trap, and without focus restoration. The traffic light and provenance
  marks (`FieldMarks.tsx` L433, L462) put `tabIndex={0}` on non-interactive
  `role="img"` spans, adding eight extra tab stops. The character counter
  (`ChatArtifact.tsx` L161–172) is `aria-live="polite"` and announces on every
  keystroke.
- **Polish — the translation catalog is fetched twice per page load.** Every
  Reflect load produces two `bible_request … "operation":"translations"` log
  lines milliseconds apart. Cached, so it is cheap; still wrong.

Working end to end, and genuinely good: registration through to a written,
saved, re-openable reflection; live Gemini replies that stay on the passage and
decline to author Heart or Testimony; drafts that arrive labelled and go
nowhere until the author places them; per-section provenance; length counters
against the raised limits; passage lookup across 47 translations; delete;
publish gating.

---

## Reflections — the personal list

**Verdict: the most finished page in the application. Ship-shaped.**

- **Important — the first-run empty state offers nothing to look at.** "Your
  reflections will appear here" with a single button. A first-time user has no
  idea what a finished C.H.A.T. looks like, which is the one thing that would
  make them write one.
- **Polish — a single reflection sits alone in a three-column grid**, leaving
  two thirds of a 1280 screen empty. See `out/use-reflections-full-1280.png`.
- **Polish — the card leads with a negative in capitals.** "NO SCRIPTURE
  REFERENCE" is the loudest text on a new card. The absence of a reference is
  not the most interesting thing about a reflection.
- **Polish — the card's excerpt repeats its own title** verbatim when the
  title was derived from the first message, which is every new reflection.
- **Polish — the sort control is a bare native `<select>`** among otherwise
  fully styled pills, and it has no visible label.

Working end to end: search, the four filters, both sorts, the density toggle,
the count, and opening a result back into the correct reflection.

---

## Community

**Verdict: not shippable. It is a database listing with a heading over it.**

- **Blocker — nothing is clickable.**
  `web_app/src/community/CommunityPage.tsx` L68–75 renders each entry as two
  plain `<span>`s. There is no link, no button, no detail route. A person can
  see that a published C.H.A.T. exists and can do absolutely nothing with it,
  including read it. The page's entire promise is discovery, and discovery is
  not implemented.
- **Blocker — no author is named.** Published entries show a title and a
  reference. Whose reflection it is — the single thing that makes a community
  feed mean anything — is not shown, and `GET /api/community` does not return
  it.
- **Important — the rows are leftover test fixtures.** Five identical *"Be
  still and know / Psalm 46:10"* entries (`out/tour-community-1280.png`), left
  in the development database by `scripts/verify/reflections.mjs`. They are
  real records rather than hard-coded placeholders, so the page is behaving
  correctly — but anyone shown this page will read it as fake seed data, and
  they will be close enough to right.
- **Important — the error state is invisible to assistive technology.** L66 is
  a bare `<p>` with no `role="alert"`.
- **Polish — the page borrows `library/LibraryPage.module.css`** (L4), a
  stylesheet belonging to a component nothing routes to.

The privacy boundary itself is correct and enforced server-side: only records
with `publicationState === 'published'` are returned. The backend of this
feature is done; the page is not.

---

## Create

**Verdict: not shippable, and it is reachable from the profile menu and from a
button on the reflection card. This is the page that would cause the most
embarrassment, because a stranger can find it without being shown it.**

- **Blocker — it looks like a form someone left half-built.** Three unstyled
  native `<select>`s and two default browser buttons on an otherwise
  carefully designed application. Nothing else in the product looks remotely
  like this. Screenshot: `out/tour-create-1280.png`.
- **Blocker — the options are raw enum values.** `quote-focus`,
  `verse-reflection`, `chat-stacked`, `chat-two-column`, `cream-botanical`,
  `modern-minimal`, `dark-worship`, `journal-paper`
  (`web_app/src/create/CreatePage.tsx` L189, L196). These are identifiers from
  `packages/shared/src/index.ts`, printed at the user. There is no preview of
  any style, so the names are also the only information available.
- **Blocker — "Create visual" hands off to the wrong reflection.**
  `ChatPage.tsx` L1583 navigates to `/create?c={id}`; `CreatePage.tsx` L114
  ignores the query parameter entirely and preselects `items[0]`. Press it on
  any reflection but the most recent and you silently get a different one.
- **Blocker — the three selects have no accessible name at all.**
  `CreatePage.tsx` L182, L189, L196 — no `<label>`, no `aria-label`. Confirmed
  by walking the page: one nameless control at 1280 with no reflections, three
  once populated.
- **Important — the layout and style names promise a system that does not
  exist.** `ARCHITECTURE.md` describes layout × style as independent
  dimensions with a deterministic renderer. What is implemented is a canvas
  draw of the title and a "Text rendered by application" line. Choosing
  `dark-worship` and choosing `cream-botanical` do not produce visibly
  different work.
- **Important — the error state is a bare `<p>`** (L210), with no role.

---

## Cross-cutting

- **Dead code presented as structure.** `web_app/src/library/LibraryPage.tsx`
  is imported by nothing; `web_app/src/shared/ui/PlaceholderPage.tsx` is
  imported by nothing. Both read as live product surface to anyone opening the
  tree.
- **A stale comment in a file being edited.** `packages/shared/src/formats.ts`
  L149–158 still explains the calibration in terms of "1,200 characters" and
  "the 2,400 hard maximum" after the limits were raised to 2000/3200 in the
  same file. Left alone here because that file has uncommitted changes in the
  working tree; it should be corrected with them.

---

## What would have to be true before showing this to anyone outside the project

Not a wish list. The minimum for the application to stop making false claims
about itself.

1. **Nothing a person types is destroyed.** The Scripture-reference field is
   the one confirmed data-loss defect, and it fires on the first reflection —
   the only one a new user will ever create.
2. **Every page a stranger can reach is either finished or unreachable.**
   Community and Create are not close to finished. Either build them or take
   them out of the navigation, the profile menu and the reflection card. A
   locked door is honest; an empty room with a sign on it is not.
3. **The card can be read.** Four unlabelled identical boxes behind a 345px
   window is not a reflection people will want to return to, and returning is
   the entire product thesis.
4. **The first screen tells the truth about C.** One line in
   `AuthPage.tsx`.
5. **A wrong URL does not end the session.** One route.

Until 1, 2 and 4 are done, this should be demonstrated by someone driving, on
Reflect and Reflections only, and not handed over.

### The three to fix first

1. `ChatPage.tsx` — the reference field losing keystrokes. It is data loss, it
   poisons AI scoping, and it happens on the first reflection.
2. `CommunityPage.tsx` and `CreatePage.tsx` — remove them from the navigation,
   the profile menu and the "Create visual" button until they are real.
3. `AuthPage.tsx` L10 — the Context-era definition of Content on the first
   screen. A one-line fix guarding the product's central idea.
