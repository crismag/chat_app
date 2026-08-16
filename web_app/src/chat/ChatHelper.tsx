import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AI_ACTIONS, AI_CHAT_NOTE_ONLY_MESSAGE, type AiAction, type ChatFormat } from '@chat/shared'
import { SendIcon } from '../shared/ui/icons.tsx'
import { ORIGIN_CLASSES, ORIGIN_LABELS, fieldsFor } from './sections.ts'
import type { FieldType, Message, Proposal } from './types.ts'
import styles from './ChatPage.module.css'

const helperActions: { id: AiAction; label: string }[] = [
  { id: AI_ACTIONS.EXPLAIN, label: 'Explain this passage' },
  { id: AI_ACTIONS.POLISH, label: 'Polish' },
  { id: AI_ACTIONS.SHORTEN, label: 'Shorten' },
  { id: AI_ACTIONS.SUMMARIZE, label: 'Summarize' },
]

/**
 * The conversation — a tool for working on the artifact, not the artifact.
 *
 * It is where thinking is done out loud: talk a section through, ask for a
 * shorter wording, then take the result back to the section it came from. Both
 * directions of that link are controls, not conventions.
 *
 * It is a *bounded* conversation, not a chatbot that happens to be here. What
 * it will discuss is this passage, these four sections and the C.H.A.T.
 * framework — and when it declines something else it does so warmly, because a
 * person asking for help with something else has done nothing wrong.
 *
 * When no provider can answer, the composer does not disappear and does not
 * pretend. Messages are still written down, the panel says they are notes to
 * self, and the reflection carries on being written. Nothing here is ever
 * load-bearing for the manual workflow.
 */
