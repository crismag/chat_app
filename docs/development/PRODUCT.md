# Product Foundation

## Product statement

C.H.A.T. is a private-first conversational Scripture reflection application that helps users preserve meaningful conversations, organize them into **Content, Heart, Application, Testimony**, improve or explain content with optional AI assistance, find previous reflections, and create beautifully designed shareable visual content.

## Core user problem

Meaningful Scripture conversations are often temporary. A user may discuss a passage, receive insight, connect it to life, write a testimony, and then lose that material inside an unstructured chat history, handwritten note, message thread, or social post.

C.H.A.T. turns those moments into a persistent, searchable personal library without requiring the user to stop thinking conversationally.

## Primary product promise

A user should be able to move naturally through this loop:

```text
CONVERSE → REMEMBER → REFLECT → CREATE → optionally PUBLISH
```

The application should make that loop feel simple enough for everyday use.

## C.H.A.T. framework

### C — Content
Content holds **the passage itself** — the verse text, usually with its reference and its translation named. An explanation may follow it, but often nothing does.

This is not an inference. Roughly thirty real C.H.A.T. reflections are transcribed in [`docs/examples/REAL_CHAT_SAMPLES.md`](../examples/REAL_CHAT_SAMPLES.md), and in every one of them the C section carries Scripture. Many carry the verse and nothing else; where an explanation appears at all, it more often appears under Heart.

Two rules follow, and both are behavioural rather than editorial:

- **A Content section that is only the passage is complete.** Nothing may report it as missing, partial, unfinished, or awaiting commentary.
- **Arrangement belongs to the author.** Reference before the quote, after it, or with a bible.com link beside it — all of these occur in the samples. The field is free text and the application does not impose a shape on it.

AI may assist with historical, literary, biblical or textual background, but that is conversation; the entry represents the person's own reflection, and a drafting request for this section produces the passage as an author would write it rather than an essay about it.

### H — Heart
The person shares their heart and how the passage touches them. This includes what spoke to, affected, convicted, encouraged, challenged, or caused them to reflect. Heart is personal reflection and must not be silently manufactured by AI.

### A — Application
The person explains how the passage applies to them and how they will apply what they have learned. This may include actions, decisions, repentance, obedience, habits, relationships, attitudes, or practical next steps.

### T — Testimony
The person expresses a testimony, declaration of faith or conviction, commitment, prayer, or statement of belief related to the verse, passage, or learning. Testimony is not limited to recounting a past event. AI must never invent a personal testimony or experience and attribute it to the user.

The C.H.A.T. structure must help the user, not force every conversation into four mandatory form fields.

## Conversation-first behavior

The canonical source is the conversation and user-authored content.

A user may:

- begin from a verse;
- begin from a sermon note;
- ask a question;
- paste a thought;
- write a testimony;
- talk naturally with the assistant;
- later ask the application to organize the material as a C.H.A.T.

C/H/A/T sections may therefore be explicit, inferred, extracted, or edited views over conversation content.

## Private-by-default model

Every new conversation and C.H.A.T. is private.

Private content must not appear in:

- community feeds;
- public search;
- public author profiles;
- recommendations to other users;
- platform discovery surfaces.

Only a deliberate publish action on a specific item makes that item available to other users inside the platform.

The product should never infer publication from:

- exporting an image;
- downloading content;
- copying text;
- using a device share sheet;
- making a visual card;
- having a public profile.

## Publishing model

Initial publication states should remain intentionally small:

```text
PRIVATE → PUBLISHED
```

Do not introduce friends-only, followers-only, group-only, unlisted, church-only, or complex ACL states until a concrete requirement exists.

Publishing must be explicit and reversible if the platform later supports unpublishing.

## External sharing

C.H.A.T. does not need to manage every external destination.

The application should support creating/exporting high-quality content. The browser or operating system may handle external sharing through downloads, share sheets, messaging apps, social networks, email, or other user-selected channels.

External sharing and internal publication are different operations.

## AI role

AI is a collaborator and explainer, not the owner of the user's devotional life.

Useful AI actions include:

- explain passage or phrase;
- provide contextual assistance;
- correct grammar only;
- polish while preserving meaning;
- shorten;
- strengthen wording;
- summarize;
- suggest a title;
- identify themes;
- identify C/H/A/T sections;
- suggest related Scripture;
- help create a concise social version;
- propose a topical image/background direction.

The UI should communicate what operation is being requested. "Fix grammar" and "rewrite this strongly" must not silently behave as the same operation.

## User authorship

The original user message must remain recoverable.

Particular care is required for Heart and Testimony:

- AI must not invent how a passage touched the user, or invent a personal experience, declaration, commitment, or prayer.
- Heart must not be silently manufactured when the user has not expressed it.
- AI may improve wording after user initiation.
- AI-generated testimony-like text must not be represented as something the user actually experienced or believes.
- A user should be able to keep the original wording at any point.

## Library

The personal Library should eventually support retrieval by:

- full text;
- Scripture reference;
- book/chapter/verse;
- date;
- tags;
- theme;
- C/H/A/T section;
- testimony;
- conversation title.

Semantic search may be added later, but V1 should not depend on embeddings if conventional search is sufficient.

## Create engine

Create is a first-class product area.

It transforms selected content into designed output such as:

- quote card;
- verse card;
- testimony card;
- full C.H.A.T. devotional;
- poster;
- story;
- portrait social post;
- carousel.

### Design philosophy

The system should use two independent concepts:

1. **Layout** — the information arrangement.
2. **Style** — the visual treatment.

Example layouts:

- full C.H.A.T. two-column;
- full C.H.A.T. stacked;
- verse + reflection;
- quote focus;
- testimony focus;
- devotional;
- carousel;
- story.

Example styles:

- cream botanical;
- editorial serif;
- modern minimal;
- paper journal;
- dark worship;
- warm sunrise;
- nature;
- pastel;
- bold youth.

Layout × style should create many combinations without requiring hundreds of independent templates.

### Topical AI backgrounds

AI image generation may produce a background inspired by:

- Scripture reference;
- subject;
- mood;
- application;
- testimony theme.

The image model should generally be asked for imagery with appropriate negative space and no rendered text.

Final Scripture, quotation, testimony, typography, spacing, attribution, and branding should be rendered by the application's deterministic layout engine.

## Long-content behavior

Never solve overflow by shrinking text until it becomes unreadable.

When content is too long, the application should offer intelligent alternatives such as:

- condense;
- quote only;
- selected section;
- split to carousel;
- one card per C/H/A/T section.

## Community

The community layer consists only of explicitly published entries.

The initial community experience can remain small:

- browse published C.H.A.T.s;
- search by Scripture/theme;
- open author/public entry;
- copy or save a reference if supported.

Reactions, comments, follows, groups, moderation systems, and recommendation algorithms should be added only when the core private-product loop is already useful.

## Non-goals for the first release

C.H.A.T. is not initially intended to become:

- a full social network;
- a Canva clone;
- a full Bible-study platform;
- a church management platform;
- a sermon-authoring suite;
- a theological authority engine;
- an all-purpose general AI chatbot.

The MVP succeeds if users want to return to their own conversations, can find them later, and enjoy turning selected content into something beautiful enough to keep or share.
