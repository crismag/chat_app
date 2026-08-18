import { Link } from 'react-router'
import styles from './NotFoundPage.module.css'

export function NotFoundPage() {
  return (
    <section className={styles.page} aria-labelledby="not-found-title">
      <p className={styles.kicker}>Not found</p>
      <h1 id="not-found-title">This page is not in C.H.A.T.</h1>
      <p className={styles.summary}>
        The address does not match a reflection, a list, or a tool in this
        application. Nothing was deleted — the link is simply unknown.
      </p>
      <p>
        <Link to="/" className="btn btn-primary">
          Back to Reflect
        </Link>
      </p>
    </section>
  )
}
