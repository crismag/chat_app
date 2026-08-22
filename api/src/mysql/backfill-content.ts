/*
 * Copying the reflections people have written from SQLite into MariaDB.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * The cutover cannot be a single moment. This copies the live content across
 * while SQLite is still the store everything reads and writes, so the target
 * can be filled, checked, and filled again — as many times as it takes —
 * before anything is asked to read from it.
 *
 * ── The three rules it keeps ────────────────────────────────────────────────
 *
 *  1. **It never writes to SQLite.** The source is opened and read. If this
 *     goes wrong, the thing that goes wrong is a copy.
 *
 *  2. **It can be run again.** Every row is keyed by the identifier it already
 *     has — the reflection's own id, which is a UUID — so a second run updates
 *     what it wrote the first time instead of duplicating it. That is what
 *     makes it usable as a repeated top-up rather than a one-shot.
 *
 *  3. **It refuses to guess.** A reflection whose owner has no account in
 *     MariaDB is reported and skipped, never attached to somebody else and
 *     never given away to a placeholder. Guest merge (B3) must already have
 *     run, or orphans here are orphans there.
 *
 * Nothing here flips a route. After this, MariaDB holds a copy and no code
 * reads it.
 */

import type { ResultSetHeader, RowDataPacket } from 'mysql2';

import type { MysqlPool } from './pool.ts';

/** What the source hands over. Deliberately a plain read, not a store. */
export type ContentSource = {
  conversations(): {
    id: string;
    userId: string;
    format: string;
    title: string;
    scriptureReference: string | null;
    visibility: string;
    tags: unknown;
    createdAt: string;
    updatedAt: string;
  }[];
  sections(conversationId: string): { type: string; content: string; authorOrigin: string }[];
  messages(conversationId: string): {
    id: string;
    position: number;
    role: string;
    content: string;
    originalContent: string;
    authorOrigin: string;
    createdAt: string;
  }[];
};

export type BackfillReport = {
  conversations: number;
  sections: number;
  messages: number;
  /** Reflections whose owner has no MariaDB account. Reported, never guessed at. */
  skippedUnknownOwner: string[];
};

/**
 * An ISO timestamp as MariaDB wants it.
 *
 * SQLite keeps these as ISO strings with a `T` and a `Z`. Handing that to a
 * DATETIME column silently truncates on some servers and errors on others, so
 * it is converted here rather than hoped about.
 */
function asDateTime(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return new Date().toISOString().slice(0, 23).replace('T', ' ');
  return when.toISOString().slice(0, 23).replace('T', ' ');
}

export async function backfillContent(
  pool: MysqlPool,
  source: ContentSource,
): Promise<BackfillReport> {
  const report: BackfillReport = {
    conversations: 0,
    sections: 0,
    messages: 0,
    skippedUnknownOwner: [],
  };

  /* One lookup per owner, not one per reflection. */
  const owners = new Map<string, number | null>();
  const ownerId = async (publicUuid: string): Promise<number | null> => {
    const known = owners.get(publicUuid);
    if (known !== undefined) return known;
    const [rows] = await pool.execute<RowDataPacket[]>(
      'SELECT id FROM users WHERE public_uuid = ? AND deleted_at IS NULL',
      [publicUuid],
    );
    const found = rows[0] ? Number(rows[0]['id']) : null;
    owners.set(publicUuid, found);
    return found;
  };

  for (const conversation of source.conversations()) {
    const owner = await ownerId(conversation.userId);
    if (owner === null) {
      report.skippedUnknownOwner.push(conversation.id);
      continue;
    }

    /*
     * Each reflection and everything in it is one transaction. A run
     * interrupted half way leaves whole reflections behind, never a reflection
     * with half its sections — which is the state that would look like data
     * loss to the person who wrote it.
     */
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.execute<ResultSetHeader>(
        `INSERT INTO conversations
           (public_uuid, user_id, format, title, scripture_reference, visibility, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           format = VALUES(format),
           title = VALUES(title),
           scripture_reference = VALUES(scripture_reference),
           visibility = VALUES(visibility),
           tags = VALUES(tags),
           updated_at = VALUES(updated_at)`,
        [
          conversation.id,
          owner,
          conversation.format,
          conversation.title,
          conversation.scriptureReference,
          conversation.visibility,
          JSON.stringify(conversation.tags ?? []),
          asDateTime(conversation.createdAt),
          asDateTime(conversation.updatedAt),
        ],
      );

      const [idRows] = await connection.execute<RowDataPacket[]>(
        'SELECT id FROM conversations WHERE public_uuid = ?',
        [conversation.id],
      );
      const conversationId = Number(idRows[0]?.['id']);

      /*
       * Sections and messages are replaced rather than merged. SQLite is the
       * truth for as long as this script exists, so a section deleted there
       * must not survive here — a top-up that only ever adds would slowly turn
       * the copy into something nobody wrote.
       */
      await connection.execute('DELETE FROM conversation_sections WHERE conversation_id = ?', [
        conversationId,
      ]);
      for (const section of source.sections(conversation.id)) {
        await connection.execute(
          `INSERT INTO conversation_sections (conversation_id, type, content, author_origin)
           VALUES (?, ?, ?, ?)`,
          [conversationId, section.type, section.content, section.authorOrigin],
        );
        report.sections += 1;
      }

      await connection.execute('DELETE FROM conversation_messages WHERE conversation_id = ?', [
        conversationId,
      ]);
      for (const message of source.messages(conversation.id)) {
        await connection.execute(
          `INSERT INTO conversation_messages
             (public_uuid, conversation_id, position, role, content, original_content, author_origin, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            message.id,
            conversationId,
            message.position,
            message.role,
            message.content,
            message.originalContent,
            message.authorOrigin,
            asDateTime(message.createdAt),
          ],
        );
        report.messages += 1;
      }

      await connection.commit();
      report.conversations += 1;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return report;
}

/**
 * Read the live SQLite store as a source.
 *
 * Position is the order the messages come back in, which is the order the
 * table already keeps them: `idx_messages_conversation` is on
 * `(conversationId, position)`, and the reader sorts by it. The thread's order
 * is part of what it means, so it is carried rather than recomputed from
 * timestamps that can tie.
 */
export function sqliteContentSource(store: {
  conversations: { values(): Record<string, unknown>[] };
  sections: { get(id: string): Record<string, { content: string; authorOrigin: string }> | undefined };
  messages: { get(id: string): Record<string, unknown>[] | undefined };
}): ContentSource {
  return {
    conversations: () =>
      store.conversations.values().map((row) => ({
        id: String(row['id']),
        userId: String(row['userId']),
        format: String(row['format'] ?? 'full'),
        title: String(row['title'] ?? ''),
        scriptureReference:
          row['scriptureReference'] == null ? null : String(row['scriptureReference']),
        visibility: String(row['visibility'] ?? 'private'),
        tags: row['tags'] ?? [],
        createdAt: String(row['createdAt']),
        updatedAt: String(row['updatedAt']),
      })),
    sections: (conversationId) =>
      Object.entries(store.sections.get(conversationId) ?? {}).map(([type, section]) => ({
        type,
        content: section.content,
        authorOrigin: section.authorOrigin,
      })),
    messages: (conversationId) =>
      (store.messages.get(conversationId) ?? []).map((message, position) => ({
        id: String(message['id']),
        position,
        role: String(message['role']),
        content: String(message['content']),
        originalContent: String(message['originalContent'] ?? message['content']),
        authorOrigin: String(message['authorOrigin'] ?? 'user'),
        createdAt: String(message['createdAt']),
      })),
  };
}
