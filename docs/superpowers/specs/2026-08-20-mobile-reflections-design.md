# Mobile Reflections — Design Specification

- **Date:** 2026-08-20
- **Status:** Approved for planning. Not implemented.
- **Scope:** The populated `/reflections` screen at ≤640px. Nothing else.

## Non-goals

Desktop Reflections, the editor, Community, the reader, and every other
screen are untouched. Reflection storage, guest and registered behaviour,
Full versus Short rules, AI guardrails, sharing permissions and existing
URL behaviour are all unchanged. No feature or stored preference is
deleted — controls are relocated, not removed from the product.

---

## 1. The measured problem

At 390×844 with two reflections present:

| | Now |
|---|---|
| Chrome above the first card | **403px** |
| Usable height (viewport − app bar − bottom nav) | 687px |
| Of that, page furniture | 336px |
| Complete cards visible | **1.6** |
| View controls above the fold | **5**, in 3 stacked rows |

Five controls — Filters, Sort, Cards/List, Density, Page size — cannot
fit one row at 390px, so they wrap into three.

There is also a content defect feeding the height. `excerptFrom`
(`ReflectionsPage.tsx:208`) walks the sections in C → H → A → T order and
takes the first non-empty one, which is almost always **Content** — the
pasted Scripture. The card therefore prints `JOHN 3:16` as its reference
and then reprints *"John 3:16 (NIV) — Why are you sleeping?…"* three
lines below. Three of the card's ten lines are duplication.

---

## 2. Information hierarchy

**Tier 1 — always visible**
1. The reflections: title, Scripture reference, when
2. Where you are, and the way out (bottom navigation)
3. The way to begin a new one

**Tier 2 — one press away**
4. Search (expands in place from the app bar)
5. Filters, with sort inside the same sheet
6. Per-card actions

**Tier 3 — relocated, not deleted**
7. Layout, density, page size — moved to a view/settings sheet
8. Page eyebrow and lede — already hidden ≤640px

### Within a card

The author scans for **what they wrote**, not the passage: several
reflections may share a passage, but only one has that title. So the
title leads, and the reference becomes metadata.

1. **Title** — the scan target
2. **Scripture reference + date** — one aligned metadata row
3. **Up to two preview lines of the author's own writing**
4. **C.H.A.T. completeness + privacy** — status strip

---

## 3. Grouping model

Groups render in this order, each only when non-empty:

1. **In Progress**
2. **Today**
3. **Yesterday**
4. **Earlier date groups** (This week, then month labels, then Older)

**In Progress is exclusive.** A reflection appears exactly once across
the whole screen and must never repeat under Today.

The existing implementation is already exclusive — `ReflectionsPage.tsx:837`
builds a `held` set from the unfinished items and filters `rest` by it.
**That exclusivity must be preserved.** What changes is the label set and
order: `Recent` / `Earlier` become true date groups, and `Yesterday` is
added, which the current `groupLabel` helper does not emit.

**In Progress membership** keeps its current definition: a Full-format
reflection with at least one section written and fewer than four
(`0 < written < 4`). Short/Condensed reflections are excluded. The
existing cap of two items stays; a third unfinished reflection simply
falls into its date group, which remains exclusive and correct.

### Day boundaries and label formatting

**`Today` and `Yesterday` are the viewer's local calendar days, not UTC
offsets.** A reflection belongs to `Today` when its `updatedAt` falls on
the same local calendar date as now — computed from local year, month and
day, never by subtracting 24-hour spans from a UTC instant. A reflection
written at 23:30 local time is still `Today` at 23:59 and becomes
`Yesterday` after local midnight, whatever the UTC date is.

**Date labels are formatted through the existing locale behaviour.** The
codebase already formats dates with `Intl.DateTimeFormat` using the
viewer's locale (`ReflectionCard.tsx`); group labels use the same
mechanism. No hardcoded English month names, no hand-built date strings,
and the relative labels `In Progress`, `Today` and `Yesterday` remain
translatable strings rather than formatting logic.

When a search or filter is narrowing the list, grouping collapses to a
single `Results` group, as it does today.

---

