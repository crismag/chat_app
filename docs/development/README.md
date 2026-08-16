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

Phase 0 foundation is in the repository: a React/Vite web app, a Hono API, shared domain types, local `npm run dev`, and CI.

These documents remain the implementation contract. Scaffolding should follow them rather than replace them.
