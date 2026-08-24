/*
 * Import and export of a person's own writing.
 *
 *   GET  /api/library/export?reflections=1&notes=1&format=json|markdown
 *   POST /api/library/import
 *
 * Registered accounts only. A guest has a session and can write, but this
 * surface is a backup of a named library, and it lives on the profile — which
 * a guest does not have. The refusal does not offer to create a guest: that
 * would be answering "I wanted a file of my writing" with a different product.
 *
 * Exporting is not sharing. Importing always creates new private copies.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  ACCOUNT_TYPES,
  ARCHIVE_FORMATS,
  ARCHIVE_LIMITS,
  archiveByteLength,
  archiveFilename,
  parseLibrary,
  selectionFromQuery,
  selectionFromUnknown,
  serializeLibrary,
  tooManyItems,
  type ArchiveFormat,
} from '@chat/shared';
import type { AuthUser } from '../auth/store.ts';
import { SlidingWindowRateLimiter } from '../ai/rate-limit.ts';
import { addressOf } from '../http/address.ts';
import type { NotesStore } from '../notes/store.ts';
import { applyArchive, buildArchiveFromStores, type ConversationTable, type PassageTable, type SectionTable, type TagRecorder } from './apply.ts';

const GUEST_REFUSED = {
  error: 'Importing and exporting is available on a signed-in account.',
};

const UNAUTHENTICATED = { error: 'Unauthenticated.' };

export type LibraryRouteOptions = {
  currentUser: (c: Context) => Promise<AuthUser | null>;
  conversations: ConversationTable;
  sections: SectionTable;
  passages?: PassageTable;
  notes: NotesStore;
  tags: TagRecorder;
  now?: () => string;
  exportLimiter?: SlidingWindowRateLimiter;
  importLimiter?: SlidingWindowRateLimiter;
  addressOf?: (c: Context) => string;
};

function readFormat(value: string | undefined): ArchiveFormat | { error: string } {
  if (!value || value === ARCHIVE_FORMATS.JSON) return ARCHIVE_FORMATS.JSON;
  if (value === ARCHIVE_FORMATS.MARKDOWN || value === 'md') return ARCHIVE_FORMATS.MARKDOWN;
  return { error: 'Format must be json or markdown.' };
}

function rateLimited(c: Context, retryAfterSeconds: number, message: string) {
  c.header('Retry-After', String(retryAfterSeconds));
  return c.json({ error: message }, 429);
}

export function createLibraryRoutes({
  currentUser,
  conversations,
  sections,
  passages,
  notes,
  tags,
  now = () => new Date().toISOString(),
  exportLimiter = new SlidingWindowRateLimiter(20, Date.now, 60 * 60 * 1000),
  importLimiter = new SlidingWindowRateLimiter(10, Date.now, 60 * 60 * 1000),
  addressOf: address = addressOf,
}: LibraryRouteOptions) {
  const app = new Hono();

  const requireRegistered = async (c: Context) => {
    const user = await currentUser(c);
    if (!user) return { error: 401 as const, user: null };
    if (user.accountType !== ACCOUNT_TYPES.REGISTERED) {
      return { error: 403 as const, user: null };
    }
    return { error: null, user };
  };

  app.get('/export', async (c) => {
    const auth = await requireRegistered(c);
    if (auth.error === 401) return c.json(UNAUTHENTICATED, 401);
    if (auth.error === 403 || !auth.user) return c.json(GUEST_REFUSED, 403);

    const selection = selectionFromQuery({
      get: (name) => c.req.query(name),
    });
    if ('error' in selection) return c.json({ error: selection.error }, 400);

    const format = readFormat(c.req.query('format'));
    if (typeof format === 'object') return c.json({ error: format.error }, 400);

    const allowed = exportLimiter.take(auth.user.id);
    if (!allowed.allowed) {
      return rateLimited(
        c,
        allowed.retryAfterSeconds,
        'That is as many downloads as one account can make in an hour.',
      );
    }

    const archive = buildArchiveFromStores(auth.user.id, selection, {
      conversations,
      sections,
      passages,
      notes,
      exportedAt: now(),
    });
    const body = serializeLibrary(archive, format);
    const filename = archiveFilename(selection, format, new Date(archive.exportedAt));
    const type =
      format === ARCHIVE_FORMATS.MARKDOWN
        ? 'text/markdown; charset=utf-8'
        : 'application/json; charset=utf-8';

    return c.body(body, 200, {
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  app.post('/import', async (c) => {
    const auth = await requireRegistered(c);
    if (auth.error === 401) return c.json(UNAUTHENTICATED, 401);
    if (auth.error === 403 || !auth.user) return c.json(GUEST_REFUSED, 403);

    const allowed = importLimiter.take(`${auth.user.id}:${address(c)}`);
    if (!allowed.allowed) {
      return rateLimited(
        c,
        allowed.retryAfterSeconds,
        'That is as many imports as one account can make in an hour.',
      );
    }

    const body = await c.req.json<unknown>().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'A JSON object with the file text is required.' }, 400);
    }
    const payload = body as Record<string, unknown>;
    const text = typeof payload['text'] === 'string' ? payload['text'] : '';
    if (!text.trim()) return c.json({ error: 'That file was empty.' }, 400);
    if (archiveByteLength(text) > ARCHIVE_LIMITS.maxBytes) {
      return c.json({ error: 'That file is too large to import.' }, 413);
    }

    const include = payload['include'] ?? {
      reflections: payload['reflections'],
      notes: payload['notes'],
    };
    const selection = selectionFromUnknown(include);
    if ('error' in selection) return c.json({ error: selection.error }, 400);

    const parsed = parseLibrary(text, now);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const over = tooManyItems(parsed.archive);
    if (over) return c.json({ error: over }, 400);

    const result = applyArchive(auth.user.id, parsed.archive, selection, {
      conversations,
      sections,
      passages,
      notes,
      tags,
      now: now(),
    });

    if (result.imported.reflections === 0 && result.imported.notes === 0) {
      return c.json(
        {
          error:
            result.skipped[0]?.reason ??
            'Nothing in that file could be imported with the boxes you ticked.',
          imported: result.imported,
          skipped: result.skipped,
        },
        400,
      );
    }

    return c.json(
      {
        imported: result.imported,
        skipped: result.skipped,
      },
      201,
    );
  });

  return app;
}
