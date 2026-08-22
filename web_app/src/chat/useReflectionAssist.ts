import { useState } from 'react'
import {
  AI_OUTCOMES,
  AI_UNAVAILABLE_MESSAGE,
  AUTHOR_ORIGINS,
  type AiGuidanceSection,
} from '@chat/shared'

import { api } from '../shared/api/client.ts'
import { assistMessage } from './ai-message.ts'

/** Where the one-time disclosure records that it has been accepted. */
export const DISCLOSURE_KEY = 'chat.ai.disclosure'

/** The four sections assistance may be asked about. */
const SECTION_FIELDS: AiGuidanceSection[] = ['content', 'heart', 'application', 'testimony']
import type { AssistBusy, AssistState, FieldGuidance, FieldImprovement, FieldType } from './types.ts'

/*
 * Assistance, and everything it is allowed to touch.
 *
 * ── Why this is a hook and not part of the page ─────────────────────────────
 *
 * The page was carrying seven pieces of state for this on its own, beside
 * everything else it owns, and the rule that matters most about them was
 * spread across those seven declarations rather than stated once.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 *
 * **None of this state is the reflection.** Questions, a suggested wording and
 * the last thing undone all live here and are thrown away when the page moves
 * on. The only route from any of them into the C.H.A.T. is `putIntoField` --
 * the same section write the author makes by hand -- and it runs only when
 * they press a button that says so. That is why this hook is handed a writer
 * rather than being given the store: it cannot write to a reflection except
 * through the one path that records where the words came from.
 */

export type ReflectionAssist = {
  /** The controller the editor renders from. */
  assist: AssistState
  /** The action waiting behind the disclosure, when the disclosure is showing. */
  pendingAssist: { field: AiGuidanceSection; kind: Exclude<AssistBusy, null> } | null
  clearPendingAssist: () => void
  runPendingAssist: () => void
  /**
   * Record what Undo should put back.
   *
   * Replacing a section from the helper is the other way words arrive over
   * something already written, and it deserves the same one-press escape as an
   * accepted suggestion.
   */
  rememberUndo: (field: FieldType, previous: string) => void
}

