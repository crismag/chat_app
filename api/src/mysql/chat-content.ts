import { CHAT_TYPES, type ChatType } from './constants.ts';

export class ChatContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatContentError';
  }
}

export type FullChatContent = {
  context: string;
  heart: string;
  application: string;
  testimony: string;
};

export type ShortChatContent = {
  reflection: string;
};

export type ChatContent = FullChatContent | ShortChatContent;

const FULL_KEYS = ['context', 'heart', 'application', 'testimony'] as const;
const SHORT_KEYS = ['reflection'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireStringFields(
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
    if (typeof value[key] !== 'string') {
      throw new ChatContentError(`${chatType} chat_content.${key} must be a string`);
    }
  }
}

export function parseChatType(value: unknown): ChatType {
  if (typeof value === 'string' && (CHAT_TYPES as readonly string[]).includes(value)) {
    return value as ChatType;
  }
  throw new ChatContentError('chat_type must be FULL or SHORT');
}

export function validateChatContent(chatType: ChatType, content: unknown): ChatContent {
  if (!isPlainObject(content)) {
    throw new ChatContentError('chat_content must be a JSON object');
  }
  if (chatType === 'FULL') {
    requireStringFields(content, FULL_KEYS, chatType);
    return content as FullChatContent;
  }
  requireStringFields(content, SHORT_KEYS, chatType);
  return content as ShortChatContent;
}

export function parseStoredChatContent(chatType: unknown, raw: unknown): ChatContent {
  const type = parseChatType(chatType);
  const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  return validateChatContent(type, parsed);
}
