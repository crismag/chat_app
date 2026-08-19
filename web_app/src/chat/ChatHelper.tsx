import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  AI_ACTIONS,
  AI_CHAT_NOTE_ONLY_MESSAGE,
  AI_CHAT_SHORT_NOTICE,
  type AiAction,
  type AiGuidanceSection,
  type ChatFormat,
} from '@chat/shared'
import { SendIcon, UseInIcon } from '../shared/ui/icons.tsx'
import { chipsFor, canAddToSection, type Chip } from './chips.ts'
import { ORIGIN_CLASSES, ORIGIN_LABELS, fieldsFor, isGuidanceSection } from './sections.ts'
import type { AddedNotice, FieldType, Message, Proposal } from './types.ts'
import styles from './ChatPage.module.css'

/** Acting on something that already exists, so only offered when it does. */
const REFINE_ACTIONS: { id: AiAction; label: string }[] = [
  { id: AI_ACTIONS.POLISH, label: 'Polish' },
  { id: AI_ACTIONS.SHORTEN, label: 'Shorten' },
]

/**
 * The conversation — a companion beside the artifact, not a transcript in a form.
 *
 * Three regions and no more: a header that stays, a thread that scrolls, and a
 * composer that stays. The disclaimer that used to sit as a permanent block
 * between the two is now a popover on the header, because a caveat nobody can
 * scroll past is a caveat everybody stops reading.
 *
 * Two rules run through every part of this file.
 *
 *   1. **Nothing here writes anything.** A reply is a message; a draft is a
 *      message with draft text on it. The only route into the C.H.A.T. is a
 *      button the author presses, and the write goes through the same section
 *      endpoint they use when typing by hand.
 *   2. **Only actual drafts are called drafts.** An explanation is an
 *      explanation. Labelling every reply "AI DRAFTED" made the label mean
 *      nothing, which is worse than not having one, because the label is what
 *      has to carry weight on the one message that really is generated
 *      material.
 */
