import { Link } from 'react-router'
import { CHAT_ANCHOR, CHAT_FLOW, CHAT_METHOD, CHAT_TAGLINE } from '@chat/shared'
import { ChatWordmark } from '../shared/ui/ChatLetters.tsx'
import styles from './MethodPage.module.css'

/*
 * The method itself, as it was taught, on a page of its own.
 *
 * Everywhere else the four letters appear they appear in short form: four
 * blurbs on About and /welcome, one line of prompt on each card in the editor.
 * That is right for those places and wrong as the only account of the method —
 * somebody who wants to know what Testimony is *for*, or why Application comes
 * with a warning attached, had nowhere to read it.
 *
 * This is a rendering of the original page rather than a picture of it. The
 * text is the same text; setting it as markup is what makes it selectable,
 * searchable, translatable, readable by a screen reader, correct in all eight
 * themes and legible at 200% text — none of which a scan of a notebook page
 * would be. The page is the artwork's content, not a substitute frame around
 * it: if the original image is ever added to the repository it belongs at the
 * top of this page, above the same words.
 *
 * Outside the shell, like About and the documents: no account, and none asked
 * for. The method is not a feature of the product.
 */
export function MethodPage() {
  return (
    <div className={styles.page}>
      <main className={styles.inner} id="main">
        <header className={styles.banner}>
          <Link className={styles.back} to="/about">
            ← About
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
