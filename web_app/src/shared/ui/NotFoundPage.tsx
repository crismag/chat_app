/*
 * What an unknown URL renders.
 *
 * Until now it rendered nothing at all: no header, no navigation, no message —
 * a blank white document. A mistyped or stale link ended the session, with no
 * way back that did not involve editing the address bar.
 *
 * It sits inside the shell rather than replacing it, so the navigation is still
 * there and the way out is the way out of any other page.
 */

import { Link } from 'react-router'
import styles from './NotFoundPage.module.css'

export function NotFoundPage() {
  return (
    <section className={styles.page}>
      <p className="eyebrow">Not found</p>
      <h1 className={styles.title}>This page does not exist</h1>
      <p className={styles.body}>
        The address may have been mistyped, or whatever was here has moved. Your
        reflections are where you left them.
      </p>
      <div className={styles.actions}>
        <Link className="btn btn-primary" to="/">
          Go to Reflect
        </Link>
        <Link className="btn btn-secondary" to="/reflections">
          Open my reflections
        </Link>
      </div>
    </section>
  )
}
