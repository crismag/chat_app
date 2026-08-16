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