## 4. Card specification

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁┃ 4px C/H/A/T strip
┃                                    ┃
┃ The comfort and home of God's      ┃ title, serif 600, ≤2 lines
┃ love                               ┃
┃ John 3:16                  20 Aug  ┃ metadata row
┃ He kept me awake for this one,     ┃ preview, ≤2 lines,
┃ and I am still thinking about it.  ┃ author's own words
┃ ─────────────────────────────────  ┃
┃ C H A T  4 of 4    ◆ Private   ⋯   ┃ status strip + overflow
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

**Height is a range, never a fixed value: approximately 175–190px.** The
card must grow safely for a two-line title and must not clip or overlap.
No `height` or rigid `max-height` that can crop content — bound the
preview by `line-clamp` on the preview element alone.

- Title: `--font-serif` 600, `--text-md`, up to 2 lines
- Metadata row: reference left, date right, sans 13px `--muted`
- Preview: `--font-serif` 400, `--text-base`, `--ink-soft`, **up to 2 lines**
- Status strip: C.H.A.T. progress left, privacy badge, then overflow
- Card padding 16px; gap between cards 8px; between groups 24px

### Primary interaction

**Tapping the card opens the dedicated reflection viewer**
(`/reflections/:id`). Reading is the default; **Edit remains a separate
action**, reached from the viewer or from the action sheet.

- The primary navigation is a **semantic link**, not a click handler on a
  container — so it keyboard-focuses, announces as a link, and supports
  open-in-new-tab and long-press by default.
- **Interactive elements must not be nested.** The overflow control is a
  button and the title is a link; neither may contain the other. The
  card's clickable area is realised by a stretched link (an absolutely
  positioned pseudo-element over the card) with the overflow raised above
  it, rather than by wrapping the card in an anchor.
- **Tapping the overflow must not activate card navigation.** The
  overflow sits above the stretched link in stacking order and stops
  propagation, so a press on it opens the sheet and nothing else.

### Per-card overflow

The `⋯` control sits at the end of the status strip with a **reserved
44×44px hit area** and an accessible name naming the reflection. It opens
the **reflection action sheet** — never a popover.

#### Action sheet requirements

- **Only authorized actions are shown.** The sheet is built from what the
  viewer may actually do with that reflection, not from a fixed list with
  disabled rows.
- **Anonymous-user sharing restrictions are preserved exactly.** Sharing
  appears only where the existing permission rules already allow it; this
  screen introduces no new sharing capability.
- **Delete requires confirmation and is visually separated** from the
  non-destructive actions — set apart in its own group and styled as
  destructive.
- **Failed actions are recoverable**: a failure keeps the person where
  they are, explains what happened, and offers a retry rather than
  closing silently or leaving the list in a false state.
- **Closing restores focus to the originating overflow control** — the
  specific card's `⋯`, not the top of the page.
- Rows are 48px; the sheet traps focus, closes on Escape and on scrim
  press.

---

## 5. Preview derivation (presentation only)

The displayed preview changes source. **Stored content is not altered in
any way** — this is a read-time selection, and nothing is written back.

**Full C.H.A.T. — deterministic fallback order:**

1. Heart
2. Application
3. Testimony
4. **Content, only as fallback**

**Short / Condensed:** use the `reflection` field
(`CONDENSED_SECTION_TYPES.REFLECTION`). The `verse` field is not used for
preview.

**When Content is the fallback**, strip any leading Bible
reference/translation prefix that the card's metadata row already shows,
so the card never prints the reference twice. Stripping is display-only
and must be conservative: remove a recognised leading reference and
translation marker, and if the text does not match that shape, show it
unchanged.

If every candidate is empty, show the existing empty-preview sentence.

---

## 6. App bar and search

A single 56px bar. **No second search row is ever introduced.**

### Default state

The default bar contains exactly four things, in this order:

```
┌──────────────────────────────────────┐
│ Reflections        ⌕   ⛛²   ⋮        │  56px, one row
└──────────────────────────────────────┘
   title          search filter  page
                        (count)  overflow
```

1. **`Reflections` title**
2. **Search trigger**
3. **Filter trigger**, with an optional active-count badge
4. **Page overflow trigger**

At narrow widths the three triggers are **accessible icon buttons** —
icon-only presentation, each with a real accessible name, never an
unlabelled glyph.

