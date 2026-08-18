import {
  CHAT_SECTION_TYPES,
  CONDENSED_SECTION_TYPES,
  parseHashtags,
} from '@chat/shared';
import type { StoredConversation, StoredMessage, StoredSection } from '../store.ts';
import { parseScriptureQuery, scriptureMatches } from './scripture-query.ts';
import { findBook } from '../bible/books.ts';

export const DATE_DAY = /^\d{4}-\d{2}-\d{2}$/;

const SECTION_MATCH: Record<string, readonly string[]> = {
  [CHAT_SECTION_TYPES.CONTENT]: [CHAT_SECTION_TYPES.CONTENT, CONDENSED_SECTION_TYPES.VERSE],
  [CHAT_SECTION_TYPES.HEART]: [CHAT_SECTION_TYPES.HEART, CONDENSED_SECTION_TYPES.REFLECTION],
  [CHAT_SECTION_TYPES.APPLICATION]: [CHAT_SECTION_TYPES.APPLICATION],
  [CHAT_SECTION_TYPES.TESTIMONY]: [CHAT_SECTION_TYPES.TESTIMONY],
  [CONDENSED_SECTION_TYPES.VERSE]: [CONDENSED_SECTION_TYPES.VERSE],
  [CONDENSED_SECTION_TYPES.REFLECTION]: [CONDENSED_SECTION_TYPES.REFLECTION],
};

export type ReflectionFilters = {
  q: string;
  filter: string;
  sort: 'recent' | 'title';
  from: string | null;
  to: string | null;
  section: string | null;
  tag: string | null;
  book: string | null;
};

export type FilterError = { error: string };

export function readReflectionFilters(query: {
  get: (name: string) => string | undefined;
}): ReflectionFilters | FilterError {
  const from = emptyToNull(query.get('from'));
  const to = emptyToNull(query.get('to'));
  if (from && !DATE_DAY.test(from)) {
    return { error: 'from must be a calendar date, for example 2026-01-31.' };
  }
  if (to && !DATE_DAY.test(to)) {
    return { error: 'to must be a calendar date, for example 2026-01-31.' };
  }

  const section = emptyToNull(query.get('section'));
  if (section && !SECTION_MATCH[section]) {
    return { error: 'section must be one of the C.H.A.T. or Condensed fields.' };
  }

  const sort = query.get('sort') === 'title' ? 'title' : 'recent';
  const rawTag = emptyToNull(query.get('tag'));
  const [parsedTag] = rawTag ? parseHashtags([rawTag]) : [];
  const rawBook = emptyToNull(query.get('book'));
  const book = rawBook
    ? (parseScriptureQuery(rawBook)?.book ?? findBook(rawBook)?.usfm ?? null)
    : null;
  if (rawBook && !book) {
    return { error: 'book must be a book of the Bible, for example John or PSA.' };
  }

  return {
    q: (query.get('q') ?? '').trim().toLowerCase(),
    filter: query.get('filter') ?? 'all',
    sort,
    from,
    to,
    section,
    tag: parsedTag?.tag ?? null,
    book,
  };
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

export function inDateRange(iso: string, from: string | null, to: string | null): boolean {
  const stamp = Date.parse(iso);
  if (Number.isNaN(stamp)) return false;
  if (from) {
    const start = Date.parse(`${from}T00:00:00.000Z`);
    if (stamp < start) return false;
  }
  if (to) {
    const end = Date.parse(`${to}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
    if (stamp >= end) return false;
  }
  return true;
}

export function sectionHasWriting(
  section: string,
  stored: Record<string, StoredSection> | undefined,
): boolean {
  const types = SECTION_MATCH[section] ?? [section];
  return types.some((type) => (stored?.[type]?.content ?? '').trim().length > 0);
}

export function tagsOf(
  conversation: StoredConversation,
  stored: Record<string, StoredSection> | undefined,
  messages: StoredMessage[],
): string[] {
  const fromFields = parseHashtags((conversation.tags ?? []).map((item) => item.tag));
  const writing = [
    ...Object.values(stored ?? {}).map((section) => section.content),
    ...messages.map((message) => message.content),
  ].join('\n');
  const fromWriting = parseHashtags(
    [...writing.matchAll(/#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu)].map((match) => match[0]),
  );
  return [...new Set([...fromFields, ...fromWriting].map((item) => item.tag))];
}

export function matchesReflection(
  conversation: StoredConversation,
  stored: Record<string, StoredSection> | undefined,
  messages: StoredMessage[],
  filters: ReflectionFilters,
): boolean {
  if (!inDateRange(conversation.updatedAt, filters.from, filters.to)) return false;
  if (filters.section && !sectionHasWriting(filters.section, stored)) return false;
  if (filters.tag && !tagsOf(conversation, stored, messages).includes(filters.tag)) return false;
  if (filters.book && !scriptureMatches(conversation.scriptureReference, { book: filters.book })) {
    return false;
  }
  if (!filters.q) return true;

  const haystack = [
    conversation.title,
    conversation.scriptureReference ?? '',
    ...messages.map((message) => message.content),
    ...Object.values(stored ?? {}).map((section) => section.content),
    ...(conversation.tags ?? []).map((item) => item.label),
  ]
    .join('\n')
    .toLowerCase();
  if (haystack.includes(filters.q)) return true;

  const locator = parseScriptureQuery(filters.q);
  return locator ? scriptureMatches(conversation.scriptureReference, locator) : false;
}
