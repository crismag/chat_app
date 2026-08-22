/*
 * Notes endpoints.
 *
 *   GET    /api/notes              — this person's notes, for a view and query
 *   POST   /api/notes              — create one; empty title and body are fine
 *   GET    /api/notes/:id          — one note, if they own it
 *   PATCH  /api/notes/:id          — title, body, pinned, archived
 *   DELETE /api/notes/:id          — soft-delete (trash); unpins
 *   POST   /api/notes/:id/restore  — leave trash; archived flag is kept
 *
 * ── Where authorisation happens ─────────────────────────────────────────────
 *
 * In the store. Every read and write goes through a method that takes `userId`
 * and puts it in the WHERE clause. This file's job on a miss is to turn `null`
 * into 404, with a body that names neither the note nor its owner.
 *
 * ── The 404 that says nothing ───────────────────────────────────────────────
 *
 * A note that does not exist and a note that belongs to somebody else return
 * exactly the same payload. Distinguishing them would confirm that a particular
 * id is in use — which is the disclosure ownership exists to prevent, made
 * through a status code.
 *
 * ── Who "this person" is ────────────────────────────────────────────────────
 *
 * `currentOwner` is the session, else the recognised guest installation — the
 * same `currentAccount` reflections use. Nobody is an ordinary answer: a
 * visitor listing notes gets an empty list, and a visitor writing one is told
 * an account is needed. The owner is taken from that function, never from a
 * client-supplied `user_id`.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { CREATION_SOURCES } from '@chat/shared';
import type { AuthUser } from '../auth/store.ts';
import { readNoteView } from './limits.ts';
import { parseNoteWrite, type NotesStore } from './store.ts';

export type NotesRouteOptions = {
  currentOwner: (c: Context) => Promise<AuthUser | null>;
  store: NotesStore;
};

const NOT_FOUND = { error: 'Note not found.' };

const accountRequired = {
  error: 'Saving this needs an account — continue as a guest, or sign in.',
  needsAccount: true as const,
  creationSource: CREATION_SOURCES.OTHER_PERSISTENT_ACTION,
};

export function createNotesRoutes({ currentOwner, store }: NotesRouteOptions) {
  const app = new Hono();

  app.get('/', async (c) => {
    const owner = await currentOwner(c);
    const view = readNoteView(c.req.query('view'));
    if (!view) {
      return c.json({ error: 'View must be active, archived or trash.' }, 400);
    }
    if (!owner) return c.json({ items: [], view });
    const q = c.req.query('q') ?? '';
    return c.json({ items: store.list({ userId: owner.id, view, q }), view });
  });

  app.post('/', async (c) => {
    const owner = await currentOwner(c);
    if (!owner) return c.json(accountRequired, 401);
    const parsed = parseNoteWrite(await c.req.json<unknown>().catch(() => ({})));
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    return c.json(store.create(owner.id, parsed.value), 201);
  });

  app.post('/:id/restore', async (c) => {
    const owner = await currentOwner(c);
    if (!owner) return c.json(accountRequired, 401);
    const restored = store.restore(owner.id, c.req.param('id'));
    if (!restored) return c.json(NOT_FOUND, 404);
    return c.json(restored);
  });

  app.get('/:id', async (c) => {
    const owner = await currentOwner(c);
    if (!owner) return c.json(NOT_FOUND, 404);
    const note = store.get(owner.id, c.req.param('id'));
    if (!note) return c.json(NOT_FOUND, 404);
    return c.json(note);
  });

  app.patch('/:id', async (c) => {
    const owner = await currentOwner(c);
    if (!owner) return c.json(accountRequired, 401);
    const parsed = parseNoteWrite(await c.req.json<unknown>().catch(() => ({})));
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const updated = store.update(owner.id, c.req.param('id'), parsed.value);
    if (!updated) return c.json(NOT_FOUND, 404);
    return c.json(updated);
  });

  app.delete('/:id', async (c) => {
    const owner = await currentOwner(c);
    if (!owner) return c.json(accountRequired, 401);
    const deleted = store.softDelete(owner.id, c.req.param('id'));
    if (!deleted) return c.json(NOT_FOUND, 404);
    return c.json(deleted);
  });

  return app;
}
