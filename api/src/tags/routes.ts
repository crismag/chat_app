import { Hono } from 'hono';
import type { Context } from 'hono';
import { TAG_SUGGEST_LIMIT, canonicalHashtag } from '@chat/shared';
import type { AuthUser } from '../auth/store.ts';
import type { TagRegistry } from './store.ts';

/*
 * Tag suggestions.
 *
 *   GET /api/tags/suggest?q=pray&limit=5   — at most five, ranked
 *
 * ── Why there is no create endpoint ─────────────────────────────────────────
 *
 * A tag is not a thing somebody makes; it is a thing that happens when they tag
 * something. The registry is written by the code that saves a reflection or a
 * publication, inside that save, so a tag cannot exist attached to nothing and
 * cannot be conjured by a client posting to an endpoint. This file only reads.
 *
 * ── What a stranger may see ─────────────────────────────────────────────────
 *
 * The store decides that, and it is the reason `userId` is passed rather than
 * looked up there: a signed-in person's own tags rank first for them, and
 * everybody sees published tags. A visitor with no account gets the global list
 * — the fallback the ranking already has, not a special case.
 *
 * ── What is never returned ──────────────────────────────────────────────────
 *
 * Counts. A suggestion is a word and its label; how many people used it is a
 * fact about people, and the community store's own note on this is that a
 * count with a name on it leaks. Nothing here returns a number.
 */

export type TagRouteOptions = {
  /** The session, else the recognised guest, else nobody. Never client-supplied. */
  currentOwner: (c: Context) => Promise<AuthUser | null>;
  registry: TagRegistry;
};

export function createTagRoutes({ currentOwner, registry }: TagRouteOptions) {
  const app = new Hono();

  app.get('/suggest', async (c) => {
    /*
     * The query is folded exactly as a tag is, so what somebody typed matches
     * what was stored. `#Pray`, ` pray ` and `PRAY` are one query — a search
     * box that normalised differently from the writer would find nothing and
     * look broken.
     */
    const query = canonicalHashtag(c.req.query('q') ?? '');
    if (!query) return c.json({ suggestions: [] });

    /*
     * The client's limit is a request, not an instruction. `boundedLimit` in
     * the store caps it at five however large it arrives — including when it
     * arrives as `abc`, which Number() turns into NaN.
     */
    const requested = Number(c.req.query('limit'));
    const owner = await currentOwner(c);

    const suggestions = registry.suggest({
      userId: owner?.id ?? null,
      query,
      limit: Number.isFinite(requested) ? requested : TAG_SUGGEST_LIMIT,
    });

    return c.json({ suggestions });
  });

  return app;
}