**The app bar is one row and must not wrap.** If the title cannot fit
beside the triggers it truncates with an ellipsis; the triggers never
move to a second line and never shrink below 44×44px.

### Search — expansion and URL behaviour

Search expands in place, replacing the bar's contents with the field.
Behaviour is deterministic in every direction:

- **A URL carrying the search parameter opens Search already active**,
  with the field populated from that parameter and the list filtered
- **Clear** removes the query *and* the URL parameter, but **leaves
  Search open** with focus still in the field
- **Back closes Search**, removes the query parameter, and restores the
  unfiltered list
- **Browser Back stays predictable.** Opening and closing Search must not
  push a history entry per keystroke or per toggle, and Back must never
  become trapped alternating Search open and closed. Query updates
  replace the current history entry rather than pushing new ones; only a
  genuine navigation pushes.
- **Focus enters the field on open and returns to the Search trigger on
  close**
- The field has a visible **clear** button while it holds text
- Software-keyboard behaviour is tested: the fixed bottom navigation
  hides while the keyboard is open (the existing `useSoftKeyboard`
  mechanism), and the field is never covered

---

## 7. Filters — visible, not hidden

**Filters must not live behind an ambiguous overflow menu.**

- A **visible 44px Filter trigger in the app bar**
- An **active-filter count badge** on that trigger when any filter is on
- Pressing it opens the **Filters bottom sheet**
- **Sort lives inside the Filters sheet**
- The sheet carries Reset, and an explicit applied count

A separate overflow `⋮` may remain in the app bar **only** for genuine
page-level secondary actions — including the view/settings sheet that
holds the relocated layout, density and page-size preferences.

---

## 8. Toolbar controls — relocated, not deleted

Removed from the **primary mobile toolbar**:

- Cards / List switcher
- Density (Compact / Preview / Full C.H.A.T.)
- Page size

Mobile presents a **canonical Auto card presentation**. These are
preferences, not features to delete: existing stored preferences and the
desktop controls are untouched, and secondary view selection remains
available in a view/settings sheet reached from the page overflow.

**Pagination:** **mobile uses a page size of 20 at runtime.**

- The 20 is a **runtime presentation value, not a write**. It does not
  overwrite the stored desktop page-size preference.
- **Switching viewport modes does not mutate that preference.** Narrowing
  a window to mobile and back leaves whatever the person chose on desktop
  exactly as it was.
- **Invalid or out-of-range page numbers normalize safely.** A `?page=`
  that is non-numeric, zero, negative, or beyond the last page resolves
  to the nearest valid page rather than rendering an empty list or
  throwing.
- Existing pagination behaviour is otherwise preserved exactly, `?page=`
  keeps working, and the pager stays at the end of the timeline.
- **No infinite scrolling in this milestone.**

---

## 9. The FAB — investigation and verdict

Amendment 5 required the current semantics of the `Reflect`
bottom-navigation destination to be inspected and documented before any
FAB is specified.

### What was found

| Action | Target | Behaviour |
|---|---|---|
| `Reflect` (bottom nav) | `/` | `AppShell.tsx:14`. Plain navigation. Never calls `startNew()`, never creates a reflection, never clears the editor. |
| `New reflection` (header) | `/?new=1` | `AppShell.tsx:110`. The `?new=1` effect (`ChatPage.tsx:458`) invokes `startNew()`. |

`startNew()` (`ChatPage.tsx:610`) first awaits `leaveSafely()`, which
flushes the pending debounced save and calls `saveAll()`; **it aborts if
the save fails**, then clears editor state and focuses the composer.

The mount-time effect (`ChatPage.tsx:399`) opens a conversation **only**
when `?c=` is present, so `/` alone opens nothing and creates nothing.

### Verdict: **the FAB is approved**, mobile-only

`Reflect` does **not** always start a new reflection — it never invokes
`startNew`, never creates a record, and never discards work. It returns
to the editor. `New reflection` is a distinct, explicit action that saves
first and then clears. The actions are distinct, so the extended
**New reflection** FAB is approved on mobile, and it replaces the
app-bar `+` on mobile only. Desktop keeps the header action unchanged.

**Unsaved content is already protected.** `startNew` cannot discard work:
it saves first and aborts on failure. No new confirmation dialog is
required, and this behaviour must not be weakened.

