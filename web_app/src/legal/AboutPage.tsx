import { Link } from 'react-router'
import { ChatLetters, ChatWordmark } from '../shared/ui/ChatLetters.tsx'
import { LEGAL_PAGES } from './pages.ts'
import styles from './DocumentPage.module.css'

/**
 * About, and the page that links to everything else.
 *
 * It used to open with the name set as plain grey text and a line of prose,
 * which is a strange way to introduce something whose entire identity is four
 * coloured letters. The sign-in page had been carrying that introduction on
 * its own — where it is only ever seen by somebody who has already decided to
 * make an account. It is here now, and on /welcome, from one definition.
 *
 * The documents are listed here rather than in a footer on every screen: the
 * writing surfaces stay free of furniture, and there is one place a person —
 * or a platform reviewer — can be sent to find all of them.
 */
export function AboutPage() {
  return (
    <main className={styles.page} id="main">
      <header className={styles.header}>
        <Link className={styles.back} to="/">
          ← Back to C.H.A.T.
        </Link>
        <ChatWordmark as="h1" />
        <p className={styles.updated}>Content · Heart · Application · Testimony</p>
      </header>

      <div className={styles.body}>
        <p>
          Reflections is a private-first place to talk through Scripture, keep what you write,
          and turn it into something you can look at again. Every reflection is private unless
          you choose to share that one.
        </p>

        <h2>What the four letters are</h2>
        <p>
          A C.H.A.T. is one reflection in four parts. They are not a form to be completed in
          order — most people write the ones they have something for and come back to the rest.
        </p>
        <ChatLetters layout="grid" />
        <p>
          <Link to="/intro">Read the method in full</Link> — what each letter is for, in the
          words it was taught in, with the questions that go with it.
        </p>

        <h2>How it works</h2>
        <ul>
          <li>
            <strong>You can write before you sign up.</strong> No account is needed to start.
            Continue as a guest and what you write is kept for this browser; create an account
            later and it comes with you, unchanged — the same reflections, not a copy.
          </li>
          <li>
            <strong>Everything is private by default.</strong> Nothing is shared, published or
            shown to anyone else unless you choose it, one reflection at a time.
          </li>
          <li>
            <strong>Scripture, in your translation.</strong> Look a passage up while you write,
            without leaving what you were writing.
          </li>
          <li>
            <strong>Assistance only ever suggests.</strong> It will not write your Heart or your
            Testimony, and nothing it offers becomes part of your reflection until you accept
            it. You can write without it entirely.
          </li>
        </ul>

        <h2>Policies and help</h2>
        <ul className={styles.links}>
          <li className={styles.linkRow}>
            <Link to="/intro">Intro</Link>
            <span className={styles.linkSummary}>
              The C.H.A.T. method, as it was taught, and the questions that go with each letter.
            </span>
          </li>
          <li className={styles.linkRow}>
            <Link to="/welcome">Welcome</Link>
            <span className={styles.linkSummary}>
              The short version: what C.H.A.T. is, and what it promises.
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

        <p className={styles.colophon}>Reflections is operated by crishub.com.</p>
      </div>
    </main>
  )
}
