/*
 * Copying what people wrote from SQLite into MariaDB.
 *
 * Every test here is about a way a copy can go wrong quietly: a reflection
 * attached to the wrong person, a second run doubling the thread, a section
 * deleted at the source living on in the copy. None of those would fail
 * loudly, and all of them would be discovered by somebody reading their own
 * reflection.
 */
import type { RowDataPacket } from 'mysql2';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { SqliteStore } from '../db.ts';
import { backfillContent, sqliteContentSource } from './backfill-content.ts';
import { readMysqlConfig } from './config.ts';
import { migrate } from './migrate.ts';
import { createMysqlPool, type MysqlPool } from './pool.ts';

const config = (() => {
  try {
    return readMysqlConfig();
  } catch {
    return null;
  }
})();

describe.skipIf(!config)('backfilling content into MariaDB', () => {
  let pool: MysqlPool;

  beforeAll(async () => {
    if (!config) return;
    pool = createMysqlPool(config);
    await migrate(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function rows<T>(sql: string, params: (string | number)[] = []): Promise<T[]> {
    const [result] = await pool.execute<RowDataPacket[]>(sql, params);
    return result as unknown as T[];
  }

  /** An account that exists in MariaDB, and the uuid SQLite content is owned by. */
  async function anAccount() {
    const uuid = crypto.randomUUID();
    await pool.execute(
      "INSERT INTO users (public_uuid, account_type, created_at) VALUES (?, 'REGISTERED', NOW())",
      [uuid],
    );
    return uuid;
  }

  /** A SQLite store holding one written reflection owned by `userId`. */
  function aStoreWith(userId: string) {
    const store = new SqliteStore();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    store.conversations.set(id, {
      id,
      userId,
      format: 'full',
      title: 'Trusting while I cannot see',
      scriptureReference: 'Romans 8:28',
      visibility: 'private',
      tags: [{ tag: 'waiting', label: 'Waiting' }],
      createdAt: now,
      updatedAt: now,
    } as never);
    store.sections.set(id, {
      heart: { type: 'heart', content: 'It met a fear I had not named.', authorOrigin: 'user' },
      content: { type: 'content', content: 'Romans 8:28 (NIV)', authorOrigin: 'ai_assisted' },
    } as never);
    store.messages.append(id, {
      id: crypto.randomUUID(),
      conversationId: id,
      role: 'user',
      content: 'What does this ask of me?',
      originalContent: 'what does this ask of me',
      authorOrigin: 'user',
      createdAt: now,
    } as never);
    return { store, id };
  }

  test('a reflection arrives whole: its sections, its thread, and its owner', async () => {
    const uuid = await anAccount();
    const { store, id } = aStoreWith(uuid);

    const report = await backfillContent(pool, sqliteContentSource(store));
    expect(report).toMatchObject({ conversations: 1, sections: 2, messages: 1 });
    expect(report.skippedUnknownOwner).toEqual([]);

    const [copied] = await rows<{ title: string; owner_uuid: string; visibility: string }>(
      `SELECT c.title, c.visibility, u.public_uuid AS owner_uuid
         FROM conversations c JOIN users u ON u.id = c.user_id
        WHERE c.public_uuid = ?`,
      [id],
    );
    expect(copied).toMatchObject({
      title: 'Trusting while I cannot see',
      visibility: 'private',
      owner_uuid: uuid,
    });

    /* Authorship travels per section, which the JSON model could not express. */
    const sections = await rows<{ type: string; author_origin: string }>(
      `SELECT s.type, s.author_origin FROM conversation_sections s
         JOIN conversations c ON c.id = s.conversation_id
        WHERE c.public_uuid = ? ORDER BY s.type`,
      [id],
    );
    expect(sections).toEqual([
      { type: 'content', author_origin: 'ai_assisted' },
      { type: 'heart', author_origin: 'user' },
    ]);
  });

  test('running it again tops up rather than duplicating', async () => {
    const uuid = await anAccount();
    const { store, id } = aStoreWith(uuid);

    await backfillContent(pool, sqliteContentSource(store));
    await backfillContent(pool, sqliteContentSource(store));

    const [counted] = await rows<{ reflections: number; sections: number; messages: number }>(
      `SELECT
         (SELECT COUNT(*) FROM conversations WHERE public_uuid = ?) AS reflections,
         (SELECT COUNT(*) FROM conversation_sections s JOIN conversations c ON c.id = s.conversation_id
            WHERE c.public_uuid = ?) AS sections,
         (SELECT COUNT(*) FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
            WHERE c.public_uuid = ?) AS messages`,
      [id, id, id],
    );
    expect({
      reflections: Number(counted?.reflections),
      sections: Number(counted?.sections),
      messages: Number(counted?.messages),
    }).toEqual({ reflections: 1, sections: 2, messages: 1 });
  });

  test('a later edit reaches the copy, and a deleted section does not survive in it', async () => {
    const uuid = await anAccount();
    const { store, id } = aStoreWith(uuid);
    await backfillContent(pool, sqliteContentSource(store));

    /*
     * They rewrote Heart. `sections.set` upserts, so this is what an edit
     * looks like at the source — there is no path in the product that removes
     * a single section, only one that empties it.
     */
    store.sections.set(id, {
      heart: { type: 'heart', content: 'A different wording.', authorOrigin: 'user' },
    } as never);
    /* And a row genuinely gone, which is the state the copy must not preserve. */
    store.db.prepare("DELETE FROM sections WHERE conversationId = ? AND type = 'content'").run(id);

    await backfillContent(pool, sqliteContentSource(store));

    const sections = await rows<{ type: string; content: string }>(
      `SELECT s.type, s.content FROM conversation_sections s
         JOIN conversations c ON c.id = s.conversation_id
        WHERE c.public_uuid = ?`,
      [id],
    );
    /*
     * SQLite is the truth while this script exists. A top-up that only ever
     * added would leave the copy holding writing that no longer exists at the
     * source, and slowly turn it into something nobody wrote.
     */
    expect(sections).toEqual([{ type: 'heart', content: 'A different wording.' }]);
  });

  test('a reflection whose owner has no account is reported, never given away', async () => {
    const { store, id } = aStoreWith('a-uuid-with-no-mariadb-account');

    const report = await backfillContent(pool, sqliteContentSource(store));

    expect(report.conversations).toBe(0);
    expect(report.skippedUnknownOwner).toEqual([id]);
    const [found] = await rows<{ n: number }>(
      'SELECT COUNT(*) AS n FROM conversations WHERE public_uuid = ?',
      [id],
    );
    expect(Number(found?.n)).toBe(0);
  });

  test('the source is only ever read', async () => {
    const uuid = await anAccount();
    const { store, id } = aStoreWith(uuid);
    const before = JSON.stringify(store.conversations.get(id));

    await backfillContent(pool, sqliteContentSource(store));

    /* If this ever goes wrong, what goes wrong is a copy. */
    expect(JSON.stringify(store.conversations.get(id))).toBe(before);
    expect(store.sections.get(id)).toBeDefined();
  });
});
