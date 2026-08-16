/*
 * The passage a reflection was written against, kept with the reflection.
 *
 * ── Why this is stored at all, given the note in `cache.ts` ─────────────────
 *
 * `cache.ts` refuses to accumulate passage text, because a growing local copy
 * of a licensed translation is an unlicensed reproduction. This table stores
 * passage text too, and the difference is not a loophole — it is the whole
 * distinction.
 *
 * A cache stores text *because fetching it again would be slow*. This stores
 * text because **it is part of what the person wrote.** A reflection on Romans
 * 8:28 in the NIV is a response to those particular words; opening it next year
 * and finding the Berean Standard Bible's wording underneath — because that is
 * what happened to be selected, or because the NIV had become unreachable —
 * would silently misrepresent what they were responding to. One row per
 * reflection, written when the author chose the passage, is the record of an
 * authored decision.
 *
 * It is bounded by construction: one passage per reflection, deleted with the
 * reflection, never queried as a corpus, never assembled into a Bible.
 *
 * ── Why it has its own table and its own migration ──────────────────────────
 *
 * The connector owns its storage rather than adding columns to `conversations`.
 * That keeps this work to one directory, it means the feature can be removed by
 * dropping one table, and — practically — it does not require editing files
 * another piece of work is in the middle of. The migration is idempotent and
 * runs on construction, exactly as the main schema's does.
 */

import type { DatabaseSync } from 'node:sqlite';
import { BIBLE_PROVIDERS, type BiblePassage } from '@chat/shared';

/**
 * The minimum that must survive, stated so it cannot drift.
 *
 * Content and copyright are stored too, but these four are the ones without
 * which a saved reflection cannot honestly say what it was written against.
 */
export const REQUIRED_PERSISTED_FIELDS = [
  'translationId',
  'passageId',
  'reference',
  'abbreviation',
] as const;

export interface PassageStore {
  get(conversationId: string): BiblePassage | null;
  set(conversationId: string, passage: BiblePassage): void;
  delete(conversationId: string): void;
}

function toRow(conversationId: string, passage: BiblePassage) {
  return {
    conversationId,
    provider: passage.provider,
    translationId: passage.translationId,
    abbreviation: passage.abbreviation,
    name: passage.name,
    passageId: passage.passageId,
    reference: passage.reference,
    content: passage.content,
    copyright: passage.copyright ?? null,
    publisherUrl: passage.links?.publisher ?? null,
    youVersionUrl: passage.links?.youVersion ?? null,
    retrievedAt: passage.retrievedAt,
  };
}

function fromRow(row: Record<string, unknown>): BiblePassage {
  const copyright = typeof row['copyright'] === 'string' ? row['copyright'] : undefined;
  const publisher = typeof row['publisherUrl'] === 'string' ? row['publisherUrl'] : undefined;
  const youVersion = typeof row['youVersionUrl'] === 'string' ? row['youVersionUrl'] : undefined;
  return {
    provider: BIBLE_PROVIDERS.YOUVERSION,
    translationId: Number(row['translationId']),
    abbreviation: String(row['abbreviation']),
    name: String(row['name']),
    passageId: String(row['passageId']),
    reference: String(row['reference']),
    content: String(row['content']),
    ...(copyright ? { copyright } : {}),
    ...(publisher || youVersion
      ? {
          links: {
            ...(publisher ? { publisher } : {}),
            ...(youVersion ? { youVersion } : {}),
          },
        }
      : {}),
    retrievedAt: String(row['retrievedAt']),
  };
}

/** SQLite backing. Migrates its own table, idempotently, on construction. */
export class SqlitePassageStore implements PassageStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    /*
     * `ON DELETE CASCADE` so deleting a reflection takes its passage with it.
     * A stored passage outliving the reflection it belonged to would be a copy
     * of licensed text with no authored decision attached to it — exactly the
     * thing this table is careful not to become.
     */
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reflection_passages (
        conversationId TEXT PRIMARY KEY
          REFERENCES conversations(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        translationId INTEGER NOT NULL,
        abbreviation TEXT NOT NULL,
        name TEXT NOT NULL,
        passageId TEXT NOT NULL,
        reference TEXT NOT NULL,
        content TEXT NOT NULL,
        copyright TEXT,
        publisherUrl TEXT,
        youVersionUrl TEXT,
        retrievedAt TEXT NOT NULL
      );
    `);
  }

  get(conversationId: string): BiblePassage | null {
    const row = this.db
      .prepare('SELECT * FROM reflection_passages WHERE conversationId = ?')
      .get(conversationId) as Record<string, unknown> | undefined;
    return row ? fromRow(row) : null;
  }

  set(conversationId: string, passage: BiblePassage): void {
    const row = toRow(conversationId, passage);
    this.db
      .prepare(
        `INSERT INTO reflection_passages
           (conversationId, provider, translationId, abbreviation, name, passageId,
            reference, content, copyright, publisherUrl, youVersionUrl, retrievedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(conversationId) DO UPDATE SET
           provider = excluded.provider,
           translationId = excluded.translationId,
           abbreviation = excluded.abbreviation,
           name = excluded.name,
           passageId = excluded.passageId,
           reference = excluded.reference,
           content = excluded.content,
           copyright = excluded.copyright,
           publisherUrl = excluded.publisherUrl,
           youVersionUrl = excluded.youVersionUrl,
           retrievedAt = excluded.retrievedAt`,
      )
      .run(
        row.conversationId,
        row.provider,
        row.translationId,
        row.abbreviation,
        row.name,
        row.passageId,
        row.reference,
        row.content,
        row.copyright,
        row.publisherUrl,
        row.youVersionUrl,
        row.retrievedAt,
      );
  }

  delete(conversationId: string): void {
    this.db.prepare('DELETE FROM reflection_passages WHERE conversationId = ?').run(conversationId);
  }
}

/** In-memory backing, for the store the tests use and for a keyless dev run. */
export class MemoryPassageStore implements PassageStore {
  private readonly rows = new Map<string, BiblePassage>();

  get(conversationId: string): BiblePassage | null {
    const row = this.rows.get(conversationId);
    return row ? { ...row } : null;
  }

  set(conversationId: string, passage: BiblePassage): void {
    this.rows.set(conversationId, { ...passage });
  }

  delete(conversationId: string): void {
    this.rows.delete(conversationId);
  }
}

/**
 * Pick a backing from whatever store the app was built with.
 *
 * The application's store is either SQLite — which exposes its handle — or the
 * in-memory one a test hands in. Rather than teach either of them about
 * passages, this reads the handle if there is one and falls back if there is
 * not, which is what keeps the change to `app.ts` down to mounting a route.
 */
export function createPassageStore(store: unknown): PassageStore {
  const handle = (store as { db?: DatabaseSync }).db;
  if (handle && typeof handle.prepare === 'function') {
    return new SqlitePassageStore(handle);
  }
  return new MemoryPassageStore();
}