export function ChatHelper({
  format,
  reference,
  messages,
  draft,
  sending,
  discussing,
  proposal,
  busyAction,
  onDraft,
  onSend,
  onChip,
  onAction,
  onUseInField,
  onStopDiscussing,
  onDismissProposal,
  composerRef,
  replying,
  chatError,
  chatAvailable,
  chatNotice,
  onDismissChatError,
  onAddDraft,
  onRetryDraft,
  addedNotice,
  onViewSection,
  onDismissAdded,
}: {
  format: ChatFormat
  /** The passage, for the header. The panel is about *this* reflection. */
  reference: string
  messages: Message[]
  draft: string
  sending: boolean
  discussing: FieldType | null
  proposal: Proposal | null
  busyAction: AiAction | null
  onDraft: (value: string) => void
  onSend: (event: FormEvent) => void
  /** Invoke a structured action. The chip chose it; the server knows it. */
  onChip: (chip: Chip) => void
  onAction: (action: AiAction) => void
  onUseInField: (field: FieldType, content: string, origin: string) => void
  onStopDiscussing: () => void
  onDismissProposal: () => void
  composerRef: React.RefObject<HTMLTextAreaElement | null>
  replying: boolean
  chatError: string | null
  chatAvailable: boolean
  chatNotice: string
  onDismissChatError: () => void
  /** Offer a draft for a section. Never writes: `ChatPage` owns the decision. */
  onAddDraft: (section: FieldType, text: string) => void
  onRetryDraft: (message: Message) => void
  addedNotice: AddedNotice | null
  onViewSection: (field: FieldType) => void
  onDismissAdded: () => void
}) {
  const listRef = useRef<HTMLOListElement>(null)
  const [offering, setOffering] = useState<string | null>(null)
  const offerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [atLatest, setAtLatest] = useState(true)
  const fields = fieldsFor(format)

  const scoped = discussing && isGuidanceSection(discussing) ? discussing : null
  const scopedMeta = scoped ? fields.find((meta) => meta.type === scoped) : undefined
  const scopedName = scoped ? (scopedMeta?.name ?? scoped) : null

  const nameOf = (field: FieldType) =>
    fields.find((meta) => meta.type === field)?.name ?? field

  /*
   * Follow the thread only when the reader is already at the bottom of it.
   *
   * Scrolling someone back down while they are reading an earlier message is
   * the reason the "↓ Latest" control exists — so the fix is not to do it, and
   * to tell them something arrived instead.
   */
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    if (atLatest) list.scrollTo({ top: list.scrollHeight })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, replying])

  function onScroll() {
    const list = listRef.current
    if (!list) return
    const distance = list.scrollHeight - list.scrollTop - list.clientHeight
    setAtLatest(distance < 48)
  }

  function goLatest() {
    const list = listRef.current
    if (!list) return
    list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
    setAtLatest(true)
  }

  /*
   * Dismissing the popover: Escape, or a click anywhere outside it.
   *
   * Both are handled on the document rather than on the menu, because focus is
   * not necessarily inside the menu when either happens — a key handler bound
   * to the menu only fires once something in it has been focused, which makes
   * Escape work for keyboard users and silently not for everyone else.
   *
   * Focus goes back to the trigger when it closes without a selection, so the
   * author is returned to where they were rather than to the top of the page.
   */
  useEffect(() => {
    if (!offering) return

    function close() {
      setOffering(null)
      offerRef.current?.focus()
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
      }
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (popoverRef.current?.contains(target)) return
      if (offerRef.current?.contains(target)) return
      /* Outside: dismiss, but leave focus wherever they clicked. */
      setOffering(null)
    }

    /* Opened near the bottom of the thread, it needs bringing into view. */
    popoverRef.current?.scrollIntoView({ block: 'nearest' })

    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [offering])

  const chips = chipsFor(scoped)
  /* Something exists to refine, so refining is worth offering. */
  const hasRefinable = proposal !== null || messages.some((message) => message.draftText)

  return (
    <div className={styles.helperInner}>
      {/* ── Region 1: the header, which does not scroll ────────────────── */}
      <div className={styles.helperHead}>
        <div className={styles.helperHeadRow}>
          <h2 className={styles.helperTitle}>
            {reference ? `Reflect on ${reference}` : 'Reflect'}
          </h2>

          {/*
            The caveat, out of the way but not hidden. It was a permanent block
            between the conversation and the composer, which is prime space
            spent on a sentence people had stopped seeing.
          */}
          <div className={styles.noticeWrap}>
            <button
              type="button"
              className={styles.noticeButton}
              aria-expanded={noticeOpen}
              aria-label="About AI suggestions"
              onClick={() => setNoticeOpen((open) => !open)}
            >
              <span aria-hidden="true">i</span>
            </button>
            {noticeOpen ? (
              <div className={styles.noticePopover} role="dialog" aria-label="About AI suggestions">
                <p>{chatNotice}</p>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setNoticeOpen(false)}
                >
                  Close
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <p className={styles.helperNote}>
          Explore the passage or develop your C.H.A.T. reflection.
        </p>

        {/*
          Scoped mode, stated and dismissible. Without this the author has no
          way to know why the chips changed or where a draft will land.
        */}
        {scopedName ? (
          <p className={styles.scopeBanner}>
            <span className={styles.scopeLabel}>
              Working with:{' '}
              {scopedMeta ? (
                <span className={`${styles.scopeLetter} ${styles[scopedMeta.type] ?? ''}`} aria-hidden="true">
                  {scopedMeta.letter}
                </span>
              ) : null}
              <strong>{scopedName}</strong>
            </span>
            <button
              type="button"
              className={styles.scopeDismiss}
              onClick={onStopDiscussing}
              aria-label={`Stop working with ${scopedName}`}
            >
              ×
            </button>
          </p>
        ) : null}

        {!chatAvailable ? (
          <p className={styles.helperNoteOnly} role="status">
            {AI_CHAT_NOTE_ONLY_MESSAGE}
          </p>
        ) : null}
      </div>

      {/* ── Region 2: the thread, which scrolls ────────────────────────── */}
      {messages.length === 0 ? (
        <div className={styles.helperEmpty}>
          <p className={styles.helperEmptyLead}>What passage are you reflecting on today?</p>
          <p className={styles.helperEmptyBody}>
            Write what you are seeing, or what it stirred. Your C.H.A.T. appears beside this as
            soon as there is something to shape.
          </p>
        </div>
      ) : (
        <ol className={styles.messages} ref={listRef} onScroll={onScroll}>
          {messages.map((message) => {
            const isAssistant = message.role === 'assistant'
            const placed =
              message.draftSection && isGuidanceSection(message.draftSection)
                ? (message.draftSection as AiGuidanceSection)
                : null

            return (
              <li key={message.id} className={styles.message} data-role={message.role}>
                {/*
                  Identity, not provenance. "✦ C.H.A.T." says who is speaking;
                  the AI badge is saved for the one thing that is genuinely
                  generated material — the draft card below.
                */}
                {isAssistant ? (
                  <p className={styles.messageWho}>
                    <span aria-hidden="true">✦</span> C.H.A.T.
                  </p>
                ) : (
                  /* Their own words need no label on screen — but a screen
                     reader still has to be told whose turn this is. */
                  <p className="sr-only">You</p>
                )}

                {message.content ? (
                  <p className={styles.messageBody}>{message.content}</p>
                ) : null}

                {/*
                  ── The draft card. ──
                  A distinct thing, named as a draft, naming where it would go.
                  Its destination was decided by the server in trusted code; the
                  button below only asks for it, and `ChatPage` decides how it
                  lands.
                */}
                {message.draftText ? (
                  <div className={styles.draftCard}>
                    <p className={styles.draftHead}>
                      <span className={styles.draftTitle}>
                        {placed ? `${nameOf(placed)} draft` : 'Draft'}
                      </span>
                      <span className={`badge ${ORIGIN_CLASSES['ai_generated']}`}>
                        {ORIGIN_LABELS['ai_generated']}
                      </span>
                    </p>

                    {editing?.id === message.id ? (
                      <>
                        <textarea
                          className={styles.draftEditor}
                          value={editing.text}
                          aria-label="Edit this draft before adding it"
                          rows={5}
                          onChange={(event) =>
                            setEditing({ id: message.id, text: event.target.value })
                          }
                        />
                        <div className={styles.draftActions}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setEditing(null)}
                          >
                            Done editing
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className={styles.draftText}>{message.draftText}</p>
                    )}

                    <div className={styles.draftActions}>
                      {placed ? (
                        /*
                          The destination is already known, so the author is not
                          asked to choose among four again. "Review in" rather
                          than "Add to": it lands in the section as unsaved
                          writing they can edit, never as a commit.
                        */
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() =>
                            onAddDraft(
                              placed,
                              editing?.id === message.id
                                ? editing.text
                                : (message.draftText ?? ''),
                            )
                          }
                        >
                          Review in {nameOf(placed)}
                        </button>
                      ) : (
                        /* No destination could be resolved from the author's
                           own words or the scope, so they are asked rather than
                           guessed at. The click is the explicit action. */
                        <span className={styles.draftPicker} role="group" aria-label="Add this draft to a section">
                          <span className={styles.draftPickerLabel}>Review in</span>
                          {fields.map((meta) => (
                            <button
                              key={meta.type}
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() =>
                                onAddDraft(
                                  meta.type,
                                  editing?.id === message.id
                                    ? editing.text
                                    : (message.draftText ?? ''),
                                )
                              }
                            >
                              {meta.name}
                            </button>
                          ))}
                        </span>
                      )}

                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          setEditing(
                            editing?.id === message.id
                              ? null
                              : { id: message.id, text: message.draftText ?? '' },
                          )
                        }
                      >
                        {editing?.id === message.id ? 'Cancel edit' : 'Edit'}
                      </button>

                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={replying}
                        onClick={() => onRetryDraft(message)}
                      >
                        Try again
                      </button>

                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void navigator.clipboard?.writeText(message.draftText ?? '')}
                      >
                        Copy
                      </button>
                    </div>

                    <p className={styles.draftNotice}>{AI_CHAT_SHORT_NOTICE}</p>
                  </div>
                ) : null}

                {/*
                  ── The contextual use control. ──

                  A small icon on the response, not a full-width button under
                  it. The button made every reply look like a form record and
                  repeated the same action endlessly without ever saying which
                  section would receive anything.

                  It is revealed by hover OR focus, never hover alone, and it is
                  always present on touch. Its accessible name says what it does
                  in words, because an icon on its own says nothing to a screen
                  reader.
                */}
                {canAddToSection(message) ? (
                  <div className={styles.messageActions}>
                    <button
                      type="button"
                      ref={offering === message.id ? offerRef : undefined}
                      className={styles.useIconButton}
                      aria-haspopup="menu"
                      aria-expanded={offering === message.id}
                      aria-label="Use response in reflection"
                      title="Use in reflection"
                      onClick={() => setOffering(offering === message.id ? null : message.id)}
                    >
                      <UseInIcon className={styles.tinyIcon} />
                    </button>

                    {offering === message.id ? (
                      <div ref={popoverRef} className={styles.usePopover} role="menu" aria-label="Use this response">
                        <p className={styles.usePopoverHead}>Use this response</p>
                        {fields.map((meta) => (
                          <button
                            key={meta.type}
                            type="button"
                            role="menuitem"
                            className={styles.useChoice}
                            aria-label={`Use in ${meta.name}`}
                            onClick={() => {
                              onUseInField(meta.type, message.content, message.authorOrigin)
                              setOffering(null)
                            }}
                          >
                            {meta.name}
                          </button>
                        ))}
                        <button
                          type="button"
                          role="menuitem"
                          className={styles.useChoice}
                          onClick={() => {
                            void navigator.clipboard?.writeText(message.content)
                            setOffering(null)
                          }}
                        >
                          Copy text
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}

          {replying ? (
            <li
              className={styles.message}
              data-role="assistant"
              data-pending="true"
              aria-live="polite"
            >
              <p className={styles.messageWho}>
                <span aria-hidden="true">✦</span> C.H.A.T.
              </p>
              <p className={styles.messagePending}>✦ C.H.A.T. is thinking…</p>
            </li>
          ) : null}
        </ol>
      )}

      {/* ── Between the regions: things that report, and do not persist ── */}

      {!atLatest && messages.length > 0 ? (
        <button type="button" className={styles.latestButton} onClick={goLatest}>
          ↓ Latest
        </button>
      ) : null}

      {/*
        Confirmation that the destination actually received it, with a way to
        go and look. A write nobody can see is a write nobody trusts.
      */}
      {addedNotice ? (
        <p className={styles.addedNotice} role="status">
          <span>✓ Added to {nameOf(addedNotice.field)}</span>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => onViewSection(addedNotice.field)}
          >
            View
          </button>
          <button type="button" className={styles.linkButton} onClick={onDismissAdded}>
            Dismiss
          </button>
        </p>
      ) : null}

      {chatError ? (
        <p className={styles.chatError} role="alert">
          {chatError}
          <button type="button" className={styles.linkButton} onClick={onDismissChatError}>
            Dismiss
          </button>
        </p>
      ) : null}

      {proposal && proposal.field === null ? (
        <aside className={styles.proposal}>
          <p className={styles.proposalLabel}>
            <span className={`badge ${ORIGIN_CLASSES[proposal.origin]}`}>
              {ORIGIN_LABELS[proposal.origin]}
            </span>
            Suggested wording — nothing has been changed
          </p>
          <p className={styles.proposalOriginal}>{proposal.original}</p>
          <p className={styles.proposalRevised}>{proposal.revised}</p>
          <div className={styles.proposalActions}>
            {fields.map((meta) => (
              <button
                key={meta.type}
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onUseInField(meta.type, proposal.revised, proposal.origin)}
              >
                Use in {meta.name}
              </button>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={onDismissProposal}>
              Dismiss
            </button>
          </div>
        </aside>
      ) : null}

      {/* ── Region 3: the composer, which does not scroll ──────────────── */}
      <div className={styles.composerWrap}>
        {chatAvailable ? (
          <div className={styles.contextualActions}>
            {/*
              Pressing one fires the request immediately. It does not fill the
              composer and wait for Send — a control that looks like it did
              something and did not is the exact defect this replaces.
            */}
            {chips.map((chip) => (
              <button
                key={chip.label}
                type="button"
                className={styles.chip}
                disabled={sending || replying}
                /* Disabled is exposed in words, not only as a grey pill. */
                title={replying ? 'Waiting for the last reply' : undefined}
                onClick={() => onChip(chip)}
              >
                {chip.label}
              </button>
            ))}

            {/* Only once there is something to act on. */}
            {hasRefinable
              ? REFINE_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className={styles.chip}
                    disabled={busyAction !== null}
                    onClick={() => onAction(action.id)}
                  >
                    {busyAction === action.id ? `${action.label}…` : action.label}
                  </button>
                ))
              : null}
          </div>
        ) : null}

        <form className={styles.composer} onSubmit={onSend}>
          <textarea
            ref={composerRef}
            className={styles.composerInput}
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                onSend(event as unknown as FormEvent)
              }
            }}
            placeholder={
              !chatAvailable
                ? 'Write a note to yourself about this passage…'
                : 'Ask about the passage or share a reflection…'
            }
            aria-label="Write your reflection"
            rows={2}
          />
          <button
            type="submit"
            className={styles.sendButton}
            disabled={sending || !draft.trim()}
            aria-label="Send"
          >
            <SendIcon className={styles.smallIcon} />
          </button>
        </form>
      </div>
    </div>
  )
}
