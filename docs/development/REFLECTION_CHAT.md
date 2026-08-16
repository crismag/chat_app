# Reflection Chat — product brief and implementation

The conversation panel beside the C.H.A.T. editor. This document is the brief as
the owner gave it, plus what was actually built against it, so both outlive the
conversation they came from.

The mechanism underneath — provider seam, configuration, failure modes — is in
[AI_PROVIDER.md](./AI_PROVIDER.md). The content rules are in
[AI_AND_CONTENT_RULES.md](./AI_AND_CONTENT_RULES.md). This is about what the
panel is *for* and how it should feel.

---

## The problem being solved

The chat worked and did not feel like a companion. In the owner's words it
*"feels like a transcript embedded inside a form"*.

## Governing principle

> **Conversation first; C.H.A.T. organization second.**
>
> Conversation → useful insight or draft → deliberate user action → C.H.A.T. section.

Nothing said in chat may ever modify the reflection without an explicit user
action. That has not changed and does not change.

---

## The rule change: drafts on request

This is the part most likely to be misread later, so it is written out in full.

The assistant **does** generate drafts on request, **including for Heart and
Testimony**. "Draft my Heart response", "Write a short prayer for Testimony",
"Generate Context for this verse" all return real drafts.

This does not contradict the content rules. The prohibition was against AI
**silently authoring personal material and attributing it to the user**. Four
things together preserve authorship:

1. the user **explicitly asked** for it;
2. it arrives with **visible draft treatment** — its own card, named as a draft;
3. **nothing is saved** until the user adds it;
4. provenance is recorded as **`ai_generated`** and travels with the text.

The choice stays with the author, which is what the rule was protecting.

**Deflecting is now a defect.** Answering "you should write this yourself" when
someone has asked for a draft is named by the owner as defect #3. When the
target section is clear, generate.

Every other guardrail stands: labelled as a draft, never auto-inserted,
`authorOrigin` carried, and **no path from chat into a section without an
explicit action**.

---

## Priority 1 — behaviour and clutter

1. **Remove the permanent "Use in…" link** under nearly every message. It
   appeared under user questions, casual messages and off-topic messages, which
   made it meaningless. Replace with a contextual action — **see the revision
   below**, which replaced the first attempt at this.
2. **Stop labelling ordinary replies "AI DRAFTED".** A conversational
   explanation is not a draft. Replace "C.H.A.T. ASSISTANT — AI DRAFTED" with a
   simple identity, `✦ C.H.A.T.`. Drop the repeated "YOU" label unless
   accessibility requires it. **Only explicit generated drafts carry a
   provenance label.**
3. **Recognise explicit generation requests** and return real drafts in a
   **distinct card**: heading "Context draft", the text, then
   `[Add to Context] [Edit] [Try again]`. When the section is known the action
   is direct — not a second picker.
4. **Insertion must be safe.** If the section already has text, offer
   **Append / Replace / Insert at cursor / Cancel**. Never assume replacement,
   never overwrite silently.
5. **Shorten default responses. One primary reflection question at a time** —
   not a compound of historical + theological + personal. Build on the
   conversation instead of restating the same paragraph about Abraham, David
   and covenants.
6. **Stop ending messages with "How would you put this into the Context
   section?"** Section-directed questions only when relevant or requested.
7. **Allow ordinary conversational detours.** The owner's example: the user says
   it is midnight with no food. A shallow acknowledgement that pivots straight
   back to the passage is wrong. Answer the human, then return to the reflection
   later if it fits.

## Priority 2 — connect the two columns

- **"Discuss in chat"** from a section enters a visible scoped mode:
  `Discussing: Heart ×`, dismissible.
- Pass that section **and its current contents** into the assistant context;
  generated material defaults to that section.
- **Prompt chips adapt per section:**

  | Section | Chips |
  |---|---|
  | Context | Explain the background · Ask a Context question · Draft Context · Check this interpretation |
  | Heart | Ask a Heart question · Help me express this · Draft Heart · Make this more personal |
  | Application | Suggest a practical response · Make this specific · Draft Application · Ask an Application question |
  | Testimony | Help me write a prayer · Turn this into a declaration · Draft Testimony · Ask a faith question |

