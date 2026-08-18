import {
  AUTHOR_ORIGINS,
  CHAT_SECTION_TYPES,
  CONDENSED_SECTION_TYPES,
  type AuthorOrigin,
  type ChatSectionType,
  type CondensedSectionType,
} from '@chat/shared';
import { CHAT_TYPES, type ChatType } from './constants.ts';

export class ChatContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatContentError';
  }
}

/**
 * One written section, as it is stored.
 *
 * `authorOrigin` travels with the words rather than beside them. It is the
 * record of who wrote a sentence, and the product's central promise is that
 * AI-assisted text stays distinguishable from the author's own testimony —
 * a shape that cannot carry it cannot keep that promise.
 */
export type StoredSection = {
  content: string;
  authorOrigin: AuthorOrigin;
};

export type FullChatContent = Record<ChatSectionType, StoredSection>;
export type CondensedChatContent = Record<CondensedSectionType, StoredSection>;
export type ChatContent = FullChatContent | CondensedChatContent;

const FULL_KEYS = Object.values(CHAT_SECTION_TYPES);
const CONDENSED_KEYS = Object.values(CONDENSED_SECTION_TYPES);
const ORIGINS: readonly string[] = Object.values(AUTHOR_ORIGINS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireSections(
  value: Record<string, unknown>,
  keys: readonly string[],
  chatType: ChatType,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i])) {
    throw new ChatContentError(
      `${chatType} chat_content must contain exactly: ${keys.join(', ')}`,
    );
  }
  for (const key of keys) {
    const section = value[key];
    if (!isPlainObject(section)) {
      throw new ChatContentError(`${chatType} chat_content.${key} must be an object`);
    }
    if (typeof section['content'] !== 'string') {
      throw new ChatContentError(`${chatType} chat_content.${key}.content must be a string`);
    }
    if (typeof section['authorOrigin'] !== 'string' || !ORIGINS.includes(section['authorOrigin'])) {
      throw new ChatContentError(
        `${chatType} chat_content.${key}.authorOrigin must be one of: ${ORIGINS.join(', ')}`,
      );
    }
    const extra = Object.keys(section).filter((name) => name !== 'content' && name !== 'authorOrigin');
    if (extra.length > 0) {
      throw new ChatContentError(
        `${chatType} chat_content.${key} has unexpected keys: ${extra.join(', ')}`,
      );
    }
  }
}

export function parseChatType(value: unknown): ChatType {
  if (typeof value === 'string' && (CHAT_TYPES as readonly string[]).includes(value)) {
    return value as ChatType;
  }
  throw new ChatContentError(`chat_type must be one of: ${CHAT_TYPES.join(', ')}`);
}

export function validateChatContent(chatType: ChatType, content: unknown): ChatContent {
  if (!isPlainObject(content)) {
    throw new ChatContentError('chat_content must be a JSON object');
  }
  if (chatType === 'FULL') {
    requireSections(content, FULL_KEYS, chatType);
    return content as FullChatContent;
  }
  requireSections(content, CONDENSED_KEYS, chatType);
  return content as CondensedChatContent;
}

/**
 * Read a stored payload back.
 *
 * MariaDB stores a declared JSON column as LONGTEXT, so what comes back from
 * the driver is a string. It is parsed and then validated with the same rule
 * that admitted it, because a column with no native JSON type has no server
 * guarantee beyond `json_valid()` that the shape is still what was written.
 */
export function parseStoredChatContent(chatType: unknown, raw: unknown): ChatContent {
  const type = parseChatType(chatType);
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new ChatContentError('chat_content is not valid JSON');
    }
  }
  return validateChatContent(type, parsed);
}
