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

export type SectionKey = ChatSectionType | CondensedSectionType;

/**
 * Every section a reflection can hold, in one document.
 *
 * The four C.H.A.T. sections and the two condensed fields are all present,
 * whichever format is active. `chat_type` says which of them the reflection
 * currently *is*; it does not say which ones exist.
 *
 * That is not redundancy, it is the format rule. Changing format proposes and
 * preserves rather than overwrites, in both directions, so an author who
 * condenses a full reflection and changes their mind still has the four
 * sections they wrote. A document holding only the active format would throw
 * the other draft away the moment the format changed — the one thing the
 * conversion rules exist to prevent.
 */
export type ChatContent = Record<SectionKey, StoredSection>;

const FULL_KEYS = Object.values(CHAT_SECTION_TYPES);
const CONDENSED_KEYS = Object.values(CONDENSED_SECTION_TYPES);
export const SECTION_KEYS: readonly SectionKey[] = [...FULL_KEYS, ...CONDENSED_KEYS];
const ORIGINS: readonly string[] = Object.values(AUTHOR_ORIGINS);

/** An unwritten section: the author's own, and empty. Never AI-authored. */
export function emptySection(): StoredSection {
  return { content: '', authorOrigin: AUTHOR_ORIGINS.USER };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireSections(value: Record<string, unknown>, chatType: ChatType): void {
  const unknown = Object.keys(value).filter(
    (key) => !(SECTION_KEYS as readonly string[]).includes(key),
  );
  if (unknown.length > 0) {
    throw new ChatContentError(
      `chat_content has no section named: ${unknown.join(', ')}`,
    );
  }
  for (const key of Object.keys(value)) {
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

/**
 * Validate a whole document.
 *
 * Sections belonging to the format that is not active may be absent — a
 * reflection that has never been condensed has no condensed draft — and are
 * filled in empty so the stored shape is the same for every row.
 */
export function validateChatContent(chatType: ChatType, content: unknown): ChatContent {
  parseChatType(chatType);
  if (!isPlainObject(content)) {
    throw new ChatContentError('chat_content must be a JSON object');
  }
  const required = chatType === 'FULL' ? FULL_KEYS : CONDENSED_KEYS;
  const missing = required.filter((key) => content[key] === undefined);
  if (missing.length > 0) {
    throw new ChatContentError(
      `${chatType} chat_content is missing: ${missing.join(', ')}`,
    );
  }
  requireSections(content, chatType);
  const complete = {} as ChatContent;
  for (const key of SECTION_KEYS) {
    const section = content[key];
    complete[key] = section === undefined ? emptySection() : (section as StoredSection);
  }
  return complete;
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