- Scope is **guidance, not a hard restriction** — still answer reasonable
  adjacent questions.
- After adding: state changes to **"✓ Added to Context"** with a **View** action
  that focuses and scrolls the left editor to that section, and the destination
  section **briefly highlights**.

## Priority 3 — usability

- **Disclaimer** stops being a permanent block between conversation and
  composer. Compact: *"AI suggestions are for reflection. Review before
  saving."* in an info popover beside the title, a muted single line, or on
  first draft-add. Full wording lives in the popover.
- **Three regions:** fixed header / scrollable conversation / fixed composer.
  Header title *"Reflect on Matthew 1:1"*, subtitle *"Explore the passage or
  develop your C.H.A.T. reflection."*
- **Composer placeholder** *"Ask about the passage or share a reflection…"*.
  Send button integrated, not overpowering.
- **"↓ Latest"** when scrolled away, or when a reply arrives while reading
  older messages.
- **State-aware chips.** Default: Explain simply / Historical context / Ask me a
  question / Draft Context. **Polish and Shorten appear only when a draft or
  selection exists** — they are meaningless as conversation starters.
- **Refine the scrollbar** (6–8px, low-contrast thumb, more contrast on hover,
  no overlay). **Do not change the scroll architecture.**

## Priority 4 — optional

Widen the chat column toward 400–440px if it does not damage the editor.
Contextual actions on hover/tap. Selectable depth. Collapsed empty sections.
Responsive drawer.

## Message widths

Assistant ~85–90% of the chat body. User ~70–80%.

---

## Revision — the add control was still too heavy

The first pass replaced the "Use in…" link with a full-width **"＋ Add to
C.H.A.T."** under every eligible message. The owner saw it and it was still
wrong: a repeated bar dominates the conversation, makes every reply look like a
form record, repeats the same action endlessly, and never says which section
will receive anything.

**What it is now.** A small icon on eligible *assistant* responses — a document
with an arrow entering it, never a bare `+`, because a plus alone says "add"
without saying add what or where. Accessible name **"Use response in
reflection"**, tooltip "Use in reflection". Revealed on hover **or focus**,
never hover alone, and always present on touch; the visual mark is small but
the target is 2.5rem.

Activating it opens a menu headed **"Use this response"** listing Context /
Heart / Application / Testimony with accessible labels "Use in Context" and so
on, plus **Copy text**. It dismisses on selection, on Escape, and on an outside
click, and focus returns to the trigger when it closes without a selection.
Escape and outside-click are handled on the *document*, because a handler bound
to the menu only fires once something inside it has been focused — which makes
Escape work for keyboard users and silently not for anyone else.

The menu flows inline rather than overlaying. Absolutely positioned it was
clipped by the thread's own scroll container: a menu opened on the last reply
had its lower half cut off. In a column this narrow there is nothing to gain
from overlaying.

**Eligibility.** Assistant responses only, excluding drafts (which have their
own card), pleasantries, and anything under 40 characters. The author's own
messages carry no control — their words are already theirs. Reliable
classification of "explanation vs acknowledgement" is not available, so this is
blunt and errs towards hiding.

**Explicit drafts** keep their own card and, because the destination is already
known, do not ask the author to pick among four again. The actions are
**Review in {Section}** / Edit / Try again / Copy.

### Insertion is a review state, never a commit

"Review in Context" places the text into the section's **unsaved editing
buffer**. The editor shows it, the header says Unsaved, and the ordinary Save
the author already uses is what commits it. Nothing generated is ever written
down without them.

That created a provenance hole worth naming: text sitting in the unsaved buffer
has no stored origin yet, so `saveAll` would have recorded the *author* as
having written it. `pendingOrigins` remembers what actually landed, so the badge
cannot quietly become a claim nobody made.

