/*
 * The community rules, as MariaDB will have to enforce them.
 *
 * These are not schema-shape assertions for their own sake. Each one is a rule
 * the live SQLite store already keeps, and the cutover cannot begin until the
 * target keeps it too — so each test states the rule and then asks the database
 * to break it.
 *
 * Skipped without MYSQL_* configured, like every other durable suite. A mock
 * would prove the SQL parses, not that MariaDB enforces anything.
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

describe.skipIf(!config)('community rules in MariaDB', () => {
  let pool: MysqlPool;

  beforeAll(async () => {
    if (!config) return;
    pool = createMysqlPool(config);
    await migrate(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  /* mysql2 wants its own value type; these are all the shapes used here. */
  type Param = string | number | null;

  async function rows<T>(sql: string, params: Param[] = []): Promise<T[]> {
    const [result] = await pool.execute<RowDataPacket[]>(sql, params);
    return result as unknown as T[];
  }

  /** The row a query must have produced. Absent means the test is wrong, loudly. */
  async function one<T>(sql: string, params: Param[] = []): Promise<T> {
    const [first] = await rows<T>(sql, params);
    if (!first) throw new Error(`expected a row from: ${sql}`);
    return first;
  }

  /** A statement whose result nobody reads — an insert, an update, a delete. */
  function run(sql: string, params: Param[] = []) {
    return pool.execute<ResultSetHeader>(sql, params);
  }

  /** An author with one reflection, ready to be shared. */
  async function anAuthor() {
    await run(
      "INSERT INTO users (public_uuid, account_type, created_at) VALUES (UUID(), 'REGISTERED', NOW())",
    );
    const user = await one<{ id: number }>('SELECT id FROM users ORDER BY id DESC LIMIT 1');
    await run(
      `INSERT INTO reflections (public_uuid, user_id, title, chat_type, chat_content, created_at, updated_at)
       VALUES (UUID(), ?, 'A reflection', 'FULL', '{}', NOW(), NOW())`,
      [user.id],
    );
    const reflection = await one<{ id: number }>(
      'SELECT id FROM reflections ORDER BY id DESC LIMIT 1',
    );
    return { userId: user.id, reflectionId: reflection.id };
  }

  function share(userId: number, reflectionId: number) {
    return run(
      `INSERT INTO publications
         (public_uuid, author_user_id, reflection_id, audience, chat_type, title, caption, created_at, updated_at)
       VALUES (UUID(), ?, ?, 'public', 'FULL', 'A reflection', '', NOW(), NOW())`,
      [userId, reflectionId],
    );
  }

  test('a community is closed until somebody opens it', async () => {
    const author = await one<{ id: number }>('SELECT id FROM users ORDER BY id DESC LIMIT 1');
    await run(
      `INSERT INTO communities (public_uuid, name, description, created_by_user_id, created_at, updated_at)
       VALUES (UUID(), 'A circle', '', ?, NOW(), NOW())`,
      [author.id],
    );
    const community = await one<{
      discoverability: string;
      join_policy: string;
      reflection_visibility: string;
      approval_policy: string;
    }>(
      `SELECT discoverability, join_policy, reflection_visibility, approval_policy
         FROM communities ORDER BY id DESC LIMIT 1`,
    );

    /*
     * A community that existed before these columns did was created under
     * rules that assumed invitation. No migration may widen who can see
     * somebody's writing, so every default is the closed one.
     */
    expect(community).toEqual({
      discoverability: 'hidden',
      join_policy: 'invite',
      reflection_visibility: 'members',
      approval_policy: 'owner_admin',
    });
  });

  test('a publication carries who may read it, fixed when it was made', async () => {
    const { userId, reflectionId } = await anAuthor();
    await share(userId, reflectionId);

    const publication = await one<{ share_visibility: string }>(
      'SELECT share_visibility FROM publications ORDER BY id DESC LIMIT 1',
    );
    expect(publication.share_visibility).toBe('members');
  });

  test('one live share per destination, and withdrawing frees the slot', async () => {
    const { userId, reflectionId } = await anAuthor();
    await share(userId, reflectionId);

    /*
     * SQLite says this with a partial unique index. MariaDB has none, so the
     * rule is a generated column that goes NULL when a row is withdrawn — a
     * UNIQUE key ignores NULLs. If that ever stops working, sharing the same
     * reflection twice starts filling a feed with duplicates.
     */
    await expect(share(userId, reflectionId)).rejects.toThrow(/duplicate/i);

    await run('UPDATE publications SET deleted_at = NOW() WHERE reflection_id = ?', [
      reflectionId,
    ]);
    /* Withdrawn really means removed: sharing again is a new share. */
    await expect(share(userId, reflectionId)).resolves.toBeDefined();

    const live = await one<{ n: number }>(
      'SELECT COUNT(*) AS n FROM publications WHERE reflection_id = ? AND deleted_at IS NULL',
      [reflectionId],
    );
    expect(Number(live.n)).toBe(1);
  });

  test('a reader’s hides and mutes are theirs, and nothing counts them', async () => {
    const { userId, reflectionId } = await anAuthor();
    await share(userId, reflectionId);
    const publication = await one<{ id: number }>(
      'SELECT id FROM publications ORDER BY id DESC LIMIT 1',
    );

    await run('INSERT INTO publication_hides (publication_id, user_id) VALUES (?, ?)', [
      publication.id,
      userId,
    ]);
    await run('INSERT INTO author_mutes (user_id, muted_user_id) VALUES (?, ?)', [
      userId,
      userId,
    ]);

    /* Saying it twice is the same fact, not a second one. */
    await expect(
      run('INSERT INTO publication_hides (publication_id, user_id) VALUES (?, ?)', [
        publication.id,
        userId,
      ]),
    ).rejects.toThrow(/duplicate/i);
  });

  test('a share event is kept even after the share it counted is gone', async () => {
    const { userId, reflectionId } = await anAuthor();
    await run(
      `INSERT INTO share_events (public_uuid, user_id, reflection_id, audience, created_at)
       VALUES (UUID(), ?, ?, 'public', ?)`,
      [userId, reflectionId, Date.now()],
    );

    await run('DELETE FROM publications WHERE reflection_id = ?', [reflectionId]);

    const kept = await one<{ n: number }>(
      'SELECT COUNT(*) AS n FROM share_events WHERE reflection_id = ?',
      [reflectionId],
    );
    /*
     * The ceilings count shares made, not shares still visible. If unsharing
     * refunded one, share-unshare-share would cost nothing and the limit would
     * measure how much is on display rather than how much somebody is doing.
     */
    expect(Number(kept.n)).toBe(1);
  });
});
