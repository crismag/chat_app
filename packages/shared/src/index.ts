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
export * from './distribution.ts';
export * from './preferences.ts';

/*
 * Guest and registered, and the words for them.
 *
 * Three words are in play and only two of them are ours to define. A VISITOR
 * has no account and nothing is stored for them. A GUEST chose to carry on
 * without signing in and is a real user with a real id — everything they write
 * belongs to them. A REGISTERED user is a guest who added an email and a
 * password, or somebody who signed in from the start.
 *
 * The internal value is `ANONYMOUS`, because that is what the account is:
 * an account with no identity attached to it. The word shown to a person is
 * "Guest", because "anonymous account" describes a threat model rather than a
 * choice they made. Both live here so the translation happens once.
 */
export const ACCOUNT_TYPES = {
  ANONYMOUS: 'ANONYMOUS',
  REGISTERED: 'REGISTERED',
} as const;

export type AccountType = (typeof ACCOUNT_TYPES)[keyof typeof ACCOUNT_TYPES];

/** A stored value read back, defaulting to the safer of the two. */
export function readAccountType(value: unknown): AccountType {
  return value === ACCOUNT_TYPES.REGISTERED ? ACCOUNT_TYPES.REGISTERED : ACCOUNT_TYPES.ANONYMOUS;
}

/**
 * Who the application is acting for.
 *
 * One shape for both kinds, because everything that owns something owns it the
 * same way. A guest has no email and a registered user usually has no guest
 * name — but one who used to be a guest keeps theirs, which is the whole point
 * of upgrading a row instead of replacing it.
 */
export type Account = {
  id: string;
  accountType: AccountType;
  email: string | null;
  guestName: string | null;
  emailVerified: boolean;
  /**
   * The public identity, when there is one.
   *
   * Carried with the account so that every place showing a person shows the
   * same person. Without it the header derived a face from an email address
   * while the profile page derived one from a name, and one person appeared
   * to be two while moving through a single application.
   *
   * Null for somebody who has never opened a profile — a guest, most often.
   * Public fields only; nothing private travels in a payload that goes
   * everywhere.
   */
  displayName?: string | null;
  handle?: string | null;
  /** Their picture, when they have set one. Null means "draw the generated face". */
  avatarUrl?: string | null;
};

export function isGuest(account: Pick<Account, 'accountType'> | null): boolean {
  return account?.accountType === ACCOUNT_TYPES.ANONYMOUS;
}

/**
 * What to call somebody on screen.
 *
 * A guest is "Guest · QuietCedar-14" — the word first, because the state
 * matters more than the name, and the name second, because a person needs
 * something to recognise as theirs.
 */
export function accountLabel(
  account: Pick<Account, 'accountType' | 'email' | 'guestName' | 'displayName'>,
): string {
  /*
   * The name they chose, before the address they signed up with. An email is
   * an identifier; a display name is what somebody is called, and it is what
   * the profile page and every shared reflection already show them as.
   */
  if (account.displayName?.trim()) return account.displayName.trim();
  if (account.accountType === ACCOUNT_TYPES.REGISTERED) return account.email ?? 'Your account';
  return account.guestName ? `Guest · ${account.guestName}` : 'Guest';
}

/**
 * How the account came to exist, kept because it cannot be reconstructed.
 *
 * Deliberately coarse. `deviceClass` is three buckets wide because the only
 * thing worth knowing later is whether guests are made on phones; a finer
 * measurement of somebody's hardware would be a fingerprint, and this
 * application does not build those.
 */
export const CREATION_METHODS = {
  GUEST_OPT_IN: 'GUEST_OPT_IN',
  REGISTRATION: 'REGISTRATION',
} as const;

export type CreationMethod = (typeof CREATION_METHODS)[keyof typeof CREATION_METHODS];

export const CREATION_SOURCES = {
  REFLECTION_CREATE: 'REFLECTION_CREATE',
  REFLECTION_SAVE: 'REFLECTION_SAVE',
  CHAT_START: 'CHAT_START',
  IMAGE_CREATE: 'IMAGE_CREATE',
  PASSAGE_SAVE: 'PASSAGE_SAVE',
  OTHER_PERSISTENT_ACTION: 'OTHER_PERSISTENT_ACTION',
} as const;

export type CreationSource = (typeof CREATION_SOURCES)[keyof typeof CREATION_SOURCES];

export const PLATFORMS = { WEB: 'WEB', ANDROID: 'ANDROID', IOS: 'IOS' } as const;
export type Platform = (typeof PLATFORMS)[keyof typeof PLATFORMS];

export const DEVICE_CLASSES = {
  MOBILE: 'MOBILE',
  TABLET: 'TABLET',
  DESKTOP: 'DESKTOP',
  UNKNOWN: 'UNKNOWN',
} as const;

export type DeviceClass = (typeof DEVICE_CLASSES)[keyof typeof DEVICE_CLASSES];

/** Creation context as it arrives from a client, with nothing trusted. */
export type AccountCreationContext = {
  creationMethod: CreationMethod;
  creationSource: CreationSource;
  platform: Platform;
  deviceClass: DeviceClass;
};

function oneOf<T extends string>(values: Record<string, T>, value: unknown, fallback: T): T {
  return Object.values(values).includes(value as T) ? (value as T) : fallback;
}

/**
 * A client says where it was and this decides whether to believe the shape.
 *
 * Not the truth of it — a client can lie about being a phone and no harm comes
 * of it — but the vocabulary, so an open string cannot be written into a
 * column that reporting later groups by.
 */
export function readCreationContext(value: unknown): AccountCreationContext {
  const source = (value ?? {}) as Record<string, unknown>;
  return {
    creationMethod: oneOf(CREATION_METHODS, source['creationMethod'], CREATION_METHODS.GUEST_OPT_IN),
    creationSource: oneOf(
      CREATION_SOURCES,
      source['creationSource'],
      CREATION_SOURCES.OTHER_PERSISTENT_ACTION,
    ),
    platform: oneOf(PLATFORMS, source['platform'], PLATFORMS.WEB),
    deviceClass: oneOf(DEVICE_CLASSES, source['deviceClass'], DEVICE_CLASSES.UNKNOWN),
  };
}
