# Development Documentation

This directory is the working development contract for C.H.A.T.

It exists so implementation work, AI-assisted development, code generation, and future contributors share the same understanding of the product before modifying code.

## Read order

1. [`PRODUCT.md`](PRODUCT.md) — product intent, users, boundaries, and core workflows.
2. [`ARCHITECTURE.md`](ARCHITECTURE.md) — target technical architecture and cross-platform strategy.
3. [`DEVELOPMENT_INSTRUCTIONS.md`](DEVELOPMENT_INSTRUCTIONS.md) — rules for implementation and AI-assisted development.
4. [`MVP_PLAN.md`](MVP_PLAN.md) — phased first-release plan.
5. [`AI_AND_CONTENT_RULES.md`](AI_AND_CONTENT_RULES.md) — AI behavior, authorship, Scripture, testimony, and generated-content boundaries.
6. [`AI_PROVIDER.md`](AI_PROVIDER.md) — how assistance is wired: setup, configuration, model selection, failure modes, privacy and logging, and how to add another provider. Document 5 is the rules; this is the mechanism that serves them.
7. [`REFLECTION_CHAT.md`](REFLECTION_CHAT.md) — the conversation panel beside the card: the brief as the owner gave it, and what was built against it.
8. [`PRODUCT_READINESS.md`](PRODUCT_READINESS.md) — what is actually finished, page by page, and what is not. The counterweight to the six documents above, which describe intent.
9. [`CREATE_STUDIO_INTEGRATION.md`](CREATE_STUDIO_INTEGRATION.md) — Phase 3 host mapping, persistence, package, export, and attribution boundaries.
10. [`MOBILE.md`](MOBILE.md) — Capacitor hosts, live reload, packaged API origin, share, and deep links.

Alongside these, [`../examples/REAL_CHAT_SAMPLES.md`](../examples/REAL_CHAT_SAMPLES.md) transcribes roughly thirty reflections people actually wrote. It is evidence, not intent, and it is why the C section holds the passage.

`../plans/` and `../requirements/` transcribe frozen source statements. They record what was asked for at a point in time, are deliberately not kept in step with the code, and should not be edited to match it.

## Working principle

Do not treat these documents as decorative planning notes. They are implementation context.

Before significant development:

- understand the user workflow being modified;
- identify the exact files and modules affected;
- preserve private-by-default behavior;
- preserve the distinction between user-authored and AI-assisted content;
- consider Web, Android, and iOS behavior;
- keep the Create engine deterministic for text and layout;
- avoid adding major product scope merely because a library or AI model makes it easy.

If implementation reveals that a documented assumption is wrong, update the relevant document as part of the same change.

## Current status

Well past scaffolding. A React/Vite web app and a Hono API, sharing domain types; email/password authentication with server-side sessions; SQLite for the live demo store and a MariaDB migration/repository foundation for durable records (conversation transcripts stay off the central database); the four C.H.A.T. sections as the page; a Gemini-backed assistance seam; a YouVersion passage connector; a Create Studio integration with host-owned layouts, styles, square/portrait formats, overflow carousels, and an optional generated-background seam; a Community feed with document-scoped publications, membership, and a server-side visibility predicate; and Capacitor Android/iOS hosts around the same web build.

Phase-by-phase status is in [`MVP_PLAN.md`](MVP_PLAN.md); an unsparing page-by-page account is in [`PRODUCT_READINESS.md`](PRODUCT_READINESS.md).

These documents remain the implementation contract. Where implementation has moved past them, the document is the thing that should be corrected — in the same change, per rule 15 of [`DEVELOPMENT_INSTRUCTIONS.md`](DEVELOPMENT_INSTRUCTIONS.md).
