import { useEffect, useRef } from 'react'
import { counterFor, splitAtLimit, type ChatFormat } from '@chat/shared'
import { AssistMenu, AssistResults, type FieldAssistProps } from './FieldAssist.tsx'
import { OriginMark, SaveToggle } from './FieldMarks.tsx'
import {
  ORIGIN_CLASSES,
  ORIGIN_LABELS,
  fieldsFor,
  isGuidanceSection,
  type FieldMeta,
} from './sections.ts'
import type { AssistState, FieldType, Proposal } from './types.ts'
import styles from './ChatPage.module.css'

/**
 * One field of the artifact, written in place.
 *
 * The C.H.A.T. is the thing being made, so it is not previewed here in two
 * clamped lines behind an Edit button — it is shown whole and typed into
 * directly.
 *
 * What is *not* on the face of the card is deliberate clutter, not the
 * framework itself. Status words, "Your words", a Save button, a traffic
 * light, a character count on its own line and three assistance buttons used
 * to sit around every one of four fields — more furniture than writing, four
 * times over, on a page that opens empty.
 *
 * What is left is the section's identity, the words, and one mark that opens
 * everything else. Each remaining thing appears when it has something to say:
 * the count when the length starts to matter, the save mark when there is
 * something unsaved, the origin when the words are not entirely the author's.
 * The letter and the name always stay — four identical boxes cannot teach
 * C.H.A.T., and the question remains the placeholder of an empty field.
 */
function Field({
  meta,
  format,
  value,
  authorOrigin,
  dirty,
  discussing,
  proposal,
  assist,
  flashed,
  onCaret,
  onChange,
  onSave,
  onDiscuss,
  onApplyProposal,
  onDismissProposal,
}: {
  meta: FieldMeta
  format: ChatFormat
  value: string
  authorOrigin: string
  dirty: boolean
  discussing: boolean
  proposal: Proposal | null
  assist: AssistState
  flashed: boolean
  onCaret: (at: number) => void
  onChange: (value: string, overflow: string) => void
  onSave: () => void
  onDiscuss: () => void
  onApplyProposal: () => void
  onDismissProposal: () => void
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null)

  /*
   * The field grows to its content. A reflection that scrolls inside a
   * six-line box is not "shown fully", which is the whole complaint this
   * rearrangement answers.
   */
  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    area.style.height = 'auto'
    area.style.height = `${Math.max(area.scrollHeight, 96)}px`
  }, [value])

  const counter = counterFor(format, meta.type, value)
  const filled = value.trim().length > 0

  /*
   * How loudly the count speaks, which is not the same as whether it is there.
   *
   * A number that is always shouting teaches nobody anything: at 12 of 700 the
   * limit is not information, it is decoration on four sections at once. So it
   * fades in as it starts to matter — silent early, quiet as it approaches,
   * plain near the line, and unmissable past it.
   *
   * "Silent" is opacity, not absence: the element stays in the page, so a
   * screen reader still reaches it and it appears the moment the section has
   * the caret in it. Removing it outright would take the count away from the
   * person who most wants it — the one who is writing right now.
   */
  const share = counter ? counter.length / counter.recommended : 0
  const tone = !counter || counter.length === 0
    ? 'silent'
    : counter.status !== 'recommended'
      ? 'over'
      : share > 0.9
        ? 'near'
        : share > 0.6
          ? 'quiet'
          : 'silent'

  /*
   * Narrowed once, into a const, so the callbacks below keep the narrowing.
   * Non-null exactly when this field is one of the four assistance understands.
   */
  const section = isGuidanceSection(meta.type) ? meta.type : null

  /*
   * The trigger sits in the heading and the results open under the textarea,
   * so they are two components — built from one object, so they cannot end up
   * disagreeing about which section they are for or what it may do.
   */
  const assistProps = (forSection: NonNullable<typeof section>): FieldAssistProps => ({
    field: forSection,
    name: meta.name,
    available: assist.available,
    unavailableReason: assist.unavailableReason,
    hasText: filled,
    busy: assist.busyField === forSection ? assist.busyKind : null,
    guidance: assist.guidance[forSection] ?? null,
    improvement: assist.improvement?.field === forSection ? assist.improvement : null,
    clarification:
      assist.clarification?.field === forSection ? assist.clarification.question : null,
    error: assist.error?.field === forSection ? assist.error.message : null,
    undoable: assist.undoable?.field === forSection,
    onAsk: () => assist.onAsk(forSection),
    onImprove: () => assist.onImprove(forSection),
    onDiscuss: onDiscuss,
    onAccept: assist.onAccept,
    onDiscard: assist.onDiscard,
    onDismissGuidance: () => assist.onDismissGuidance(forSection),
    onUndo: assist.onUndo,
  })

  return (
    <article
      className={`${styles.field} ${styles[meta.type] ?? ''}`}
      data-discussing={discussing ? 'true' : 'false'}
      /*
       * Briefly marked after something lands here, so a write is seen to have
       * arrived somewhere rather than reported to have happened.
       */
      data-flash={flashed ? 'true' : 'false'}
    >
      {/*
        One row where a heading, a status row and an actions row used to be.
        The heading is the section — it stays visible after the placeholder has
        left, because that is when a person most needs to know which box they
        are in — and everything else on this line earns its place by having
        something to report.
      */}
      <div className={styles.fieldHead}>
        <h3 className={styles.fieldHeading}>
          <span className={styles.fieldLetter} aria-hidden="true">
            {meta.letter}
          </span>
          {meta.name}
        </h3>

        <span className={styles.fieldHeadMarks}>
          {/* Only when there is something unsaved to say. Blur saves anyway. */}
          {dirty ? <SaveToggle name={meta.name} dirty onSave={onSave} /> : null}

          {/*
            Whose words these are, when that is a question. "Your words" on
            every field of a reflection somebody wrote themselves is a label
            with no information in it.
          */}
          {filled && authorOrigin !== 'user' ? <OriginMark origin={authorOrigin} /> : null}

          {counter ? (
            <span
              className={styles.counter}
              data-status={counter.status}
              data-tone={tone}
              aria-live="polite"
              title={`${meta.name}: ${counter.length} of ${counter.recommended} characters recommended, ${counter.hard} maximum`}
            >
              {counter.length} / {counter.recommended}
              {counter.length > counter.recommended ? ` · ${counter.hard} max` : ''}
              <span className="sr-only"> characters</span>
            </span>
          ) : null}

          {section ? <AssistMenu {...assistProps(section)} /> : null}
        </span>
      </div>

      <textarea
        ref={areaRef}
        /* Addressable, so "View" can bring the author to it. */
        id={`chat-field-${meta.type}`}
        className={styles.fieldInput}
        value={value}
        /* Where the caret is, so "insert at cursor" can mean what it says. */
        onSelect={(event) => onCaret(event.currentTarget.selectionStart)}
        aria-label={`${meta.name} — ${meta.prompt}`}
        /*
         * The same sentence again as a type hint, because the placeholder
         * leaves the moment there is writing in the box and the section still
         * has to be nameable after that. A keyboard reaches the same wording
         * through the mark below, which opens on focus.
         */
        title={`${meta.name} — ${meta.prompt}`}
        /*
         * The question, where the answer goes. It is the hint the section needs
         * and it leaves of its own accord the moment there is writing to read.
         */
        placeholder={meta.prompt}
        onChange={(event) => {
          /*
           * At the hard maximum the field stops accepting characters and the
           * excess is handed back to the author rather than dropped.
           */
          const split = splitAtLimit(format, meta.type, event.target.value)
          onChange(split.kept, split.overflow)
        }}
        onBlur={onSave}
      />

      {/*
        What assistance came back, under the words it is about. Only the four
        C.H.A.T. sections can be asked about — Condensed's Verse is the passage
        itself and its Reflection is not one of the four the schema knows.
      */}
      {section ? <AssistResults {...assistProps(section)} /> : null}

      {/*
        A result comes back to the field it was raised from, and it arrives as
        a suggestion sitting beside the author's words — never as a silent
        replacement, and never wearing their name.
      */}
      {proposal ? (
        <div className={styles.fieldProposal}>
          <p className={styles.fieldProposalHead}>
            <span className={`badge ${ORIGIN_CLASSES[proposal.origin]}`}>
              {ORIGIN_LABELS[proposal.origin]}
            </span>
            Suggested for {meta.name}. Nothing has changed yet.
          </p>
          <p className={styles.fieldProposalText}>{proposal.revised}</p>
          <div className={styles.fieldProposalActions}>
            <button type="button" className="btn btn-primary btn-sm" onClick={onApplyProposal}>
              Use this in {meta.name}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onDismissProposal}>
              Keep mine
            </button>
          </div>
        </div>
      ) : null}
    </article>
  )
}

