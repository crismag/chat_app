export const PUBLICATION_STATES = {
  PRIVATE: 'private',
  PUBLISHED: 'published',
} as const;

export type PublicationState =
  (typeof PUBLICATION_STATES)[keyof typeof PUBLICATION_STATES];

export const CHAT_SECTION_TYPES = {
  CONTENT: 'content',
  HEART: 'heart',
  APPLICATION: 'application',
  TESTIMONY: 'testimony',
} as const;

export type ChatSectionType =
  (typeof CHAT_SECTION_TYPES)[keyof typeof CHAT_SECTION_TYPES];

/*
 * Condensed C.H.A.T. carries its own two fields, and they are stored beside the
 * four rather than on top of them. That is what makes conversion safe in both
 * directions: changing format proposes and preserves, and never overwrites the
 * draft the author already has in the other form.
 */
export const CONDENSED_SECTION_TYPES = {
  VERSE: 'verse',
  REFLECTION: 'reflection',
} as const;

export type CondensedSectionType =
  (typeof CONDENSED_SECTION_TYPES)[keyof typeof CONDENSED_SECTION_TYPES];

export type CondensedSection = {
  type: CondensedSectionType;
  content: string;
  authorOrigin: AuthorOrigin;
};

export const AUTHOR_ORIGINS = {
  USER: 'user',
  AI_ASSISTED: 'ai_assisted',
  AI_GENERATED: 'ai_generated',
} as const;

export type AuthorOrigin = (typeof AUTHOR_ORIGINS)[keyof typeof AUTHOR_ORIGINS];

export const AI_ACTIONS = {
  EXPLAIN: 'explain',
  GRAMMAR: 'grammar',
  POLISH: 'polish',
  SHORTEN: 'shorten',
  SUMMARIZE: 'summarize',
  EXTRACT_CHAT: 'extract_chat',
  /*
   * A title is a label, not a confession.
   *
   * The format rules forbid the model inventing Heart, Application or
   * Testimony because those carry the author's own conviction, and writing
   * them would be putting words in someone's mouth. A title makes no such
   * claim — it is the handle a reflection is filed under — so suggesting one
   * is legitimate where suggesting a testimony is not. It stays a suggestion.
   */
  SUGGEST_TITLE: 'suggest_title',
} as const;

export type AiAction = (typeof AI_ACTIONS)[keyof typeof AI_ACTIONS];

export const CREATE_LAYOUTS = {
  QUOTE_FOCUS: 'quote-focus',
  VERSE_REFLECTION: 'verse-reflection',
  CHAT_STACKED: 'chat-stacked',
  CHAT_TWO_COLUMN: 'chat-two-column',
} as const;

export type CreateLayout =
  (typeof CREATE_LAYOUTS)[keyof typeof CREATE_LAYOUTS];

export const CREATE_STYLES = {
  CREAM_BOTANICAL: 'cream-botanical',
  MODERN_MINIMAL: 'modern-minimal',
  DARK_WORSHIP: 'dark-worship',
  JOURNAL_PAPER: 'journal-paper',
} as const;

export type CreateStyle = (typeof CREATE_STYLES)[keyof typeof CREATE_STYLES];

export type HealthResponse = {
  status: 'ok';
  service: 'chat-api';
  timestamp: string;
};

export type ChatSection = {
  type: ChatSectionType;
  content: string;
  authorOrigin: AuthorOrigin;
};

export type ConversationSummary = {
  id: string;
  title: string;
  scriptureReference: string | null;
  publicationState: PublicationState;
  updatedAt: string;
};

export function isCommunityVisible(state: PublicationState): boolean {
  return state === PUBLICATION_STATES.PUBLISHED;
}

export function emptyChatSections(): Record<ChatSectionType, ChatSection> {
  return {
    content: {
      type: 'content',
      content: '',
      authorOrigin: AUTHOR_ORIGINS.USER,
    },
    heart: {
      type: 'heart',
      content: '',
      authorOrigin: AUTHOR_ORIGINS.USER,
    },
    application: {
      type: 'application',
      content: '',
      authorOrigin: AUTHOR_ORIGINS.USER,
    },
    testimony: {
      type: 'testimony',
      content: '',
      authorOrigin: AUTHOR_ORIGINS.USER,
    },
  };
}

export * from './formats.ts';
export * from './ai.ts';
export * from './bible.ts';
