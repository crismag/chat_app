# Create Studio integration

## Scope

Phase 3 replaces the primitive Create canvas with the private
`@crismag/create-studio` package. C.H.A.T. remains the host and owns every
domain decision, saved document, asset identifier, and exported-file action.
Create Studio receives only its neutral `StudioDocument` contract.

The initial production proof is deliberately bounded: one 1080 × 1080 page,
the exact saved passage and translation, one selected reflection field, editing,
save/reopen, and deterministic PNG export. Multi-page layouts, image upload,
generated backgrounds, crop and image adjustments remain later work.

## Source mapping

`web_app/src/create/host-adapter.ts` is the domain boundary. It maps:

- the selected reflection ID and source update time;
- the exact saved passage, provider passage ID and translation ID;
- the canonical reference and translation abbreviation;
- one user-selected Heart, Application, Testimony, or Condensed Reflection;
- the section's saved authorship provenance;
- translation copyright text when supplied by the passage provider.

These values become ordinary text/shape elements with semantic-slot metadata.
No C.H.A.T. types or interpretation enter the Create Studio package. Saved
passage text wins over the Content field because it is the exact provider result
the author selected; the existing saved field is the offline fallback.

## Persistence and export

`GET/PUT /api/studio-creations/:conversationId` is owner-scoped in the same way
as reflection detail. The host stores the canonical schema-versioned document,
template ID/version, stable asset references discovered from the document, and
the latest export metadata. The API rejects oversized documents, executable
content, credential-shaped keys, and temporary signed URLs before persistence.

Save is explicit. Export uses Create Studio's deterministic renderer, downloads
a PNG in the browser, then saves the document and the export timestamp,
dimensions and media type. Export does not publish to Community.

## Package consumption

Create Studio is private, `UNLICENSED`, and unpublished. A sibling filesystem
dependency would make CI depend on an untracked checkout, so C.H.A.T. currently
uses the exact `npm pack` artifact recorded under `vendor/`. Its source commit
and SHA-256 are checked during lint. Replace this with an owner-approved private
registry version when package publication and CI credentials are configured.

Application code imports only `@crismag/create-studio` and its documented CSS
and notice exports. It does not import Fabric.js or internal Studio modules.

## Notices

`npm run notices:generate` imports Create Studio's structured notice payload and
combines it with C.H.A.T.'s shipped React dependencies. CI checks the generated
Markdown/JSON records and confirms notice text is present in the production web
bundle. `/open-source-licenses` is bundled, offline-capable, publicly reachable,
and linked from the account menu. A future Capacitor wrapper must package this
same web build and retain the route.

## Manual verification

1. Run `npm install` and `npm run dev`.
2. Sign in and open or create a reflection with a saved passage and a short
   Heart, Application, Testimony, or Condensed Reflection.
3. Choose **Create visual** or open `/create?c=<reflection-id>`.
4. Confirm the reference, passage wording and translation match the reflection.
5. Edit a text layer, select **Save**, reload, and confirm the edit reopens.
6. Select **Export** and inspect the downloaded 1080 × 1080 PNG.
7. Open `/open-source-licenses` directly, then repeat with the browser offline.

Automated checks live in the Create host adapter/component tests and the API
Studio persistence tests.
