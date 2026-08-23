# Tags: the registry, suggestions and moderation

A tag used to be a string on one record. It is now a word in a shared
dictionary: typed once, suggested afterwards, counted, moderated, and
administratively retirable without deleting anything it is attached to.

This document is the design and the reasoning. The word data and how to update
it is [`api/moderation-lists/README.md`](../../api/moderation-lists/README.md).

## The shape of it

```
normalize → validate → moderate → reuse or create → record → rank → suggest ≤ 5
```

| Piece | Where |
| --- | --- |
| Folding, limits, refusal codes | `packages/shared/src/community.ts`, `packages/shared/src/tags.ts` |
| The gate every tag passes | `api/src/tags/validate.ts` |
| Word-list matching | `api/src/tags/moderation.ts` |
| Registry and ranking | `api/src/tags/store.ts` |
| `GET /api/tags/suggest` | `api/src/tags/routes.ts` |
| The field | `web_app/src/tags/TagInput.tsx` |
| MariaDB tables | `api/src/mysql/migrations/010_tag_registry.sql` |

## Normalization was already decided

`canonicalHashtag` has folded tags since hashtags existed and this feature did
not change it: NFC, lowercase, leading `#` removed, **every separator removed**,
40 characters at most. Accents are kept — `#alabaré` is a word somebody chose.

Separators being *removed* rather than normalised to one character is the
consequential part, and it is worth knowing before designing anything on top:

```
bible-study ─┐
bible study ─┼─→ biblestudy      one tag, already, with no merge step
biblestudy  ─┘
```

`displayName` keeps the first spelling anybody typed, so a card can still read
`#Bible-Study`. The key is what queries compare.

## Two counts, and why

The community store says it in one line: *a filter chip is a count with a name
on it, and counts leak.* A suggestion list is the same thing with a keyboard in
front of it, so the registry keeps two numbers that are never the same number.

| Count | Fed by | Read for |
| --- | --- | --- |
| `tags.publicCount` | uses on **published** content | everybody |
| `user_tag_usage.usageCount` | that person's own uses, private included | **that person only** |

A tag typed only in private reflections is in the registry, is suggested back to
its own author forever, and is invisible to everyone else — `publicCount > 0` is
the privacy rule written as a `WHERE` clause. Sharing the reflection is what
gives it standing with strangers.

This is why `record()` takes `published` as a required argument rather than an
option with a default. A default there would be a privacy decision made by
whoever forgot to pass it.

## Ranking

Deterministic, and every term is a fact somebody could check by hand:

| Signal | Weight |
| --- | --- |
| Exact match | 10000 |
| Prefix match | 1000 |
| This person has used it | 500 |
| Their uses | 10 each, capped at 20 uses |
| Published uses | 1 each, capped at 200 |
| Ties | more recently used, then alphabetical |

"Used by this person" alone outweighs anything popularity can contribute, which
is the intended behaviour: a word somebody already chose is nearly always the
word they are typing again. A visitor with no account gets the global ordering —
the fallback the scoring already has, not a special case.

Matching is prefix-only, expressed as a range (`name >= 'pray' AND name <
'praz'`) so the index does the work. There is no substring fallback: with
separators removed, `#prayer` already matches what a hyphenated form would have,
and substring matching would put `mensprayer` under `pray`.

## Moderation

One list, one question. LDNOOBW's English list, stored locally, read once at
startup, never fetched at request time.

**Matching is whole-word, never substring.** The substring version is the single
most common way a filter like this becomes the thing people complain about: it
refuses `assessment`, `class`, `passage`, `compassion` and `Scunthorpe`. Two
comparisons are made instead:

- the folded tag against folded list entries, so `#alabama-hot-pocket` and
  `#alabamahotpocket` are both refused; and
- each word of what was typed, recovered before the fold removed the separators,
  so `#prayer-<slur>` is refused rather than passing because the whole run of
  letters is not itself listed.

A **multi-word entry contributes its folded form only**. The list contains
`god damn`; splitting it into words would refuse `#god` on a Bible reflection
application. `api/src/tags/moderation.test.ts` asserts that specifically, along
with `prayer`, `jesus`, `hell`, `sin`, `lust`, `flesh`, `concubine`,
`circumcision` and `nativity`.

Running two words together defeats this. That is accepted for V1 and is written
down as a test, so it reads as a decision rather than an oversight.

### What a refusal does

Nothing. That is the point:

- no registry row, no `publicCount`, no `user_tag_usage`, no rank, no suggestion;
- the rest of the save succeeds — four good tags and one refused word keeps the
  four and the reflection;
- one neutral sentence comes back: *This tag isn't allowed. Please choose
  another.*

The message is identical for every refusal reason, including "too short". A
message that distinguished them would let anybody map the word list a few
attempts at a time. The reason code (`tag_empty`, `tag_too_short`,
`tag_not_allowed`) is returned for the client and the logs, never rendered.

## Statuses

`active` is suggestable. `hidden` and `blocked` are not, and `blocked` also
refuses new use — an administrator retires a word without deleting the rows that
reference it, because destroying content relationships to moderate a word is not
a repair. `merged` and `mergedIntoId` exist for a consolidation this version
does not perform; the fold has already removed most of the reason for one.

There is **no HTTP surface for any of this**. Status is changed through
`registry.setStatus()`, which means the database, deliberately: an
administrative endpoint is an attack surface, and nothing has yet needed it.

## The interface

One text input holding a comma-separated line, as before. What is new is that
the fragment after the last comma is looked up, and at most five tags are
offered beneath it.

- 200 ms debounce, one request in flight, previous one aborted — without the
  abort a fast typist gets answers out of order and sees suggestions for a
  prefix they have moved past, which looks like a ranking bug and is not;
- choosing replaces **only that fragment**, so earlier tags survive;
- arrow keys and Enter reach a suggestion; Escape dismisses the list, and a
  second Escape cancels the edit;
- a failed lookup is silent — suggestions are a convenience, and typing a new
  tag was always the other half of this control;
- five short rows, anchored under the field, scrolling rather than growing, so
  it stays a hint rather than a panel over somebody's writing on a phone.

## Storage

The live registry is SQLite, in `api/src/tags/store.ts`, which owns its own DDL
the way Notes and Community do. `010_tag_registry.sql` adds the same pair to
MariaDB — additive and unread, exactly as `008` was, so the one-database phase
finds the tables waiting.

Uniqueness on `normalized_name` is the concurrency guarantee, not a hint: two
requests inserting the same new tag at once cannot both succeed, so the registry
cannot acquire two rows for one word. The application-side lookup is an
optimisation on top of that, never the rule.

## Known limits

- **Obfuscation defeats moderation.** `#prayerandshittalk` passes. V1 does not
  chase disguised words.
- **The list is English.** A tag in another language is only checked against
  English entries.
- **Global suggestions start empty** and fill as people share tagged
  reflections. This is the privacy design working, not a bug — it is also why a
  new installation's suggestions are personal long before they are communal.
- **No administrative interface.** Blocking a tag is a database statement.
- **The share composer still has no tag field.** `POST /api/publications`
  accepts `hashtags` and now moderates them, but no client sends any; a
  publication's tags come from the reflection behind it.
