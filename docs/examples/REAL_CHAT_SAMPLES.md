# Real C.H.A.T. reflections — observed usage

Transcribed from reflections people actually wrote and shared as images. This is
the evidence behind the Content-section change, and it should be read before
anyone redesigns that section again.

---

## The finding

**In real use, the C section holds the Bible verse itself.**

Not a commentary on the passage. Not background. The verse text, usually with its
reference and translation, and *sometimes* an explanation after it — but often
nothing else at all.

That is why "Context" was wrong as a name and why the app's model was wrong as
a shape. The application used to treat the passage as a separate
`scriptureReference` field and to expect the C section to be prose *about* the
passage. Every sample below does the opposite.

The name was changed — the section is Content, and stored writing was carried
across by a migration — and the copy, prompts and chip labels were rewritten
around it. The separate `scriptureReference` field still exists, as the
reference a lookup and an AI request are scoped to; what changed is that it no
longer competes with C for the passage.

## What the samples show

**Every single one puts Scripture in C.** Across roughly thirty reflections there
is no exception.

**Most are verse text plus reference plus translation, and nothing more:**

> **Content:** 2 Chronicles 13:18 NIV
> "The Israelites were subdued on that occasion, and the people of Judah were
> victorious because they relied on the Lord, the God of their ancestors."

**A minority add explanation after the verse** — but the verse still comes first:

> **content**
> "They rejected his decrees and the covenant he had made with their ancestors…"
> 2 Kings 17:15 NIV

with the historical explanation appearing under **heart**, not under content.

**Reference placement varies** — before the quote, after it, or both:

| Pattern | Example |
| --- | --- |
| Reference first, then text | `Content: Habakkuk 3:17-19 NLT` then the quote |
| Text first, then reference | quote, then `Psalms 105:1-3 NIV` |
| Reference in a heading above C | `Jeremiah 15:19-21 NIV` then `Content:` |
| Reference plus a bible.com link | `https://bible.com/bible/111/psa.105.1-3.NIV` |

**Translations in use:** NIV (most common), NLT, NASB1995, GNT, ESV, TPT.

**Labels vary in case and form:** `Content:` · `CONTENT` · `content` · `C-` ·
`C` alone in a lettered card. Several omit the label entirely and simply open
with the verse.

**Some reflections skip C entirely** and open with the quote, then `heart:` —
the verse *is* the content, so the label is redundant to the author.

---

## Representative transcriptions

### 1 — Reference first, no explanation

> **Content:** Habakkuk 3:17-19 NLT
> "Even though the fig trees have no blossoms, and there are no grapes on the
> vines; even though the olive crop fails, and the fields lie empty and barren;
> even though the flocks die in the fields, and the cattle barns are empty, yet I
> will rejoice in the Lord! I will be joyful in the God of my salvation! The
> Sovereign Lord is my strength! He makes me as surefooted as a deer, able to
> tread upon the heights."
>
> **Heart:** These words of prophet Habakkuk reminds me not to be dependent on
> the circumstances or blessings in giving my all to the Lord…

### 2 — Verse only, reference after

> **CONTENT:**
> *"The Israelites were subdued on that occasion, and the people of Judah were
> victorious because they relied on the Lord, the God of their ancestors."*
> *2 Chronicles 13:18 NIV*

### 3 — Letter labels, no word at all

> **C-**
> *"But with you there is forgiveness, so that we can, with reverence, serve
> you."* Psalm 130:4 NIV
> **H-** This verse reminded me to serve the Lord with reverence…
> **A-** I will serve the Lord with a sincere & willing heart…
> **T-** Thank You Lord that I get to serve You…

### 4 — Verse with a link

> "Give praise to the Lord, proclaim his name; make known among the nations what
> he has done…"
> Psalms 105:1-3 NIV
> https://bible.com/bible/111/psa.105.1-3.NIV
>
> **Heart:** This verses is about living openly with God, not keeping it inside…

### 5 — Longer passage, verse only

> **Content:**
> "As for other matters, brothers and sisters, we instructed you how to live in
> order to please God… It is God's will that you should be sanctified…"
> — 1 Thessalonians 4:1-6 NIV

### 6 — Content carries a whole narrative passage

> **content**
> "He then said to the whole assembly of Israel, 'If it seems good to you and if
> it is the will of the Lord our God, let us send word far and wide to the rest
> of our people throughout the territories of Israel…'" 1 Chronicles 13:2
>
> **heart** the ark of God represented God's presence among His people. during
> saul's reign, it was neglected…

---

## What this means for the application

1. **The C section must accept Scripture as its primary content**, with optional
   explanation after it — not the other way round.
2. **The reference, translation and verse text belong together in C**, however
   the author chooses to arrange them. The separate `scriptureReference` field
   should feed C rather than compete with it.
3. **An author who pastes only the verse into C has written a complete Content
   section.** Nothing should tell them it is incomplete or prompt them to add
   commentary.
4. **The YouVersion passage should land in C**, which is what makes the connector
   worth having: choose a passage, and Content is populated with the text,
   reference and translation, ready for the author to add explanation if they
   want to.
5. **Explanation, when present, mostly appears under Heart** in real use — the
   authors are not looking for a commentary field.
6. **Attribution matters** — translations are named in almost every sample, and
   one carries a bible.com link. That aligns with the licensing requirement
   rather than fighting it.

## What was previously assumed, and was wrong

The prompts, chip labels and empty-state copy described C as *"what does the
passage mean?"* and offered *"Explain the background"* and *"Draft Context"*.
That framing asked for a commentary nobody writes. The section is where the
passage goes.

**What changed.** The section prompt is now *"The passage itself. Add an
explanation only if you want to."* The chip is *"Draft Content"*, and the
server-side note behind it forbids quoting verse text from memory and asks for
the passage as an author would write it. `api/src/ai/ai.test.ts` fails if the
old commentary phrasing returns to the prompt.

**What did not.** The chip is still called *"Draft Content"* — a name that
describes composing prose, which is the habit this finding exists to break.
*"Add passage"* would say what the button does. It has not been renamed.