**Non-empty destination** raises a sheet with a live preview of the result:

| Mode | Default | Behaviour |
|---|---|---|
| Add to the end | **yes** | Existing writing stays, new text follows |
| Insert where I left the cursor | offered only when a caret is known | Existing writing stays |
| Replace what I have written | never the default | Requires ticking a separate confirmation, and leaves an Undo |

"Insert at cursor" is offered **only** when a caret in that section is actually
known. Offering it and quietly meaning "at the end" would be a small lie in
exactly the place this sheet exists to be trustworthy.

The preview is computed by `mergeInto` — the same function that performs the
merge — because a preview computed differently from the thing it previews is
worse than no preview at all.

After success: the destination briefly flashes, a compact **"✓ Added to
Context"** appears with a **View** action, and the page scrolls to the section
*unless the author is typing somewhere else*.

## Revision — the chips were inert

Four visible, clickable, dead controls: the same defect class already reported
and fixed once. Either wire it or hide it.

They now invoke **structured action identifiers**, not prompt text:

| Chip | Action | Produces |
|---|---|---|
| Explain simply | `explain_simply` | ordinary message |
| Historical context | `historical_context` | ordinary message |
| Ask me a question | `ask_reflection_question` | ordinary message, exactly one question |
| Draft Context | `draft_section` + `section` | **draft card** |

The client picks an identifier from a fixed list; the server looks up what it
means. The prompt wording lives on the server and can change without a client
release.

**The reason that matters most is not testing or localisation.** It is that
"produce conversation" versus "produce a draft" becomes a decision trusted code
makes *from the identifier, before the provider is called* — rather than
something inferred afterwards from whatever came back. `draft_section` is the
only action that may yield a draft. A model that volunteers draft text on an
`explain_simply` turn has it discarded, in `routes.ts`, via `isDraftTurn`.

An unrecognised action becomes "no action" and degrades to an ordinary
conversational turn. It can never become prompt text: there is no path from that
value to anything but a lookup in a table the server owns.

**Interaction.** Pressing a chip fires the request immediately — it does not
fill the composer and wait for Send. The human-readable equivalent is stored as
an ordinary user message so the thread still reads as a conversation later.
Chips disable while a reply is in flight, with the reason in the tooltip rather
than only in the grey. "Try again" repeats the *request* without re-posting the
author's turn, so retrying never duplicates the message that caused it.

Section-scoped chip sets are in place for all four sections; three of the four
in each set reuse the same three actions, so a new set is a table entry rather
than a new code path.

## Non-goals

Do **not**: remove the independent two-column scrollbars (structurally correct —
the editor must stay usable while the chat scrolls); auto-save assistant
content; force all conversation into a C.H.A.T. category; show a section action
on every message; label every reply a draft; redesign navigation; replace the
warm devotional visual style; build an autonomous theological authority or make
responses appear definitive.

---

## Acceptance criteria

To be verified, not assumed:

- Direct question gets a direct answer.
- A draft request for **each of the four sections** returns a draft.
- No repeated restatement.
- One question by default.
- Casual messages get natural responses.
- Ordinary replies are not labelled drafts.
- Not every message shows an add action.
- A draft names its destination.
- Existing section text cannot be silently overwritten.
- The destination visibly responds and confirms.
- Scoped mode shows the section, receives its contents, adapts chips, dismisses.
- Dual-column and independent scrolling intact.
- Composer reachable while scrolling.
- Disclaimer no longer a large block.
- Contextual controls reachable without hover alone.
- Colour is never the only signal of draft/selected/saved/scoped.
- Keyboard focus visible; accessible names on section actions.

---

# What was built

## The draft, end to end

A chat turn can now return a **draft** alongside its reply. The provider result
carries an optional `draft: { section, text }`, and the schema makes the model
name the destination section rather than leaving the interface to guess.

