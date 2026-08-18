/*
 * The durable reflection loop, against the real database.
 *
 * Skipped without MYSQL_* configured, exactly as the persistence suite is —
 * these prove the boundary works against MariaDB 11.8, and a mock could not.
 * Every user created here is removed again in `afterAll`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTHOR_ORIGINS, CHAT_FORMATS } from '@chat/shared';
import { readMysqlConfig } from '../mysql/config.ts';
import { migrate } from '../mysql/migrate.ts';
import { MysqlPersistence } from '../mysql/persistence.ts';
import { createMysqlPool, type MysqlPool } from '../mysql/pool.ts';
import { ReflectionService, ReflectionServiceError } from './service.ts';

const config = (() => {
  try {
    return readMysqlConfig();
  } catch {
    return null;
  }
})();

describe.skipIf(!config)('durable reflections', () => {
  let pool: MysqlPool;
  let service: ReflectionService;
  let db: MysqlPersistence;
  const ownerIds: number[] = [];

  beforeAll(async () => {
    if (!config) return;
    pool = createMysqlPool(config);
    await migrate(pool);
    db = new MysqlPersistence(pool);
    service = new ReflectionService(db);
  });

  afterAll(async () => {
    for (const id of ownerIds.reverse()) await db.deleteUserGraph(id).catch(() => undefined);
    await pool?.end();
  });

  async function owner() {
    const created = await service.ensureOwner();
    ownerIds.push(created.id);
    return created;
  }

  const fullSections = {
    content: { content: 'John 3:16 (NIV) — For God so loved the world…', authorOrigin: AUTHOR_ORIGINS.USER },
    heart: { content: 'It landed on a week I could not see it.', authorOrigin: AUTHOR_ORIGINS.USER },
    application: { content: 'I will say it out loud on Sunday.', authorOrigin: AUTHOR_ORIGINS.AI_ASSISTED },
    testimony: { content: 'He kept me when I could not keep myself.', authorOrigin: AUTHOR_ORIGINS.USER },
  };

  it('carries a FULL reflection there and back by public UUID', async () => {
    const me = await owner();
    const saved = await service.save(me.id, {
      format: CHAT_FORMATS.FULL,
      sections: fullSections,
      title: 'The week I could not see it',
      bibleReference: 'John 3:16',
      bibleTranslation: 'NIV',
      bibleText: 'For God so loved the world…',
    });

    expect(saved.publicUuid).toMatch(/^[0-9a-f-]{36}$/);
    const read = await service.getByPublicUuid(saved.publicUuid);
    expect(read).not.toBeNull();
    expect(read?.format).toBe(CHAT_FORMATS.FULL);
    expect(read?.title).toBe('The week I could not see it');
    expect(read?.bibleTranslation).toBe('NIV');
    expect(read?.sections).toEqual(fullSections);
  });

  /*
   * The section the product is named for. It is `content`, and a payload using
   * the retired name must not be storable.
   */
  it('names the first section content, and refuses any other', async () => {
    const me = await owner();
    await expect(
      service.save(me.id, {
        format: CHAT_FORMATS.FULL,
        sections: { ...fullSections, context: fullSections.content } as never,
      }),
    ).rejects.toBeInstanceOf(ReflectionServiceError);
  });

  it('keeps both condensed fields rather than only the reflection', async () => {
    const me = await owner();
    const saved = await service.save(me.id, {
      format: CHAT_FORMATS.CONDENSED,
      sections: {
        verse: { content: 'Romans 8:28', authorOrigin: AUTHOR_ORIGINS.USER },
        reflection: { content: 'All things. Not some.', authorOrigin: AUTHOR_ORIGINS.USER },
      },
    });
    const read = await service.getByPublicUuid(saved.publicUuid);
    expect(Object.keys(read?.sections ?? {}).sort()).toEqual(['reflection', 'verse']);
    expect(read?.sections['verse']?.content).toBe('Romans 8:28');
  });

  /* Who wrote a sentence has to survive the round trip, or the badge lies. */
  it('preserves author origin through storage', async () => {
    const me = await owner();
    const saved = await service.save(me.id, { format: CHAT_FORMATS.FULL, sections: fullSections });
    const read = await service.getByPublicUuid(saved.publicUuid);
    expect(read?.sections['application']?.authorOrigin).toBe(AUTHOR_ORIGINS.AI_ASSISTED);
    expect(read?.sections['testimony']?.authorOrigin).toBe(AUTHOR_ORIGINS.USER);
  });

  it('updates in place, keeping its identity', async () => {
    const me = await owner();
    const saved = await service.save(me.id, {
      format: CHAT_FORMATS.FULL,
      sections: fullSections,
      title: 'First title',
    });

    const updated = await service.update(saved.publicUuid, me.id, {
      format: CHAT_FORMATS.FULL,
      sections: { ...fullSections, heart: { content: 'Rewritten.', authorOrigin: AUTHOR_ORIGINS.USER } },
      title: 'Second title',
    });

    expect(updated?.publicUuid).toBe(saved.publicUuid);
    const read = await service.getByPublicUuid(saved.publicUuid);
    expect(read?.title).toBe('Second title');
    expect(read?.sections['heart']?.content).toBe('Rewritten.');
    expect(read?.sections['testimony']?.content).toBe(fullSections.testimony.content);
  });

  it('will not let one owner rewrite another owner’s reflection', async () => {
    const me = await owner();
    const stranger = await owner();
    const saved = await service.save(me.id, { format: CHAT_FORMATS.FULL, sections: fullSections });

    await expect(
      service.update(saved.publicUuid, stranger.id, {
        format: CHAT_FORMATS.FULL,
        sections: fullSections,
      }),
    ).rejects.toBeInstanceOf(ReflectionServiceError);
    const read = await service.getByPublicUuid(saved.publicUuid);
    expect(read?.sections['heart']?.content).toBe(fullSections.heart.content);
  });

  it('stores an unwritten section as the author’s own empty text', async () => {
    const me = await owner();
    const saved = await service.save(me.id, {
      format: CHAT_FORMATS.FULL,
      sections: { content: { content: 'Only this so far.', authorOrigin: AUTHOR_ORIGINS.USER } },
    });
    const read = await service.getByPublicUuid(saved.publicUuid);
    expect(read?.sections['heart']).toEqual({ content: '', authorOrigin: AUTHOR_ORIGINS.USER });
  });

  it('returns null for a UUID that is not there', async () => {
    expect(await service.getByPublicUuid('00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});
