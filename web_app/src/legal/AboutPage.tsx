import { Link } from 'react-router'
import { LEGAL_PAGES } from './pages.ts'
import styles from './DocumentPage.module.css'

/**
 * About, and the only page that links to the legal documents.
 *
 * Keeping them here rather than in a footer on every screen is a deliberate
 * choice: the writing surfaces stay free of furniture, and there is one place
 * a person — or a reviewer — can be sent to find all four.
 */
export function AboutPage() {
  return (
    <main className={styles.page} id="main">
      <header className={styles.header}>
        <Link className={styles.back} to="/">
          ← Back to C.H.A.T.
        </Link>
        <h1>About C.H.A.T.</h1>
        <p className={styles.updated}>Content · Heart · Application · Testimony</p>
      </header>

      <div className={styles.body}>
        <p>
          C.H.A.T. is a private-first place to talk through Scripture, keep what
          you write, and turn it into something you can look at again. Every
          reflection is private unless you choose to publish that one.
        </p>

        <h2>Policies and help</h2>
        <ul className={styles.links}>
          {LEGAL_PAGES.map(({ slug, title, summary }) => (
            <li className={styles.linkRow} key={slug}>
              <Link to={`/${slug}`}>{title}</Link>
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
      </div>
    </main>
  )
}
