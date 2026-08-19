import { expect, test } from 'vitest';
import { AUTHOR_ORIGINS, CHAT_FORMATS, CHAT_SECTION_TYPES, VISIBILITY } from '@chat/shared';
import type { StoredConversation, StoredSection } from '../store.ts';
import { matchesReflection, readReflectionFilters } from './query.ts';

const conversation: StoredConversation = {
  id: 'c1',
  userId: 'u1',
  format: CHAT_FORMATS.FULL,
  title: 'Abide',
  scriptureReference: 'John 15:5',
  visibility: VISIBILITY.PRIVATE,
  tags: [{ tag: 'faith', label: 'faith' }],
  createdAt: '2026-03-01T12:00:00.000Z',
  updatedAt: '2026-03-10T12:00:00.000Z',
};

const sections: Record<string, StoredSection> = {
  [CHAT_SECTION_TYPES.HEART]: {
    type: CHAT_SECTION_TYPES.HEART,
    content: 'It met my fear. #trust',
    authorOrigin: AUTHOR_ORIGINS.USER,
  },
};

function filters(params: Record<string, string>) {
  const result = readReflectionFilters({ get: (name) => params[name] });
  if ('error' in result) throw new Error(result.error);
  return result;
}

test('Jn 15 matches a reflection stored as John 15:5', () => {
  expect(matchesReflection(conversation, sections, [], filters({ q: 'Jn 15' }))).toBe(true);
  expect(matchesReflection(conversation, sections, [], filters({ q: 'Psalm' }))).toBe(false);
});

test('date bounds use the inclusive calendar day in UTC', () => {
  expect(matchesReflection(conversation, sections, [], filters({ from: '2026-03-10', to: '2026-03-10' }))).toBe(
    true,
  );
  expect(matchesReflection(conversation, sections, [], filters({ from: '2026-03-11' }))).toBe(false);
  expect(matchesReflection(conversation, sections, [], filters({ to: '2026-03-09' }))).toBe(false);
});

test('section=heart finds writing in Heart, not an empty Application', () => {
  expect(matchesReflection(conversation, sections, [], filters({ section: 'heart' }))).toBe(true);
  expect(matchesReflection(conversation, sections, [], filters({ section: 'application' }))).toBe(false);
});

test('tag matches an explicit tag and a hashtag written in a section', () => {
  expect(matchesReflection(conversation, sections, [], filters({ tag: 'faith' }))).toBe(true);
  expect(matchesReflection(conversation, sections, [], filters({ tag: 'trust' }))).toBe(true);
  expect(matchesReflection(conversation, sections, [], filters({ tag: 'youth' }))).toBe(false);
});

test('book=John selects by canon, not by substring of the title', () => {
  expect(matchesReflection(conversation, sections, [], filters({ book: 'John' }))).toBe(true);
  expect(matchesReflection(conversation, sections, [], filters({ book: 'Romans' }))).toBe(false);
});

test('refuses a date that is not a calendar day', () => {
  expect(readReflectionFilters({ get: (name) => (name === 'from' ? 'March' : undefined) })).toEqual({
    error: 'from must be a calendar date, for example 2026-01-31.',
  });
});
