# Notes

Private, Keep-like notes inside C.H.A.T. A person can write, search, pin, archive, trash and restore their own notes. Notes are not reflections: they have no verse, no C.H.A.T. sections, and no sharing.

This file plus the two `notes/` folders is the whole module. Another agent should not need to hunt through `app.ts` to understand it.

## Scope

In:

- Owner-only notes with title and body
- Active, archive and trash views
- Pin, search, soft-delete, restore
- Guests with a session or recognised installation, same as reflections
- Visitors: empty list on GET, `needsAccount` on writes

Out (do not build these here):

- Labels, colours, checklists, reminders
- Sharing, collaboration, or community
- A Redis cache, a notes microservice, or a `modules/` tree
- A foreign key from `notes.userId` to `users` (accounts may be in MariaDB)
- Reusing `conversations` / reflections tables
- New fields on `@chat/shared` (writes use `CREATION_SOURCES.OTHER_PERSISTENT_ACTION`)

## Architecture

Notes is a feature folder, not a new top-level package.

- **API** owns the table, the queries and the HTTP surface. Ownership is in every SQL `WHERE`. The JSON a route returns never includes `userId`.
- **Web** owns the Keep-like page, the overlay editor and the API client. It renders what the server sent; it does not filter another person's notes client-side, because those notes never arrive.
- **Shared-file wiring is tiny.** `createApp` constructs the store and mounts the routes. `App.tsx` adds `/notes`. `AppShell` adds one nav item.

There are two store implementations. SQLite is the real one (`CREATE TABLE IF NOT EXISTS`, like community and profile). Memory exists so `createApp(new MemoryStore())` still works: rows live in a `WeakMap` keyed by the store object. Authorisation tests use `SqliteStore(':memory:')`.

## Directory structure

```
api/src/notes/
  limits.ts          NOTE_TITLE_MAX, NOTE_BODY_MAX, views, LIKE escaping
  store.ts           SqliteNotesStore, MemoryNotesStore, parseNoteWrite, publicNote
  routes.ts          Hono app mounted at /api/notes
  notes.test.ts      Payload-level tests, including ownership
  README.md          This file

web_app/src/notes/
  api.ts             Types and list/create/get/update/delete/restore
  icons.tsx          NotesIcon (nav), PinIcon, ArchiveIcon, local actions
  NotesPage.tsx      Toolbar, views, grid, empty states
  NotesPage.module.css
  NoteCard.tsx       Compact card with preview and icon actions
  NoteEditor.tsx     Overlay editor with debounced save
  NoteEditor.module.css
  NotesPage.test.tsx
```

## Schema

```
notes(
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,          -- no FK to users
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  isPinned INTEGER NOT NULL DEFAULT 0,
  isArchived INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT,
  updatedAt TEXT,
  deletedAt TEXT
)

INDEX idx_notes_owner_list (userId, deletedAt, isArchived, isPinned, updatedAt)
```

Created on first use with `CREATE TABLE IF NOT EXISTS`. Existing SQL migrations are not edited.

## API

Mounted at `/api/notes`.

| Method | Path | Who | Result |
| --- | --- | --- | --- |
| GET | `/?view=&q=` | Anybody | `{ items, view }`. Nobody signed in → `{ items: [], view }` 200. |
| POST | `/` | Account | 201 note. Nobody → 401 `{ error, needsAccount: true, creationSource: 'OTHER_PERSISTENT_ACTION' }`. |
| GET | `/:id` | Owner | The note, or 404. |
| PATCH | `/:id` | Owner | `{ title?, body?, pinned?: boolean, archived?: boolean }`. 400 if over-long or wrong type. Nobody → 401. |
| DELETE | `/:id` | Owner | Soft-delete: sets `deletedAt`, unpins. Nobody → 401. |
| POST | `/:id/restore` | Owner | Clears `deletedAt`, keeps `archived`. Nobody → 401. |

Limits: title 200, body 20 000. Over-long is refused, never clipped.

List order: `isPinned DESC`, `updatedAt DESC`. Search is `title OR body LIKE`, owner-scoped and view-scoped. `likePattern` escapes `\`, `%` and `_`.

`publicNote()` omits `userId` and nothing else sensitive.

## Ownership

The owner is `currentAccount` (session, else recognised guest installation). The client never supplies `user_id`.

Missing and not-yours are both 404, with a body that does not contain the note's title, body or id. Search never returns another user's notes.

## Integration points

- `api/src/app.ts` — `createNotesStore(store)` next to `communityStore`; `app.route('/api/notes', createNotesRoutes({ currentOwner: (c) => currentAccount(c), store: notesStore }))` after the community `app.route` block.
- `web_app/src/app/App.tsx` — `<Route path="/notes" element={<NotesPage />} />` inside `AppShell`.
- `web_app/src/shared/layout/AppShell.tsx` — nav item `{ to: '/notes', label: 'Notes', Icon: NotesIcon }` after Reflections.

## UI behaviour

- Toolbar: **+ New note**, search, compact **Active | Archive | Trash**.
- New note: `POST` an empty note, then open the editor immediately.
- Pinned section, then the rest. Compact cards: title + short body preview. Click opens the editor (full-screen on a phone, dialog on desktop — a notes-local overlay, not a second global Sheet).
- Icon actions: pin, archive, delete; restore in trash. Overflow menu when crowded. Touch targets ~44px.
- Auto-save: debounce ~600ms. Status: Editing / Saving… / Saved / Save failed. A save generation ignores stale PATCH results.
- Empty states in plain language (not "No posts").
- Mobile bar title: "Notes".
- Visitors creating a note hit `ApiError` `needsAccount`; the existing `AccountChoice` flow handles it. Do not duplicate that UI.

## Limitations

- Notes are private to one account. There is no share. A registered account can export and import them from Settings on their profile, together with reflections.
- Trash is not emptied automatically and there is no permanent-delete control.
- Search is substring `LIKE`, not ranked full-text.
- No offline cache; the list is whatever the API last returned.

## Future ideas (do not build)

- Labels, colours, checklists, reminders
- Rich text or Markdown
- Pin-to-top limits, grid density, list/grid toggle
- Empty-trash, restore-all
- Attach a note to a reflection, or turn a note into one
- Encryption at rest beyond what the host already does
