import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTHOR_ORIGINS } from '@chat/shared';
import { ChatContentError } from './chat-content.ts';
import { readMysqlConfig } from './config.ts';
import { migrate } from './migrate.ts';
import { MysqlPersistence } from './persistence.ts';
import { createMysqlPool, type MysqlPool } from './pool.ts';
import { FORBIDDEN_CENTRAL_TABLES, FORBIDDEN_USAGE_COLUMNS } from './privacy.ts';
import { hashSessionToken } from './tokens.ts';
import { verifyPassword } from './passwords.ts';

const config = (() => {
  try {
    return readMysqlConfig();
  } catch {
    return null;
  }
})();

describe.skipIf(!config)('MySQL persistence', () => {
  let pool: MysqlPool;
  let db: MysqlPersistence;
  const userIds: number[] = [];

  beforeAll(async () => {
    if (!config) return;
    pool = createMysqlPool(config);
    await migrate(pool);
    db = new MysqlPersistence(pool);
  });

  afterAll(async () => {
    for (const id of userIds.reverse()) {
      await db.deleteUserGraph(id).catch(() => undefined);
    }
    await pool?.end();
  });

  async function user() {
    const created = await db.createUser();
    userIds.push(created.id);
    return created;
  }

  const own = (content: string) => ({ content, authorOrigin: AUTHOR_ORIGINS.USER });

  const full = {
    content: own('John names the gift.'),
    heart: own('I received it.'),
    application: own('I will live openly.'),
    testimony: own('This is what God did.'),
  };

  const short = { verse: own('John 3:16'), reflection: own('God so loved the world.') };

  it('creates users with public UUIDs distinct from internal ids', async () => {
    const a = await user();
    const b = await user();
    expect(a.publicUuid).not.toBe(b.publicUuid);
    expect(a.publicUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(a.id).not.toBe(a.publicUuid);
    const columns = await db.listColumnNames('users');
    expect(columns).not.toContain('email');
  });

  it('rejects a duplicate public UUID', async () => {
    const created = await user();
    await expect(
      pool.execute('INSERT INTO users (public_uuid, status) VALUES (?, ?)', [
        created.publicUuid,
        'ACTIVE',
      ]),
    ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
  });

  it('maps Google, Facebook, Apple, and local identities onto one user', async () => {
    const created = await user();
    await db.addIdentity(created.id, 'GOOGLE', `g-${randomUUID()}`);
    await db.addIdentity(created.id, 'FACEBOOK', `fb-${randomUUID()}`);
    await db.addIdentity(created.id, 'APPLE', `ap-${randomUUID()}`);
    await db.addIdentity(created.id, 'LOCAL', `local-${randomUUID()}`);
    const identities = await db.listIdentitiesForUser(created.id);
    expect(identities.map((row) => row.provider).sort()).toEqual([
      'APPLE',
      'FACEBOOK',
      'GOOGLE',
      'LOCAL',
    ]);
    expect(new Set(identities.map((row) => row.userId))).toEqual(new Set([created.id]));
  });

  it('does not treat two providers as the same identity', async () => {
    const created = await user();
    const providerUserId = `shared-${randomUUID()}`;
    await db.addIdentity(created.id, 'GOOGLE', providerUserId);
    const other = await user();
    await db.addIdentity(other.id, 'FACEBOOK', providerUserId);
    const google = await db.findIdentity('GOOGLE', providerUserId);
    const facebook = await db.findIdentity('FACEBOOK', providerUserId);
    expect(google?.userId).toBe(created.id);
    expect(facebook?.userId).toBe(other.id);
  });

  it('stores local credentials as Argon2id', async () => {
    const created = await user();
    const username = `u_${randomUUID().slice(0, 8)}`;
    await db.setLocalCredentials(created.id, username, 'a-strong-password');
    const digest = await db.getLocalCredentialHash(created.id);
    expect(digest).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(digest ?? '', 'a-strong-password')).toBe(true);
    expect(await db.findUserIdByLocalUsername(username)).toBe(created.id);
  });

  it('persists profiles and settings JSON', async () => {
    const created = await user();
    const profile = await db.upsertProfile(created.id, {
      username: `p_${randomUUID().slice(0, 8)}`,
      displayName: 'Ada',
      tagline: 'Walking slowly',
      bio: 'A writer.',
    });
    expect(profile.displayName).toBe('Ada');
    const settings = await db.upsertSettings(created.id, {
      defaultTranslation: 'NIV',
      conversationStorage: 'device',
    });
    expect(settings.conversationStorage).toBe('device');
    expect(await db.getSettings(created.id)).toEqual(settings);
  });

  it('creates and retrieves FULL and SHORT reflections with Bible snapshots', async () => {
    const created = await user();
    const fullRow = await db.createReflection({
      userId: created.id,
      title: 'The gift',
      bibleReference: 'John 3:16-18',
      bibleTranslation: 'NIV',
      bibleText: 'For God so loved the world...',
      chatType: 'FULL',
      chatContent: full,
    });
    const loadedFull = await db.getReflectionByPublicUuid(fullRow.publicUuid, created.id);
    expect(loadedFull?.chatType).toBe('FULL');
    expect(loadedFull?.chatContent).toEqual(full);
    expect(loadedFull?.bibleReference).toBe('John 3:16-18');
    expect(loadedFull?.bibleTranslation).toBe('NIV');
    expect(loadedFull?.bibleText).toContain('God so loved');

    const shortRow = await db.createReflection({
      userId: created.id,
      bibleReference: 'Psalm 23:1',
      bibleTranslation: 'ESV',
      bibleText: 'The Lord is my shepherd; I shall not want.',
      chatType: 'SHORT',
      chatContent: short,
    });
    const loadedShort = await db.getReflectionByPublicUuid(shortRow.publicUuid);
    expect(loadedShort?.chatContent).toEqual(short);
  });

  it('rejects invalid chat_content before insert', async () => {
    const created = await user();
    await expect(
      db.createReflection({
        userId: created.id,
        chatType: 'FULL',
        chatContent: { reflection: own('not a full payload') },
      }),
    ).rejects.toBeInstanceOf(ChatContentError);
  });

  it('enforces ownership and soft deletion', async () => {
    const owner = await user();
    const other = await user();
    const reflection = await db.createReflection({
      userId: owner.id,
      chatType: 'SHORT',
      chatContent: short,
    });
    expect(await db.getReflectionByPublicUuid(reflection.publicUuid, other.id)).toBeNull();
    expect(await db.getReflectionByPublicUuid(reflection.publicUuid, owner.id)).not.toBeNull();
    expect(await db.softDeleteReflection(reflection.id, other.id)).toBe(false);
    expect(await db.softDeleteReflection(reflection.id, owner.id)).toBe(true);
    expect(await db.getReflectionByPublicUuid(reflection.publicUuid)).toBeNull();
    expect((await db.getReflectionById(reflection.id, true))?.deletedAt).toBeTruthy();
  });

  it('stores ordered revisions and points current_revision_id at the latest', async () => {
    const created = await user();
    const reflection = await db.createReflection({
      userId: created.id,
      title: 'First',
      chatType: 'SHORT',
      chatContent: short,
    });
    const first = await db.createRevisionFromCurrent(reflection.id);
    await pool.execute('UPDATE reflections SET title = ? WHERE id = ?', ['Second', reflection.id]);
    const second = await db.createRevisionFromCurrent(reflection.id);
    const listed = await db.listRevisions(reflection.id);
    expect(listed.map((row) => row.revisionNumber)).toEqual([1, 2]);
    expect(listed[0]?.title).toBe('First');
    expect(listed[1]?.title).toBe('Second');
    const current = await db.getReflectionById(reflection.id);
    expect(current?.currentRevisionId).toBe(second.id);
    expect(first.id).not.toBe(second.id);
  });

  it('allows multiple images per reflection and an optional revision link', async () => {
    const created = await user();
    const reflection = await db.createReflection({
      userId: created.id,
      chatType: 'SHORT',
      chatContent: short,
    });
    const revision = await db.createRevisionFromCurrent(reflection.id);
    const hash = createHash('sha256').update('design-input').digest('hex');
    await db.addImage({
      reflectionId: reflection.id,
      imagePath: '/generated/one.png',
      aspectRatio: '4:5',
      designConfig: { template: 'stacked', aspectRatio: '4:5', layers: [] },
    });
    await db.addImage({
      reflectionId: reflection.id,
      revisionId: revision.id,
      imagePath: '/generated/two.png',
      imageType: 'png',
      inputHash: hash,
    });
    const images = await db.listImages(reflection.id);
    expect(images).toHaveLength(2);
    expect(images.some((image) => image.revisionId === revision.id)).toBe(true);
    expect(images.some((image) => image.inputHash === hash)).toBe(true);
  });

  it('creates sessions with hashed tokens, expiry, and revocation', async () => {
    const created = await user();
    const { session, token } = await db.createSession(created.id, 60_000);
    const storedHash = await db.sessionTokenHashStored(session.id);
    expect(storedHash).toBe(hashSessionToken(token));
    expect(storedHash).not.toBe(token);
    expect(await db.findActiveSession(token)).not.toBeNull();

    await db.revokeSession(session.id);
    expect(await db.findActiveSession(token)).toBeNull();

    const second = await db.createSession(created.id, 60_000);
    await db.expireSessionForTests(second.session.id);
    expect(await db.findActiveSession(second.token)).toBeNull();
  });

  it('records AI usage metadata without conversation content and aggregates daily totals', async () => {
    const created = await user();
    const event = await db.recordAiUsage({
      userId: created.id,
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      feature: 'REFLECTION_CHAT',
      inputTokens: 40,
      outputTokens: 80,
      totalTokens: 120,
      estimatedCost: 0.0012,
      resultStatus: 'OK',
      rateLimitResult: 'ALLOWED',
      latencyMs: 210,
    });
    expect(event.feature).toBe('REFLECTION_CHAT');
    expect(event.totalTokens).toBe(120);
    const eventKeys = Object.keys(event);
    for (const forbidden of ['prompt', 'response', 'transcript', 'message', 'conversation']) {
      expect(eventKeys).not.toContain(forbidden);
    }

    await db.recordAiUsage({
      userId: created.id,
      provider: 'gemini',
      feature: 'IMAGE_GENERATION',
      inputTokens: 10,
      outputTokens: 0,
      totalTokens: 10,
      estimatedCost: 0.02,
    });

    const usageDate = new Date().toISOString().slice(0, 10);
    const daily = await db.getDailyUsage(created.id, usageDate);
    expect(daily?.requestCount).toBe(2);
    expect(daily?.totalTokens).toBe(130);
    expect(daily?.imageGenerationCount).toBe(1);

    const columns = await db.listColumnNames('ai_usage_events');
    for (const name of FORBIDDEN_USAGE_COLUMNS) {
      expect(columns).not.toContain(name);
    }
  });

  it('does not create conversation-history tables in the live schema', async () => {
    const tables = await db.listTableNames();
    for (const table of FORBIDDEN_CENTRAL_TABLES) {
      expect(tables).not.toContain(table);
    }
    expect(tables).not.toContain('messages');
  });
});
