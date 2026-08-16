import type { AiGuidanceSection } from '@chat/shared'
import { SparkIcon } from '../shared/ui/icons.tsx'
import { Sheet } from './ChatSheets.tsx'
import type { AssistBusy, FieldGuidance, FieldImprovement } from './types.ts'
import styles from './ChatPage.module.css'

/**
 * Assistance for one section, beside the section.
 *
 * Not a chatbot panel. The C.H.A.T. is the page and the conversation is already
 * the helper beside it; a second assistant competing for the middle would undo
 * the rearrangement this page was just rebuilt for. So these are two small
 * controls in the row of controls the field already has, and anything they
 * produce opens underneath the words it is about — attached to the section it
 * concerns, closed when it is done with.
 *
 * Two rules hold everywhere below:
 *
 *   1. Nothing here writes into the field. Questions are questions; a suggested
 *      wording sits beside the author's words with the original still shown,
 *      and it moves only when they press Use this.
 *   2. Everything is labelled. A reader who cannot see the dashed border still
 *      hears "AI suggestion" from the badge and the group's accessible name.
 */

export function FieldAssist({
  field,
  name,
  available,
  unavailableReason,
  hasText,
  busy,
  guidance,
  improvement,
  clarification,
  error,
  undoable,
  onAsk,
  onImprove,
  onAccept,
  onDiscard,
  onDismissGuidance,
  onUndo,
}: {
  field: AiGuidanceSection
  name: string
  available: boolean
  unavailableReason: string | null
  hasText: boolean
  busy: AssistBusy
  guidance: FieldGuidance | null
  improvement: FieldImprovement | null
  clarification: string | null
  error: string | null
  undoable: boolean
  onAsk: () => void
  onImprove: () => void
  onAccept: () => void
  onDiscard: () => void
  onDismissGuidance: () => void
  onUndo: () => void
}) {
  const reasonId = `assist-reason-${field}`
  const guidanceId = `assist-questions-${field}`
  const improveId = `assist-improve-${field}`

  /*
   * Why a control cannot be pressed, in words. `null` means it can. A greyed
   * control with nothing attached to it is the failure this page already fixed
   * once for Suggest title, and it is not being reintroduced here.
   */
  const askReason = !available
    ? unavailableReason
    : busy !== null
      ? 'Waiting for the last request to come back.'
      : null

  const improveReason = !available
    ? unavailableReason
    : !hasText
      ? `Write something in ${name} first — there is nothing to reword yet.`
      : busy !== null
        ? 'Waiting for the last request to come back.'
        : null

  return (
    <>
      <span className={styles.assistActions}>
        <button
          type="button"
          className={styles.assistButton}
          disabled={askReason !== null}
          title={askReason ?? undefined}
          aria-describedby={askReason ? reasonId : undefined}
          aria-controls={guidance ? guidanceId : undefined}
          onClick={onAsk}
        >
          <SparkIcon className={styles.tinyIcon} />
          {busy === 'questions' ? 'Thinking…' : 'Ask me questions'}
        </button>

        <button
          type="button"
          className={styles.assistButton}
          disabled={improveReason !== null}
          title={improveReason ?? undefined}
          aria-describedby={improveReason ? reasonId : undefined}
          aria-controls={improvement ? improveId : undefined}
          onClick={onImprove}
        >
          <SparkIcon className={styles.tinyIcon} />
          {busy === 'improve' ? 'Reading…' : 'Improve wording'}
        </button>

        {/*
          Undo survives acceptance. Taking a suggestion is a decision someone is
          allowed to change their mind about a second later, and "the original
          must remain recoverable" is not satisfied by a suggestion that has
          already overwritten the only copy of it.
        */}
        {undoable ? (
          <button type="button" className={styles.assistButton} onClick={onUndo}>
            Undo — put my words back
          </button>
        ) : null}
      </span>

      {askReason || improveReason ? (
        <span className="sr-only" id={reasonId}>
          {askReason ?? improveReason}
        </span>
      ) : null}

      {/* Loading is stated, not merely implied by a label changing. */}
      {busy ? (
        <p className={styles.assistStatus} role="status">
          {busy === 'questions'
            ? `Asking for questions about ${name}…`
            : `Reading your ${name}…`}
        </p>
      ) : null}

      {error ? (
        <p className={styles.assistError} role="alert">
          {error}
        </p>
      ) : null}

      {clarification ? (
        <div className={styles.assistPanel} role="group" aria-label={`AI question about ${name}`}>
          <p className={styles.assistPanelHead}>
            <span className="badge badge-ai-generated">AI suggestion</span>
            Nothing has changed. This needs one thing cleared up first.
          </p>
          <p className={styles.assistQuestion}>{clarification}</p>
          <div className={styles.assistPanelActions}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onDiscard}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {guidance ? (
        <div
          className={styles.assistPanel}
          id={guidanceId}
          role="group"
          aria-label={`AI questions to think about for ${name}`}
        >
          <p className={styles.assistPanelHead}>
            <span className="badge badge-ai-generated">AI suggestion</span>
            Questions to think about. Nothing has been written for you.
          </p>

          {guidance.questions.length === 0 ? (
            <p className={styles.assistQuestion}>
              No questions came back for this one. Keep writing in your own words.
            </p>
          ) : (
            <ul className={styles.assistQuestions}>
              {guidance.questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          )}

          {/*
            The notice comes from the server with the questions rather than
            being remembered here, so a set of suggestions can never arrive
            without the sentence that keeps them suggestions.
          */}
          <p className={styles.assistNotice}>{guidance.notice}</p>

          <div className={styles.assistPanelActions}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onDismissGuidance}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {improvement ? (
        <div
          className={styles.assistPanel}
          id={improveId}
          role="group"
          aria-label={`Suggested wording for ${name}`}
        >
          <p className={styles.assistPanelHead}>
            <span className="badge badge-ai-assisted">AI assisted</span>
            Suggested wording. Your {name} has not changed.
          </p>

          {/*
            Both versions, side by side and both readable. A preview that shows
            only the result asks someone to accept a change they cannot see, and
            the point of this control is that the original stays recoverable.
          */}
          <div className={styles.assistCompare}>
            <div>
              <h4 className={styles.assistCompareLabel}>Your words</h4>
              <p className={styles.assistCompareText}>{improvement.original}</p>
            </div>
            <div>
              <h4 className={styles.assistCompareLabel}>Suggested</h4>
              <p className={styles.assistCompareText} data-suggested="true">
                {improvement.suggested}
              </p>
            </div>
          </div>

          {improvement.summaryOfChanges.length > 0 ? (
            <ul className={styles.assistChanges}>
              {improvement.summaryOfChanges.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          ) : null}

          <div className={styles.assistPanelActions}>
            <button type="button" className="btn btn-primary btn-sm" onClick={onAccept}>
              Use this in {name}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onDiscard}>
              Discard — keep my words
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}

/**
 * Said once, before the first request leaves the browser.
 *
 * Not a checkbox in a settings page nobody opens. The person is about to send
 * a passage and something they wrote to a third party, and the moment to say so
 * is the moment before it happens — with a way to decline that costs them
 * nothing, because the manual workflow was never dependent on any of this.
 */
export function AiDisclosureSheet({
  disclosure,
  onAccept,
  onClose,
}: {
  disclosure: string
  onAccept: () => void
  onClose: () => void
}) {
  return (
    /* The page's own sheet: Escape closes it, focus is handled, nothing new. */
    <Sheet
      title="Before you use AI assistance"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={onAccept}>
            I understand — continue
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Not now
          </button>
        </>
      }
    >
      <p className={styles.sheetLead}>{disclosure}</p>
      <p className={styles.sheetLead}>
        Assistance only ever suggests. It will not write your Heart or your Testimony, and
        nothing it offers becomes part of your reflection until you accept it. You can keep
        writing without it at any time.
      </p>
    </Sheet>
  )
}
