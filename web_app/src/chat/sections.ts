/*
 * The four sections, with the question each one answers.
 *
 * The prompts are the whole point of showing a card rather than a textarea: an
 * empty box asks the author to remember the framework, a question asks them
 * something they can answer.
 */
export const SECTIONS = [
  {
    type: 'context' as const,
    letter: 'C',
    name: 'Context',
    prompt: 'What does the passage mean?',
  },
  {
    type: 'heart' as const,
    letter: 'H',
    name: 'Heart',
    prompt: 'What touched or challenged you?',
  },
  {
    type: 'application' as const,
    letter: 'A',
    name: 'Application',
    prompt: 'How will you respond?',
  },
  {
    type: 'testimony' as const,
    letter: 'T',
    name: 'Testimony',
    prompt: 'What do you believe, declare or pray?',
  },
]

/*
 * The Condensed form — its own two fields, and its own questions.
 *
 * This is not the four-section form with two of them hidden. Condensed
 * C.H.A.T. is a complete, approved format: the interface never calls it
 * partial, simplified or incomplete, and it never shows empty
 * Context/Heart/Application/Testimony fields beside it.
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
