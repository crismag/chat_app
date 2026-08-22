# Audit remediation pack

**For Claude (or any coding agent).** This folder is the implementation brief for the repository-wide audit of 2026-08-22. It is not the product contract. The product contract remains [`docs/development/`](../development/).

Do **not** implement code until you have read the documents in the order below and confirmed which phase you are allowed to execute.

This pack exists so an agent with no chat history can:

1. understand the current system without assuming the existing architecture is desirable;
2. implement audit findings in small, reviewable steps;
3. preserve the product behavior we actually want;
4. stop before any change that needs Cris’s explicit approval.

The owner is **Cris**. Prefer asking over inventing product behavior.

---

## Read this first

Read in this order, then stop and state the phase you will execute:

1. [`INSTRUCTIONS.md`](INSTRUCTIONS.md) — how to work in this repository for this job
2. [`DO-NOT.md`](DO-NOT.md) — what not to do, including rewrite temptations
3. [`APPROVALS.md`](APPROVALS.md) — what is blocked until Cris says yes
4. [`CONTEXT.md`](CONTEXT.md) — what the system is today, and the simpler target
5. [`FINDINGS.md`](FINDINGS.md) — the catalog of defects and sediment
6. [`CODEREVIEWERASSIST.md`](CODEREVIEWERASSIST.md) — second review: tree state, new IDs, do not re-audit
7. [`ROADMAP.md`](ROADMAP.md) — the only order of work
8. The **one** phase file you are executing, under [`phases/`](phases/)
9. The living product contract as needed: [`../development/DEVELOPMENT_INSTRUCTIONS.md`](../development/DEVELOPMENT_INSTRUCTIONS.md), [`../development/PRODUCT.md`](../development/PRODUCT.md), [`../development/ARCHITECTURE.md`](../development/ARCHITECTURE.md), [`../development/AI_AND_CONTENT_RULES.md`](../development/AI_AND_CONTENT_RULES.md)

Then inspect the current code. Do not assume this pack is still exact if the tree has moved. Paths and line numbers were true on 2026-08-22.

---

## What this job is

Make the application **smaller, easier to understand, easier to test, safer to modify, and faster where it matters**, while preserving intended product behavior.

Highest-value work is:

1. fix real security and correctness bugs;
2. delete dead aliases and unused paths;
3. finish **one** persistence store;

not a rewrite, not new infrastructure, not prettier layering for its own sake.

---

## What this job is not

- Not a green-field redesign of C.H.A.T. as a product.
- Not a MariaDB cutover onto the unused `reflection_revisions` / `chat_content` JSON model.
- Not adding Redis, queues, workers, CSP theater, or a new frontend state library.
- Not rewriting tests so a behavior change looks intended.

---

## Folder

| File | Role |
|------|------|
| [`INSTRUCTIONS.md`](INSTRUCTIONS.md) | Operating rules for every commit |
| [`DO-NOT.md`](DO-NOT.md) | Forbidden moves |
| [`APPROVALS.md`](APPROVALS.md) | Changes that need Cris first |
| [`CONTEXT.md`](CONTEXT.md) | Architecture, dual store, naming |
| [`FINDINGS.md`](FINDINGS.md) | Finding IDs (B*, S*, O*, M*, and sediment) |
| [`CODEREVIEWERASSIST.md`](CODEREVIEWERASSIST.md) | 2026-08-22 lens review; tree state; new IDs |
| [`ROADMAP.md`](ROADMAP.md) | Phases P0–P6 |
| [`STATUS.md`](STATUS.md) | Checklist — update when a finding is done |
| [`phases/P0-security.md`](phases/P0-security.md) | Security fixes |
| [`phases/P1-deletions.md`](phases/P1-deletions.md) | Dead routes, broken unused code, stale docs |
| [`phases/P2-guest-merge.md`](phases/P2-guest-merge.md) | Guest merge + title Send race |
| [`phases/P3-performance.md`](phases/P3-performance.md) | List/feed query shape |
| [`phases/P4-frontend.md`](phases/P4-frontend.md) | Page modularization |
| [`phases/P5-one-store.md`](phases/P5-one-store.md) | MariaDB content cutover |
| [`phases/P6-optional.md`](phases/P6-optional.md) | CSRF, S9 bind/XFF, health, AI route merge, CI verify |

---

## Default starting point

If Cris has not named a phase, start at **P0** and do **one finding per commit**. Skip anything listed in [`APPROVALS.md`](APPROVALS.md) until it is approved.

When you finish a finding, update [`STATUS.md`](STATUS.md) in the same change that implements it if you are already touching this folder; otherwise report the STATUS line in the PR/commit message so a human can tick it.
