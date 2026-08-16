import {
  AI_CHAT_ACTIONS,
  AI_CHAT_ACTION_MESSAGES,
  AI_GUIDANCE_SECTIONS,
  draftActionMessage,
  type AiChatAction,
  type AiGuidanceSection,
} from '@chat/shared'
import type { Message } from './types.ts'

/**
 * The prompt chips, and what pressing one actually invokes.
 *
 * A chip carries a STRUCTURED IDENTIFIER, never prompt text. The client picks
 * one from this fixed list, the server looks up what it means, and the wording
 * of the prompt lives on the server where it can change without a release.
 *
 * The reason that matters most is not localisation or testing, though it helps
 * both. It is that "produce conversation" and "produce a draft" become a
 * decision trusted code makes from the identifier, before the provider is
 * called — rather than something inferred afterwards from whatever came back.
 * `draft_section` is the only action that may yield a draft, and it carries its
 * own destination.
 *
 * `message` is what the thread displays, stored as an ordinary user message so
 * the conversation still reads as a conversation when someone returns to it.
 */
export type Chip = {
  label: string
  /** A structured identifier from a fixed set. Never prompt text. */
  action: AiChatAction
  /** The destination, for draft actions only. */
  section?: AiGuidanceSection
  /** What the thread shows, so the conversation still reads correctly. */
  message: string
}

function draftChip(section: AiGuidanceSection, label: string): Chip {
  return {
    label,
    action: AI_CHAT_ACTIONS.DRAFT_SECTION,
    section,
    message: draftActionMessage(section),
  }
}

const explain: Chip = {
  label: 'Explain simply',
  action: AI_CHAT_ACTIONS.EXPLAIN_SIMPLY,
  message: AI_CHAT_ACTION_MESSAGES[AI_CHAT_ACTIONS.EXPLAIN_SIMPLY],
}

const historical: Chip = {
  label: 'Historical context',
  action: AI_CHAT_ACTIONS.HISTORICAL_CONTEXT,
  message: AI_CHAT_ACTION_MESSAGES[AI_CHAT_ACTIONS.HISTORICAL_CONTEXT],
}

function askChip(label: string): Chip {
  return {
    label,
    action: AI_CHAT_ACTIONS.ASK_REFLECTION_QUESTION,
    message: AI_CHAT_ACTION_MESSAGES[AI_CHAT_ACTIONS.ASK_REFLECTION_QUESTION],
  }
}

/**
 * Before a section is being worked on.
 *
 * Four, and none of them "Polish" or "Shorten" — those act on something that
 * already exists, and offering them as conversation starters is offering to
 * polish nothing.
 */
export const DEFAULT_CHIPS: Chip[] = [
  explain,
  historical,
  askChip('Ask me a question'),
  draftChip('content', 'Draft Content'),
]

/**
 * Once a section is scoped, the chips are about that section's actual job.
 *
 * Three of the four in each set are the same three actions as the default —
 * the shapes the backend already knows — so a new section set is a table entry
 * rather than a new code path.
 */
export const SECTION_CHIPS: Record<AiGuidanceSection, Chip[]> = {
  content: [
    explain,
    historical,
    askChip('Ask a Content question'),
    draftChip('content', 'Draft Content'),
  ],
  heart: [
    askChip('Ask a Heart question'),
    explain,
    draftChip('heart', 'Draft Heart'),
    historical,
  ],
  application: [
    askChip('Ask an Application question'),
    explain,
    draftChip('application', 'Draft Application'),
    historical,
  ],
  testimony: [
    askChip('Ask a faith question'),
    explain,
    draftChip('testimony', 'Draft Testimony'),
    historical,
  ],
}

export function chipsFor(section: AiGuidanceSection | null): Chip[] {
  if (section && (AI_GUIDANCE_SECTIONS as readonly string[]).includes(section)) {
    return SECTION_CHIPS[section]
  }
  return DEFAULT_CHIPS
}

/*
 * Openers and acknowledgements — things nobody wants to file into a reflection.
 *
 * The complaint this answers is that an add control under every message made
 * the control meaningless. So the test is deliberately blunt and errs towards
 * hiding: a false negative costs one extra step through the message's own
 * menu, while a false positive is the clutter that was the original problem.
 */
const PLEASANTRY =
  /^(hi|hey|hello|thanks|thank you|ok|okay|sure|yes|no|yep|nope|got it|right|cool|great|nice|amen|good morning|good evening|good night)\b[\s!.,]*$/i

/**
 * Is this response worth offering to put into a section?
 *
 * Assistant responses only. The author's own words are already theirs and are
 * carried into a section by writing there; putting an action under their own
 * messages made the thread look like a form record, which is the complaint
 * this whole pass exists to answer.
 *
 * Reliable classification of "explanation vs acknowledgement" is not available
 * here, so this is deliberately blunt and errs towards hiding: a false negative
 * costs nothing anyone will notice, a false positive is the clutter that was
 * the original problem.
 */
export function canAddToSection(message: Message): boolean {
  if (message.role !== 'assistant') return false
  /* A draft has its own card and its own direct action. */
  if (message.draftText) return false
  const text = message.content.trim()
  if (text.length < 40) return false
  if (PLEASANTRY.test(text)) return false
  return true
}
