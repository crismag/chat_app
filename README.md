# C.H.A.T.

**Context · Heart · Application · Testimony**

C.H.A.T. is a private-first conversational Scripture reflection and devotional application that helps people talk through Scripture, preserve their reflections and testimonies, receive optional AI assistance, and turn meaningful content into beautifully designed visual cards and social-ready images.

The product is intended to run from one primary codebase across **Web, Android, and iOS**.

## Product idea

A user begins with a natural conversation around a Bible verse, sermon, question, experience, or testimony. The application preserves that conversation and can help organize it into the C.H.A.T. framework:

- **C — Context**: The person explains the context of the passage—what is happening, who is involved, the surrounding circumstances, and what they understand it to mean.
- **H — Heart**: The person shares their heart and how the passage touches, convicts, encourages, challenges, or affects them.
- **A — Application**: The person describes how the passage applies to them and how they will apply what they have learned.
- **T — Testimony**: The person expresses a testimony, declaration of faith or conviction, commitment, prayer, or statement of belief related to the passage or learning.

The conversation remains the primary artifact. C/H/A/T sections may be written directly, assigned from messages, or generated as an optional structured view of a longer conversation.

## Core principles

### Private by default

Every conversation and C.H.A.T. entry is private unless the user explicitly chooses to publish that specific item to the platform community.

The application does not assume that a user wants a social profile, public journal, or public testimony simply because content was created.

### AI assists; the user authors

AI may help with:

- Scripture and contextual explanation
- Grammar correction
- Wording and clarity
- Shortening or strengthening a message
- Summarization
- Extracting a C.H.A.T. structure from a conversation
- Suggesting titles, themes, related verses, or shareable quotations

The original user content must be preserved. AI-generated explanations and substantial AI-authored text should remain distinguishable from the user's own testimony and reflection.

### Create beautiful content without becoming a design tool

C.H.A.T. includes a creation engine for turning conversations, verses, quotes, applications, and testimonies into designed visual content.

The preferred model is:

**deterministic layout + typography + styling + optional AI-generated topical background**

The application controls all text rendering so that Scripture, testimony, spelling, typography, and layout remain accurate and editable. AI image generation is used primarily for backgrounds or artistic supporting imagery rather than for rendering final text.

### Publish intentionally

There is a deliberate distinction between:

- **Export / external share** — the user receives an image or file and can send it anywhere using normal browser/device capabilities.
- **Publish to Community** — the selected C.H.A.T. becomes available to other users inside the C.H.A.T. platform.

Only explicit publishing makes an entry visible to the platform community.

## Primary product areas

### C.H.A.T.
Conversational Scripture study, reflection, AI assistance, and structured C/H/A/T views.

### Library
Persistent conversation history, Scripture references, tags, collections, search, and personal testimony history.

### Community
Discovery of only those C.H.A.T.s that users explicitly publish. Future community features may include saves, reactions, comments, following, and discussion.

### Create
Template-driven visual creation for:

- Full C.H.A.T. cards
- Verse cards
- Quote cards
- Testimony cards
- Devotionals
- Posters
- Stories
- Carousels

## Cross-platform direction

The intended baseline is:

- **Language:** TypeScript
- **Web UI:** React
- **Build tooling:** Node.js
- **Mobile packaging:** Capacitor
- **Backend:** TypeScript API (Hono) sharing types with the web app
- **Database:** PostgreSQL
- **Visual renderer:** React + HTML/CSS templates with image export
- **AI:** provider abstraction so text and image providers can be changed without rewriting product logic

The goal is one shared product implementation, not three independent applications.

## Current repository shape

```text
chat_app/
├── web_app/                 # React + TypeScript product UI
├── api/                     # Hono/TypeScript API
├── packages/
│   └── shared/              # Shared types and domain constants
├── docs/
│   └── development/
├── .github/workflows/
├── package.json
├── .gitignore
└── README.md
```

`android/` and `ios/` will be added in the mobile packaging phase. They are native integration layers, not independent application implementations. Most product development should happen in `web_app/`, shared packages, and the backend.

## Local development

Requires Node.js 22+.

```bash
npm install
npm run dev
```

- Web: http://localhost:5173
- API health: http://localhost:8000/api/health

Useful commands:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## Initial MVP

The first useful release should prove the core loop:

1. Create or open a conversation.
2. Discuss Scripture naturally.
3. Preserve conversation history.
4. Use optional AI explain / grammar / polish actions.
5. Organize or extract C/H/A/T sections.
6. Search previous conversations and Scripture references.
7. Create a styled visual card from selected content.
8. Export the result as an image.
9. Explicitly publish a selected C.H.A.T. to the platform community.
10. Browse published C.H.A.T.s without exposing private content.

The MVP should not attempt to become a full Bible platform, social network, Canva replacement, or church-management system.

## Development documentation

The current development package lives in [`docs/development/`](docs/development/).

Start with:

1. [`docs/development/README.md`](docs/development/README.md)
2. [`docs/development/PRODUCT.md`](docs/development/PRODUCT.md)
3. [`docs/development/ARCHITECTURE.md`](docs/development/ARCHITECTURE.md)
4. [`docs/development/DEVELOPMENT_INSTRUCTIONS.md`](docs/development/DEVELOPMENT_INSTRUCTIONS.md)
5. [`docs/development/MVP_PLAN.md`](docs/development/MVP_PLAN.md)
6. [`docs/development/AI_AND_CONTENT_RULES.md`](docs/development/AI_AND_CONTENT_RULES.md)

## Status

**Phase 0 foundation scaffold.**

The web app and API start locally. Product areas other than the shell and API health check are visible as placeholders and are not implemented yet.
