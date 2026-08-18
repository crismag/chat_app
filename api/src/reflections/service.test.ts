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
    expect(read?.sections).toMatchObject(fullSections);
    /* Every slot is stored; the format names the live ones. */
    expect(read?.sections['verse']).toEqual({ content: '', authorOrigin: AUTHOR_ORIGINS.USER });
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
    expect(read?.sections['verse']?.content).toBe('Romans 8:28');
    expect(read?.sections['reflection']?.content).toBe('All things. Not some.');
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

  /*
   * The defect this migration could introduce, and the reason the write is a
   * locked read-modify-write rather than an UPDATE of the whole document.
   *
   * Sections used to be their own rows, so writing one could not reach the
   * others. They are fields of one document now, and a careless write replaces
   * the document — taking three sections the author never touched with it.
   */
  it('writes one section without disturbing the others', async () => {
    const me = await owner();
    const saved = await service.save(me.id, { format: CHAT_FORMATS.FULL, sections: fullSections });

    const after = await service.writeSection(saved.publicUuid, me.id, 'heart', {
      content: 'Rewritten heart.',
      authorOrigin: AUTHOR_ORIGINS.USER,
    });

    expect(after?.sections['heart']?.content).toBe('Rewritten heart.');
    expect(after?.sections['content']?.content).toBe(fullSections.content.content);
    expect(after?.sections['application']?.content).toBe(fullSections.application.content);
    expect(after?.sections['testimony']?.content).toBe(fullSections.testimony.content);
    expect(after?.sections['application']?.authorOrigin).toBe(AUTHOR_ORIGINS.AI_ASSISTED);
  });

  /*
   * Two writes at once. Without SELECT ... FOR UPDATE both read the same
   * document and the second erases the first — a lost update that reads to the
   * author as a save that simply did not happen.
   */
  it('does not lose one of two concurrent section writes', async () => {
    const me = await owner();
    const saved = await service.save(me.id, { format: CHAT_FORMATS.FULL, sections: fullSections });

    await Promise.all([
      service.writeSection(saved.publicUuid, me.id, 'heart', {
        content: 'From the first writer.',
        authorOrigin: AUTHOR_ORIGINS.USER,
      }),
      service.writeSection(saved.publicUuid, me.id, 'testimony', {
        content: 'From the second writer.',
        authorOrigin: AUTHOR_ORIGINS.USER,
      }),
    ]);

    const read = await service.getByPublicUuid(saved.publicUuid);
    expect(read?.sections['heart']?.content).toBe('From the first writer.');
    expect(read?.sections['testimony']?.content).toBe('From the second writer.');
  });

  /*
   * Both drafts, in both directions. Condensing a full reflection and changing
   * your mind must not cost you the four sections you wrote.
   */
  it('keeps a condensed draft beside the full one rather than on top of it', async () => {
    const me = await owner();
    const saved = await service.save(me.id, { format: CHAT_FORMATS.FULL, sections: fullSections });

    await service.writeSection(saved.publicUuid, me.id, 'reflection', {
      content: 'The condensed version.',
      authorOrigin: AUTHOR_ORIGINS.USER,
    });
    const condensed = await service.update(saved.publicUuid, me.id, {
      format: CHAT_FORMATS.CONDENSED,
      sections: {
        verse: { content: 'John 3:16', authorOrigin: AUTHOR_ORIGINS.USER },
        reflection: { content: 'The condensed version.', authorOrigin: AUTHOR_ORIGINS.USER },
        ...fullSections,
      },
    });

    expect(condensed?.format).toBe(CHAT_FORMATS.CONDENSED);
    expect(condensed?.sections['heart']?.content).toBe(fullSections.heart.content);
    expect(condensed?.sections['reflection']?.content).toBe('The condensed version.');
  });

  it('refuses a section that does not exist, and another owner’s write', async () => {
    const me = await owner();
    const stranger = await owner();
    const saved = await service.save(me.id, { format: CHAT_FORMATS.FULL, sections: fullSections });

    await expect(
      service.writeSection(saved.publicUuid, me.id, 'context', {
        content: 'the retired name',
        authorOrigin: AUTHOR_ORIGINS.USER,
      }),
    ).rejects.toBeInstanceOf(ReflectionServiceError);

    await expect(
      service.writeSection(saved.publicUuid, stranger.id, 'heart', {
        content: 'not mine to write',
        authorOrigin: AUTHOR_ORIGINS.USER,
      }),
    ).rejects.toBeInstanceOf(ReflectionServiceError);
  });

  it('returns null for a UUID that is not there', async () => {
    expect(await service.getByPublicUuid('00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});
