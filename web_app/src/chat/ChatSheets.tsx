import { useEffect, useId, useRef, useState } from 'react'
import {
  CHAT_FORMATS,
  TITLE_SOURCES,
  FORMAT_LIMITS,
  counterFor,
  validateChat,
  type ChatFormat,
  type ValidationResult,
} from '@chat/shared'
import { CloseIcon, GlobeIcon, LockIcon, CommunityIcon } from '../shared/ui/icons.tsx'

import { ORIGIN_LABELS, SECTIONS, mergeInto } from './sections.ts'
import type { FieldType } from './types.ts'
import styles from './ChatPage.module.css'

/**
 * A sheet: a modal that closes on Escape, returns focus, and never closes by
 * accident onto work in progress.
 */
export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const headingId = useId()

  useEffect(() => {
    closeRef.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.sheetScrim} onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.sheetHead}>
          <h2 className={styles.sheetTitle} id={headingId}>
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className={styles.headerButton}
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            <CloseIcon className={styles.smallIcon} />
          </button>
        </div>
        <div className={styles.sheetBody}>{children}</div>
        {footer ? <div className={styles.sheetFoot}>{footer}</div> : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- share */

export type ShareAudience = 'only-me' | 'public' | 'community'

/**
 * Where this goes — the question Publish never asked.
 *
 * Exactly one audience per publication, named in words before it is chosen.
 * Communities exist in the rules and not yet in the software, so that
 * destination is shown as unavailable rather than faked: a person can see that
 * it is coming without being able to believe they have used it.
 */
export function ShareSheet({
  currentlyPublished,
  validation,
  format,
  onClose,
  onShare,
}: {
  currentlyPublished: boolean
  validation: ValidationResult | null
  format: ChatFormat
  onClose: () => void
  onShare: (audience: ShareAudience, acknowledgeExtension: boolean) => Promise<void>
}) {
  const [audience, setAudience] = useState<ShareAudience>(
    currentlyPublished ? 'public' : 'only-me',
  )
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)

  const destinations = [
    {
      id: 'only-me' as const,
      icon: <LockIcon className={styles.smallIcon} />,
      name: 'Only me',
      detail: 'Stays private. Nobody else can reach it, even with the link.',
      available: true,
    },
    {
      id: 'public' as const,
      icon: <GlobeIcon className={styles.smallIcon} />,
      name: 'Public',
      detail:
        'Anyone who can see public C.H.A.T. content. May appear in feeds and search, and others may share it on.',
      available: true,
    },
    {
      id: 'community' as const,
      icon: <CommunityIcon className={styles.smallIcon} />,
      name: 'A community',
      detail: 'Members of one community only. Communities are not built yet, so this cannot be chosen.',
      available: false,
    },
  ]

  return (
    <Sheet
      title="Share this reflection"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void onShare(audience, acknowledged).finally(() => setBusy(false))
            }}
          >
            {busy ? 'Sharing…' : audience === 'only-me' ? 'Keep it private' : 'Share publicly'}
          </button>
        </>
      }
    >
      <p className={styles.sheetLead}>
        A reflection goes to one audience at a time. Sharing it somewhere else later makes a
        separate publication — private sharing never becomes public on its own.
      </p>

      <ul className={styles.destinations}>
        {destinations.map((destination) => (
          <li key={destination.id}>
            <label
              className={styles.destination}
              data-selected={audience === destination.id}
              data-unavailable={!destination.available}
            >
              <input
                type="radio"
                name="audience"
                value={destination.id}
                checked={audience === destination.id}
                disabled={!destination.available}
                onChange={() => setAudience(destination.id)}
              />
              <span className={styles.destinationIcon} aria-hidden="true">
                {destination.icon}
              </span>
              <span className={styles.destinationText}>
                <span className={styles.destinationName}>
                  {destination.name}
                  {!destination.available ? (
                    <span className={styles.unavailableTag}>Not available yet</span>
                  ) : null}
                </span>
                <span className={styles.destinationDetail}>{destination.detail}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {/*
        When the gate refuses, it refuses with numbers. "Invalid" tells someone
        that they are stuck; "Heart is 46 characters over its maximum of 600"
        tells them what to do next.
      */}
      {validation ? (
        <div className={styles.validation} role="alert">
          <p className={styles.validationHead}>This cannot be shared publicly yet.</p>

          {validation.missing.length > 0 ? (
            <p className={styles.validationLine}>
              Still to write:{' '}
              {validation.missing
                .map(
                  (field) =>
                    SECTIONS.find((meta) => meta.type === field)?.name ??
                    (field === 'scriptureReference' ? 'Scripture reference' : field),
                )
                .join(', ')}
              .
            </p>
          ) : null}

          {validation.fields
            .filter((field) => field.status === 'invalid')
            .map((field) => (
              <p key={field.field} className={styles.validationLine}>
                {SECTIONS.find((meta) => meta.type === field.field)?.name ?? field.field} is{' '}
                {field.length - field.hard} characters over its maximum of {field.hard}.
              </p>
            ))}

          {validation.combined.status !== 'recommended' ? (
            <p className={styles.validationLine}>
              Together they run to {validation.combined.length} characters — the recommended
              length is {validation.combined.recommended} and the maximum is{' '}
              {validation.combined.hard}.
            </p>
          ) : null}

          <p className={styles.validationLine}>
            It renders to {validation.pages} {validation.pages === 1 ? 'page' : 'pages'}; this
            format allows {validation.maxPages}.
          </p>

          {/*
            Two pages are a decision the author makes. A Condensed C.H.A.T. has
            no such decision to make — one page is absolute — so the offer is
            not made there at all.
          */}
          {validation.requiresExtensionAcknowledgement &&
          format === CHAT_FORMATS.FULL ? (
            <label className={styles.acknowledge}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              Allow this C.H.A.T. to use two pages
            </label>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  )
}

/* ------------------------------------------------------------------ format */

/**
 * Choosing a format, with both explained before either is picked.
 *
 * Condensed is a format in its own right, never "Full with things missing", so
 * the two are described side by side in their own terms. Converting proposes
 * and preserves: the draft being left is kept exactly as it is, the proposal is
 * shown for review, and nothing is invented for a section the author has not
 * written.
 */
export function FormatSheet({
  format,
  fullSections,
  condensedFields,
  onClose,
  onChoose,
}: {
  format: ChatFormat
  fullSections: Record<string, string>
  condensedFields: Record<string, string>
  onClose: () => void
  onChoose: (
    next: ChatFormat,
    carry: { field: FieldType; content: string } | null,
  ) => Promise<void>
}) {
  const target: ChatFormat =
    format === CHAT_FORMATS.FULL ? CHAT_FORMATS.CONDENSED : CHAT_FORMATS.FULL

  /*
   * The proposed Reflection is the author's four sections joined, in their
   * order and their words — no new wording, so it is still theirs and is not
   * labelled otherwise. They can edit it here before it is used, or take none
   * of it.
   */
  const joined = SECTIONS.map((meta) => fullSections[meta.type]?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n')

  const [proposedReflection, setProposedReflection] = useState(joined)
  const [carryOver, setCarryOver] = useState(true)
  const [busy, setBusy] = useState(false)

  const condensedCheck = validateChat(CHAT_FORMATS.CONDENSED, {
    verse: condensedFields['verse'] ?? '',
    reflection: proposedReflection,
  })

  const limits = FORMAT_LIMITS[CHAT_FORMATS.CONDENSED]

  return (
    <Sheet
      title="C.H.A.T. format"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Keep {format === CHAT_FORMATS.FULL ? 'Full' : 'Condensed'} C.H.A.T.
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void onChoose(
                target,
                target === CHAT_FORMATS.CONDENSED && carryOver && proposedReflection.trim()
                  ? { field: 'reflection', content: proposedReflection }
                  : null,
              ).finally(() => setBusy(false))
            }}
          >
            {busy
              ? 'Changing…'
              : `Change to ${target === CHAT_FORMATS.FULL ? 'Full' : 'Condensed'} C.H.A.T.`}
          </button>
        </>
      }
    >
      <div className={styles.formatPair}>
        <div className={styles.formatCard} data-current={format === CHAT_FORMATS.FULL}>
          <h3 className={styles.formatName}>
            Full C.H.A.T.
            {format === CHAT_FORMATS.FULL ? (
              <span className={styles.currentTag}>Current</span>
            ) : null}
          </h3>
          <p className={styles.formatShape}>Content · Heart · Application · Testimony</p>
          <p className={styles.formatDetail}>
            {/*
              Read from the limits rather than written out. The Condensed card
              beside this one already did, so when the budgets were raised this
              card quietly kept quoting the old numbers — a sentence that looks
              like documentation and is actually a stale copy.
            */}
            All four sections, up to{' '}
            {FORMAT_LIMITS.full.combined.recommended.toLocaleString()} characters
            together as a rule and{' '}
            {FORMAT_LIMITS.full.combined.hard.toLocaleString()} at most. One
            page, or two if you allow it.
          </p>
        </div>

        <div className={styles.formatCard} data-current={format === CHAT_FORMATS.CONDENSED}>
          <h3 className={styles.formatName}>
            Condensed C.H.A.T.
            {format === CHAT_FORMATS.CONDENSED ? (
              <span className={styles.currentTag}>Current</span>
            ) : null}
          </h3>
          <p className={styles.formatShape}>Verse · Reflection</p>
          <p className={styles.formatDetail}>
            A verse and what it is saying to you, in {limits.combined.recommended} characters
            or so and {limits.combined.hard} at most. Always exactly one page.
          </p>
        </div>
      </div>

      <p className={styles.sheetLead}>
        Both are complete formats. Whichever you leave is kept exactly as it is, so you can
        change back and find your work where you left it.
      </p>

      {target === CHAT_FORMATS.CONDENSED ? (
        <div className={styles.conversion}>
          <h3 className={styles.conversionHead}>What would carry over</h3>
          {joined ? (
            <>
              <label className={styles.acknowledge}>
                <input
                  type="checkbox"
                  checked={carryOver}
                  onChange={(event) => setCarryOver(event.target.checked)}
                />
                Start the Reflection from your four sections
              </label>
              <p className={styles.conversionNote}>
                This is your own writing, joined in order — nothing has been reworded. Edit it
                here before it is used; your Full C.H.A.T. is kept either way.
              </p>
              <textarea
                className={styles.conversionInput}
                value={proposedReflection}
                aria-label="Proposed Reflection"
                disabled={!carryOver}
                onChange={(event) => setProposedReflection(event.target.value)}
              />
              <p
                className={styles.counter}
                data-status={condensedCheck.combined.status}
                aria-live="polite"
              >
                {condensedCheck.combined.length} / {condensedCheck.combined.recommended}{' '}
                recommended for verse and reflection together · {condensedCheck.combined.hard}{' '}
                maximum
              </p>
              {condensedCheck.combined.status === 'invalid' ? (
                <p className={styles.conversionNote}>
                  This is longer than a Condensed C.H.A.T. allows. You can still change format
                  and shorten it afterwards — nothing will be cut for you.
                </p>
              ) : null}
            </>
          ) : (
            <p className={styles.conversionNote}>
              You have not written any sections yet, so there is nothing to carry over. The
              verse and reflection are yours to write.
            </p>
          )}
          <p className={styles.conversionNote}>
            The verse is not filled in for you. Quoted Scripture is yours to choose, along
            with the translation it comes from.
          </p>
        </div>
      ) : (
        <div className={styles.conversion}>
          <h3 className={styles.conversionHead}>What would carry over</h3>
          <p className={styles.conversionNote}>
            Your Scripture reference and verse stay as they are, and your Condensed draft is
            kept. The four sections are yours to write — each one asks a question, and none of
            them will be filled in on your behalf:
          </p>
          <ul className={styles.questionList}>
            {SECTIONS.map((meta) => (
              <li key={meta.type}>
                <strong>{meta.name}</strong> — {meta.prompt}
              </li>
            ))}
          </ul>
          {condensedFields['reflection']?.trim() ? (
            <p className={styles.conversionNote}>
              Your Reflection stays available as source material; use <em>Use in…</em> in the
              chat, or copy from it as you write.
            </p>
          ) : null}
        </div>
      )}
    </Sheet>
  )
}

/* ------------------------------------------------------------------- title */

/**
 * A suggested name for the work, offered rather than applied.
 *
 * The author picks from candidates drawn out of their own writing, edits the
 * one they picked if they want to, and only then does it become the title. An
 * existing name is named alongside, because replacing something someone chose
 * for themselves should be a visible decision and not a side effect of
 * curiosity.
 */
export function TitleSuggestionSheet({
  suggestions,
  currentTitle,
  format,
  source,
  onClose,
  onUse,
}: {
  suggestions: string[]
  currentTitle: string
  format: ChatFormat
  /** Which side produced these. Shown, so nobody is misled about it. */
  source: string
  onClose: () => void
  onUse: (title: string) => Promise<void>
}) {
  const [chosen, setChosen] = useState(suggestions[0] ?? '')
  const [busy, setBusy] = useState(false)
  const counter = counterFor(format, 'title', chosen)
  const limit = FORMAT_LIMITS[format].fields['title']
  const tooLong = limit ? chosen.length > limit.hard : false

  return (
    <Sheet
      title="Suggest a title"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {currentTitle.trim() ? 'Keep my title' : 'Not now'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !chosen.trim() || tooLong}
            onClick={() => {
              setBusy(true)
              void onUse(chosen.trim()).finally(() => setBusy(false))
            }}
          >
            {busy ? 'Saving…' : 'Use this title'}
          </button>
        </>
      }
    >
      <p className={styles.sheetLead}>
        Drawn from your passage and your own writing. Nothing here is used until you choose
        it, and you can edit it first.
      </p>

      {/*
        Where these came from, said plainly. The model and the fallback produce
        noticeably different candidates, and an author who cannot tell which
        they are looking at has been misled about the help they are getting.
      */}
      <p className={styles.titleSource}>
        {source === TITLE_SOURCES.MODEL ? (
          <>
            <span className="badge badge-ai-generated">{ORIGIN_LABELS['ai_generated']}</span>
            Suggested by AI from what you have written.
          </>
        ) : (
          <>
            <span className="badge badge-user">Built from your words</span>
            AI was unavailable, so these were assembled from your own writing.
          </>
        )}
      </p>

      {currentTitle.trim() ? (
        <p className={styles.conversionNote}>
          This reflection is currently called <strong>{currentTitle}</strong>. Choosing one of
          these replaces that.
        </p>
      ) : null}

      <ul className={styles.destinations}>
        {suggestions.map((suggestion) => (
          <li key={suggestion}>
            <label className={styles.destination} data-selected={chosen === suggestion}>
              <input
                type="radio"
                name="title-suggestion"
                value={suggestion}
                checked={chosen === suggestion}
                onChange={() => setChosen(suggestion)}
              />
              <span className={styles.destinationText}>
                <span className={styles.suggestionText}>{suggestion}</span>
                <span className={styles.destinationDetail}>
                  {suggestion.length} characters
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <label className={styles.suggestionEdit}>
        <span className={styles.conversionHead}>Edit it before it is used</span>
        <input
          className={styles.suggestionInput}
          value={chosen}
          aria-label="Title to use"
          onChange={(event) => setChosen(event.target.value)}
        />
      </label>

      {counter ? (
        <p className={styles.counter} data-status={counter.status} aria-live="polite">
          {counter.length} / {counter.recommended} recommended · {counter.hard} maximum
        </p>
      ) : null}

      {tooLong ? (
        <p className={styles.conversionNote}>
          That is longer than a title may be. Shorten it by{' '}
          {limit ? chosen.length - limit.hard : 0} characters to use it.
        </p>
      ) : null}
    </Sheet>
  )
}

/* ------------------------------------------------------------------ delete */

export function DeleteSheet({
  title,
  onClose,
  onDelete,
}: {
  title: string
  onClose: () => void
  onDelete: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  return (
    <Sheet
      title="Delete this reflection"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Keep it
          </button>
          <button
            type="button"
            className={`btn ${styles.dangerButton}`}
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void onDelete().finally(() => setBusy(false))
            }}
          >
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </>
      }
    >
      <p className={styles.sheetLead}>
        <strong>{title}</strong> will be deleted, along with its conversation and every
        section of its C.H.A.T. This cannot be undone.
      </p>
    </Sheet>
  )
}

/* ------------------------------------------------------- adding to a section */

/**
 * Where a draft goes when the section already has words in it.
 *
 * This sheet exists to make one outcome impossible: text the author wrote
 * disappearing because they pressed a button. So it shows the RESULT before it
 * happens, defaults to the mode that loses nothing, and puts Replace behind a
 * second, deliberate confirmation.
 *
 * The preview is computed by the same function that performs the merge, because
 * a preview computed a different way from the thing it previews is worse than
 * no preview at all.
 *
 * "Insert at cursor" is offered ONLY when a caret in that section is actually
 * known. Offering it and quietly meaning "at the end" would be a small lie in
 * exactly the place this sheet exists to be trustworthy.
 */
export function AddToSectionSheet({
  sectionName,
  text,
  existing,
  caret,
  onCancel,
  onChoose,
}: {
  sectionName: string
  text: string
  existing: string
  caret: number | null
  onCancel: () => void
  onChoose: (mode: 'append' | 'replace' | 'insert') => void
}) {
  /* Append is the default, because it is the one that cannot lose anything. */
  const [mode, setMode] = useState<'append' | 'replace' | 'insert'>('append')
  const [confirmedReplace, setConfirmedReplace] = useState(false)

  const modes: { id: 'append' | 'replace' | 'insert'; label: string; hint: string }[] = [
    { id: 'append', label: 'Add to the end', hint: 'Your writing stays, this goes after it.' },
    ...(caret !== null
      ? ([
          {
            id: 'insert' as const,
            label: 'Insert where I left the cursor',
            hint: 'Your writing stays, this goes in at that point.',
          },
        ])
      : []),
    {
      id: 'replace',
      label: 'Replace what I have written',
      hint: 'Your current writing is removed. You can undo this afterwards.',
    },
  ]

  const preview = mergeInto(existing, text, mode, caret ?? existing.length)
  const blocked = mode === 'replace' && !confirmedReplace

  return (
    <Sheet
      title={`Add to ${sectionName}`}
      onClose={onCancel}
      footer={
        <>
          <button
            type="button"
            className="btn btn-primary"
            disabled={blocked}
            onClick={() => onChoose(mode)}
          >
            {mode === 'replace' ? `Replace my ${sectionName}` : `Add to ${sectionName}`}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </>
      }
    >
      <p className={styles.sheetLead}>
        Your {sectionName} already has something in it. Nothing has changed yet, and nothing is
        saved until you save it.
      </p>

      <div className={styles.addChoices} role="radiogroup" aria-label="How to add this">
        {modes.map((option) => (
          <label key={option.id} className={styles.addChoice} data-selected={mode === option.id}>
            <input
              type="radio"
              name="add-mode"
              value={option.id}
              checked={mode === option.id}
              onChange={() => {
                setMode(option.id)
                setConfirmedReplace(false)
              }}
            />
            <span>
              <span className={styles.addChoiceLabel}>{option.label}</span>
              <span className={styles.addChoiceHint}>{option.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {/*
        Replacing is the one choice that removes something, so it takes a
        second deliberate act rather than a single click near the others.
      */}
      {mode === 'replace' ? (
        <label className={styles.addConfirm}>
          <input
            type="checkbox"
            checked={confirmedReplace}
            onChange={(event) => setConfirmedReplace(event.target.checked)}
          />
          <span>Yes, remove what I have written in {sectionName}.</span>
        </label>
      ) : null}

      <div>
        <h3 className={styles.addCompareLabel}>Result</h3>
        <p className={styles.addCompareText} data-incoming="true">
          {preview}
        </p>
      </div>
    </Sheet>
  )
}