export function ChatHelper({
  format,
  messages,
  draft,
  sending,
  discussing,
  proposal,
  busyAction,
  onDraft,
  onSend,
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
}: {
  format: ChatFormat
  messages: Message[]
  draft: string
  sending: boolean
  discussing: FieldType | null
  proposal: Proposal | null
  busyAction: AiAction | null
  onDraft: (value: string) => void
  onSend: (event: FormEvent) => void
  onAction: (action: AiAction) => void
  onUseInField: (field: FieldType, content: string, origin: string) => void
  onStopDiscussing: () => void
  onDismissProposal: () => void
  composerRef: React.RefObject<HTMLTextAreaElement | null>
  /** A reply is in flight. Separate from `sending`, which is already over. */
  replying: boolean
  chatError: string | null
  chatAvailable: boolean
  chatNotice: string
  onDismissChatError: () => void
}) {
  const listRef = useRef<HTMLOListElement>(null)
  const [offering, setOffering] = useState<string | null>(null)
  const fields = fieldsFor(format)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  const discussedName = discussing
    ? (fields.find((meta) => meta.type === discussing)?.name ?? discussing)
    : null

  return (
    <div className={styles.helperInner}>
      <div className={styles.helperHead}>
        <h2 className={styles.helperTitle}>Reflection chat</h2>
        <p className={styles.helperNote}>
          {chatAvailable
            ? 'Talk this passage and your sections through. Nothing said here changes your C.H.A.T. until you put it there.'
            : 'Think it through here. Nothing said here changes your C.H.A.T. until you put it there.'}
        </p>
        {/*
          Said plainly rather than left to be inferred from silence. A composer
          that accepts messages and never answers looks broken; a composer that
          says it is a notebook is a notebook.
        */}
        {!chatAvailable ? (
          <p className={styles.helperNoteOnly} role="status">
            {AI_CHAT_NOTE_ONLY_MESSAGE}
          </p>
        ) : null}
      </div>

      {discussedName ? (
        <p className={styles.discussingBanner}>
          <span>
            Working on <strong>{discussedName}</strong>
          </span>
          <button type="button" className={styles.linkButton} onClick={onStopDiscussing}>
            Stop
          </button>
        </p>
      ) : null}

      {messages.length === 0 ? (
        <div className={styles.helperEmpty}>
          <p className={styles.helperEmptyLead}>
            What passage are you reflecting on today?
          </p>
          <p className={styles.helperEmptyBody}>
            Write what you are seeing, or what it stirred. Your C.H.A.T. appears beside
            this as soon as there is something to shape.
          </p>
        </div>
      ) : (
        <ol className={styles.messages} ref={listRef}>
          {messages.map((message) => (
            <li key={message.id} className={styles.message} data-role={message.role}>
              {/*
                Whose words these are, said in words rather than only in
                alignment or colour. A reply that could be mistaken for
                something the author wrote is the one mistake this thread
                cannot afford to allow.
              */}
              <p className={styles.messageWho}>
                {message.role === 'user' ? 'You' : 'C.H.A.T. assistant'}
                {message.role === 'assistant' ? (
                  <span className={`badge ${ORIGIN_CLASSES[message.authorOrigin] ?? 'badge-ai-generated'}`}>
                    {ORIGIN_LABELS[message.authorOrigin] ?? message.authorOrigin}
                  </span>
                ) : null}
              </p>
              <p className={styles.messageBody}>{message.content}</p>

              {/*
                The way back. Anything in the thread can be carried into a
                field of the artifact, and it arrives carrying where it came
                from — the author's own words stay theirs, assisted wording
                says so.
              */}
              <div className={styles.messageActions}>
                <button
                  type="button"
                  className={styles.linkButton}
                  aria-expanded={offering === message.id}
                  onClick={() => setOffering(offering === message.id ? null : message.id)}
                >
                  Use in…
                </button>
                {offering === message.id ? (
                  <span className={styles.useMenu} role="group" aria-label="Put this into a section">
                    {fields.map((meta) => (
                      <button
                        key={meta.type}
                        type="button"
                        className={styles.useChoice}
                        onClick={() => {
                          onUseInField(meta.type, message.content, message.authorOrigin)
                          setOffering(null)
                        }}
                      >
                        {meta.name}
                      </button>
                    ))}
                  </span>
                ) : null}
              </div>
            </li>
          ))}

          {/*
            A reply on its way, in the thread rather than over it, so the place
            it will appear is the place that says it is coming.
          */}
          {replying ? (
            <li
              className={styles.message}
              data-role="assistant"
              /*
               * Marked as a placeholder, not merely styled like one. Anything
               * reading the thread — a test, a script, an assistive technology
               * walking the list — has to be able to tell a reply that exists
               * from one that is still on its way.
               */
              data-pending="true"
              aria-live="polite"
            >
              <p className={styles.messageWho}>C.H.A.T. assistant</p>
              <p className={styles.messagePending}>Thinking about this with you…</p>
            </li>
          ) : null}
        </ol>
      )}

      {/*
        One caveat under the thread rather than one under every reply. Repeated
        on each message it would become furniture nobody reads.
      */}
      {chatAvailable && messages.some((message) => message.role === 'assistant') ? (
        <p className={styles.chatNotice}>{chatNotice}</p>
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

      <div className={styles.composerWrap}>
        {messages.length > 0 ? (
          <div className={styles.contextualActions}>
            {helperActions.map((action) => (
              <button
                key={action.id}
                type="button"
                className={styles.chip}
                disabled={busyAction !== null}
                onClick={() => onAction(action.id)}
              >
                {busyAction === action.id ? `${action.label}…` : action.label}
              </button>
            ))}
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
              discussedName
                ? `Talk through ${discussedName}…`
                : !chatAvailable
                  ? 'Write a note to yourself about this passage…'
                  : messages.length > 0
                    ? 'Keep going…'
                    : 'Write what you are seeing in the passage, or what it stirred.'
            }
            aria-label="Write your reflection"
            rows={2}
          />
          <button
            type="submit"
            className="btn btn-primary"
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
