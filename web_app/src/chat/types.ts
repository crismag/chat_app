import type {
  ChatFormat,
  ChatSection,
  ChatSectionType,
  CondensedSection,
  CondensedSectionType,
  ConversationSummary,
} from '@chat/shared'

export type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  authorOrigin: string
}

/** Every field of the artifact that can be written, in either format. */
export type FieldType = ChatSectionType | CondensedSectionType

/** The API returns a format on every conversation; the shared summary predates it. */
export type Summary = ConversationSummary & { format?: ChatFormat }

/**
 * A reflection, whole.
 *
 * Both drafts travel together — the four sections and the two Condensed fields
 * — because changing format must never be the moment one of them disappears.
 */
export type ConversationDetail = Summary & {
  messages: Message[]
  sections: Record<ChatSectionType, ChatSection>
  condensed: Record<CondensedSectionType, CondensedSection>
}

/**
 * Whether the author's work is safely written down, said in words.
 *
 * Saving used to be implicit and invisible, which asks someone to trust that
 * something happened. This is what the header reports, and `failed` keeps the
 * text on screen with a way to try again — it never resolves by discarding.
 */
export type SaveState =
  | { status: 'idle' }
  | { status: 'unsaved' }
  | { status: 'saving' }
  | { status: 'saved'; at: number }
  | { status: 'failed'; message: string }

/** An AI result, held for review. Nothing is applied until the author says so. */
export type Proposal = {
  action: string
  original: string
  revised: string
  origin: 'ai_assisted' | 'ai_generated'
  /** The field it was raised from, when it came from a section. */
  field: FieldType | null
}
