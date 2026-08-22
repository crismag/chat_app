/*
 * The four sections, by name.
 *
 * Their own module rather than a corner of the barrel: anything that needs the
 * names -- including code the barrel re-exports, like `preview.ts` -- can
 * import them without waiting for the barrel's own body to run. When these
 * lived in index.ts, a module re-exported from index evaluated first and found
 * them undefined.
 */

export const CHAT_SECTION_TYPES = {
  CONTENT: 'content',
  HEART: 'heart',
  APPLICATION: 'application',
  TESTIMONY: 'testimony',
} as const;

export type ChatSectionType =
  (typeof CHAT_SECTION_TYPES)[keyof typeof CHAT_SECTION_TYPES];