export function ChatArtifact({
  format,
  valueOf,
  originOf,
  dirtyFields,
  discussing,
  proposal,
  overflow,
  assist,
  flashed,
  onCaret,
  onChange,
  onSave,
  onDiscuss,
  onApplyProposal,
  onDismissProposal,
}: {
  format: ChatFormat
  valueOf: (field: FieldType) => string
  originOf: (field: FieldType) => string
  dirtyFields: ReadonlySet<FieldType>
  discussing: FieldType | null
  proposal: Proposal | null
  overflow: { field: FieldType; text: string } | null
  assist: AssistState
  flashed: FieldType | null
  onCaret: (field: FieldType, at: number) => void
  onChange: (field: FieldType, value: string, overflow: string) => void
  onSave: (field: FieldType) => void
  onDiscuss: (field: FieldType) => void
  onApplyProposal: () => void
  onDismissProposal: () => void
}) {
  const fields = fieldsFor(format)

  return (
    <div className={styles.fields}>
      {overflow ? (
        <p className={styles.overflowNotice} role="alert">
          {overflow.text.length} characters are past the maximum for this field and were not
          added. Nothing was discarded — they are here to shorten or keep elsewhere:
          <span className={styles.overflowText}>{overflow.text}</span>
        </p>
      ) : null}

      {fields.map((meta) => (
        <Field
          key={meta.type}
          meta={meta}
          format={format}
          value={valueOf(meta.type)}
          authorOrigin={originOf(meta.type)}
          dirty={dirtyFields.has(meta.type)}
          discussing={discussing === meta.type}
          proposal={proposal && proposal.field === meta.type ? proposal : null}
          assist={assist}
          flashed={flashed === meta.type}
          onCaret={(at) => onCaret(meta.type, at)}
          onChange={(value, over) => onChange(meta.type, value, over)}
          onSave={() => onSave(meta.type)}
          onDiscuss={() => onDiscuss(meta.type)}
          onApplyProposal={onApplyProposal}
          onDismissProposal={onDismissProposal}
        />
      ))}
    </div>
  )
}
