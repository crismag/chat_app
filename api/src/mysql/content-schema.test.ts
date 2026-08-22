/*
 * The reflection model MariaDB will hold, and the rules that make it one.
 *
 * The point of these is not that the tables exist. It is that the shape the
 * editor depends on survives the move: a section is a row, its authorship is
 * its own, and deleting a reflection really deletes all of it. The legacy
 * `reflections` / `chat_content` document model cannot express the first two,
 * which is why the cutover does not use it.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

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

describe.skipIf(!config)('the live content model in MariaDB', () => {
  let pool: MysqlPool;

  beforeAll(async () => {
    if (!config) return;
    pool = createMysqlPool(config);
    await migrate(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  type Param = string | number | null;

  async function rows<T>(sql: string, params: Param[] = []): Promise<T[]> {
    const [result] = await pool.execute<RowDataPacket[]>(sql, params);
    return result as unknown as T[];
  }

  async function one<T>(sql: string, params: Param[] = []): Promise<T> {
    const [first] = await rows<T>(sql, params);
    if (!first) throw new Error(`expected a row from: ${sql}`);
    return first;
  }

  function run(sql: string, params: Param[] = []) {
    return pool.execute<ResultSetHeader>(sql, params);
  }

  async function aReflection() {
    await run(
      "INSERT INTO users (public_uuid, account_type, created_at) VALUES (UUID(), 'REGISTERED', NOW())",
    );
    const user = await one<{ id: number }>('SELECT id FROM users ORDER BY id DESC LIMIT 1');
    await run(
      `INSERT INTO conversations (public_uuid, user_id, title, visibility, created_at, updated_at)
       VALUES (UUID(), ?, 'Trusting while I cannot see', 'private', NOW(3), NOW(3))`,
      [user.id],
    );
    const conversation = await one<{ id: number; public_uuid: string }>(
      'SELECT id, public_uuid FROM conversations ORDER BY id DESC LIMIT 1',
    );
    return { userId: user.id, id: conversation.id, uuid: conversation.public_uuid };
  }

  function writeSection(conversationId: number, type: string, content: string, origin: string) {
    return run(
      `INSERT INTO conversation_sections (conversation_id, type, content, author_origin)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE content = VALUES(content), author_origin = VALUES(author_origin)`,
      [conversationId, type, content, origin],
    );
  }

  test('a section is one row per type, so writing it again is an edit', async () => {
    const reflection = await aReflection();
    await writeSection(reflection.id, 'heart', 'It met a fear I had not named.', 'user');
    await writeSection(reflection.id, 'heart', 'A different wording.', 'user');

    const heart = await rows<{ content: string }>(
      "SELECT content FROM conversation_sections WHERE conversation_id = ? AND type = 'heart'",
      [reflection.id],
    );
    expect(heart).toHaveLength(1);
    expect(heart[0]?.content).toBe('A different wording.');
  });

  test('each section carries its own authorship, and one edit does not restate another', async () => {
    const reflection = await aReflection();
    await writeSection(reflection.id, 'content', 'Romans 8:28 (NIV)', 'user');
    await writeSection(reflection.id, 'heart', 'A suggested wording, accepted.', 'ai_assisted');

    /* Editing Content must not touch how Heart came to be written. */
    await writeSection(reflection.id, 'content', 'Romans 8:28, in full.', 'user');

    const origins = await rows<{ type: string; author_origin: string }>(
      'SELECT type, author_origin FROM conversation_sections WHERE conversation_id = ? ORDER BY type',
      [reflection.id],
    );
    expect(origins).toEqual([
      { type: 'content', author_origin: 'user' },
      { type: 'heart', author_origin: 'ai_assisted' },
    ]);
  });

  test('a message keeps what the person actually wrote beside what is shown', async () => {
    const reflection = await aReflection();
    await run(
      `INSERT INTO conversation_messages
         (public_uuid, conversation_id, position, role, content, original_content, author_origin)
       VALUES (UUID(), ?, 0, 'user', 'A tidied wording.', 'what they actually typed', 'ai_assisted')`,
      [reflection.id],
    );

    const message = await one<{ content: string; original_content: string }>(
      'SELECT content, original_content FROM conversation_messages WHERE conversation_id = ?',
      [reflection.id],
    );
    /* Undo restores authorship, not only text, and this is what it restores from. */
    expect(message.original_content).toBe('what they actually typed');
    expect(message.content).not.toBe(message.original_content);
  });

  test('deleting a reflection deletes all of it', async () => {
    const reflection = await aReflection();
    await writeSection(reflection.id, 'heart', 'Something written.', 'user');
    await run(
      `INSERT INTO conversation_messages
         (public_uuid, conversation_id, position, role, content, original_content, author_origin)
       VALUES (UUID(), ?, 0, 'user', 'A question.', 'A question.', 'user')`,
      [reflection.id],
    );

    await run('DELETE FROM conversations WHERE id = ?', [reflection.id]);

    const left = await one<{ sections: number; messages: number }>(
      `SELECT
         (SELECT COUNT(*) FROM conversation_sections WHERE conversation_id = ?) AS sections,
         (SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = ?) AS messages`,
      [reflection.id, reflection.id],
    );
    expect({ sections: Number(left.sections), messages: Number(left.messages) }).toEqual({
      sections: 0,
      messages: 0,
    });
  });

  test('the identifier a browser sees is a UUID, not a number to count with', async () => {
    const reflection = await aReflection();
    expect(reflection.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);

    /* Two reflections must not be able to claim one public identifier. */
    await expect(
      run(
        `INSERT INTO conversations (public_uuid, user_id, title, visibility, created_at, updated_at)
         VALUES (?, ?, 'A second one', 'private', NOW(3), NOW(3))`,
        [reflection.uuid, reflection.userId],
      ),
    ).rejects.toThrow(/duplicate/i);
  });

  test('tags are a list, and the database refuses anything that is not', async () => {
    const reflection = await aReflection();
    await expect(
      run('UPDATE conversations SET tags = ? WHERE id = ?', ['not json at all', reflection.id]),
    ).rejects.toThrow();
  });
});
