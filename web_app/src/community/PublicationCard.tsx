/*
 * A shared C.H.A.T., as a gallery card.
 *
 * ── Why this is not a second card ──────────────────────────────────────────
 *
 * It is `ReflectionCard`, configured. The tile, its consistent height, the
 * three-line clamp, the section colour strip and the C/H/A/T markers all come
 * from there; this file supplies the two regions a publication has and a
 * private reflection does not — an identity line (author · audience · time) and
 * an action row (hashtags · Encouraged · Save · Share · overflow).
 *
 * Two components claiming to be the same card is how a product starts looking
 * like two products, so the shared one grew two optional slots rather than
 * being copied.
 *
 * ── What the card refuses to become ────────────────────────────────────────
 *
 * The tone is a devotional reading feed, not engagement statistics, and several
 * absences here are deliberate:
 *
 *  - **No dislike, downvote, star or score.** Encouraged is the only reaction,
 *    and its count sits at the same weight as the date rather than being the
 *    loudest thing on the card. Nothing sorts by it.
 *  - **Save shows only the reader's own state.** There is no number beside it,
 *    because the payload carries none.
 *  - **Share is absent, not disabled**, on another member's community
 *    publication. A greyed-out button still tells the reader an export exists.
 *  - **No comment affordance**, because comments are not in this phase and the
 *    interface must not display placeholder controls.
 *
 * Metadata stays visually secondary to the reflection: the Scripture reference
 * anchors, the title leads, the section excerpts are the body, and everything
 * else is small.
 */

import { useState } from 'react'
import {
  AUDIENCES,
  CHAT_FORMATS,
  audienceLabel,
  type ChatSectionType,
} from '@chat/shared'
import { ReflectionCard, SECTIONS } from '../shared/ui/ReflectionCard.tsx'
import { GlobeIcon, LockIcon, CommunityIcon } from '../shared/ui/icons.tsx'
import { ReportDialog } from './ReportDialog.tsx'
import type { Publication, ReportReason } from './api.ts'
import styles from './CommunityPage.module.css'

/** The section letters, for the small indicators beside each excerpt. */
const SECTION_LETTER = new Map(SECTIONS.map((section) => [section.type as string, section]))

const CONDENSED_LABELS: Record<string, string> = {
  verse: 'Verse',
  reflection: 'Reflection',
}

function AudienceMark({ publication }: { publication: Publication }) {
  const label = audienceLabel(publication.audience, publication.community?.name)
  const Icon =
    publication.audience === AUDIENCES.PUBLIC
      ? GlobeIcon
      : publication.audience === AUDIENCES.ONLY_ME
        ? LockIcon
        : CommunityIcon

  /*
   * The icon is decorative and the word carries the meaning — privacy is never
   * communicated by colour or by a glyph alone.
   */
  return (
    <span className={styles.audience} data-audience={publication.audience}>
      <Icon className={styles.metaIcon} aria-hidden="true" />
      {label}
    </span>
  )
}

/**
 * One section, shown as a letter and its words.
 *
 * A Condensed C.H.A.T. gets no C/H/A/T indicators — it is a format of its own
 * and not a Full one with sections missing, so showing it against a
 * four-section scale would misdescribe it. It gets its field name instead.
 */
function SectionExcerpt({
  section,
  condensed,
}: {
  section: { type: string; content: string }
  condensed: boolean
}) {
  const meta = SECTION_LETTER.get(section.type)

  return (
    <p className={styles.sectionLine}>
      {condensed ? (
        <span className={styles.condensedLabel}>
          {CONDENSED_LABELS[section.type] ?? section.type}
        </span>
      ) : (
        <span
          className={styles.sectionLetter}
          data-section={section.type}
          /* The marker has an accessible name; the colour is not the message. */
          role="img"
          aria-label={`${meta?.label ?? section.type}:`}
        >
          {meta?.letter ?? '·'}
        </span>
      )}
      <span className={styles.sectionText}>{section.content}</span>
    </p>
  )
}

