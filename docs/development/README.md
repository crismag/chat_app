# Development Documentation

This directory is the working development contract for C.H.A.T.

It exists so implementation work, AI-assisted development, code generation, and future contributors share the same understanding of the product before modifying code.

## Read order

1. [`PRODUCT.md`](PRODUCT.md) — product intent, users, boundaries, and core workflows.
2. [`ARCHITECTURE.md`](ARCHITECTURE.md) — target technical architecture and cross-platform strategy.
3. [`DEVELOPMENT_INSTRUCTIONS.md`](DEVELOPMENT_INSTRUCTIONS.md) — rules for implementation and AI-assisted development.
4. [`MVP_PLAN.md`](MVP_PLAN.md) — phased first-release plan.
5. [`AI_AND_CONTENT_RULES.md`](AI_AND_CONTENT_RULES.md) — AI behavior, authorship, Scripture, testimony, and generated-content boundaries.

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

The repository is in foundation stage. Framework scaffolding has not yet been treated as product architecture. These documents should guide the initial scaffold rather than be retrofitted after implementation.
