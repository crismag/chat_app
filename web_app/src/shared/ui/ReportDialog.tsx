import { useEffect, useId, useRef, useState } from 'react'
import styles from './ReportDialog.module.css'

export type ReportReason = { id: string; label: string }

/*
 * Reporting, asked properly.
 *
 * It used to be a row of reason buttons where one press sent the report. That
 * is quick, and quick is wrong here: a report is an allegation about another
 * person made in a moment of irritation, and the moment between choosing a
 * reason and pressing Submit is worth having.
 *
 * Three things this deliberately does not do.
 *
 * It does not offer a category for disagreement — no "false teaching", no
 * "wrong interpretation", no denomination. People here write about Scripture,
 * and strong disagreement about what a passage means is the ordinary substance
 * of that rather than an infraction. A report button that offered to settle it
 * would turn moderation into a doctrinal court.
 *
 * It does not ask what should happen to the author. The reporter describes the
 * problem; deciding the consequence is somebody else's job, and asking a
 * person in the middle of being upset to choose a punishment is asking the
 * wrong question of the wrong person.
 *
 * And it does not promise removal. "Report received" is the truth; "we will
 * remove this" is a promise made before anybody has looked.
 *
 * ── One dialog, two things to report ────────────────────────────────────────
 *
 * Reflections and profiles were reported through two different components: a
 * modal here and a form inside the profile page, with their own wording, their
 * own failure handling and their own idea of when Submit should be allowed.
 * Reporting somebody is exactly the interaction that should not vary by where
 * you happened to be standing, so the words are parameters and the behaviour
 * is not.
 */
export function ReportDialog({
  title,
  lead,
  reasons,
  notePlaceholder,
  isSubmittable,
  onClose,
  onSubmit,
}: {
  title: string
  lead: string
  reasons: ReportReason[]
  /** What the free-text box invites, given the chosen reason. */
  notePlaceholder?: (reason: string | null) => string
  /**
   * Whether Submit may be pressed. Defaults to "a reason, and a sentence when
   * the reason is Something else" — the rule both surfaces already wanted.
   * Community passes its own so its reason ids stay an allowlist.
   */
  isSubmittable?: (reason: string, note: string) => boolean
  onClose: () => void
  /** May resolve with what to say instead of the default confirmation. */
  onSubmit: (reason: string, note: string) => Promise<string | void>
}) {
  const [reason, setReason] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  /*
   * A failure that can be tried again, said out loud.
   *
   * Submitting used to be `.then(setSent).finally(clearBusy)` with no catch:
   * a refused or dropped request left the dialog exactly as it was, the button
   * enabled again, and nothing on screen to say why nothing happened — plus an
   * unhandled rejection in the console. The reason and the sentence somebody
   * typed are deliberately untouched here, because asking them to write it
   * twice is the one thing a failed submit must not do.
   */
  const [problem, setProblem] = useState<string | null>(null)
  const headingId = useId()
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submittable =
    reason !== null &&
    (isSubmittable
      ? isSubmittable(reason, note)
      : reason !== 'other' || note.trim().length >= 10)

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(event) => event.stopPropagation()}
      >
        {sent !== null ? (
          <>
            <h2 className={styles.title} id={headingId}>
              Report received.
            </h2>
            <p className={styles.lead}>{sent}</p>
            <div className={styles.actions}>
              <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className={styles.title} id={headingId}>
              {title}
            </h2>
            <p className={styles.lead}>{lead}</p>

            <fieldset className={styles.reasons}>
              <legend className="sr-only">Choose a reason</legend>
              {reasons.map((option, index) => (
                <label key={option.id} className={styles.reason}>
                  <input
                    ref={index === 0 ? firstRef : undefined}
                    type="radio"
                    name="report-reason"
                    value={option.id}
                    checked={reason === option.id}
                    onChange={() => setReason(option.id)}
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>

            <label className="label" htmlFor="report-note">
              Tell us more{reason === 'other' ? '' : ' (optional)'}
            </label>
            <textarea
              id="report-note"
              className="input"
              rows={3}
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                notePlaceholder?.(reason) ??
                'Anything that would help somebody understand the problem.'
              }
            />
            {problem ? (
              <p className={styles.hint} role="alert">
                {problem}
              </p>
            ) : null}

            {reason === 'other' && !submittable ? (
              <p className={styles.hint}>
                “Something else” needs a sentence — otherwise nobody can act on it.
              </p>
            ) : null}

            {/*
              Not asked: what should happen to this person. The reporter says
              what is wrong; the consequence is somebody else's decision.
            */}
            <div className={styles.actions}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!submittable || busy}
                onClick={() => {
                  if (!reason) return
                  setBusy(true)
                  setProblem(null)
                  void onSubmit(reason, note)
                    .then((message) =>
                      setSent(
                        message ??
                          'Thanks for helping keep the community useful and respectful. Somebody will look at it.',
                      ),
                    )
                    .catch((caught: unknown) => {
                      setProblem(
                        caught instanceof Error && caught.message
                          ? caught.message
                          : 'That could not be sent. Your report is still here — try again.',
                      )
                    })
                    .finally(() => setBusy(false))
                }}
              >
                {busy ? 'Sending…' : problem ? 'Try again' : 'Submit report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