export function PublicationCard({
  publication,
  now,
  reportReasons,
  onEncourage,
  onSave,
  onReport,
  onAccountRequired,
  onHideForMe,
  onMuteAuthor,
  onHide,
  onShare,
  onDelete,
}: {
  publication: Publication
  now: number
  reportReasons: ReportReason[]
  onEncourage: (next: boolean) => void
  onSave: (next: boolean) => void
  onReport: (reason: string, note: string) => Promise<void>
  /**
   * Explain instead of opening the form, when reporting needs an account.
   *
   * The card does not decide this — the page knows who is reading, and the
   * server is what actually enforces it. Absent means "go ahead".
   */
  onAccountRequired?: (() => void) | null
  /** Out of this reader's sight. Not a report, and nobody is told. */
  onHideForMe: () => void
  onMuteAuthor: () => void
  onHide: (next: boolean) => void
  onShare: () => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [reporting, setReporting] = useState(false)

  const condensed = publication.format === CHAT_FORMATS.CONDENSED
  const written = publication.sections
    .map((section) => section.type)
    .filter((type): type is ChatSectionType => SECTION_LETTER.has(type))

  return (
    <ReflectionCard
      item={{
        id: publication.id,
        title: publication.title,
        scriptureReference: publication.scriptureReference,
        format: publication.format,
        updatedAt: publication.createdAt,
      }}
      now={now}
      href={`/community/publications/${publication.id}`}
      written={written}
      dateLabel="Shared "
      /*
       * The C.H.A.T. progress marker is replaced. On a private reflection "3 of
       * 4" is a workflow state worth seeing; on a publication it would read as
       * a completeness score on someone's shared testimony.
       */
      progress={
        publication.moderationState === 'hidden' ? (
          <span className={styles.hiddenMark}>Hidden from the community</span>
        ) : (
          <span className={styles.formatMark}>
            {condensed ? 'Condensed C.H.A.T.' : 'C.H.A.T.'}
          </span>
        )
      }
      meta={
        <>
          <span className={styles.author}>
            <span className={styles.avatar} aria-hidden="true">
              {publication.author.displayName.trim().charAt(0).toUpperCase() || '?'}
            </span>
            {publication.author.displayName}
          </span>
          <span aria-hidden="true">·</span>
          <AudienceMark publication={publication} />
        </>
      }
      excerpt={
        <>
          {publication.caption ? (
            <p className={styles.caption}>{publication.caption}</p>
          ) : null}
          {publication.sections.slice(0, 2).map((section) => (
            <SectionExcerpt key={section.type} section={section} condensed={condensed} />
          ))}
          {publication.sections.length > 2 ? (
            <span className={styles.continue}>Continue reading</span>
          ) : null}
        </>
      }
      footer={
        <>
          {publication.hashtags.length > 0 ? (
            <p className={styles.hashtags}>
              {publication.hashtags.map((hashtag) => (
                <span key={hashtag.tag} className={styles.hashtag}>
                  #{hashtag.label}
                </span>
              ))}
            </p>
          ) : null}

          <div className={styles.actions}>
            {/*
              One reaction, and it reads as encouragement rather than a score.
              `aria-pressed` is what announces the result of pressing it, which
              the accessibility requirements ask for by name.
            */}
            <button
              type="button"
              className={styles.encourage}
              aria-pressed={publication.encouraged.byViewer}
              onClick={() => onEncourage(!publication.encouraged.byViewer)}
            >
              <span aria-hidden="true">
                {publication.encouraged.byViewer ? '♥' : '♡'}
              </span>
              Encouraged
              {publication.encouraged.count > 0 ? (
                <span className={styles.count}>{publication.encouraged.count}</span>
              ) : null}
            </button>

            {/*
              Visually distinct from Encouraged, and private. No count, because
              the payload has none to show.
            */}
            <button
              type="button"
              className={styles.save}
              aria-pressed={publication.saved}
              onClick={() => onSave(!publication.saved)}
            >
              <span aria-hidden="true">{publication.saved ? '★' : '☆'}</span>
              {publication.saved ? 'Saved' : 'Save'}
            </button>

            {/*
              Rendered only where sharing is permitted. Another member's
              community publication has no share control at all — not a
              disabled one.
            */}
            {publication.canShareExternally ? (
              <button type="button" className={styles.action} onClick={onShare}>
                Share
              </button>
            ) : null}

            <div className={styles.overflow}>
              <button
                type="button"
                className={styles.action}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                onClick={() => setMenuOpen((open) => !open)}
              >
                <span aria-hidden="true">⋯</span>
                <span className="sr-only">More actions for {publication.title}</span>
              </button>

              {menuOpen ? (
                <div className={styles.menu} role="menu">
                  {publication.isAuthor ? (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false)
                          onHide(publication.moderationState !== 'hidden')
                        }}
                      >
                        {publication.moderationState === 'hidden'
                          ? 'Show again'
                          : 'Hide from view'}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false)
                          onDelete()
                        }}
                      >
                        Unshare
                      </button>
                    </>
                  ) : (
                    <>
                      {publication.canModerate ? (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuOpen(false)
                            onHide(publication.moderationState !== 'hidden')
                          }}
                        >
                          {publication.moderationState === 'hidden'
                            ? 'Show to the community'
                            : 'Hide from the community'}
                        </button>
                      ) : null}
                      {/*
                        Two personal controls above the report, on purpose.
                        Most of what somebody wants is not to see a thing
                        again, and that should not have to become a case
                        anybody judges — or a wait for a verdict.
                      */}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false)
                          onHideForMe()
                        }}
                      >
                        Hide this for me
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false)
                          onMuteAuthor()
                        }}
                      >
                        Mute this author
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false)
                          /*
                            Reporting needs an account, and saying so here is
                            cheaper than opening a form, letting somebody
                            choose a reason and write a sentence, and refusing
                            it at the end.
                          */
                          if (onAccountRequired) {
                            onAccountRequired()
                            return
                          }
                          setReporting(true)
                        }}
                      >
                        Report
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {reporting ? (
            <ReportDialog
              reasons={reportReasons}
              onClose={() => setReporting(false)}
              onSubmit={(reason, note) => onReport(reason, note)}
            />
          ) : null}
        </>
      }
    />
  )
}
