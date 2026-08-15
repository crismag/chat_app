# Development Instructions

These instructions govern implementation work in C.H.A.T., including AI-assisted coding and code generation.

## 1. Understand before modifying

Before implementing a feature or changing an existing one:

1. Identify the user-visible behavior being changed.
2. Identify the domain objects involved.
3. Identify the exact files/modules expected to change.
4. Check whether the change affects privacy, authorship, publication, AI behavior, or cross-platform behavior.
5. Prefer the smallest coherent implementation that completes the user workflow.

Do not begin with broad refactors unless they are required to deliver the requested behavior.

## 2. Preserve product boundaries

C.H.A.T. is primarily:

- a private conversational Scripture/reflection tool;
- a searchable personal library;
- an optional internal publishing/community layer;
- a visual content creation tool.

Do not casually expand it into unrelated product categories.

## 3. Private by default is an invariant

New user content must default to private.

Publishing requires an explicit user action.

Never expose private data through:

- community API endpoints;
- public search;
- client-side filtering of mixed private/public datasets;
- analytics payloads containing unnecessary user content;
- generated public URLs without explicit publication intent.

Treat privacy as a backend/domain rule, not only a UI state.

## 4. Preserve authorship and revisions

Never silently replace the user's original wording with AI output.

For grammar/polish/rewrite actions:

- preserve the original;
- show or retain the proposed revision;
- record enough provenance to distinguish user text from AI-assisted text where practical;
- require deliberate acceptance for replacement when the UI supports editing suggestions.

Heart and Testimony must receive stricter handling than ordinary generated copy. Do not invent the person's inner response, first-person testimony, declaration, commitment, or prayer and attribute it to the user.

## 5. AI actions must be explicit

Prefer named operations such as:

```text
Explain
Grammar only
Polish
Shorten
Strengthen
Summarize
Extract C.H.A.T.
Suggest title
Related Scripture
Prepare social version
Generate topical background
```

Do not expose one ambiguous "Improve" action that unpredictably changes meaning.

AI provider implementation must remain behind a service abstraction.

## 6. Do not let AI render final text inside generated artwork

For shareable visual content:

- image generation may create background artwork;
- application code renders final text;
- Scripture/reference text must be deterministic;
- user Heart and Testimony text must remain editable;
- typography and spacing are controlled by the Create engine.

Avoid sending the complete final poster to an image model and trusting it to spell and typeset the content.

## 7. Build Create as a system, not a pile of templates

Separate:

- content;
- layout;
- style;
- background;
- export format.

Prefer reusable combinations over duplicated markup.

A style should not know the user's specific devotional content. A layout should not hard-code a particular color palette.

## 8. Readability beats density

Never shrink large bodies of text indefinitely to fit one card.

When content exceeds a safe threshold:

- warn;
- offer condensation;
- allow selection;
- split across cards;
- generate a carousel.

Maintain safe margins and mobile-readable font sizes.

## 9. Responsive first

The web application should be designed from the beginning for:

- narrow mobile viewport;
- tablet;
- desktop.

A feature is not complete if it only works on desktop and is intended for shared product use.

## 10. Web is the primary implementation; mobile is an adapter

Implement product behavior in the shared React/TypeScript code whenever possible.

Use Android/iOS native code only for capabilities that require it, such as:

- share sheet;
- secure storage;
- notifications;
- camera/photo library;
- platform lifecycle/deep-link behavior.

Do not duplicate business rules in native shells.

## 11. Keep generated native projects conventional

Use normal Capacitor project conventions. Avoid custom directory reshaping or build scripts without a clear need.

Changes inside `android/` or `ios/` should be documented when they are not generated/default changes.

## 12. Backend API rules

The API should be resource/domain oriented and should not mirror individual UI components.

Prefer clear resources for:

- conversations;
- messages;
- structured C.H.A.T.s;
- publication;
- creations;
- AI operations;
- search.

Validate authorization at every data boundary.

## 13. Testing expectations

Prioritize tests around high-risk behavior:

- private content cannot be retrieved by other users;
- publication changes visibility correctly;
- unpublishing removes community visibility if supported;
- AI revision does not destroy original content;
- C/H/A/T extraction preserves section meaning;
- export handles short and long text;
- layout/style combinations render without overflow;
- cross-platform adapters fail gracefully.

Visual rendering should eventually have snapshot/golden-image coverage for stable templates.

## 14. Avoid speculative infrastructure

Do not add queues, distributed workers, vector databases, event buses, microservices, or cloud-specific infrastructure merely because they may be useful someday.

Start with the simplest architecture that supports the current workflow. Introduce infrastructure in response to measured needs.

## 15. Keep documentation synchronized

When a change alters product behavior, architecture, privacy assumptions, AI behavior, or MVP scope, update the relevant document under `docs/development/` in the same work.

## 16. Definition of done for a feature

A feature is done when:

- the complete user flow works;
- loading, empty, error, and success states are handled;
- mobile and desktop behavior have been considered;
- authorization/privacy rules are enforced server-side where relevant;
- tests cover important domain behavior;
- no placeholder UI appears functional when it is not;
- documentation is updated when the product contract changed.

## 17. AI coding-agent instruction

When an AI coding agent works in this repository, it should:

1. Read this development package before broad implementation.
2. Inspect the existing implementation instead of assuming the documented target state already exists.
3. State the planned files/modules before large changes.
4. Implement the smallest complete vertical slice.
5. Run relevant tests/build/lint checks.
6. Report what changed, what remains incomplete, and any new decisions introduced.
7. Never claim a feature is complete based only on generated files or static UI.

The goal is a usable product, not maximum code generation.
