/*
 * Whether a reflection has been shared, and nothing else.
 *
 * This was `PUBLICATION_STATES`, with the values `private` and `published`,
 * which read as a publishing lifecycle a reflection moved along. It never was
 * one: there are two values, they are visibility, and a finished reflection
 * may stay private forever. Completing a C.H.A.T. does not propose sharing it
 * and never sets this — only an explicit act of sharing does.
 *
 * Sharing to a device or another app does not change it either. Handing
 * something to WhatsApp is an export; it says nothing about who can see the
 * reflection inside C.H.A.T.
 */
export const VISIBILITY = {
  PRIVATE: 'private',
  SHARED: 'shared',
} as const;

export type Visibility = (typeof VISIBILITY)[keyof typeof VISIBILITY];

/**
 * Read a stored value, including rows written when the value was `published`.
 *
 * Kept deliberately rather than renamed in place: existing rows say
 * `published`, and a reader that did not understand them would quietly turn
 * every shared reflection private.
 */
export function readVisibility(value: unknown): Visibility {
  return value === VISIBILITY.SHARED || value === 'published'
    ? VISIBILITY.SHARED
    : VISIBILITY.PRIVATE;
}

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
  WARM_PHOTOGRAPHIC: 'warm-photographic',
  JOURNAL_PAPER: 'journal-paper',
} as const;

export type CreateStyle = (typeof CREATE_STYLES)[keyof typeof CREATE_STYLES];

export const CREATE_FORMATS = {
  SQUARE: 'square',
  PORTRAIT: 'portrait',
} as const;

export type CreateFormat = (typeof CREATE_FORMATS)[keyof typeof CREATE_FORMATS];

export const CREATE_FORMAT_SIZE: Record<CreateFormat, { width: number; height: number }> = {
  [CREATE_FORMATS.SQUARE]: { width: 1080, height: 1080 },
  [CREATE_FORMATS.PORTRAIT]: { width: 1080, height: 1350 },
};

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
  visibility: Visibility;
  updatedAt: string;
  tags: { tag: string; label: string }[];
};

export function isCommunityVisible(state: Visibility): boolean {
  return state === VISIBILITY.SHARED;
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
export * from './community.ts';
