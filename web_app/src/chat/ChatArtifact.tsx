import { useEffect, useRef } from 'react'
import { counterFor, splitAtLimit, type ChatFormat } from '@chat/shared'
import { SendIcon } from '../shared/ui/icons.tsx'
import { FieldAssist } from './FieldAssist.tsx'
import { OriginMark, SaveToggle, StatusLight, type FieldStatus } from './FieldMarks.tsx'
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
 * What is *not* on the face of the card is deliberate. The letter, the section
 * name, "Not yet", "Written", "Your words", "Unsaved" and a Save button used to
 * sit around every one of four fields, and four fields' worth of that is more
 * interface than reflection. `docs/examples/REAL_CHAT_SAMPLES.md` transcribes
 * roughly thirty real C.H.A.T.s: the labels vary in case and form, several omit
 * them entirely, and some skip the C heading altogether and simply open with
 * the verse — because the verse *is* the content and the label is redundant to
 * the person writing it. So the section is carried by its colour, by the
 * question in the empty field, and by wording one hover or one keyboard focus
 * away; the state is carried by marks. Nothing has been removed from the
 * accessibility tree, and nothing that was stored has changed.
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
   * Three states for three shapes. "Long" is the amber: written, and past the
   * length this format suggests — which is a thing to know about, not a thing
   * that is wrong.
   */
  const status: FieldStatus = !filled
    ? 'empty'
    : counter && counter.status !== 'recommended'
      ? 'long'
      : 'written'

  /*
   * Narrowed once, into a const, so the callbacks below keep the narrowing.
   * Non-null exactly when this field is one of the four assistance understands.
   */
  const section = isGuidanceSection(meta.type) ? meta.type : null

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
        The heading is kept for anything that navigates by headings; it is the
        printing of it on the card that was the clutter, not the fact of it.
      */}
      <h3 className="sr-only">{meta.name}</h3>

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

      <div className={styles.fieldFoot}>
        {/* Where this section has got to: red hollow, amber half, green solid. */}
        <StatusLight name={meta.name} status={status} />

        {/* Nothing written is nobody's words yet, so nothing is claimed. */}
        {filled ? <OriginMark origin={authorOrigin} /> : null}

        {/*
          The count against the limit, and nothing else. The word "recommended"
          was three quarters of this line and the number was already saying it.
        */}
        {counter ? (
          <span
            className={styles.counter}
            data-status={counter.status}
            aria-live="polite"
            title={`${meta.name}: ${counter.length} of ${counter.recommended} characters recommended, ${counter.hard} maximum`}
          >
            {counter.length} / {counter.recommended}
            {counter.length > counter.recommended ? ` · ${counter.hard} max` : ''}
            <span className="sr-only"> characters</span>
          </span>
        ) : null}

        <span className={styles.fieldActions}>
          {/* One control where a status and a button used to stand. */}
          <SaveToggle name={meta.name} dirty={dirty} onSave={onSave} />
          <button
            type="button"
            className={styles.discussButton}
            onClick={onDiscuss}
            disabled={!filled}
            title={
              filled
                ? undefined
                : 'Write something here first — there is nothing to discuss yet.'
            }
          >
            <SendIcon className={styles.tinyIcon} />
            Discuss in chat
          </button>
        </span>
      </div>

      {/*
        Assistance for this section, in the section. Only the four C.H.A.T.
        sections can be asked about — Condensed's Verse is the passage itself
        and its Reflection is not one of the four the guidance schema knows.
      */}
      {section ? (
        <FieldAssist
          field={section}
          name={meta.name}
          available={assist.available}
          unavailableReason={assist.unavailableReason}
          hasText={filled}
          busy={assist.busyField === section ? assist.busyKind : null}
          guidance={assist.guidance[section] ?? null}
          improvement={assist.improvement?.field === section ? assist.improvement : null}
          clarification={
            assist.clarification?.field === section ? assist.clarification.question : null
          }
          error={assist.error?.field === section ? assist.error.message : null}
          undoable={assist.undoable?.field === section}
          onAsk={() => assist.onAsk(section)}
          onImprove={() => assist.onImprove(section)}
          onAccept={assist.onAccept}
          onDiscard={assist.onDiscard}
          onDismissGuidance={() => assist.onDismissGuidance(section)}
          onUndo={assist.onUndo}
        />
      ) : null}

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
  hasWritten,
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
  hasWritten: boolean
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

  /*
   * The rule the redesign was built on, and it survives the rearrangement:
   * the structure does not appear before there is anything to structure.
   */
  if (!hasWritten) {
    return (
      <div className={styles.artifactWaiting}>
        <p className={styles.waitingLead}>
          {format === 'condensed'
            ? 'Your Condensed C.H.A.T. takes shape as you write'
            : 'Your C.H.A.T. takes shape as you write'}
        </p>
        <p className={styles.waitingBody}>
          {format === 'condensed'
            ? 'The verse and your reflection appear here once you have begun — drawn from the conversation beside you rather than asked for up front.'
            : 'Content, Heart, Application and Testimony appear here once your reflection has begun — drawn from the conversation beside you rather than asked for up front.'}
        </p>
      </div>
    )
  }

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