export function useReflectionAssist({
  activeId,
  detail,
  capabilities,
  unavailableReason,
  valueOf,
  putIntoField,
  onFieldChosen,
}: {
  activeId: string | null
  detail: { scriptureReference: string | null } | null
  capabilities: { improveWriting?: boolean } | null
  unavailableReason: string | null
  /** What is currently written in a field, edits included. */
  valueOf: (field: FieldType) => string
  /** The one way words reach a reflection, marked with where they came from. */
  putIntoField: (field: FieldType, content: string, origin: string) => Promise<void>
  /** Choosing an assistance action also says which section is being worked on. */
  onFieldChosen: (field: FieldType) => void
}): ReflectionAssist {
  const [assistBusy, setAssistBusy] = useState<{ field: FieldType; kind: AssistBusy } | null>(null)
  const [guidance, setGuidance] = useState<Partial<Record<FieldType, FieldGuidance>>>({})
  const [improvement, setImprovement] = useState<
    ({ field: FieldType } & FieldImprovement) | null
  >(null)
  const [clarification, setClarification] = useState<{ field: FieldType; question: string } | null>(
    null,
  )
  const [assistError, setAssistError] = useState<{ field: FieldType; message: string } | null>(null)
  /* What Undo puts back. Set only when a suggestion was actually accepted. */
  const [undoable, setUndoable] = useState<{ field: FieldType; previous: string } | null>(null)
  /* The action waiting behind the disclosure, if the disclosure is showing. */
  const [pendingAssist, setPendingAssist] = useState<
    { field: AiGuidanceSection; kind: Exclude<AssistBusy, null> } | null
  >(null)

  /*
   * The bounded conversation.
   *
   * `replying` is separate from `sending` on purpose. Sending is over in
   * milliseconds and must never be held up by a provider; waiting for a reply
   * is a different, slower thing, and the composer stays usable throughout it.
   */


  async function askForQuestions(field: AiGuidanceSection) {
    if (!activeId || !detail) return
    setAssistError(null)
    setAssistBusy({ field, kind: 'questions' })
    try {
      /*
       * Only what this action needs travels: the passage, the sections being
       * asked about, and what has already been written in them. No profile, no
       * other reflections, no identifiers, no message history.
       */
      const written: Partial<Record<AiGuidanceSection, string>> = {}
      for (const meta of SECTION_FIELDS) {
        const value = valueOf(meta).trim()
        if (value) written[meta] = value
      }

      const result = await api<{
        sections: Partial<Record<AiGuidanceSection, { questions: string[] }>>
        notice: string
      }>('/ai/reflection-guidance', {
        method: 'POST',
        body: JSON.stringify({
          passageReference: detail.scriptureReference ?? '',
          sections: [field],
          written,
        }),
      })

      setGuidance((current) => ({
        ...current,
        [field]: {
          questions: result.sections[field]?.questions ?? [],
          notice: result.notice,
        },
      }))
    } catch (caught: unknown) {
      setAssistError({ field, message: assistMessage(caught) })
    } finally {
      setAssistBusy(null)
    }
  }

  async function askForImprovement(field: AiGuidanceSection) {
    if (!activeId || !detail) return
    const text = valueOf(field).trim()
    if (!text) return
    setAssistError(null)
    setClarification(null)
    setAssistBusy({ field, kind: 'improve' })
    try {
      const result = await api<{
        outcome: string
        original: string
        suggested?: string
        summaryOfChanges?: string[]
        question?: string
      }>('/ai/improve-writing', {
        method: 'POST',
        body: JSON.stringify({
          section: field,
          text,
          passageReference: detail.scriptureReference ?? '',
        }),
      })

      /*
       * The honest answer when meaning was uncertain. It is shown as a question
       * rather than as a failure, because the request worked — the model
       * declined to guess, which is exactly what it was told to do.
       */
      if (result.outcome === AI_OUTCOMES.NEEDS_USER_CLARIFICATION) {
        setClarification({ field, question: result.question ?? '' })
        return
      }

      setImprovement({
        field,
        original: result.original,
        suggested: result.suggested ?? '',
        summaryOfChanges: result.summaryOfChanges ?? [],
      })
    } catch (caught: unknown) {
      setAssistError({ field, message: assistMessage(caught) })
    } finally {
      setAssistBusy(null)
    }
  }

  /**
   * The gate in front of the first real request.
   *
   * The disclosure is shown once, before anything leaves the browser, and the
   * action that prompted it is held rather than dropped — declining costs the
   * person nothing and running it afterwards costs them no second click.
   */
  function requestAssist(field: AiGuidanceSection, kind: Exclude<AssistBusy, null>) {
    /* One request at a time, page-wide. Two in flight would race to set state. */
    if (assistBusy) return
    if (window.localStorage.getItem(DISCLOSURE_KEY) !== 'accepted') {
      setPendingAssist({ field, kind })
      return
    }
    void (kind === 'questions' ? askForQuestions(field) : askForImprovement(field))
  }

  /**
   * Accept a suggested wording — an ordinary section write, marked as assisted.
   *
   * The author's original is kept in `undoable` first. "The original must remain
   * recoverable" is not satisfied by a preview that has already been replaced by
   * the thing it was previewing.
   */
  async function acceptImprovement() {
    if (!improvement) return
    const { field, original, suggested } = improvement
    setImprovement(null)
    setUndoable({ field, previous: original })
    await putIntoField(field, suggested, AUTHOR_ORIGINS.AI_ASSISTED)
  }

  async function undoImprovement() {
    if (!undoable) return
    const { field, previous } = undoable
    setUndoable(null)
    /* Their words come back as theirs. Undo restores authorship, not only text. */
    await putIntoField(field, previous, AUTHOR_ORIGINS.USER)
  }


  const assist: AssistState = {
    available: capabilities?.improveWriting === true && detail !== null,
    unavailableReason: !detail
      ? 'Start a reflection first.'
      : capabilities?.improveWriting
        ? null
        : (unavailableReason ?? AI_UNAVAILABLE_MESSAGE),
    busyField: assistBusy?.field ?? null,
    busyKind: assistBusy?.kind ?? null,
    guidance,
    improvement,
    clarification,
    error: assistError,
    undoable,
    /*
     * Asking about a section also tells the conversation which section it is.
     *
     * The Reflect panel already has a scoped mode; it was only ever reachable
     * through a "Discuss in chat" button on every field. Setting it here is
     * what lets those buttons go: choosing an assistance action *is* saying
     * which section is being worked on, so the helper stops having to be told
     * again in a second control.
     */
    onAsk: (field) => {
      onFieldChosen(field)
      requestAssist(field, 'questions')
    },
    onImprove: (field) => {
      onFieldChosen(field)
      requestAssist(field, 'improve')
    },
    onAccept: () => void acceptImprovement(),
    onDiscard: () => {
      /* Discard leaves the author's words exactly as they were. */
      setImprovement(null)
      setClarification(null)
    },
    onDismissGuidance: (field) =>
      setGuidance((current) => {
        const next = { ...current }
        delete next[field]
        return next
      }),
    onUndo: () => void undoImprovement(),
  }

  return {
    assist,
    pendingAssist,
    clearPendingAssist: () => setPendingAssist(null),
    rememberUndo: (field, previous) => setUndoable({ field, previous }),
    /* Run what the disclosure was holding, now that it has been accepted. */
    runPendingAssist: () => {
      if (!pendingAssist) return
      const waiting = pendingAssist
      setPendingAssist(null)
      void (waiting.kind === 'questions'
        ? askForQuestions(waiting.field)
        : askForImprovement(waiting.field))
    },
  }
}
