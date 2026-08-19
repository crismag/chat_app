import { Link } from 'react-router'
import { Markdown, parseDocument } from './markdown.tsx'
import { LEGAL_PAGES, type LegalPageSlug } from './pages.ts'
import styles from './DocumentPage.module.css'

/**
 * Every document links to the others.
 *
 * The markdown arrived with a hand-written line of names at the foot of each
 * file — a different set on every one, and none of them links. This replaces
 * all four with the same real navigation, so a reader can reach any document
 * from any other and none of them can fall out of step with the routes.
 */
function DocumentNav({ current }: { current: LegalPageSlug }) {
  return (
    <nav className={styles.docNav} aria-label="Policies">
      {LEGAL_PAGES.filter(({ slug }) => slug !== current).map(({ slug, label }) => (
        <Link key={slug} to={`/${slug}`}>
          {label}
        </Link>
      ))}
      <Link to="/about">About</Link>
      <Link to="/welcome">Welcome</Link>
      <Link to="/">Back to Reflections</Link>
    </nav>
  )
}

/**
 * A document, rendered from its markdown.
 *
 * The title and date come out of the file rather than being kept beside it,
 * because a page heading that disagrees with the document it is showing is
 * worse than no heading.
 */
export function DocumentPage({ slug }: { slug: LegalPageSlug }) {
  const page = LEGAL_PAGES.find((entry) => entry.slug === slug)!
  const parsed = page.markdown ? parseDocument(page.markdown) : null

  return (
    <main className={styles.page} id="main">
      <header className={styles.header}>
        <Link className={styles.back} to="/about">
          ← Back to About
        </Link>
        <h1>{parsed?.title || page.label}</h1>
        {parsed?.updated ? (
          <p className={styles.updated}>Last updated {parsed.updated}</p>
        ) : null}
      </header>

      {/*
        Not finished, and it says so on the page rather than in a comment.
        The check is the text itself: while the document still carries a
        square-bracket placeholder — an operator's legal name, a contact
        address, a governing jurisdiction — this appears. Filling them in is
        what removes it; nobody has to remember to flip a flag.
      */}
      {parsed && parsed.placeholders.length > 0 ? (
        <p className={styles.pending} role="status">
          This document is not final. It still has to be completed:{' '}
          {parsed.placeholders.map((item) => `[${item}]`).join(', ')}.
        </p>
      ) : null}

      <div className={styles.body}>
        {parsed ? (
          <Markdown markdown={parsed.body} />
        ) : (
          <p className={styles.pending} role="status">
            The {page.label} page has not been written yet. It is reachable so
            the address can be registered, but it must not be relied on until
            the wording is supplied.
          </p>
        )}
      </div>

      <DocumentNav current={slug} />
    </main>
  )
}
