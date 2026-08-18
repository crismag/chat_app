/*
 * The durable reflection boundary.
 *
 * Everything above this file speaks the application's language — `full` and
 * `condensed` formats, sections keyed by `content`/`heart`/`application`/
 * `testimony`, an author origin on every one. Everything below it speaks the
 * database's: `FULL` and `SHORT` chat types, a `chat_content` document, a
 * BIGINT owner. Nothing else in the API should know both, and no request
 * handler should ever hold SQL.
 *
 * A reflection is addressed from outside by its `public_uuid`. The BIGINT `id`
 * is an internal join key and must not reach a browser, a URL, or a mobile
 * client.
 */

import {
  AUTHOR_ORIGINS,
  CHAT_FORMATS,
  CHAT_SECTION_TYPES,
  CONDENSED_SECTION_TYPES,
  type AuthorOrigin,
  type ChatFormat,
} from '@chat/shared';
import { ChatContentError, type ChatContent, type StoredSection } from '../mysql/chat-content.ts';
import type { ChatType } from '../mysql/constants.ts';
import type { MysqlPersistence } from '../mysql/persistence.ts';

/** A section as the application holds it, before it is written down. */
export type SectionInput = {
  content: string;
  authorOrigin: AuthorOrigin;
};

export type ReflectionInput = {
  format: ChatFormat;
  sections: Record<string, SectionInput>;
  title?: string | null;
  bibleReference?: string | null;
  bibleTranslation?: string | null;
  bibleText?: string | null;
};

export type Reflection = {
  /** The only identifier that may leave the server. */
  publicUuid: string;
  format: ChatFormat;
  sections: Record<string, StoredSection>;
  title: string | null;
  bibleReference: string | null;
  bibleTranslation: string | null;
  bibleText: string | null;
  createdAt: string;
  updatedAt: string;
};

export class ReflectionServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReflectionServiceError';
  }
}

const FORMAT_TO_CHAT_TYPE: Record<ChatFormat, ChatType> = {
  [CHAT_FORMATS.FULL]: 'FULL',
  [CHAT_FORMATS.CONDENSED]: 'SHORT',
};

const CHAT_TYPE_TO_FORMAT: Record<ChatType, ChatFormat> = {
  FULL: CHAT_FORMATS.FULL,
  SHORT: CHAT_FORMATS.CONDENSED,
};

const KEYS_FOR_FORMAT: Record<ChatFormat, readonly string[]> = {
  [CHAT_FORMATS.FULL]: Object.values(CHAT_SECTION_TYPES),
  [CHAT_FORMATS.CONDENSED]: Object.values(CONDENSED_SECTION_TYPES),
};

/**
 * Fill in what the author has not written yet.
 *
 * A reflection is saved while it is being written, so most sections are empty
 * most of the time. An absent section is an unwritten one and is stored as the
 * author's own empty string — never as AI-authored, which would put a claim on
 * words nobody has typed.
 */
function completeSections(
  format: ChatFormat,
  sections: Record<string, SectionInput>,
): Record<string, StoredSection> {
  const keys = KEYS_FOR_FORMAT[format];
  const unknown = Object.keys(sections).filter((key) => !keys.includes(key));
  if (unknown.length > 0) {
    throw new ReflectionServiceError(
      `${format} reflections have no section named: ${unknown.join(', ')}`,
    );
  }
  const complete: Record<string, StoredSection> = {};
  for (const key of keys) {
    const given = sections[key];
    complete[key] = {
      content: given?.content ?? '',
      authorOrigin: given?.authorOrigin ?? AUTHOR_ORIGINS.USER,
    };
  }
  return complete;
}

export class ReflectionService {
  private readonly db: MysqlPersistence;

  constructor(db: MysqlPersistence) {
    this.db = db;
  }

  /**
   * The owner record a reflection hangs from.
   *
   * Identity is not built yet, so this establishes the minimum seam: a durable
   * `users` row addressed by its public UUID. It creates on first use and
   * returns the same row afterwards, which is what lets a reflection be saved
   * before any login provider exists.
   */
  async ensureOwner(publicUuid?: string): Promise<{ id: number; publicUuid: string }> {
    if (publicUuid) {
      const found = await this.db.getUserByPublicUuid(publicUuid);
      if (!found) throw new ReflectionServiceError(`No owner record for ${publicUuid}`);
      return { id: found.id, publicUuid: found.publicUuid };
    }
    const created = await this.db.createUser();
    return { id: created.id, publicUuid: created.publicUuid };
  }

  async save(ownerId: number, input: ReflectionInput): Promise<Reflection> {
    const chatContent = completeSections(input.format, input.sections);
    try {
      const record = await this.db.createReflection({
        userId: ownerId,
        title: input.title ?? null,
        bibleReference: input.bibleReference ?? null,
        bibleTranslation: input.bibleTranslation ?? null,
        bibleText: input.bibleText ?? null,
        chatType: FORMAT_TO_CHAT_TYPE[input.format],
        chatContent,
      });
      return toReflection(record);
    } catch (error: unknown) {
      if (error instanceof ChatContentError) throw new ReflectionServiceError(error.message);
      throw error;
    }
  }

  async getByPublicUuid(publicUuid: string): Promise<Reflection | null> {
    const record = await this.db.getReflectionByPublicUuid(publicUuid);
    return record ? toReflection(record) : null;
  }

  /**
   * Rewrite a reflection, keeping its identity and its owner.
   *
   * Sections are replaced as a whole document rather than merged field by
   * field. `chat_content` is one LONGTEXT value on this server — there is no
   * partial update of a JSON path to merge into — so the caller sends the
   * reflection as it now stands and the write is a single atomic row update.
   */
  async update(
    publicUuid: string,
    ownerId: number,
    input: ReflectionInput,
  ): Promise<Reflection | null> {
    const existing = await this.db.getReflectionByPublicUuid(publicUuid);
    if (!existing) return null;
    if (existing.userId !== ownerId) {
      throw new ReflectionServiceError('A reflection may only be updated by its owner.');
    }
    const chatContent = completeSections(input.format, input.sections);
    try {
      const record = await this.db.updateReflection(existing.id, ownerId, {
        title: input.title ?? null,
        bibleReference: input.bibleReference ?? null,
        bibleTranslation: input.bibleTranslation ?? null,
        bibleText: input.bibleText ?? null,
        chatType: FORMAT_TO_CHAT_TYPE[input.format],
        chatContent,
      });
      return record ? toReflection(record) : null;
    } catch (error: unknown) {
      if (error instanceof ChatContentError) throw new ReflectionServiceError(error.message);
      throw error;
    }
  }
}

function toReflection(record: {
  publicUuid: string;
  chatType: ChatType;
  chatContent: ChatContent;
  title: string | null;
  bibleReference: string | null;
  bibleTranslation: string | null;
  bibleText: string | null;
  createdAt: string;
  updatedAt: string;
}): Reflection {
  return {
    publicUuid: record.publicUuid,
    format: CHAT_TYPE_TO_FORMAT[record.chatType],
    sections: record.chatContent as Record<string, StoredSection>,
    title: record.title,
    bibleReference: record.bibleReference,
    bibleTranslation: record.bibleTranslation,
    bibleText: record.bibleText,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
