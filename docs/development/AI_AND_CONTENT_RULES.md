# AI and Content Rules

## Purpose

C.H.A.T. uses AI to assist reflection, explanation, wording, organization, and creative presentation. The product must preserve the distinction between:

- what the user wrote or experienced;
- what AI suggested;
- what Scripture says;
- what interpretation or commentary says.

## 1. Heart and testimony are not generative filler

Heart is the user's personal response to the passage. Testimony represents the user's own experience, witness, declaration, commitment, prayer, or belief.

AI may:

- correct grammar;
- improve clarity;
- shorten;
- help organize;
- ask prompting questions;
- help the user turn rough notes into a coherent Heart or Testimony after the user supplies the substance.

AI must not:

- invent an experience and present it as the user's;
- fabricate answered prayer, healing, provision, encounter, conversion, or personal history;
- silently manufacture Heart or Testimony when the user has not expressed it;
- silently add details that change what happened.

## 2. Preserve originals

When AI modifies user-authored content, retain the original or revision history.

Operations should have understandable semantics:

### Grammar only
Correct spelling, punctuation, and grammar with minimal stylistic change.

### Polish
Improve clarity and flow while preserving meaning and voice.

### Strengthen
Offer more deliberate or impactful phrasing. This may be more editorial and should be presented as a proposal.

### Shorten
Reduce length while preserving the central meaning.

### Explain
Generate commentary or explanation. Do not present it as the user's writing.

## 3. Scripture and commentary are different layers

The application should distinguish Scripture text/reference from explanatory content.

When a particular Bible translation is displayed or quoted, translation/source handling must follow applicable licensing and attribution requirements.

Do not silently rewrite a verse and present the paraphrase as verbatim Scripture.

## 4. Theological assistance

AI explanations should be framed as assistance rather than as infallible theological authority.

Where interpretation is disputed or denomination-dependent, the product should avoid presenting one interpretation as unquestionably the only possible reading unless the user has explicitly selected a doctrinal framework that supports that behavior.

Future product settings may allow users or communities to select preferred translations or theological traditions, but this is not required for the first MVP.

## 5. C.H.A.T. extraction

When extracting a structured C.H.A.T. from conversation:

- Content may summarize relevant explanatory conversation and the person's understanding of the passage.
- Heart may organize what the user expressed about how the passage touched, convicted, encouraged, challenged, or affected them. It must not be silently manufactured by AI.
- Application may summarize how the user said the passage applies to them and how they intend to respond.
- Testimony may organize a user-authored testimony, declaration of faith or conviction, commitment, prayer, or statement of belief. It must rely on the user's expressed substance.

If no Heart or Testimony exists, the system should leave that section empty or invite the user to add it rather than fabricate it.

## 6. Suggested verses

Related-Scripture suggestions should be clearly presented as suggestions.

The application should preserve exact references and allow the user to inspect surrounding context rather than encouraging isolated proof-text behavior.

## 7. Visual creation

AI may help with:

- selecting a visual mood;
- selecting a style;
- generating a background prompt;
- creating a topical background image;
- condensing long content for a social format when requested.

AI should not be responsible for final typesetting of important text.

Preferred pipeline:

```text
AI or user selects/generates background
               +
application-rendered typography and layout
               =
final visual artifact
```

## 8. Generated background prompts

Background prompts should normally request:

- no visible text;
- no logos;
- appropriate negative space;
- composition suitable for the target card format;
- visual theme related to the content without forcing literal imagery.

Users should be able to regenerate or replace the background without changing their written content.

## 9. Content condensation

When preparing long material for cards/carousels:

- never imply that condensed wording is verbatim if it is not;
- preserve the original source content;
- allow the user to review substantial reductions;
- prefer splitting across cards when shortening would remove important meaning.

## 10. Publication

AI assistance does not change publication status.

A private C.H.A.T. remains private after:

- AI explanation;
- polishing;
- C.H.A.T. extraction;
- card creation;
- AI background generation;
- export.

Only the explicit publication action changes internal platform visibility.

## 11. Provider abstraction

Do not encode product rules only inside prompts for a specific AI provider.

Authorship, privacy, publication, revision preservation, and content provenance are application rules and should be enforced in application/domain logic where appropriate.

## 12. User control

The user should ultimately decide:

- whether to use AI;
- whether to accept an AI revision;
- what becomes part of the structured C.H.A.T.;
- what visual is exported;
- what is published to the community.

AI should reduce friction without taking ownership of the user's words, faith experience, or publishing decisions.
