import { Link } from 'react-router'
import { ChatLetters, ChatWordmark } from '../shared/ui/ChatLetters.tsx'
import { LEGAL_PAGES } from './pages.ts'
import styles from './WelcomePage.module.css'

/*
 * The front door: what C.H.A.T. is, and everything else worth linking to.
 *
 * It is deliberately NOT the application's home page. `/` opens straight into
 * a blank Content field, because the product's whole claim is that you can
 * write before you have decided anything — and a splash screen in front of
 * that would be a wall by another name, one press deep.
 *
 * So this is a page to be *sent* somewhere: a shared link, a listing, a
 * platform reviewer checking what the thing is and where its policies are
 * before approving a sign-in provider. It carries the banner, the four
 * letters, the promises the product actually keeps, and one place from which
 * every other page can be reached.
 *
 * Outside the shell, like About and the documents, so it needs no account and
 * asks for none.
 */

/*
 * Four claims, each of which the application has to actually keep. Nothing
 * aspirational goes on this list: every line here is a rule enforced in the
 * code, and if one stopped being true it would have to come off the page.
 */
const PROMISES = [
  {
    title: 'Private by default',
    body: 'Every reflection is yours alone. Nothing is shared, published or shown to anyone else unless you choose it, one reflection at a time.',
  },
  {
    title: 'Write before you sign up',
    body: 'No account is needed to start. Continue as a guest and what you write is kept for this browser; create an account later and it comes with you, unchanged.',
  },
  {
    title: 'Scripture, in your translation',
    body: 'Look a passage up while you write, in the translation you read, without leaving what you were writing.',
  },
  {
    title: 'Assistance that only ever suggests',
    body: 'Optional help with questions and wording. It never writes your Heart or your Testimony, and nothing it offers becomes part of your reflection until you accept it.',
  },
]

export function WelcomePage() {
  return (
    <div className={styles.page}>
      <main className={styles.inner} id="main">
        <header className={styles.banner}>
          <ChatWordmark as="h1" size="banner" />
          <p className={styles.lede}>
            Keep the conversation that changed your mind. A private place to reflect on
            Scripture — Content, Heart, Application, Testimony — and keep what you write.
          </p>
          <div className={styles.actions}>
            {/*
              Straight into a blank page, not into a sign-up form. That is the
              product: you can write first and decide about an account after.
            */}
            <Link className="btn btn-primary" to="/">
              Start writing
            </Link>
            <Link className="btn btn-secondary" to="/login">
              Sign in
            </Link>
          </div>
        </header>

        <section aria-labelledby="letters-heading">
          <h2 className="sr-only" id="letters-heading">
            What the four letters mean
          </h2>
          <ChatLetters layout="grid" />
          <p className={styles.methodLink}>
            <Link to="/intro">Read the C.H.A.T. method in full →</Link>
          </p>
        </section>

        <section aria-labelledby="promises-heading">
          <h2 className="sr-only" id="promises-heading">
            What Reflections does
          </h2>
          <ul className={styles.promises}>
            {PROMISES.map(({ title, body }) => (
              <li className={styles.promise} key={title}>
                <span className={styles.promiseTitle}>{title}</span>
                <span className={styles.promiseBody}>{body}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      {/*
        Every other page, from one place.
        A reviewer, or anyone who wants to know what they are agreeing to,
        should not have to hunt: the policies, the disclaimer, the deletion
        route and a way to reach a person are all listed here by name.
      */}
      <footer className={styles.footer}>
        <h2 className={styles.footerTitle}>Policies and help</h2>
        <ul className={styles.links}>
          <li className={styles.linkRow}>
            <Link to="/intro">Intro</Link>
            <span className={styles.linkSummary}>
              The C.H.A.T. method, as it was taught, and the questions that go with each letter.
            </span>
          </li>
          <li className={styles.linkRow}>
            <Link to="/about">About</Link>
            <span className={styles.linkSummary}>
              What Reflections is, who runs it, and how to reach them.
            </span>
          </li>
          {LEGAL_PAGES.map(({ slug, label, summary }) => (
            <li className={styles.linkRow} key={slug}>
              <Link to={`/${slug}`}>{label}</Link>
              <span className={styles.linkSummary}>{summary}</span>
            </li>
          ))}
          <li className={styles.linkRow}>
            <Link to="/open-source-licenses">Open Source Licences</Link>
            <span className={styles.linkSummary}>
              The software C.H.A.T. is built with, and its required notices.
            </span>
          </li>
        </ul>
        <p className={styles.colophon}>
          Reflections is operated by crishub.com. Reading a shared reflection never requires an
          account.
        </p>
      </footer>
    </div>
  )
}
