import {
  AI_ACTIONS,
  AUTHOR_ORIGINS,
  CHAT_SECTION_TYPES,
  CONDENSED_SECTION_TYPES,
  emptyChatSections,
  type AiAction,
  type ChatSection,
  type ChatSectionType,
  type CondensedSection,
  type CondensedSectionType,
} from '@chat/shared';
import type { StoredMessage, StoredSection } from './store.ts';

export function applyNamedAiAction(
  action: AiAction,
  sourceText: string,
): { revised: string; origin: typeof AUTHOR_ORIGINS.AI_GENERATED | typeof AUTHOR_ORIGINS.AI_ASSISTED } {
  switch (action) {
    case AI_ACTIONS.GRAMMAR: {
      const trimmed = sourceText.trim();
      const capitalized = trimmed ? trimmed[0]!.toUpperCase() + trimmed.slice(1) : '';
      const withStop = capitalized && !/[.!?]$/.test(capitalized) ? `${capitalized}.` : capitalized;
      return { revised: withStop, origin: AUTHOR_ORIGINS.AI_ASSISTED };
    }
    case AI_ACTIONS.POLISH:
      return {
        revised: sourceText.replace(/\s+/g, ' ').trim(),
        origin: AUTHOR_ORIGINS.AI_ASSISTED,
      };
    case AI_ACTIONS.SHORTEN:
      return {
        revised: sourceText.split(/(?<=[.!?])\s+/)[0]?.trim() ?? sourceText,
        origin: AUTHOR_ORIGINS.AI_ASSISTED,
      };
    case AI_ACTIONS.SUMMARIZE:
      return {
        revised: sourceText.trim().slice(0, 160),
        origin: AUTHOR_ORIGINS.AI_GENERATED,
      };
    case AI_ACTIONS.EXPLAIN:
      return {
        revised: `Explanation (not the user's words): ${sourceText.trim()}`,
        origin: AUTHOR_ORIGINS.AI_GENERATED,
      };
    default:
      return { revised: sourceText, origin: AUTHOR_ORIGINS.AI_ASSISTED };
  }
}

function collectUserText(messages: StoredMessage[]): string {
  return messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join('\n');
}

/**
 * What extraction could derive from the conversation — and nothing else.
 *
 * This used to return all four sections, padded with empty strings for the ones
 * no rule matched. Any caller that stored that record wiped whatever the author
 * had written by hand into Heart, Application and Testimony, because by the
 * time it reaches storage an empty string is indistinguishable from "delete
 * this". That is exactly what happened, and it was a wholesale replace that
 * looked like a save.
 *
 * A partial record cannot do it. A section that was not derived is absent
 * rather than blank, so the worst a careless caller can do is leave existing
 * content alone. The shape is the safeguard; review before applying is the
 * second one.
 */
export function extractChatSections(
  messages: StoredMessage[],
): Partial<Record<ChatSectionType, ChatSection>> {
  const sections: Partial<Record<ChatSectionType, ChatSection>> = {};
  const userText = collectUserText(messages);

  if (userText.trim()) {
    sections[CHAT_SECTION_TYPES.CONTEXT] = {
      type: CHAT_SECTION_TYPES.CONTEXT,
      content: userText.trim(),
      authorOrigin: AUTHOR_ORIGINS.AI_ASSISTED,
    };
  }

  const heartMatch = userText.match(
    /\bI (?:feel|felt|am convicted|was encouraged|was challenged|am touched|was touched)\b[\s\S]{0,240}/i,
  );
  if (heartMatch?.[0]) {
    sections[CHAT_SECTION_TYPES.HEART] = {
      type: CHAT_SECTION_TYPES.HEART,
      content: heartMatch[0].trim(),
      authorOrigin: AUTHOR_ORIGINS.AI_ASSISTED,
    };
  }

  const applicationMatch = userText.match(
    /\bI (?:will|need to|must|intend to)\b[\s\S]{0,240}/i,
  );
  if (applicationMatch?.[0]) {
    sections[CHAT_SECTION_TYPES.APPLICATION] = {
      type: CHAT_SECTION_TYPES.APPLICATION,
      content: applicationMatch[0].trim(),
      authorOrigin: AUTHOR_ORIGINS.AI_ASSISTED,
    };
  }

  const testimonyMatch = userText.match(
    /\bI (?:believe|testify|declare|commit|pray)\b[\s\S]{0,240}/i,
  );
  if (testimonyMatch?.[0]) {
    sections[CHAT_SECTION_TYPES.TESTIMONY] = {
      type: CHAT_SECTION_TYPES.TESTIMONY,
      content: testimonyMatch[0].trim(),
      authorOrigin: AUTHOR_ORIGINS.AI_ASSISTED,
    };
  }

  return sections;
}

/**
 * The two Condensed fields, read from the same table.
 *
 * They live beside the four rather than instead of them, so an author who
 * changes format keeps both drafts and can change back.
 */
export function condensedFromStore(
  stored: Record<string, StoredSection> | undefined,
): Record<CondensedSectionType, CondensedSection> {
  const empty = (): Record<CondensedSectionType, CondensedSection> => ({
    verse: { type: 'verse', content: '', authorOrigin: AUTHOR_ORIGINS.USER },
    reflection: { type: 'reflection', content: '', authorOrigin: AUTHOR_ORIGINS.USER },
  });
  const sections = empty();
  if (!stored) {
    return sections;
  }
  for (const type of Object.values(CONDENSED_SECTION_TYPES)) {
    const item = stored[type];
    if (item) {
      sections[type] = { type, content: item.content, authorOrigin: item.authorOrigin };
    }
  }
  return sections;
}

export function sectionsFromStore(
  stored: Record<string, StoredSection> | undefined,
): Record<ChatSectionType, ChatSection> {
  const sections = emptyChatSections();
  if (!stored) {
    return sections;
  }
  for (const type of Object.values(CHAT_SECTION_TYPES)) {
    const item = stored[type];
    if (item) {
      sections[type] = {
        type,
        content: item.content,
        authorOrigin: item.authorOrigin,
      };
    }
  }
  return sections;
}
