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

### Per-card overflow

The `⋯` control sits at the end of the status strip with a **reserved
44×44px hit area** and an accessible name naming the reflection. It opens
the **reflection action sheet** — never a popover — carrying Open, Edit,
Share and Delete at 48px rows.

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

**Default state:** title `Reflections`, then a **Filter** trigger, then an
overflow `⋮`.

**Search** expands in place, replacing the bar's contents with the field.
Required behaviour:

- The field has a visible **clear** button while it holds text
- **Back closes search and restores the normal app bar**, and does not
  leave the screen
- The query is preserved appropriately: closing search clears the applied
  query and restores the unfiltered list; the URL parameter stays the
  source of truth so a shared or restored URL still reproduces the view
- Focus moves into the field on open and returns to the search trigger on
  close
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

**Pagination:** fixed page size of **20** on mobile. Existing pagination
behaviour is preserved exactly, `?page=` keeps working, and the pager
stays at the end of the timeline. **No infinite scrolling in this
milestone.**

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
`env(safe-area-inset-bottom)`. It must not cover the last card's actions
— the timeline reserves bottom padding for it.

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
| Any control | sans | **≥16px** |

### Surface and elevation

Page `--surface-2`; card `--surface`; sheet `--surface` over a scrim.
Cards use `--radius-lg` and a hairline `--line`. One elevation only — no
stacked shadows on mobile.

### Metadata alignment

Every card's metadata occupies exactly two rows with fixed roles:
identity left / time right, then status left / privacy right. Baselines
align down the whole timeline so the eye scans a column.

### Structural rules carried from the width fix

Every grid container declares `grid-template-columns: minmax(0, 1fr)`.
Every flex toolbar declares `flex-wrap`. Targets ≥44px, 48px for the FAB.
16px edges, safe-area insets, `dvh`-class units, inputs ≥16px.

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
- No control under 44×44px; no control within 16px of an edge; no input
  under 16px
- The per-card overflow has a reserved 44×44px hit area and opens the
  action sheet
- The Filter trigger is visible in the app bar and shows an active count
- Search expands in place; no second row appears in any state
- Back closes search and restores the app bar
- Every reflection appears exactly once; nothing in In Progress repeats
  under Today
- Group order is In Progress → Today → Yesterday → earlier groups, each
  only when non-empty
- Page size is 20; `?page=` behaviour is unchanged; no infinite scroll
- The card preview never repeats the reference shown in its metadata row
- `N of 4` (or `Condensed C.H.A.T.`) is visible on every card
- Verified in both light and dark themes

**Evidence:** `scripts/verify/narrowest.mjs` reports zero offenders at
320/360/390/430; `scripts/verify/touch-targets.mjs` reports zero
violations; before/after screenshots at 390×844 and 360×800.

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
