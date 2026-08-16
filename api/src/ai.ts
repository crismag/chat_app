import {
  AI_ACTIONS,
  AUTHOR_ORIGINS,
  CHAT_SECTION_TYPES,
  CONDENSED_SECTION_TYPES,
  FORMAT_LIMITS,
  emptyChatSections,
  type AiAction,
  type ChatFormat,
  type ChatSection,
  type ChatSectionType,
  type CondensedSection,
  type CondensedSectionType,
} from '@chat/shared';
import type { StoredMessage, StoredSection } from './store.ts';

/* ------------------------------------------------------------- capability */

/**
 * Whether assistance is available at all, and what is answering.
 *
 * The interface has to be able to say *why* a control is unavailable rather
 * than leaving it live and inert — that was the exact failure the last pass
 * fixed. So availability is a fact the API states, not something the client
 * assumes, and `CHAT_AI_DISABLED=1` makes the disabled path real enough to
 * test rather than hypothetical.
 */
export const AI_PROVIDERS = {
  /** Deterministic string work in this file. No model is involved. */
  HEURISTIC: 'heuristic',
  MODEL: 'model',
} as const;

export type AiProvider = (typeof AI_PROVIDERS)[keyof typeof AI_PROVIDERS];

export function aiStatus(): { enabled: boolean; provider: AiProvider; reason?: string } {
  if (process.env['CHAT_AI_DISABLED'] === '1') {
    return {
      enabled: false,
      provider: AI_PROVIDERS.HEURISTIC,
      reason: 'Assistance is switched off for this server.',
    };
  }
  return { enabled: true, provider: AI_PROVIDERS.HEURISTIC };
}

/* ------------------------------------------------------------------ title */

/**
 * Cut to a length without cutting a word in half.
 *
 * Never returns more than `limit` characters. The limit is the point: a
 * suggestion that arrives already over its own format's maximum is a bug, not
 * a suggestion, because the field it lands in would immediately report invalid.
 */
function trimToWords(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim().replace(/[.,;:!?—-]+$/, '');
  if (clean.length <= limit) return clean;

  const cut = clean.slice(0, limit);

  /*
   * A clause boundary beats a word boundary. "Romans 8:28 met me this week"
   * is a title; "Romans 8:28 met me this week and I could not" is a sentence
   * someone interrupted.
   */
  const lastClause = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('; '), cut.lastIndexOf(' — '));
  if (lastClause > Math.floor(limit * 0.5)) {
    return dropDanglingWords(cut.slice(0, lastClause));
  }

  const lastSpace = cut.lastIndexOf(' ');
  /* A single word longer than the limit still has to fit, so it is cut hard. */
  const trimmed = lastSpace > Math.floor(limit * 0.4) ? cut.slice(0, lastSpace) : cut;
  return dropDanglingWords(trimmed);
}

/*
 * Words no title should end on. Cutting mid-sentence tends to leave a
 * conjunction or an article hanging, which reads as a truncation rather than
 * as a name — and a title that looks broken is worse than a shorter one.
 */
const DANGLING = new Set([
  'a', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'but',
  'by', 'could', 'for', 'from', 'had', 'has', 'have', 'how', 'i', 'if', 'in',
  'into', 'is', 'it', 'like', 'my', 'no', 'not', 'of', 'on', 'or', 'over',
  'should', 'so', 'some', 'than', 'that', 'the', 'their', 'then', 'this', 'to',
  'was', 'were', 'what', 'when', 'which', 'who', 'why', 'will', 'with', 'would',
  'you', 'your',
]);

function dropDanglingWords(text: string): string {
  const words = text.trim().split(' ');
  while (words.length > 2 && DANGLING.has((words.at(-1) ?? '').toLowerCase().replace(/\W/g, ''))) {
    words.pop();
  }
  return words.join(' ').replace(/[.,;:!?—-]+$/, '').trim();
}

/** The opening clause of a piece of writing — its first sentence, roughly. */
function openingClause(text: string): string {
  return (text.trim().split(/(?<=[.!?])\s|\n/)[0] ?? '').trim();
}

export interface TitleSource {
  scriptureReference: string | null;
  messages: StoredMessage[];
  sections: Record<string, StoredSection> | undefined;
}

/**
 * Suggest titles for a reflection.
 *
 * ── This is the seam. ──
 *
 * The implementation below is a **heuristic, not a model**: it rearranges what
 * the author already wrote — their Scripture reference, the opening clause of
 * their first message, and their own sections — and invents no wording of its
 * own. When a model is wired up, this function is what changes; the route, the
 * client and the interface all stay as they are, because they only ever see a
 * list of candidate strings.
 *
 * Two properties must hold whatever is behind it, and are tested:
 *
 *   1. Every candidate fits the format's title limit. Never emit something the
 *      field would reject the moment it arrived.
 *   2. Suggesting is not applying. Nothing here writes anything.
 */
export function suggestTitles(format: ChatFormat, source: TitleSource): string[] {
  const limit = FORMAT_LIMITS[format].fields['title'];
  const recommended = limit?.recommended ?? 60;
  const hard = limit?.hard ?? 100;

  const reference = (source.scriptureReference ?? '').trim();
  const userText = source.messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter(Boolean);

  const sections = source.sections ?? {};
  const sectionText = (type: string) => (sections[type]?.content ?? '').trim();

  /*
   * Ordered by how much of the author's own intent each one carries: what they
   * said first, what moved them, what they resolved, and the passage itself.
   */
  const raw = [
    userText[0] ? openingClause(userText[0]) : '',
    sectionText('heart') ? openingClause(sectionText('heart')) : '',
    sectionText('reflection') ? openingClause(sectionText('reflection')) : '',
    sectionText('testimony') ? openingClause(sectionText('testimony')) : '',
    reference,
  ];

  const candidates: string[] = [];
  for (const value of raw) {
    const trimmed = trimToWords(value, recommended);
    if (!trimmed) continue;
    /* A title identical to the reference is already the default name. */
    if (candidates.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) continue;
    candidates.push(trimmed);
  }

  /*
   * A reference-led variant, which is how most people name a reflection out
   * loud — "Romans 8:28 — the week I could not see it".
   *
   * The clause has the reference stripped off the front first. People tend to
   * open by naming the passage they are reading, and "Romans 8:28 — Romans
   * 8:28 met me this week" is what happens if you do not check.
   */
  if (reference && candidates[0]) {
    const opensWithReference = candidates[0]
      .toLowerCase()
      .startsWith(reference.toLowerCase());
    /*
     * If they already opened by naming the passage, the first candidate leads
     * with it and a second reference-led variant adds nothing but a stutter —
     * and stripping the reference off would leave a verb with no subject.
     */
    if (!opensWithReference) {
      const led = trimToWords(`${reference} — ${candidates[0]}`, recommended);
      if (led && !candidates.includes(led)) candidates.splice(1, 0, led);
    }
  }

  return candidates.slice(0, 3).map((candidate) => trimToWords(candidate, hard));
}

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
    sections[CHAT_SECTION_TYPES.CONTENT] = {
      type: CHAT_SECTION_TYPES.CONTENT,
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
