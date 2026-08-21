import { CHAT_FORMATS, CHAT_SECTION_TYPES, type ChatFormat } from '@chat/shared'

/*
 * The line of a reflection that a card shows.
 *
 * What this replaces walked the sections in C → H → A → T order and took the
 * first one with anything in it — which is Content, which is very often the
 * passage the author pasted in. So a card printed `JOHN 3:16` as its reference
 * and then, three lines below, "John 3:16 (NIV) — For God so loved…". Three of
 * the card's ten lines said the same thing twice, and none of them said what
 * the person had written about it.
 *
 * A summary card is supposed to answer "what did I say about this", so the
 * order asks the author's own sections first and only falls back to the source
 * text when there is nothing else. Nothing here writes: this is a read-time
 * choice about presentation, and the stored reflection is untouched.
 */

/** Author's own writing first; the passage only when there is nothing else. */
const FULL_ORDER = [
  CHAT_SECTION_TYPES.HEART,
  CHAT_SECTION_TYPES.APPLICATION,
  CHAT_SECTION_TYPES.TESTIMONY,
  CHAT_SECTION_TYPES.CONTENT,
] as const

/** A Short reflection keeps its thoughts in one field, and that is the one. */
const CONDENSED_ORDER = ['reflection', 'verse'] as const

type Sections = Record<string, { content?: string } | undefined>

/**
 * Remove a leading Bible reference the card is already showing.
 *
 * Only when Content is the fallback, and only when the text actually begins
 * the way a pasted passage begins: the reference, optionally a translation in
 * brackets, then a dash or a colon. Anything that does not match that shape is
 * returned untouched — a reflection that happens to open with the word "John"
 * must not lose it.
 */
export function stripReferencePrefix(text: string, reference: string | null | undefined): string {
  const trimmed = text.trim()
  if (!reference) return trimmed

  const escaped = reference.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  /*
   * reference, optional (TRANSLATION), then the separator that a pasted
   * passage uses. The separator is required: without it "John 3:16 is the
   * verse I keep returning to" would lose its first three words.
   */
  const pattern = new RegExp(
    `^${escaped}\\s*(?:\\([A-Za-z0-9 ]{2,20}\\)|[A-Z]{2,10})?\\s*[—–\\-:]\\s*`,
    'i',
  )
  const stripped = trimmed.replace(pattern, '').trim()
  return stripped.length > 0 ? stripped : trimmed
}

/**
 * The preview for one reflection, or an empty string when nothing is written.
 *
 * `reference` is what the card shows in its metadata row, so the prefix strip
 * knows what it is allowed to remove.
 */
export function previewFor(
  sections: Sections | undefined,
  format: ChatFormat | undefined,
  reference: string | null | undefined,
): string {
  const read = (type: string) => (sections?.[type]?.content ?? '').trim()
  const order = format === CHAT_FORMATS.CONDENSED ? CONDENSED_ORDER : FULL_ORDER

  for (const type of order) {
    const content = read(type)
    if (!content) continue
    /*
     * The strip applies to the fields that carry the passage — Content for a
     * Full reflection, Verse for a Short one — because those are the ones a
     * reference gets pasted into.
     */
    const carriesPassage = type === CHAT_SECTION_TYPES.CONTENT || type === 'verse'
    return carriesPassage ? stripReferencePrefix(content, reference) : content
  }
  return ''
}
