# Create Studio integration

## Scope

Phase 3 replaces the primitive Create canvas with the private
`@crismag/create-studio` package. C.H.A.T. remains the host and owns every
domain decision, saved document, asset identifier, and exported-file action.
Create Studio receives only its neutral `StudioDocument` contract.

The current integration maps Phase 5 layouts, styles, formats and overflow on
top of Create Studio. The optional generated-background callback is the Phase 6
host boundary: the browser may request an ordinary background through Create
Studio's neutral callback, but the C.H.A.T. backend selects the provider, owns
credentials and billing, registers the result under a stable asset ID, and
permanently stores the bytes and safe provenance. Scripture and user text
remain deterministic foreground elements and are not sent by this adapter.

## Source mapping

`web_app/src/create/host-adapter.ts` is the domain boundary. It maps:

- the selected reflection ID and source update time;
- the exact saved passage, provider passage ID and translation ID;
- the canonical reference and translation abbreviation;
- one user-selected Heart, Application, Testimony, or Condensed Reflection;
- the section's saved authorship provenance.

These values become ordinary text/shape elements with semantic-slot metadata.
Translation copyright stays on the saved passage and the reflection Bible card;
it is not mapped as a Create image layer. No C.H.A.T. types or interpretation
enter the Create Studio package. Saved
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
dimensions and media type. Export does not share to Community.

Generated assets are served from authenticated
`/api/studio-assets/:assetId` routes and remain owner-scoped. Studio documents
store only stable `studio-asset.*` references and provenance, never provider
URLs, signed URLs, credentials, or encoded image bytes. The host asset resolver
turns those IDs into session-local object URLs for preview and export and
revokes them when the route unmounts.

## Image provider boundary

`api/src/create/image-provider.ts` defines the server-only provider seam. A
production adapter receives purpose, exact dimensions, prompt, optional
negative prompt, safe area, and an optional variation seed. It must return
encoded image bytes with matching dimensions and non-sensitive provenance.
Provider errors are replaced with application-owned copy at the HTTP boundary.

Generated backgrounds are disabled by default. Setting
`STUDIO_IMAGE_PROVIDER=deterministic` enables the original local gradient
fixture for development and automated tests. It performs no network request,
uses no model or credential, and must not be represented as AI output. Adding a
real provider requires an owner decision, server-side credentials, terms and
licence review, cost/rate-limit policy, output moderation, and tests through the
same interface; none of that belongs in Create Studio.

## Package consumption

Create Studio is private, `UNLICENSED`, and unpublished. A sibling filesystem
dependency would make CI depend on an untracked checkout, so C.H.A.T. currently
uses the exact `npm pack` artifact recorded under `vendor/`. Its source commit
and SHA-256 are checked during lint. Replace this with an owner-approved private
registry version when package publication and CI credentials are configured.

Application code imports only `@crismag/create-studio` and its documented CSS
and notice exports. It does not import Fabric.js or internal Studio modules.
Canvas transforms are applied through Create Studio's safe canonical-operation
boundary. A rejected drag restores the last valid composition, reports
`onEditorIssue`, and must not blank the Create route or host navigation.
The host passes a narrowed capability policy and no Studio built-in templates.
C.H.A.T. maps its own layouts (quote focus, verse + reflection, stacked
C.H.A.T., two-column C.H.A.T.), styles, and square/portrait formats. The
default Full C.H.A.T. composition is the stacked layout on a 1080×1350
portrait page. Create Studio owns the domain-neutral fit-to-page flow;
C.H.A.T. maps Title + C/H/A/T onto that flow. Pages stay on so leftover
text on other layouts can become a carousel. Drawing, callouts, connectors, and
Studio template replacement stay off.

## Notices

`npm run notices:generate` imports Create Studio's structured notice payload and
combines it with C.H.A.T.'s shipped React dependencies. CI checks the generated
Markdown/JSON records and confirms notice text is present in the production web
bundle. `/open-source-licenses` is bundled, offline-capable, publicly reachable,
and linked from the account menu. The Capacitor wrapper packages this same web
build and keeps the route.

## Manual verification

1. Run `npm install` and `npm run dev`.
2. Sign in and open or create a reflection with a saved passage and a short
   Heart, Application, Testimony, or Condensed Reflection.
3. Choose **Create visual** or open `/create?c=<reflection-id>`.
4. Confirm the reference, passage wording and translation match the reflection.
5. Edit a text layer, select **Save**, reload, and confirm the edit reopens.
6. To exercise the provider boundary locally, set
   `STUDIO_IMAGE_PROVIDER=deterministic`, restart the API, enter a neutral
   background prompt, and select **Generate background**.
7. Confirm the background changes while passage and reflection text do not,
   then try **Generate variation**, save, and reload.
8. Choose a layout, style and square or portrait format, then **Rebuild from
   reflection**. Long text should shrink, then split across cards rather than
   disappear.
9. Select **Export** and inspect the PNG. For a carousel, use **Export all
   pages**.
10. Open `/open-source-licenses` directly, then repeat with the browser offline.

Automated checks live in the Create host adapter/component tests and the API
Studio persistence/generated-asset route tests. The package's own component,
Playwright, and visual tests cover cancellation, regeneration, variations, and
preservation of deterministic foreground content.
