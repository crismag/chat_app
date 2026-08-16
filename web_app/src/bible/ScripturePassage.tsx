/*
 * The passage a reflection is written against, shown above the writing.
 *
 * Self-contained on purpose: it owns its own loading, its own storage calls and
 * its own error recovery, and the page it sits on only has to hand it a
 * reflection id. That is what lets it be built and tested without touching the
 * page around it.
 *
 * Four promises govern every branch below.
 *
 *   1. **It is source material, not a field.** The text is a `<blockquote>` and
 *      there is no input, no `contentEditable`, no way to type into it. A
 *      publisher's words sitting in a text box invite editing, and edited
 *      Scripture under a copyright notice is a false attribution.
 *   2. **A failed lookup never clears what is already there.** Every failure
 *      path leaves `passage` untouched and puts the problem beside it. Someone
 *      halfway through writing about Romans 8:28 must not lose the verse
 *      because the network dropped, and must not have to wonder whether their
 *      writing went with it — which is why the copy says so out loud.
 *   3. **No translation is ever substituted.** If the chosen one becomes
 *      unreachable, the interface says so and offers a choice. It does not
 *      quietly load a different Bible.
 *   4. **Progress is local and the layout does not move.** The card keeps its
 *      height while a lookup is in flight, so the four sections below do not
 *      jump under a cursor that is already on its way to them.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { TranslationPicker } from './TranslationPicker.tsx'
import {
  BIBLE_OUTCOMES,
  asLookupFailure,
  fetchPassage,
  fetchSavedPassage,
  fetchTranslations,
  passageAsWritten,
  readPreviousTranslationId,
  readRecentTranslationIds,
  rememberTranslationId,
  saveSavedPassage,
  type BiblePassage,
  type BibleTranslation,
  type LookupFailure,
} from './api.ts'
import styles from './ScripturePassage.module.css'

export interface ScripturePassageProps {
  /** The reflection this passage belongs to. Null before one exists. */
  conversationId: string | null
  /**
   * The reference already on the reflection, if any.
   *
   * Used to pre-fill the form — never to trigger a lookup on its own. A
   * component that fetched whenever a prop changed would re-fetch on every
   * keystroke in the page's reference field.
   */
  initialReference?: string
  /**
   * Told when the passage changes, so the page can keep its own reference field
   * in step. Optional: the component is complete without it.
   */
  onPassageChange?: (passage: BiblePassage | null) => void
  /**
   * Offer the passage to the Content section.
   *
   * The C of C.H.A.T. is where the passage goes — that is what roughly thirty
   * real reflections show (`docs/examples/REAL_CHAT_SAMPLES.md`), and it is what
   * makes this connector worth having: choose a passage, and the section can be
   * populated with the text, its reference and its translation, ready for the
   * author to add an explanation if they want one.
   *
   * It hands over TEXT and nothing else. The page decides where it lands and
   * whether existing writing has to be protected first, which keeps the one
   * safe insertion path the rest of the application already uses. Optional: the
   * component is complete without it, and shows no button when it is absent.
   */
  onUsePassage?: (text: string) => void
}

type Phase = 'idle' | 'loading-translations' | 'loading-passage'

/** Does this failure mean the provider is down, rather than the request wrong? */
function isOutage(failure: LookupFailure): boolean {
  return (
    failure.outcome === BIBLE_OUTCOMES.PROVIDER_UNAVAILABLE ||
    failure.outcome === BIBLE_OUTCOMES.TIMEOUT ||
    failure.outcome === BIBLE_OUTCOMES.INVALID_PROVIDER_RESPONSE ||
    failure.outcome === BIBLE_OUTCOMES.RATE_LIMITED
  )
}

