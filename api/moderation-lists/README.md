# Moderation lists

Word data used to refuse a tag. **Application data, not secrets and not code** —
it ships inside `api/`, it is read from disk once at startup, and no request a
person makes ever reaches the network because of it.

```
api/moderation-lists/
├── banned-words.txt   the upstream list, byte for byte as retrieved
├── sources.json       where it came from, its licence, and which commit
└── README.md          this file
```

## What is here

| File | Upstream | Licence | Retrieved |
| --- | --- | --- | --- |
| `banned-words.txt` | [LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words), file `en` | CC-BY-4.0 | 2026-08-23, commit `4638b97` |

The licence is Creative Commons Attribution 4.0, which is why the attribution in
`sources.json` is a field rather than a note: keeping it is a condition of use,
and it is also listed with the other third-party notices the application shows
at `/open-source-licenses`.

The file is kept **exactly as retrieved**. Nothing here is edited by hand — an
edited copy of an upstream list is a copy nobody can update again without first
working out what was changed and why.

## Updating it

```bash
curl -sSfL \
  https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en \
  -o api/moderation-lists/banned-words.txt
```

Then update `commit`, `commitDate`, `retrieved` and `entries` in `sources.json`:

```bash
curl -sS "https://api.github.com/repos/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/commits?path=en&per_page=1"
wc -l api/moderation-lists/banned-words.txt
```

Run `npm test -w api` afterwards. `api/src/tags/moderation.test.ts` asserts both
that the list still refuses what it should and that it still admits ordinary
religious vocabulary — an upstream change that started refusing `nativity` or
`passion` would fail there rather than in front of somebody trying to tag a
reflection.

## What this is not

There is no allowlist and no local blocklist. V1 is deliberately one list and
one question: does the normalized tag match it. If a false positive appears in
practice, that is the moment to add an override file — not before, because an
override file with nothing in it is a mechanism nobody has tested.

The matching itself is described where it happens, in `api/src/tags/moderation.ts`.
It is whole-word and whole-tag; it is not substring matching, which would refuse
`assessment`, `class`, `Scunthorpe` and a great deal of Scripture.
