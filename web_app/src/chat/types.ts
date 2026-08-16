import type {
  AiGuidanceSection,
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
  /** Generated draft text hanging off this reply. Offered, never applied. */
  draftText?: string | null
  /** Its destination, decided server-side by trusted code. May be null. */
  draftSection?: string | null
}

/** Where a draft would land, and what to do about text already there. */
export type PendingAdd = {
  field: FieldType
  text: string
  existing: string
  /** The caret in that section's editor, when one is known. */
  caret: number | null
}

/** Said after a write, so the destination is seen to have received it. */
export type AddedNotice = { field: FieldType; at: number }

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

/* ------------------------------------------------------- assistance state */

/** Which kind of request is in flight, if any. */
export type AssistBusy = 'questions' | 'improve' | null

export type FieldGuidance = { questions: string[]; notice: string }

export type FieldImprovement = {
  original: string
  suggested: string
  summaryOfChanges: string[]
}

/**
 * All of assistance's state and handlers, passed down as one thing.
 *
 * A bundle rather than fifteen props threaded through two components. It is
 * also the shape that makes the single-flight rule expressible: `busyField` and
 * `busyKind` are one pair for the whole page, so a second request cannot be
 * started from another section while one is still out.
 *
 * None of this is the reflection. It is thrown away when the page moves on, and
 * the only route from any of it into the C.H.A.T. is the ordinary section write
 * the author triggers by pressing a button that says so.
 */
export type AssistState = {
  available: boolean
  unavailableReason: string | null
  busyField: FieldType | null
  busyKind: AssistBusy
  guidance: Partial<Record<FieldType, FieldGuidance>>
  improvement: ({ field: FieldType } & FieldImprovement) | null
  clarification: { field: FieldType; question: string } | null
  error: { field: FieldType; message: string } | null
  undoable: { field: FieldType; previous: string } | null
  onAsk: (field: AiGuidanceSection) => void
  onImprove: (field: AiGuidanceSection) => void
  onAccept: () => void
  onDiscard: () => void
  onDismissGuidance: (field: AiGuidanceSection) => void
  onUndo: () => void
}
