import { useEffect, useId, useRef, useState } from 'react'
import {
  counterFor,
  splitAtLimit,
  validateChat,
  type ChatFormat,
  type ChatSection,
  type ChatSectionType,
  type ValidationResult,
} from '@chat/shared'
import { CheckIcon, ExpandIcon, PencilIcon } from '../shared/ui/icons.tsx'
import { ORIGIN_CLASSES, ORIGIN_LABELS, SECTIONS } from './sections.ts'
import styles from './ChatPage.module.css'

function SectionCard({
  meta,
  section,
  format,
  expanded,
  saved,
  onExpand,
  onCollapse,
  onSave,
}: {
  meta: (typeof SECTIONS)[number]
  section: ChatSection | undefined
  format: ChatFormat
  expanded: boolean
  saved: boolean
  onExpand: () => void
  onCollapse: () => void
  onSave: (content: string) => Promise<void>
}) {
  const bodyId = useId()
  const content = section?.content ?? ''
  const [value, setValue] = useState(content)
  const [overflow, setOverflow] = useState('')
  const [busy, setBusy] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (expanded) {
      setValue(content)
      setOverflow('')
      textareaRef.current?.focus()
    }
    // Only when the card opens; typing must not be overwritten by a refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded])

  const filled = content.trim().length > 0
  const counter = counterFor(format, meta.type, expanded ? value : content)
  const preview = content.trim() || meta.prompt

  return (
    <article className={`${styles.card} ${styles[meta.type]}`} data-expanded={expanded}>
      <h3 className={styles.cardHead}>
        <button
          type="button"
          className={styles.cardToggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={expanded ? onCollapse : onExpand}
        >
          {/* The letter is a mark; the name beside it is what gets announced. */}
          <span className={styles.marker} aria-hidden="true">
            {meta.letter}
          </span>
          <span className={styles.cardTitle}>
            <span className={styles.cardName}>{meta.name}</span>
            <span className={styles.cardState}>
              {filled ? (
                <>
                  <CheckIcon className={styles.tinyIcon} />
                  Reflected
                </>
              ) : (
                'Not yet'
              )}
            </span>
          </span>
          <ExpandIcon
            className={expanded ? `${styles.cardChevron} ${styles.cardChevronOpen}` : styles.cardChevron}
          />
        </button>
      </h3>

      {expanded ? (
        <div className={styles.cardBody} id={bodyId}>
          <p className={styles.cardPrompt}>{meta.prompt}</p>
          <textarea
            ref={textareaRef}
            className={styles.cardTextarea}
            value={value}
            aria-label={`${meta.name} — ${meta.prompt}`}
            onChange={(event) => {
              /*
               * Nothing the author typed is thrown away. At the hard maximum
               * the field stops accepting characters and the excess is shown
               * back to them to shorten or move, rather than vanishing.
               */
              const split = splitAtLimit(format, meta.type, event.target.value)
              setValue(split.kept)
              setOverflow(split.overflow)
            }}
          />

          {counter ? (
            <p
              className={styles.counter}
              data-status={counter.status}
              aria-live="polite"
            >
              <span>
                {counter.length} / {counter.recommended} recommended
              </span>
              {counter.length > counter.recommended ? (
                <span className={styles.counterHard}>{counter.hard} maximum</span>
              ) : null}
            </p>
          ) : null}

          {overflow ? (
            <p className={styles.overflowNotice}>
              {overflow.length} characters are past the maximum for {meta.name} and were
              not added. Shorten this section, or keep them somewhere else:
              <span className={styles.overflowText}>{overflow}</span>
            </p>
          ) : null}

          <div className={styles.cardActions}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void onSave(value).finally(() => setBusy(false))
              }}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCollapse}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.cardPreviewRow} id={bodyId}>
          <p className={filled ? styles.cardPreview : styles.cardPreviewEmpty}>{preview}</p>
          {/*
            An unwritten card is a question and nothing else. The heading above
            it is already the control that opens it, so a second "Write" button
            would only be a taller way of saying the same thing — and four of
            those are what pushes the fourth section below a fold.
          */}
          {filled ? (
            <div className={styles.cardFoot}>
              <span className={`badge ${ORIGIN_CLASSES[section?.authorOrigin ?? 'user'] ?? 'badge-user'}`}>
                {ORIGIN_LABELS[section?.authorOrigin ?? 'user'] ?? section?.authorOrigin}
              </span>
              <span className={styles.cardFootRight}>
                {saved ? (
                  <span className={styles.savedFlag} role="status">
                    <CheckIcon className={styles.tinyIcon} />
                    Saved
                  </span>
                ) : null}
                <button
                  type="button"
                  className={styles.editButton}
                  onClick={onExpand}
                  aria-label={`Edit ${meta.name}`}
                >
                  <PencilIcon className={styles.tinyIcon} />
                  Edit
                </button>
              </span>
            </div>
          ) : null}
        </div>
      )}
    </article>
  )
}