**Documented nuance, carried as an open question.** Because `ChatPage`
unmounts when the person is on `/reflections`, arriving via `Reflect`
lands on a blank composer rather than the last reflection — so from this
screen the two actions can *look* alike even though they differ. Making
`Reflect` genuinely restore the last open reflection would be a
behaviour change to another screen and is **out of scope here**; it is
recorded in §13.

**FAB specification:** extended, with a visible text label, 48px tall,
16px from the right edge, 16px above the bottom navigation, respecting
`env(safe-area-inset-bottom)`.

**Clearance is a hard requirement.** Every card action, the final card,
and the pager must be scrollable into a position clear of **both** the
FAB and the bottom navigation. The timeline reserves bottom padding equal
to the FAB's height plus the navigation's height plus the safe-area
inset, so the end of the list can always be scrolled above them.

**The FAB must never make an action unreachable.** If any control cannot
be brought clear by scrolling, the reserved padding is wrong and must be
corrected — the FAB does not get to win that conflict.

---

## 10. C.H.A.T. design system

Built from the tokens already in `web_app/src/styles/tokens.css`. No
external catalog style is adopted. A `--design-system` search proposed a
"Scroll-Triggered Storytelling" landing pattern and a handwriting font
pairing; both were **rejected** as unrelated to a populated timeline.

### The spine: four section colours

The one thing no other product has. These are the **only** chromatic
accents on this screen; everything else is parchment, ink and the green
accent.

| Section | Light | Dark |
|---|---|---|
| Content | `#3d5a80` | `#8fb0d9` |
| Heart | `#9c4a5c` | `#d98fa2` |
| Application | `#8a5a2b` | `#d9a066` |
| Testimony | `#3f5d4e` | `#8fc0a4` |

### Type: the rule that makes it C.H.A.T.

**Serif for what a person wrote; sans for what the application says.**
Titles, Scripture references and previews use `--font-serif`. Every
control, label and group heading uses `--font-sans`. The screen reads as
writing surrounded by quiet furniture.

| Role | Family | Size |
|---|---|---|
| Card title | serif 600 | `--text-md` |
| Preview | serif 400, `--ink-soft` | `--text-base` |
| Metadata, group label | sans 600, `--muted` | 13px, `0.04em`, uppercase |

**Control type sizes** are role-specific rather than one blanket minimum:

- **Inputs: minimum 16px.** This one is not a preference — anything
  smaller makes iOS zoom the page on focus and leave it zoomed.
- **Primary button labels: generally 15–16px.**
- **Compact control and navigation labels may be smaller** where they
  remain readable — the bottom navigation's labels and the card's
  metadata are legitimate at 13px.
- **Every interactive hit target remains at least 44×44px**, whatever its
  label size. Target size and type size are independent requirements.

### Surface and elevation

Page `--surface-2`; card `--surface`; sheet `--surface` over a scrim.
Cards use `--radius-lg` and a hairline `--line`. One elevation only — no
stacked shadows on mobile.

### Metadata alignment

Every card's metadata occupies exactly two rows with fixed roles:
identity left / time right, then status left / privacy right. Baselines
align down the whole timeline so the eye scans a column.

### Structural rules carried from the width fix

Stated as the specific rules that prevent the overflow, rather than as
blanket mandates — a universal "every grid is one `minmax` column" would
forbid legitimate multi-column and auto-sized layouts, and a universal
"every toolbar wraps" would break the app bar, which must not wrap.

- **`minmax(0, 1fr)` for grid tracks that contain shrinkable user text**,
  where a track would otherwise be sized by its content. This is what
  fixed the 408px shell and the 560px page.
- **`min-width: 0` on flex and grid children containing user text**, so a
  long title or reference can shrink instead of widening its parent.
- **Wrapping only where the design explicitly permits it.** The filter
  sheet's control rows wrap; the card's status strip wraps.
- **No wrapping in the mobile app bar.** It is one row in every state.
- Targets ≥44×44px, 48px for the FAB; safe-area insets honoured;
  `dvh`-class viewport units; inputs ≥16px.

---

## 11. Accessibility

**Completion is never communicated by colour alone.** Verified in the
current code and required to remain:

