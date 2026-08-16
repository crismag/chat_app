import { useEffect, useRef } from 'react'
import { counterFor, splitAtLimit, type ChatFormat } from '@chat/shared'
import { CheckIcon, SendIcon } from '../shared/ui/icons.tsx'
import { FieldAssist } from './FieldAssist.tsx'
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
 * directly. Everything a person needs while writing sits with the words: the
 * question, the counter, who wrote it, and the two ways out to the conversation
 * beside it.
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
   * Narrowed once, into a const, so the callbacks below keep the narrowing.
   * Non-null exactly when this field is one of the four assistance understands.
   */
  const section = isGuidanceSection(meta.type) ? meta.type : null

  return (
    <article
      className={`${styles.field} ${styles[meta.type] ?? ''}`}
      data-discussing={discussing ? 'true' : 'false'}
    >
      <div className={styles.fieldHead}>
        <span className={styles.marker} aria-hidden="true">
          {meta.letter}
        </span>
        <div className={styles.fieldHeading}>
          <h3 className={styles.fieldName}>{meta.name}</h3>
          <p className={styles.fieldPrompt}>{meta.prompt}</p>
        </div>
        <span className={styles.fieldState}>
          {filled ? (
            <>
              <CheckIcon className={styles.tinyIcon} />
              Written
            </>
          ) : (
            'Not yet'
          )}
        </span>
      </div>

      <textarea
        ref={areaRef}
        className={styles.fieldInput}
        value={value}
        aria-label={`${meta.name} — ${meta.prompt}`}
        /* The question is already printed above the box; twice is clutter. */
        placeholder="Write here…"
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
        {/* Nothing written is nobody's words yet, so nothing is claimed. */}
        {filled ? (
          <span className={`badge ${ORIGIN_CLASSES[authorOrigin] ?? 'badge-user'}`}>
            {ORIGIN_LABELS[authorOrigin] ?? authorOrigin}
          </span>
        ) : null}

        {counter ? (
          <span className={styles.counter} data-status={counter.status} aria-live="polite">
            {counter.length} / {counter.recommended} recommended
            {counter.length > counter.recommended ? ` · ${counter.hard} maximum` : ''}
          </span>
        ) : null}

        <span className={styles.fieldActions}>
          <span className={styles.fieldSaved} role="status">
            {dirty ? 'Unsaved' : filled ? 'Saved' : ''}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onSave}
            disabled={!dirty}
          >
            Save
          </button>
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
            : 'Context, Heart, Application and Testimony appear here once your reflection has begun — drawn from the conversation beside you rather than asked for up front.'}
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