export function ChatCompanion({
  sections,
  format,
  title,
  scriptureReference,
  hasWritten,
  onSave,
  onExtract,
  onCreateVisual,
}: {
  sections: Record<ChatSectionType, ChatSection> | null
  format: ChatFormat
  title: string
  scriptureReference: string | null
  hasWritten: boolean
  onSave: (type: ChatSectionType, content: string) => Promise<void>
  onExtract: () => Promise<void>
  onCreateVisual: () => void
}) {
  const [expanded, setExpanded] = useState<ChatSectionType | null>(null)
  const [savedType, setSavedType] = useState<ChatSectionType | null>(null)
  const [review, setReview] = useState<ValidationResult | null>(null)
  const [extracting, setExtracting] = useState(false)

  /*
   * The single most important rule on this screen: the structure does not
   * appear before there is anything to structure. Four empty cards beside an
   * empty conversation is the form the redesign exists to remove.
   */
  if (!hasWritten || !sections) {
    return (
      <aside className={styles.companion} aria-label="C.H.A.T. companion">
        <div className={styles.companionWaiting}>
          <p className={styles.waitingLead}>C.H.A.T. takes shape as you write</p>
          <p className={styles.waitingBody}>
            Context, Heart, Application and Testimony appear here once your reflection
            has begun — drawn from the conversation rather than asked for up front.
          </p>
        </div>
      </aside>
    )
  }

  const done = SECTIONS.filter((meta) => sections[meta.type]?.content.trim()).length

  return (
    <aside className={styles.companion} aria-label="C.H.A.T. companion">
      <div className={styles.companionHead}>
        <h2 className={styles.companionTitle}>C.H.A.T.</h2>
        <p className={styles.progress}>
          <span className={styles.progressText}>{done} of 4 reflected</span>
          <span className={styles.progressTrack} aria-hidden="true">
            <span className={styles.progressFill} style={{ inlineSize: `${(done / 4) * 100}%` }} />
          </span>
        </p>
      </div>

      <div className={styles.cards}>
        {SECTIONS.map((meta) => (
          <SectionCard
            key={meta.type}
            meta={meta}
            section={sections[meta.type]}
            format={format}
            expanded={expanded === meta.type}
            saved={savedType === meta.type}
            /* One at a time: opening a card closes whichever was open. */
            onExpand={() => setExpanded(meta.type)}
            onCollapse={() => setExpanded(null)}
            onSave={async (content) => {
              await onSave(meta.type, content)
              setExpanded(null)
              setSavedType(meta.type)
              window.setTimeout(() => setSavedType(null), 2500)
            }}
          />
        ))}
      </div>

      {review ? (
        <div className={styles.review} role="status">
          <p className={styles.reviewHead}>
            {review.publishable
              ? 'Ready to share.'
              : `Not ready yet — ${review.combined.length} of ${review.combined.recommended} recommended characters.`}
          </p>
          {review.missing.length > 0 ? (
            <p className={styles.reviewLine}>
              Still to write: {review.missing.join(', ')}.
            </p>
          ) : null}
          {review.corrections.map((correction) => (
            <p key={correction} className={styles.reviewLine}>
              {correction}
            </p>
          ))}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setReview(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <div className={styles.companionFoot}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={extracting}
          onClick={() => {
            setExtracting(true)
            void onExtract().finally(() => setExtracting(false))
          }}
        >
          {extracting ? 'Extracting…' : 'Extract from conversation'}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() =>
            setReview(
              validateChat(format, {
                title,
                scriptureReference: scriptureReference ?? '',
                context: sections.context.content,
                heart: sections.heart.content,
                application: sections.application.content,
                testimony: sections.testimony.content,
              }),
            )
          }
        >
          Review C.H.A.T.
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCreateVisual}>
          Create visual
        </button>
      </div>
    </aside>
  )
}
