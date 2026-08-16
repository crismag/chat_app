import { Link } from 'react-router'
import { SOFTWARE_NOTICES } from './notices.ts'
import styles from './OpenSourceLicencesPage.module.css'

/** Production, offline-capable third-party notice surface. */
export function OpenSourceLicencesPage() {
  return (
    <main className={styles.page} id="main">
      <header className={styles.header}>
        <Link to="/">← Back to C.H.A.T.</Link>
        <p className="eyebrow">About</p>
        <h1>Open Source Licences</h1>
        <p>
          C.H.A.T. includes the software listed below. These notices are bundled with the app and remain available without a network connection.
        </p>
      </header>
      <div className={styles.list}>
        {SOFTWARE_NOTICES.map((notice) => (
          <article className={styles.notice} key={`${notice.packageName}@${notice.version}`}>
            <h2>{notice.name}</h2>
            <p><code>{notice.packageName}@${notice.version}</code> · {notice.license}</p>
            {notice.copyright.map((line) => <p key={line}>{line}</p>)}
            <pre>{notice.licenseText}</pre>
          </article>
        ))}
      </div>
    </main>
  )
}
