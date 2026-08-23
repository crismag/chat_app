import { AI_GUIDANCE_SECTIONS, type AiGuidanceSection } from '@chat/shared'

/*
 * The four sections, with the question each one answers.
 *
 * The prompts are the whole point of showing a card rather than a textarea: an
 * empty box asks the author to remember the framework, a question asks them
 * something they can answer.
 *
 * Content's prompt is not a question, and that is deliberate. Roughly thirty
 * real C.H.A.T. reflections were transcribed in
 * `docs/examples/REAL_CHAT_SAMPLES.md`, and in every one of them the C section
 * holds the passage itself — the verse text, usually with its reference and
 * translation. Many hold nothing else. Asking "what does the passage mean?"
 * was asking for a commentary nobody writes.
 *
 * Heart's prompt carries the other half of that finding. The authors who DO
 * explain a passage explain it under Heart — the background, who was speaking,
 * what it is doing — always tied to what it meant to them. So Heart asks for
 * both, and Content asks for neither.
 *
 * Application and Testimony ask what the method asks. "How will you respond?"
 * invites agreement rather than a decision, so it now asks for the one thing;
 * and "What do you believe, declare or pray?" pointed at the writer, where the
 * method points at the Lord and His faithfulness. See `chat-method.ts` in
 * `@chat/shared` for the original wording these are the short form of.
 */
export const SECTIONS = [
  {
    type: 'content' as const,
    letter: 'C',
    name: 'Content',
    prompt: 'The passage itself. Add an explanation only if you want to.',
  },
  {
    type: 'heart' as const,
    letter: 'H',
    name: 'Heart',
    prompt: 'What it means to you, and what touched or challenged you.',
  },
  {
    type: 'application' as const,
    letter: 'A',
    name: 'Application',
    prompt: 'How will you respond? One thing you will actually do.',
  },
  {
    type: 'testimony' as const,
    letter: 'T',
    name: 'Testimony',
    prompt: 'What God has done, and His faithfulness in it.',
  },
]

/*
 * The Condensed form — its own two fields, and its own questions.
 *
 * This is not the four-section form with two of them hidden. Condensed
 * C.H.A.T. is a complete, approved format: the interface never calls it
 * partial, simplified or incomplete, and it never shows empty
 * Content/Heart/Application/Testimony fields beside it.
 */
export const CONDENSED_FIELDS = [
  {
    type: 'verse' as const,
    letter: 'V',
    name: 'Verse',
    prompt: 'The words of the passage, as you want them read.',
  },
  {
    type: 'reflection' as const,
    letter: 'R',
    name: 'Reflection',
    prompt: 'What this passage is saying to you.',
  },
]

export type FieldMeta = (typeof SECTIONS)[number] | (typeof CONDENSED_FIELDS)[number]

/**
 * A field's name, by its stored type.
 *
 * For the places that hold a section row without knowing which format it came
 * from — the Create renderer chief among them, which was printing the raw
 * lowercase enum (`content:`, `heart:`) straight onto an exported image. A
 * machine identifier on a card someone shares is a machine identifier in
 * public, and it is the one place a surviving legacy `context` row would have
 * painted the old name onto a picture.
 */
export const FIELD_NAMES: Record<string, string> = Object.fromEntries(
  [...SECTIONS, ...CONDENSED_FIELDS].map((field) => [field.type, field.name]),
)

/**
 * Which of the four sections assistance may be asked about.
 *
 * Condensed's Verse and Reflection are deliberately outside it: Verse is the
 * passage itself rather than the writer's response to it, and Reflection is not
 * one of the four the guidance schema knows. Narrowing here is what stops a
 * request for a section the server would refuse.
 */
export function isGuidanceSection(field: string): field is AiGuidanceSection {
  return (AI_GUIDANCE_SECTIONS as readonly string[]).includes(field)
}

/** Which form a format is written in. */
export function fieldsFor(format: string): readonly FieldMeta[] {
  return format === 'condensed' ? CONDENSED_FIELDS : SECTIONS
}

/*
 * Provenance, in words. The data model records whether wording came from the
 * author, from an assisted edit or from a draft the model wrote; the badge says
 * so on the card, because a colour alone cannot make that claim.
 */
export const ORIGIN_LABELS: Record<string, string> = {
  user: 'Your words',
  ai_assisted: 'AI assisted',
  ai_generated: 'AI drafted',
}

export const ORIGIN_CLASSES: Record<string, string> = {
  user: 'badge-user',
  ai_assisted: 'badge-ai-assisted',
  ai_generated: 'badge-ai-generated',
}

/**
 * Combine incoming text with what is already in a section.
 *
 * Pure and exported so the preview in the sheet and the write itself cannot
 * disagree — a preview computed differently from the thing it previews is
 * worse than no preview at all.
 */
export function mergeInto(
  existing: string,
  incoming: string,
  mode: 'append' | 'replace' | 'insert',
  caret: number,
): string {
  if (mode === 'replace') return incoming
  if (mode === 'insert') {
    const at = Math.max(0, Math.min(caret, existing.length))
    return `${existing.slice(0, at)}${incoming}${existing.slice(at)}`
  }
  return existing.trim() ? `${existing.trimEnd()}\n\n${incoming}` : incoming
}
