import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import {
  readAccountType,
  type AccountCreationContext,
  type AccountType,
} from '@chat/shared';
import {
  parseChatType,
  parseStoredChatContent,
  validateChatContent,
} from './chat-content.ts';
import type { ChatContent, SectionKey, StoredSection } from './chat-content.ts';
import type { ChatType, IdentityProvider } from './constants.ts';
import { IDENTITY_PROVIDERS } from './constants.ts';
import { asBigIntId, newPublicUuid } from './ids.ts';
import { assertArgon2idHash, hashPassword } from './passwords.ts';
import type { MysqlPool } from './pool.ts';
import { hashSessionToken, newSessionToken } from './tokens.ts';

export class MysqlPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MysqlPersistenceError';
  }
}

export type UserRecord = {
  id: number;
  publicUuid: string;
  status: string;
  /** ANONYMOUS for a guest, REGISTERED once an identity is attached. */
  accountType: AccountType;
  guestName: string | null;
  registeredAt: string | null;
  emailVerifiedAt: string | null;
  mergedIntoUserId: number | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type IdentityRecord = {
  id: number;
  userId: number;
  provider: IdentityProvider;
  providerUserId: string;
  providerData: unknown;
};

export type ProfileRecord = {
  userId: number;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  tagline: string | null;
  bio: string | null;
};

export type ReflectionRecord = {
  id: number;
  publicUuid: string;
  userId: number;
  title: string | null;
  bibleReference: string | null;
  bibleTranslation: string | null;
  bibleText: string | null;
  chatType: ChatType;
  chatContent: ChatContent;
  visibility: string;
  status: string;
  currentRevisionId: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type RevisionRecord = {
  id: number;
  publicUuid: string;
  reflectionId: number;
  revisionNumber: number;
  title: string | null;
  bibleReference: string | null;
  bibleTranslation: string | null;
  bibleText: string | null;
  chatType: ChatType;
  chatContent: ChatContent;
  createdAt: string;
};

export type ImageRecord = {
  id: number;
  publicUuid: string;
  reflectionId: number;
  revisionId: number | null;
  imagePath: string;
  imageType: string | null;
  aspectRatio: string | null;
  designConfig: unknown;
  inputHash: string | null;
  createdAt: string;
  deletedAt: string | null;
};

export type SessionRecord = {
  id: number;
  publicUuid: string;
  userId: number;
  /** The browser that established it, when one is durably recognised. */
  installationId: string | null;
  sessionType: string;
  expiresAt: string;
  lastSeenAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};

export type AiUsageEventRecord = {
  id: number;
  publicUuid: string;
  userId: number | null;
  sessionUuid: string | null;
  provider: string;
  model: string | null;
  feature: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCost: string | null;
  resultStatus: string | null;
  rateLimitResult: string | null;
  latencyMs: number | null;
  createdAt: string;
};

export type AiUsageDailyRecord = {
  userId: number;
  usageDate: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  imageGenerationCount: number;
  estimatedCost: string;
};

export type CreateReflectionInput = {
  userId: number;
  title?: string | null;
  bibleReference?: string | null;
  bibleTranslation?: string | null;
  bibleText?: string | null;
  chatType: ChatType;
  chatContent: unknown;
  visibility?: string;
  status?: string;
};

export type UpdateReflectionInput = {
  title?: string | null;
  bibleReference?: string | null;
  bibleTranslation?: string | null;
  bibleText?: string | null;
  chatType: ChatType;
  chatContent: unknown;
};

export type CreateAiUsageInput = {
  userId?: number | null;
  sessionUuid?: string | null;
  provider: string;
  model?: string | null;
  feature: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  estimatedCost?: number | null;
  resultStatus?: string | null;
  rateLimitResult?: string | null;
  latencyMs?: number | null;
};

function asNullableId(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return asBigIntId(value);
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return JSON.parse(value) as unknown;
  return value;
}

function isProvider(value: unknown): value is IdentityProvider {
  return typeof value === 'string' && (IDENTITY_PROVIDERS as readonly string[]).includes(value);
}

function mapUser(row: RowDataPacket): UserRecord {
  return {
    id: asBigIntId(row.id),
    publicUuid: String(row.public_uuid),
    status: String(row.status),
    accountType: readAccountType(row.account_type),
    guestName: row.guest_name ? String(row.guest_name) : null,
    registeredAt: row.registered_at ? String(row.registered_at) : null,
    emailVerifiedAt: row.email_verified_at ? String(row.email_verified_at) : null,
    mergedIntoUserId: row.merged_into_user_id ? asBigIntId(row.merged_into_user_id) : null,
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  };
}

function mapReflection(row: RowDataPacket): ReflectionRecord {
  const chatType = parseChatType(row.chat_type);
  return {
    id: asBigIntId(row.id),
    publicUuid: String(row.public_uuid),
    userId: asBigIntId(row.user_id),
    title: row.title === null ? null : String(row.title),
    bibleReference: row.bible_reference === null ? null : String(row.bible_reference),
    bibleTranslation: row.bible_translation === null ? null : String(row.bible_translation),
    bibleText: row.bible_text === null ? null : String(row.bible_text),
    chatType,
    chatContent: parseStoredChatContent(chatType, row.chat_content),
    visibility: String(row.visibility),
    status: String(row.status),
    currentRevisionId: asNullableId(row.current_revision_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  };
}

function mapRevision(row: RowDataPacket): RevisionRecord {
  const chatType = parseChatType(row.chat_type);
  return {
    id: asBigIntId(row.id),
    publicUuid: String(row.public_uuid),
    reflectionId: asBigIntId(row.reflection_id),
    revisionNumber: Number(row.revision_number),
    title: row.title === null ? null : String(row.title),
    bibleReference: row.bible_reference === null ? null : String(row.bible_reference),
    bibleTranslation: row.bible_translation === null ? null : String(row.bible_translation),
    bibleText: row.bible_text === null ? null : String(row.bible_text),
    chatType,
    chatContent: parseStoredChatContent(chatType, row.chat_content),
    createdAt: String(row.created_at),
  };
}

export class MysqlPersistence {
  private readonly pool: MysqlPool;

  constructor(pool: MysqlPool) {
    this.pool = pool;
  }

  async createUser(status = 'ACTIVE'): Promise<UserRecord> {
    const publicUuid = newPublicUuid();
    const [result] = await this.pool.execute<ResultSetHeader>(
      'INSERT INTO users (public_uuid, status) VALUES (?, ?)',
      [publicUuid, status],
    );
    const created = await this.getUserById(asBigIntId(result.insertId));
    if (!created) throw new MysqlPersistenceError('user insert did not persist');
    return created;
  }

  async getUserById(id: number, includeDeleted = false): Promise<UserRecord | null> {
    const sql = includeDeleted
      ? 'SELECT * FROM users WHERE id = ?'
      : 'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL';
    const [rows] = await this.pool.execute<RowDataPacket[]>(sql, [id]);
    const row = rows[0];
    return row ? mapUser(row) : null;
  }

  async getUserByPublicUuid(publicUuid: string): Promise<UserRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM users WHERE public_uuid = ? AND deleted_at IS NULL',
      [publicUuid],
    );
    const row = rows[0];
    return row ? mapUser(row) : null;
  }

  async softDeleteUser(id: number): Promise<void> {
    await this.pool.execute('UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL', [
      id,
    ]);
  }

  async addIdentity(
    userId: number,
    provider: IdentityProvider,
    providerUserId: string,
    providerData: unknown = null,
  ): Promise<IdentityRecord> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      'INSERT INTO user_identities (user_id, provider, provider_user_id, provider_data) VALUES (?, ?, ?, ?)',
      [userId, provider, providerUserId, providerData === null ? null : JSON.stringify(providerData)],
    );
    const created = await this.getIdentityById(asBigIntId(result.insertId));
    if (!created) throw new MysqlPersistenceError('identity insert did not persist');
    return created;
  }

  async getIdentityById(id: number): Promise<IdentityRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM user_identities WHERE id = ?',
      [id],
    );
    const row = rows[0];
    if (!row || !isProvider(row.provider)) return null;
    return {
      id: asBigIntId(row.id),
      userId: asBigIntId(row.user_id),
      provider: row.provider,
      providerUserId: String(row.provider_user_id),
      providerData: parseJson(row.provider_data),
    };
  }

  async findIdentity(provider: IdentityProvider, providerUserId: string): Promise<IdentityRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM user_identities WHERE provider = ? AND provider_user_id = ?',
      [provider, providerUserId],
    );
    const row = rows[0];
    if (!row || !isProvider(row.provider)) return null;
    return {
      id: asBigIntId(row.id),
      userId: asBigIntId(row.user_id),
      provider: row.provider,
      providerUserId: String(row.provider_user_id),
      providerData: parseJson(row.provider_data),
    };
  }

  async listIdentitiesForUser(userId: number): Promise<IdentityRecord[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM user_identities WHERE user_id = ? ORDER BY id',
      [userId],
    );
    return rows.flatMap((row) => {
      if (!isProvider(row.provider)) return [];
      return [
        {
          id: asBigIntId(row.id),
          userId: asBigIntId(row.user_id),
          provider: row.provider,
          providerUserId: String(row.provider_user_id),
          providerData: parseJson(row.provider_data),
        },
      ];
    });
  }

  async setLocalCredentials(userId: number, username: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    assertArgon2idHash(passwordHash);
    await this.pool.execute(
      `INSERT INTO local_credentials (user_id, username, password_hash, password_changed_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         username = VALUES(username),
         password_hash = VALUES(password_hash),
         password_changed_at = CURRENT_TIMESTAMP`,
      [userId, username, passwordHash],
    );
  }

  async getLocalCredentialHash(userId: number): Promise<string | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT password_hash FROM local_credentials WHERE user_id = ?',
      [userId],
    );
    const hash = rows[0]?.password_hash;
    return typeof hash === 'string' ? hash : null;
  }

  async findUserIdByLocalUsername(username: string): Promise<number | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT user_id FROM local_credentials WHERE username = ?',
      [username],
    );
    const row = rows[0];
    return row ? asBigIntId(row.user_id) : null;
  }

  /** The login handle for a user, which is what the session hands back. */
  async getLocalUsername(userId: number): Promise<string | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT username FROM local_credentials WHERE user_id = ?',
      [userId],
    );
    const username = rows[0]?.username;
    return typeof username === 'string' ? username : null;
  }

  async upsertProfile(
    userId: number,
    profile: {
      username?: string | null;
      displayName?: string | null;
      avatarUrl?: string | null;
      tagline?: string | null;
      bio?: string | null;
    },
  ): Promise<ProfileRecord> {
    await this.pool.execute(
      `INSERT INTO profiles (user_id, username, display_name, avatar_url, tagline, bio)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         username = VALUES(username),
         display_name = VALUES(display_name),
         avatar_url = VALUES(avatar_url),
         tagline = VALUES(tagline),
         bio = VALUES(bio)`,
      [
        userId,
        profile.username ?? null,
        profile.displayName ?? null,
        profile.avatarUrl ?? null,
        profile.tagline ?? null,
        profile.bio ?? null,
      ],
    );
    const saved = await this.getProfile(userId);
    if (!saved) throw new MysqlPersistenceError('profile did not persist');
    return saved;
  }

  async getProfile(userId: number): Promise<ProfileRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>('SELECT * FROM profiles WHERE user_id = ?', [
      userId,
    ]);
    const row = rows[0];
    if (!row) return null;
    return {
      userId: asBigIntId(row.user_id),
      username: row.username === null ? null : String(row.username),
      displayName: row.display_name === null ? null : String(row.display_name),
      avatarUrl: row.avatar_url === null ? null : String(row.avatar_url),
      tagline: row.tagline === null ? null : String(row.tagline),
      bio: row.bio === null ? null : String(row.bio),
    };
  }

  async upsertSettings(userId: number, settings: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.pool.execute(
      `INSERT INTO user_settings (user_id, settings) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE settings = VALUES(settings)`,
      [userId, JSON.stringify(settings)],
    );
    const saved = await this.getSettings(userId);
    if (!saved) throw new MysqlPersistenceError('settings did not persist');
    return saved;
  }

  async getSettings(userId: number): Promise<Record<string, unknown> | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT settings FROM user_settings WHERE user_id = ?',
      [userId],
    );
    const raw = rows[0]?.settings;
    if (raw === undefined) return null;
    const parsed = parseJson(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new MysqlPersistenceError('settings must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  }

  async createReflection(input: CreateReflectionInput): Promise<ReflectionRecord> {
    const chatContent = validateChatContent(input.chatType, input.chatContent);
    const publicUuid = newPublicUuid();
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO reflections (
         public_uuid, user_id, title, bible_reference, bible_translation, bible_text,
         chat_type, chat_content, visibility, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicUuid,
        input.userId,
        input.title ?? null,
        input.bibleReference ?? null,
        input.bibleTranslation ?? null,
        input.bibleText ?? null,
        input.chatType,
        JSON.stringify(chatContent),
        input.visibility ?? 'PRIVATE',
        input.status ?? 'DRAFT',
      ],
    );
    const created = await this.getReflectionById(asBigIntId(result.insertId), true);
    if (!created) throw new MysqlPersistenceError('reflection insert did not persist');
    return created;
  }

  async getReflectionById(id: number, includeDeleted = false): Promise<ReflectionRecord | null> {
    const sql = includeDeleted
      ? 'SELECT * FROM reflections WHERE id = ?'
      : 'SELECT * FROM reflections WHERE id = ? AND deleted_at IS NULL';
    const [rows] = await this.pool.execute<RowDataPacket[]>(sql, [id]);
    const row = rows[0];
    return row ? mapReflection(row) : null;
  }

  async getReflectionByPublicUuid(
    publicUuid: string,
    ownerUserId?: number,
  ): Promise<ReflectionRecord | null> {
    const params: Array<string | number> = [publicUuid];
    let sql = 'SELECT * FROM reflections WHERE public_uuid = ? AND deleted_at IS NULL';
    if (ownerUserId !== undefined) {
      sql += ' AND user_id = ?';
      params.push(ownerUserId);
    }
    const [rows] = await this.pool.execute<RowDataPacket[]>(sql, params);
    const row = rows[0];
    return row ? mapReflection(row) : null;
  }

  /**
   * Rewrite a reflection in place, scoped to its owner.
   *
   * `chat_content` is replaced whole. MariaDB stores it as LONGTEXT, so there
   * is no JSON path to update in part — and a whole-document write is what
   * keeps a save atomic rather than a read-modify-write race between two tabs.
   *
   * Ownership is in the WHERE clause, not checked beforehand, so a reflection
   * cannot be rewritten by anyone else even if a caller forgets to ask.
   */
  async updateReflection(
    id: number,
    ownerUserId: number,
    input: UpdateReflectionInput,
  ): Promise<ReflectionRecord | null> {
    const chatContent = validateChatContent(input.chatType, input.chatContent);
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE reflections
          SET title = ?, bible_reference = ?, bible_translation = ?, bible_text = ?,
              chat_type = ?, chat_content = ?
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
      [
        input.title ?? null,
        input.bibleReference ?? null,
        input.bibleTranslation ?? null,
        input.bibleText ?? null,
        input.chatType,
        JSON.stringify(chatContent),
        id,
        ownerUserId,
      ],
    );
    if (result.affectedRows === 0) return null;
    return this.getReflectionById(id);
  }

  /**
   * Write ONE section, leaving every other section exactly as it was.
   *
   * This is the operation the whole migration turns on. Sections used to be
   * their own rows, so writing one could not touch the others; they are now
   * fields of a single document, so a careless write replaces the document and
   * silently destroys the three sections the author did not touch.
   *
   * The row is therefore locked with SELECT ... FOR UPDATE, merged in memory,
   * and written back inside the same transaction. Without the lock, two
   * concurrent section writes both read the same document and the second write
   * erases the first — a lost update that looks exactly like a save that
   * "did not take", which is the hardest kind of bug to be told about.
   */
  async writeReflectionSection(
    id: number,
    ownerUserId: number,
    section: SectionKey,
    value: StoredSection,
  ): Promise<ReflectionRecord | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        'SELECT chat_type, chat_content FROM reflections WHERE id = ? AND user_id = ? AND deleted_at IS NULL FOR UPDATE',
        [id, ownerUserId],
      );
      const row = rows[0];
      if (!row) {
        await connection.rollback();
        return null;
      }
      const chatType = parseChatType(row.chat_type);
      const current = parseStoredChatContent(chatType, row.chat_content);
      const merged = { ...current, [section]: value };
      await connection.execute(
        'UPDATE reflections SET chat_content = ? WHERE id = ?',
        [JSON.stringify(validateChatContent(chatType, merged)), id],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.getReflectionById(id);
  }

  async softDeleteReflection(id: number, ownerUserId: number): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      'UPDATE reflections SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
      [id, ownerUserId],
    );
    return result.affectedRows === 1;
  }

  async createRevisionFromCurrent(reflectionId: number): Promise<RevisionRecord> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        'SELECT * FROM reflections WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
        [reflectionId],
      );
      const row = rows[0];
      if (!row) throw new MysqlPersistenceError('reflection not found');
      const current = mapReflection(row);
      const [maxRows] = await connection.execute<RowDataPacket[]>(
        'SELECT COALESCE(MAX(revision_number), 0) AS max_revision FROM reflection_revisions WHERE reflection_id = ?',
        [reflectionId],
      );
      const nextNumber = Number(maxRows[0]?.max_revision ?? 0) + 1;
      const publicUuid = newPublicUuid();
      const [inserted] = await connection.execute<ResultSetHeader>(
        `INSERT INTO reflection_revisions (
           public_uuid, reflection_id, revision_number, title, bible_reference,
           bible_translation, bible_text, chat_type, chat_content
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          publicUuid,
          reflectionId,
          nextNumber,
          current.title,
          current.bibleReference,
          current.bibleTranslation,
          current.bibleText,
          current.chatType,
          JSON.stringify(current.chatContent),
        ],
      );
      const revisionId = asBigIntId(inserted.insertId);
      await connection.execute('UPDATE reflections SET current_revision_id = ? WHERE id = ?', [
        revisionId,
        reflectionId,
      ]);
      await connection.commit();
      const created = await this.getRevisionById(revisionId);
      if (!created) throw new MysqlPersistenceError('revision insert did not persist');
      return created;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getRevisionById(id: number): Promise<RevisionRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM reflection_revisions WHERE id = ?',
      [id],
    );
    const row = rows[0];
    return row ? mapRevision(row) : null;
  }

  async listRevisions(reflectionId: number): Promise<RevisionRecord[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM reflection_revisions WHERE reflection_id = ? ORDER BY revision_number ASC',
      [reflectionId],
    );
    return rows.map(mapRevision);
  }

  async addImage(input: {
    reflectionId: number;
    revisionId?: number | null;
    imagePath: string;
    imageType?: string | null;
    aspectRatio?: string | null;
    designConfig?: unknown;
    inputHash?: string | null;
  }): Promise<ImageRecord> {
    const publicUuid = newPublicUuid();
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO reflection_images (
         public_uuid, reflection_id, revision_id, image_path, image_type,
         aspect_ratio, design_config, input_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicUuid,
        input.reflectionId,
        input.revisionId ?? null,
        input.imagePath,
        input.imageType ?? null,
        input.aspectRatio ?? null,
        input.designConfig === undefined || input.designConfig === null
          ? null
          : JSON.stringify(input.designConfig),
        input.inputHash ?? null,
      ],
    );
    const created = await this.getImageById(asBigIntId(result.insertId), true);
    if (!created) throw new MysqlPersistenceError('image insert did not persist');
    return created;
  }

  async getImageById(id: number, includeDeleted = false): Promise<ImageRecord | null> {
    const sql = includeDeleted
      ? 'SELECT * FROM reflection_images WHERE id = ?'
      : 'SELECT * FROM reflection_images WHERE id = ? AND deleted_at IS NULL';
    const [rows] = await this.pool.execute<RowDataPacket[]>(sql, [id]);
    const row = rows[0];
    return row ? this.mapImage(row) : null;
  }

  async listImages(reflectionId: number): Promise<ImageRecord[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM reflection_images WHERE reflection_id = ? AND deleted_at IS NULL ORDER BY id',
      [reflectionId],
    );
    return rows.map((row) => this.mapImage(row));
  }

  async createSession(
    userId: number,
    ttlMs: number,
    options: { installationId?: string | null; sessionType?: string } = {},
  ): Promise<{ session: SessionRecord; token: string }> {
    const token = newSessionToken();
    const tokenHash = hashSessionToken(token);
    const publicUuid = newPublicUuid();
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO user_sessions (public_uuid, user_id, installation_id, session_type, token_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))`,
      [
        publicUuid,
        userId,
        options.installationId ?? null,
        options.sessionType ?? 'REGISTERED_TEMPORARY',
        tokenHash,
        ttlSeconds,
      ],
    );
    const session = await this.getSessionById(asBigIntId(result.insertId));
    if (!session) throw new MysqlPersistenceError('session insert did not persist');
    return { session, token };
  }

  async getSessionById(id: number): Promise<SessionRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>('SELECT * FROM user_sessions WHERE id = ?', [
      id,
    ]);
    const row = rows[0];
    return row ? this.mapSession(row) : null;
  }

  async findActiveSession(token: string): Promise<SessionRecord | null> {
    const tokenHash = hashSessionToken(token);
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM user_sessions
       WHERE token_hash = ?
         AND revoked_at IS NULL
         AND expires_at > UTC_TIMESTAMP()`,
      [tokenHash],
    );
    const row = rows[0];
    return row ? this.mapSession(row) : null;
  }

  async sessionTokenHashStored(sessionId: number): Promise<string | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT token_hash FROM user_sessions WHERE id = ?',
      [sessionId],
    );
    const hash = rows[0]?.token_hash;
    return typeof hash === 'string' ? hash : null;
  }

  async revokeSession(id: number): Promise<void> {
    await this.pool.execute(
      'UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL',
      [id],
    );
  }

  async expireSessionForTests(id: number): Promise<void> {
    await this.pool.execute(
      'UPDATE user_sessions SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND) WHERE id = ?',
      [id],
    );
  }

  async recordAiUsage(input: CreateAiUsageInput): Promise<AiUsageEventRecord> {
    const publicUuid = newPublicUuid();
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO ai_usage_events (
         public_uuid, user_id, session_uuid, provider, model, feature,
         input_tokens, output_tokens, total_tokens, estimated_cost,
         result_status, rate_limit_result, latency_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        publicUuid,
        input.userId ?? null,
        input.sessionUuid ?? null,
        input.provider,
        input.model ?? null,
        input.feature,
        input.inputTokens ?? null,
        input.outputTokens ?? null,
        input.totalTokens ?? null,
        input.estimatedCost ?? null,
        input.resultStatus ?? null,
        input.rateLimitResult ?? null,
        input.latencyMs ?? null,
      ],
    );
    if (input.userId) {
      await this.bumpDailyUsage(input);
    }
    const created = await this.getAiUsageById(asBigIntId(result.insertId));
    if (!created) throw new MysqlPersistenceError('usage insert did not persist');
    return created;
  }

  async getAiUsageById(id: number): Promise<AiUsageEventRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM ai_usage_events WHERE id = ?',
      [id],
    );
    const row = rows[0];
    return row ? this.mapUsage(row) : null;
  }

  async getDailyUsage(userId: number, usageDate: string): Promise<AiUsageDailyRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM ai_usage_daily WHERE user_id = ? AND usage_date = ?',
      [userId, usageDate],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      userId: asBigIntId(row.user_id),
      usageDate: String(row.usage_date),
      requestCount: Number(row.request_count),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      totalTokens: Number(row.total_tokens),
      imageGenerationCount: Number(row.image_generation_count),
      estimatedCost: String(row.estimated_cost),
    };
  }

  async listTableNames(): Promise<string[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>('SHOW TABLES');
    return rows.map((row) => String(Object.values(row)[0]));
  }

  async listColumnNames(table: string): Promise<string[]> {
    if (!/^[a-z0-9_]+$/i.test(table)) {
      throw new MysqlPersistenceError('invalid table name');
    }
    const [rows] = await this.pool.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${table}\``);
    return rows.map((row) => String(row.Field));
  }

  /* ------------------------------------------------------- guest accounts */

  /**
   * A guest: an ordinary user row that has not been claimed yet.
   *
   * Everything about how it was made is written here, at the one moment it is
   * known. Reconstructing it later from other columns would be guesswork, and
   * the reason to have it at all is to find out whether the guest prompt is
   * appearing somewhere useful.
   */
  async createGuestUser(
    guestName: string,
    context: AccountCreationContext,
  ): Promise<UserRecord> {
    const publicUuid = newPublicUuid();
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO users
         (public_uuid, status, account_type, guest_name, guest_created_at,
          creation_method, creation_source, platform, device_class, last_seen_at)
       VALUES (?, 'ACTIVE', 'ANONYMOUS', ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        publicUuid,
        guestName,
        context.creationMethod,
        context.creationSource,
        context.platform,
        context.deviceClass,
      ],
    );
    const created = await this.getUserById(asBigIntId(result.insertId));
    if (!created) throw new MysqlPersistenceError('guest insert did not persist');
    return created;
  }

  /**
   * The next number for a base name, handed out exactly once.
   *
   * `LAST_INSERT_ID(expression)` is what makes this atomic without an explicit
   * transaction: the UPDATE stores the incremented value and records it in the
   * same statement, and the row lock serialises two callers arriving together
   * so they read back different numbers. The stored column is the *next*
   * number to hand out, so what was allocated is one less than what comes back.
   *
   * On ONE connection, taken from the pool and held. `LAST_INSERT_ID()` is
   * per-connection state: issued through the pool, the SELECT could land on a
   * different connection and read a value belonging to somebody else's insert,
   * which is exactly the collision this function exists to prevent.
   */
  async nextGuestNameSequence(baseName: string): Promise<number> {
    const connection = await this.pool.getConnection();
    try {
      await connection.execute(
        'INSERT IGNORE INTO guest_name_sequences (base_name, next_sequence) VALUES (?, 1)',
        [baseName],
      );
      await connection.execute(
        'UPDATE guest_name_sequences SET next_sequence = LAST_INSERT_ID(next_sequence + 1) WHERE base_name = ?',
        [baseName],
      );
      const [rows] = await connection.query<RowDataPacket[]>('SELECT LAST_INSERT_ID() AS allocated');
      const allocated = Number(rows[0]?.allocated ?? 1);
      return Math.max(1, allocated - 1);
    } finally {
      connection.release();
    }
  }

  /**
   * Durable recognition for one browser or app.
   *
   * Only the hash of the secret is stored, so this row cannot be turned back
   * into something presentable. The diagnostic columns are written here and
   * read nowhere: they answer "what kind of clients are these" and never
   * "is this the same person".
   */
  async addInstallation(input: {
    userId: number;
    installationId: string;
    credentialHash: string;
    persistenceType: string;
    platform: string;
    deviceClass?: string | null;
    browserFamily?: string | null;
    osFamily?: string | null;
  }): Promise<number> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO account_installations
         (user_id, installation_id, credential_hash, platform, device_class,
          browser_family, os_family, persistence_type, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        input.userId,
        input.installationId,
        input.credentialHash,
        input.platform,
        input.deviceClass ?? null,
        input.browserFamily ?? null,
        input.osFamily ?? null,
        input.persistenceType,
      ],
    );
    return asBigIntId(result.insertId);
  }

  /** By id alone: the caller compares the secret against the hash itself. */
  async findInstallation(
    installationId: string,
  ): Promise<{ id: number; userId: number; credentialHash: string; persistenceType: string } | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, user_id, credential_hash, persistence_type
         FROM account_installations
        WHERE installation_id = ? AND revoked_at IS NULL`,
      [installationId],
    );
    const row = rows[0];
    return row
      ? {
          id: asBigIntId(row.id),
          userId: asBigIntId(row.user_id),
          credentialHash: String(row.credential_hash),
          persistenceType: String(row.persistence_type),
        }
      : null;
  }

  async touchInstallation(installationId: string): Promise<void> {
    await this.pool.execute(
      'UPDATE account_installations SET last_seen_at = CURRENT_TIMESTAMP WHERE installation_id = ?',
      [installationId],
    );
  }

  /** The browser is no longer recognised, and neither is anything it started. */
  async revokeInstallation(installationId: string): Promise<void> {
    await this.pool.execute(
      'UPDATE account_installations SET revoked_at = CURRENT_TIMESTAMP WHERE installation_id = ? AND revoked_at IS NULL',
      [installationId],
    );
    await this.pool.execute(
      'UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE installation_id = ? AND revoked_at IS NULL',
      [installationId],
    );
  }

  /** Used when an account is retired: nothing it opened stays usable. */
  async revokeSessionsForUser(userId: number): Promise<void> {
    await this.pool.execute(
      'UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL',
      [userId],
    );
  }

  async revokeInstallationsForUser(userId: number): Promise<void> {
    await this.pool.execute(
      'UPDATE account_installations SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL',
      [userId],
    );
  }

  /**
   * Registration, applied to the row that already exists.
   *
   * Guarded on the account still being a guest so two registrations racing on
   * one guest cannot both win. The guest name is left alone: it is what this
   * person has been called until now, and an audit trail that stops the moment
   * somebody registers has a hole in it.
   */
  async markUserRegistered(userId: number): Promise<void> {
    await this.pool.execute(
      `UPDATE users
          SET account_type = 'REGISTERED', registered_at = COALESCE(registered_at, CURRENT_TIMESTAMP)
        WHERE id = ?`,
      [userId],
    );
  }

  async markEmailVerified(userId: number): Promise<void> {
    await this.pool.execute(
      'UPDATE users SET email_verified_at = CURRENT_TIMESTAMP WHERE id = ?',
      [userId],
    );
  }

  /** The guest is retired, not deleted: a stale cookie must resolve to it. */
  async markUserMerged(fromUserId: number, intoUserId: number): Promise<void> {
    await this.pool.execute(
      'UPDATE users SET merged_into_user_id = ?, status = \'MERGED\' WHERE id = ?',
      [intoUserId, fromUserId],
    );
  }

  async deleteUserGraph(userId: number): Promise<void> {
    await this.pool.execute('DELETE FROM account_installations WHERE user_id = ?', [userId]);
    await this.pool.execute(
      'UPDATE reflections SET current_revision_id = NULL WHERE user_id = ?',
      [userId],
    );
    await this.pool.execute(
      `DELETE i FROM reflection_images i
       INNER JOIN reflections r ON r.id = i.reflection_id
       WHERE r.user_id = ?`,
      [userId],
    );
    await this.pool.execute(
      `DELETE rv FROM reflection_revisions rv
       INNER JOIN reflections r ON r.id = rv.reflection_id
       WHERE r.user_id = ?`,
      [userId],
    );
    await this.pool.execute('DELETE FROM reflections WHERE user_id = ?', [userId]);
    await this.pool.execute('DELETE FROM ai_usage_events WHERE user_id = ?', [userId]);
    await this.pool.execute('DELETE FROM users WHERE id = ?', [userId]);
  }

  private async bumpDailyUsage(input: CreateAiUsageInput): Promise<void> {
    const userId = input.userId;
    if (!userId) return;
    const usageDate = new Date().toISOString().slice(0, 10);
    const imageCount = input.feature === 'IMAGE_GENERATION' ? 1 : 0;
    await this.pool.execute(
      `INSERT INTO ai_usage_daily (
         user_id, usage_date, request_count, input_tokens, output_tokens,
         total_tokens, image_generation_count, estimated_cost
       ) VALUES (?, ?, 1, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         request_count = request_count + 1,
         input_tokens = input_tokens + VALUES(input_tokens),
         output_tokens = output_tokens + VALUES(output_tokens),
         total_tokens = total_tokens + VALUES(total_tokens),
         image_generation_count = image_generation_count + VALUES(image_generation_count),
         estimated_cost = estimated_cost + VALUES(estimated_cost)`,
      [
        userId,
        usageDate,
        input.inputTokens ?? 0,
        input.outputTokens ?? 0,
        input.totalTokens ?? 0,
        imageCount,
        input.estimatedCost ?? 0,
      ],
    );
  }

  private mapImage(row: RowDataPacket): ImageRecord {
    return {
      id: asBigIntId(row.id),
      publicUuid: String(row.public_uuid),
      reflectionId: asBigIntId(row.reflection_id),
      revisionId: asNullableId(row.revision_id),
      imagePath: String(row.image_path),
      imageType: row.image_type === null ? null : String(row.image_type),
      aspectRatio: row.aspect_ratio === null ? null : String(row.aspect_ratio),
      designConfig: parseJson(row.design_config),
      inputHash: row.input_hash === null ? null : String(row.input_hash),
      createdAt: String(row.created_at),
      deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    };
  }

  private mapSession(row: RowDataPacket): SessionRecord {
    return {
      id: asBigIntId(row.id),
      publicUuid: String(row.public_uuid),
      userId: asBigIntId(row.user_id),
      installationId: row.installation_id ? String(row.installation_id) : null,
      sessionType: row.session_type ? String(row.session_type) : 'REGISTERED_TEMPORARY',
      expiresAt: String(row.expires_at),
      lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : null,
      createdAt: String(row.created_at),
      revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    };
  }

  private mapUsage(row: RowDataPacket): AiUsageEventRecord {
    return {
      id: asBigIntId(row.id),
      publicUuid: String(row.public_uuid),
      userId: asNullableId(row.user_id),
      sessionUuid: row.session_uuid === null ? null : String(row.session_uuid),
      provider: String(row.provider),
      model: row.model === null ? null : String(row.model),
      feature: String(row.feature),
      inputTokens: asNullableNumber(row.input_tokens),
      outputTokens: asNullableNumber(row.output_tokens),
      totalTokens: asNullableNumber(row.total_tokens),
      estimatedCost: row.estimated_cost === null ? null : String(row.estimated_cost),
      resultStatus: row.result_status === null ? null : String(row.result_status),
      rateLimitResult: row.rate_limit_result === null ? null : String(row.rate_limit_result),
      latencyMs: asNullableNumber(row.latency_ms),
      createdAt: String(row.created_at),
    };
  }
}