export function ScripturePassage({
  conversationId,
  initialReference,
  onPassageChange,
  onUsePassage,
}: ScripturePassageProps) {
  const [translations, setTranslations] = useState<BibleTranslation[] | null>(null)
  const [translationId, setTranslationId] = useState<number | null>(null)
  const [passage, setPassage] = useState<BiblePassage | null>(null)
  const [phase, setPhase] = useState<Phase>('loading-translations')
  const [failure, setFailure] = useState<LookupFailure | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [recentIds, setRecentIds] = useState<number[]>(() => readRecentTranslationIds())
  const [reference, setReference] = useState(initialReference ?? '')

  const formId = useId()
  const referenceId = `${formId}-reference`
  /** The last attempt, so Retry repeats it rather than guessing. */
  const lastAttempt = useRef<{ translationId: number; reference: string } | null>(null)
  /**
   * The passage as it stands, readable from an effect without depending on it.
   *
   * Needed because a passage can be chosen before the reflection it belongs to
   * exists; when the reflection appears, the effect has to be able to see what
   * is already on screen without re-running every time the passage changes.
   */
  const latestPassage = useRef<BiblePassage | null>(null)
  latestPassage.current = passage

  /* ------------------------------------------------------------- loading */

  useEffect(() => {
    let cancelled = false
    setPhase('loading-translations')
    fetchTranslations()
      .then((answer) => {
        if (cancelled) return
        setTranslations(answer.translations)
        /*
         * Previous choice, then the server's default, then the first usable
         * one. The previous choice is honoured only if it is still in the
         * catalog — a translation the key cannot reach must never appear
         * selected, because the reader would believe they were about to get it.
         */
        const previous = readPreviousTranslationId()
        const usable =
          answer.translations.find((entry) => entry.id === previous) ??
          answer.translations.find((entry) => entry.id === answer.defaultTranslationId) ??
          answer.translations[0] ??
          null
        setTranslationId((current) => current ?? usable?.id ?? null)
        setFailure(null)
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(asLookupFailure(error))
      })
      .finally(() => {
        if (!cancelled) setPhase('idle')
      })
    return () => {
      cancelled = true
    }
  }, [])

  /*
   * The saved passage, read once per reflection and never re-fetched.
   *
   * This is what makes an old reflection honest: it shows the exact translation
   * and wording it was written against, straight from storage. Looking it up
   * again "to be fresh" is how a year-old reflection quietly changes Bibles.
   */
  useEffect(() => {
    if (!conversationId) return
    let cancelled = false
    fetchSavedPassage(conversationId)
      .then((answer) => {
        if (cancelled) return
        if (answer.passage) {
          setPassage(answer.passage)
          setTranslationId(answer.passage.translationId)
          setReference(answer.passage.reference)
          return
        }
        /*
         * Nothing stored, but a passage may already be on screen.
         *
         * A reflection does not exist until its author types something, so
         * somebody can choose their passage BEFORE there is anything to attach
         * it to. When the reflection appears, the passage they already picked
         * is attached to it — otherwise it would be visible on the page,
         * apparently chosen, and simply not be there on reload.
         */
        const pending = latestPassage.current
        if (pending) void saveSavedPassage(conversationId, pending).catch(() => {})
      })
      .catch(() => {
        /*
         * Silently ignored, and deliberately so. Failing to read a saved
         * passage is not something the writer can act on, and an error banner
         * above someone's reflection every time storage hiccups is noise that
         * teaches them to ignore the banner that matters.
         */
      })
    return () => {
      cancelled = true
    }
  }, [conversationId])

  /* ------------------------------------------------------------- lookup */

  const load = useCallback(
    async (wantedTranslationId: number, wantedReference: string) => {
      lastAttempt.current = { translationId: wantedTranslationId, reference: wantedReference }
      setPhase('loading-passage')
      setFailure(null)
      try {
        const answer = await fetchPassage(wantedTranslationId, wantedReference)
        setPassage(answer.passage)
        setReference(answer.passage.reference)
        setChoosing(false)
        rememberTranslationId(answer.passage.translationId)
        setRecentIds(readRecentTranslationIds())
        onPassageChange?.(answer.passage)
        if (conversationId) {
          /*
           * Saved after it is shown, and a save that fails does not undo the
           * display. The reader has their passage either way; what they would
           * lose is its persistence, and telling them about that in the middle
           * of writing helps nobody.
           */
          await saveSavedPassage(conversationId, answer.passage).catch(() => {})
        }
      } catch (error: unknown) {
        /*
         * The whole of the failure handling, and note what it does NOT do: it
         * does not touch `passage`, it does not touch `translationId`, and it
         * does not clear the reference. Whatever was on screen stays on screen.
         */
        setFailure(asLookupFailure(error))
      } finally {
        setPhase('idle')
      }
    },
    [conversationId, onPassageChange],
  )

  const retry = useCallback(() => {
    const attempt = lastAttempt.current
    if (attempt) void load(attempt.translationId, attempt.reference)
  }, [load])

  /* ------------------------------------------------------------ selector */

  const selected = useMemo(
    () => (translations ?? []).find((entry) => entry.id === translationId) ?? null,
    [translations, translationId],
  )

  /*
   * The passage's own translation may not be in the catalog — the key may have
   * lost access to it since it was written. It is still what the reflection was
   * written against, so its abbreviation comes from the saved passage rather
   * than from the catalog lookup, and it is never silently re-labelled.
   */
  const shownAbbreviation = passage?.abbreviation ?? selected?.abbreviation ?? ''
  const chosenIsUnavailable =
    passage !== null &&
    translations !== null &&
    !translations.some((entry) => entry.id === passage.translationId)

  const busy = phase === 'loading-passage'
  const notConfigured = failure?.outcome === BIBLE_OUTCOMES.NOT_CONFIGURED

  /* --------------------------------------------------------------- render */

  return (
    <section className={styles.card} aria-labelledby={`${formId}-heading`}>
      <div className={styles.head}>
        <h2 className={styles.heading} id={`${formId}-heading`}>
          {passage ? passage.reference : 'Bible passage'}
        </h2>
        {passage ? (
          <span className={styles.badge} title={passage.name}>
            {shownAbbreviation}
          </span>
        ) : null}
        <span className={styles.spacer} />
        {!notConfigured ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-expanded={choosing}
            aria-controls={`${formId}-chooser`}
            onClick={() => setChoosing((open) => !open)}
          >
            {passage ? 'Change passage' : 'Choose a passage'}
          </button>
        ) : null}
      </div>

      {/*
        The progress line has a reserved row of its own, so appearing and
        disappearing costs no layout. `role="status"` announces it without
        stealing focus — a passage arriving must not move a screen reader out
        of the section someone is writing in.
      */}
      <p className={styles.progress} role="status" aria-live="polite">
        {phase === 'loading-translations' ? 'Loading translations…' : null}
        {phase === 'loading-passage' ? 'Looking up the passage…' : null}
      </p>

      {passage ? (
        <>
          {/*
            A blockquote, not a field. Provider source material, visually and
            structurally distinct from anything the person wrote, and with no
            way to type into it.
          */}
          <blockquote className={styles.passage} data-testid="scripture-text">
            {passage.content}
          </blockquote>
          <footer className={styles.attribution}>
            <span className={styles.reference}>
              {passage.reference} ({shownAbbreviation})
            </span>
            {passage.copyright ? (
              <span className={styles.copyright}>{passage.copyright}</span>
            ) : null}
            {passage.links?.publisher || passage.links?.youVersion ? (
              <span className={styles.links}>
                {passage.links?.publisher ? (
                  <a
                    className={styles.link}
                    href={passage.links.publisher}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Publisher
                  </a>
                ) : null}
                {passage.links?.youVersion ? (
                  <a
                    className={styles.link}
                    href={passage.links.youVersion}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Read on YouVersion
                  </a>
                ) : null}
              </span>
            ) : null}
          </footer>
          {/*
            The passage into the section it belongs in.

            An explicit press, never automatic. Choosing a translation to read
            is not the same act as putting words into a reflection, and the page
            this hands to still asks before it displaces anything already
            written there.
          */}
          {onUsePassage ? (
            <div className={styles.useRow}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onUsePassage(passageAsWritten(passage, shownAbbreviation))}
              >
                Add to Content
              </button>
              <span className={styles.useHint}>
                The passage, its reference and its translation — yours to arrange.
              </span>
            </div>
          ) : null}
        </>
      ) : (
        !busy &&
        !notConfigured && (
          <p className={styles.empty}>
            Choose a passage and its words come with it — the text, the reference
            and the translation, ready to put into Content. It stays with this
            reflection in the translation you chose.
          </p>
        )
      )}

      {chosenIsUnavailable ? (
        <p className={styles.notice} role="status">
          {shownAbbreviation} is no longer available to this app. Your reflection
          and its passage have not been changed — choose another translation if
          you would like to load a new passage.
        </p>
      ) : null}

      {failure ? (
        <div className={styles.failure} role="alert">
          <p className={styles.failureText}>{failure.message}</p>
          {isOutage(failure) ? (
            <div className={styles.failureActions}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={retry}>
                Retry
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setChoosing(true)
                  setFailure(null)
                }}
              >
                Choose another translation
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {choosing && !notConfigured ? (
        <form
          id={`${formId}-chooser`}
          className={styles.chooser}
          onSubmit={(event) => {
            event.preventDefault()
            if (translationId !== null) void load(translationId, reference)
          }}
        >
          <div className={styles.field}>
            <label className={styles.label} htmlFor={referenceId}>
              Passage
            </label>
            <input
              id={referenceId}
              className={styles.input}
              value={reference}
              placeholder="John 3:16-18"
              aria-describedby={`${formId}-reference-hint`}
              onChange={(event) => setReference(event.target.value)}
            />
            <span className={styles.hint} id={`${formId}-reference-hint`}>
              One to three verses reads best — for example John 3:16 or Psalm 23:1-3.
            </span>
          </div>

          <TranslationPicker
            translations={translations ?? []}
            value={translationId}
            onChange={setTranslationId}
            recentIds={recentIds}
          />

          <div className={styles.chooserActions}>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={busy || translationId === null || reference.trim() === ''}
            >
              {busy ? 'Looking up…' : 'Load passage'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setChoosing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  )
}