- `SectionMarks` is decorative — `aria-hidden="true"`
  (`ReflectionCard.tsx`), so the 4px strip carries no unique meaning
- `ChatProgress` renders **visible text** `N of 4` alongside
  `role="img"` with `aria-label="C.H.A.T. progress: N of 4 sections
  written"`
- Short/Condensed renders the visible text `Condensed C.H.A.T.`

**The textual `2 of 4` / completion status must remain visible on the
mobile card.** The strip is approved as decoration only.

Also required: WCAG AA contrast in both themes (`--line` is 3.23:1 in
dark after the earlier fix); every icon-only control has an accessible
name; the overflow's name identifies its reflection; sheets trap focus,
close on Escape and on scrim press, and restore focus to their trigger;
`prefers-reduced-motion` is honoured for sheet and search transitions.

---

## 12. Acceptance criteria

**Composition (390×844, populated):**

- **At least two complete, readable cards plus a meaningful portion of
  the third are visible without scrolling.**
- This is achieved by removing chrome — **never** by shrinking type,
  touch targets or spacing. Card height stays in the ~175–190px range and
  type and targets stay at their specified sizes. No card-count target
  beyond the above is used as a criterion.

**Structure:**

- No horizontal overflow at 320, 360, 390 and 430
- No control under 44×44px; no input under 16px
- **Interactive content respects the 16px page-content boundary or the
  applicable safe-area inset. Full-width structural components may extend
  to viewport edges.** The bottom navigation and the app bar are such
  components: they span the viewport by design, and their *cells* are the
  targets that must respect the boundary.
- **Adjacent touch targets must not have overlapping hit areas and should
  normally maintain at least 8px of visual or functional separation.**
  Deliberately adjoining cells of one segmented component — the bottom
  navigation, a segmented control — satisfy this functionally by sharing
  a crisp edge between two large targets; overlapping hit areas never
  satisfy it.
- The per-card overflow has a reserved 44×44px hit area, opens the action
  sheet, and does not activate card navigation
- The card's primary navigation is a semantic link, with no interactive
  element nested inside another
- The app bar carries title, Search, Filter and overflow on **one row**
  and does not wrap at any supported width
- The Filter trigger is visible in the app bar and shows an active count
- Search expands in place; no second row appears in any state
- A URL with the search parameter opens Search active and populated;
  Clear leaves Search open; Back closes Search, drops the parameter and
  restores the unfiltered list; Back never traps
- `Today`/`Yesterday` follow the viewer's local calendar day, and labels
  are locale-formatted
- Every reflection appears exactly once; nothing in In Progress repeats
  under Today
- Group order is In Progress → Today → Yesterday → earlier groups, each
  only when non-empty
- Mobile renders 20 per page without mutating the stored desktop
  preference; invalid `?page=` values normalize; no infinite scroll
- Every card action, the final card and the pager can be scrolled clear
  of both the FAB and the bottom navigation
- The card preview never repeats the reference shown in its metadata row
- `N of 4` (or `Condensed C.H.A.T.`) is visible on every card
- Verified in both light and dark themes

**Evidence:** `scripts/verify/narrowest.mjs` reports zero offenders at
320/360/390/430; `scripts/verify/touch-targets.mjs` reports zero
violations; before/after screenshots at 390×844 and 360×800.

**The automated edge check must be updated to match.** The harness
currently flags any control whose box falls within 16px of the viewport
edge, exempting only full-width segmented rows. It must instead measure
against the **page-content boundary**: a control inside page content is
checked against the 16px inset, while a full-width structural component
is exempt as a component and its cells are checked within it. The
adjacency check keeps its existing exemption for deliberately adjoining
segmented cells, and gains an assertion that no two hit areas overlap.

---

## 13. Open questions, deliberately deferred

1. **`Reflect` does not restore the last open reflection** when arriving
   from another route (§9). Changing it touches the editor screen and is
   out of this milestone's scope.
2. **Navigating to `/` from `/?c=…` drops `c` from the URL** while the
   editor keeps showing that reflection — a pre-existing inconsistency,
   observed during this investigation, not introduced by it.
3. **The In Progress cap of two** is retained from current behaviour. It
   is exclusive and correct either way; whether two is the right number
   is a product question, not a layout one.