**Drafts persist.** `messages` gained two nullable columns, `draftSection` and
`draftText`, added by an idempotent migration. An ephemeral draft would vanish
on reload and leave a lead-in sentence pointing at nothing — which is exactly
the "transcript embedded in a form" feeling the brief is trying to remove.

One assistant turn is **one message**: `content` is the conversational reply,
and when a draft was asked for, `draftText`/`draftSection` hang off the same
row. The renderer shows the reply as prose and the draft below it as a card.

### The model never names a destination

The response schema has `onTopic`, `reply` and `draft` — **no section field, no
action field, no target**. There is no vocabulary in which the model could
express "write this to Heart", so there is nothing for a client to obey. That is
stronger than validating a destination the model proposed.

Where a draft is offered is resolved in `api/src/ai/draft-target.ts`, in this
order, from sources the model does not control:

1. the **structured action's** own section (the author pressed "Draft Heart");
2. **scoped mode** (the author pressed "Discuss in chat" on a section);
3. the **author's own words** ("write a prayer for my testimony");
4. otherwise **null** — the draft is offered unplaced and the author is asked.

Every one of these is validated against the section enum before it is believed,
including values from our own client, because "our own client" is only ever a
claim about the sender.

## Adding to a section

`ChatPage` owns an **add flow** rather than a single write:

- section empty → added directly;
- section has text → a sheet offers **Append / Replace / Insert at cursor /
  Cancel**, defaulting to nothing.

Every path writes through the existing `putIntoField`, so `authorOrigin`
travels and undo behaves as it already did. Replace stashes the previous text
into the same `undoable` slot the improve-wording flow uses.

## Scoped mode

`Discussing: Heart ×` in the panel header. The section **and its current
contents** go into the request as `focusSection`, chips swap to that section's
set, and a draft defaults to that section.

Scope is guidance: the instruction says to prefer the focused section but still
answer reasonable adjacent questions, because a hard restriction would make the
panel worse at the thing it is for.

## The mutation boundary

Stated by the owner, and enforced structurally rather than by intention:

> Gemini may generate explanations, questions and clearly labelled C.H.A.T.
> section drafts. Gemini must never directly mutate a section. Moving content
> from a message into a section must require an explicit, trusted user action
> handled by application code, with no silent replacement of existing text.

How each half is held:

- **No tool use, no function calling, no model-emitted directive.** The model
  returns content; the schema is closed (`additionalProperties: false`) and
  `validateChatPayload` reads three keys and discards the rest — by
  construction, not by rejection. A response inventing `section`, `action` or
  `tool_call` cannot carry any of it past the adapter.
- **Whether a turn may draft at all** is decided by trusted code before the
  call, from the structured action or the author's own words.
- **Where a draft may go** is decided by trusted code, never from model output.
- **The write** happens through the authenticated, owned-conversation section
  endpoint on a user gesture — the same endpoint used when typing by hand.
- **A chat reply is a message.** `POST /api/ai/reflection-chat` appends to the
  thread and touches the sections table not at all.

The tests assert on **stored sections after the call**, not on rendering: a
rendering test can pass while a section quietly changed.

## Known limitations

- **Draft "Edit" is inline in the card**, not a full editor. It is a textarea on
  the draft; it does not offer formatting or length counters.
- **The "Use conversation ▾" header control is not built.** It was optional and
  deferrable in the brief, and the per-message work was large.
- **Section-scoped chips reuse the default actions** for three of their four
  slots. The brief lists richer per-section wording ("Help me express this",
  "Make it specific") which would need their own action identifiers and prompts;
  the structure takes them as table entries when they are wanted.
- **"Try again" re-sends the original request.** It does not tell the model what
  was wrong with the first attempt, so a second draft can resemble the first.
- **The relevance heuristic for the add action is lexical.** Greetings,
  acknowledgements and very short messages are filtered out by pattern, which
  will occasionally hide the action on a short but useful sentence. It errs
  toward hiding, because the brief's complaint was clutter.
- **Draft persistence has no cap.** A user who presses "Try again" many times
  accumulates draft rows on the conversation like any other message.
