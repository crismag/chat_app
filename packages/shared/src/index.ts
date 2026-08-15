export const PUBLICATION_STATES = {
  PRIVATE: 'private',
  PUBLISHED: 'published',
} as const;

export type PublicationState =
  (typeof PUBLICATION_STATES)[keyof typeof PUBLICATION_STATES];

export const CHAT_SECTION_TYPES = {
  CONTEXT: 'context',
  HEART: 'heart',
  APPLICATION: 'application',
  TESTIMONY: 'testimony',
} as const;

export type ChatSectionType =
  (typeof CHAT_SECTION_TYPES)[keyof typeof CHAT_SECTION_TYPES];

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
    context: {
      type: 'context',
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
