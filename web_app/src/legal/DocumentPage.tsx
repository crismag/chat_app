import type { ReactNode } from 'react'
import { Link } from 'react-router'
import styles from './DocumentPage.module.css'

/**
 * The shell every standalone document shares.
 *
 * It carries the way back, the heading and the date, so a page only has to
 * supply what it says. `updated` is required rather than optional: a policy
 * with no date cannot be checked for currency by the person relying on it.
 */
export function DocumentPage({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: ReactNode
}) {
  return (
    <main className={styles.page} id="main">
      <header className={styles.header}>
        <Link className={styles.back} to="/about">
          ← Back to About
        </Link>
        <h1>{title}</h1>
        <p className={styles.updated}>Last updated {updated}</p>
      </header>
      <div className={styles.body}>{children}</div>
    </main>
  )
}

/**
 * Where the words go, until they arrive.
 *
 * Deliberately conspicuous. A legal page that ships with plausible-sounding
 * filler is worse than one that ships obviously empty: the filler reads as
 * policy, nobody goes back for it, and the product ends up making promises
 * nobody wrote.
 */
export function ContentPending({ page }: { page: string }) {
  return (
    <p className={styles.pending} role="status">
      The {page} text has not been written yet. This page is routed and
      reachable so the address can be registered, but it must not be published
      as policy until the wording is supplied.
    </p>
  )
}
