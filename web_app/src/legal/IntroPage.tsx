import { useEffect } from 'react'
import { Link } from 'react-router'
import { CHAT_ANCHOR, CHAT_FLOW, CHAT_METHOD, CHAT_TAGLINE } from '@chat/shared'
import { ChatWordmark } from '../shared/ui/ChatLetters.tsx'
import { markIntroSeen } from './introSeen.ts'
import styles from './IntroPage.module.css'

/*
 * The method itself, as it was taught, on a page of its own — and, for a
 * browser that has never opened Reflections before, the first thing it sees.
 *
 * ── What it is called, and why that changed ─────────────────────────────────
 *
 * This used to be named for what it *contains* — the method — which was right
 * while it was one document among several that About linked to. It no longer
 * only sits at the end of a chain a curious reader follows; it is now also
 * where a brand-new visitor's very first look at the product lands, before
 * they have written anything or decided anything. "Intro" names that role.
 * The content did not change and is not a copy of anything: the method itself
 * is still called the C.H.A.T. method everywhere that phrase describes the
 * four-letter framework rather than this page.
 *
 * ── Why a first-time visitor sees this before Reflect ───────────────────────
 *
 * `/` used to open straight into a blank Content field on every visit,
 * deliberately, so that nobody had to decide whether to trust the product
 * before they had used it — see the note on `RootEntry`. That is still true
 * for a returning browser. What changed is the very first visit: arriving
 * with nothing written and no idea what C.H.A.T. even stands for, and being
 * handed a blank field with no explanation, was not the product being
 * welcoming, it was the product assuming context nobody had yet. This page
 * supplies that context exactly once.
 *
 * `markIntroSeen` fires the moment this page is shown, not only when somebody
 * presses "Start writing". Reaching it at all — by the first-visit redirect
 * from `/`, or later from the header's own way in — is what "seen" means;
 * there is no partial or unread state for a reload or a browser-back to
 * return to.
 *
 * ── Everywhere else it was reached from ─────────────────────────────────────
 *
 * Still readable at any time, by anyone, whether or not this is their first
 * visit: from the header (every screen, every account state), from the
 * account menu, and from About, which is where its only link used to live.
 * `/method` is kept as a redirect here for exactly the address this page used
 * to answer to — a bookmark, a shared link, a platform reviewer's saved URL
 * — none of which should 404 over a rename that is ours to absorb.
 *
 * Outside the shell, like About and the documents: no account, and none asked
 * for. The method is not a feature of the product.
 */
export function IntroPage() {
  useEffect(() => {
    markIntroSeen()
  }, [])

  return (
    <div className={styles.page}>
      <main className={styles.inner} id="main">
        <header className={styles.banner}>
          {/*
            Not "← About" any more. Reached first by a redirect with nothing
            behind it to go back to, a literal back link would be a broken
            promise on the one visit that matters most — so this leaves rather
            than returns, straight to what a first-time visitor came for.
          */}
          <Link className={styles.skip} to="/">
            Skip
          </Link>
          <p className={styles.tagline}>{CHAT_TAGLINE}</p>
          <ChatWordmark as="h1" size="banner" />
          <p className={styles.lede}>
            Four steps, in the words they were taught in. One passage, held long enough to
            change something.
          </p>
        </header>

        <ol className={styles.steps}>
          {CHAT_METHOD.map((step) => (
            <li className={styles.step} data-tone={step.type} key={step.letter}>
              <p className={styles.mark} aria-hidden="true">
                {step.letter}
              </p>
              <div className={styles.stepBody}>
                <h2 className={styles.stepName}>
                  {step.name}
                  <span className={styles.essence}>{step.essence}</span>
                </h2>
                <p className={styles.description}>{step.description}</p>
                {/*
                  The method's own questions, and the same ones the assistant is
                  given as the shape of a good question. Somebody writing
                  without assistance switched on gets exactly what somebody
                  writing with it gets.
                */}
                <ul className={styles.questions}>
                  {step.questions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>

        {/*
          Said plainly, because four cards read as four boxes and this is the
          one thing the letters on their own cannot say: they are in order, and
          each one is only possible because of the one before it.
        */}
        <section aria-labelledby="flow-heading" className={styles.flowSection}>
          <h2 className={styles.flowHeading} id="flow-heading">
            It is one movement
          </h2>
          <ol className={styles.flow}>
            {CHAT_FLOW.map((stage) => (
              <li className={styles.flowStage} key={stage}>
                {stage}
              </li>
            ))}
          </ol>
        </section>

        <figure className={styles.anchor}>
          <blockquote className={styles.anchorText}>{CHAT_ANCHOR.text}</blockquote>
          <figcaption className={styles.anchorRef}>
            {CHAT_ANCHOR.reference} ({CHAT_ANCHOR.translation})
          </figcaption>
        </figure>

        <div className={styles.actions}>
          <Link className="btn btn-primary" to="/">
            Start writing
          </Link>
          <Link className="btn btn-secondary" to="/welcome">
            What Reflections is
          </Link>
        </div>
      </main>
    </div>
  )
}
