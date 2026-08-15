import styles from './PlaceholderPage.module.css'

type PlaceholderPageProps = {
  title: string
  summary: string
  phase: string
}

export function PlaceholderPage({
  title,
  summary,
  phase,
}: PlaceholderPageProps) {
  return (
    <section className={styles.page} aria-labelledby="page-title">
      <p className={styles.kicker}>Coming later</p>
      <h1 id="page-title">{title}</h1>
      <p className={styles.summary}>{summary}</p>
      <p className={styles.note}>
        This area is not implemented yet. It is planned for {phase}. The
        navigation is here so the product shell can be used on phone and desktop
        widths while the first vertical slices are built.
      </p>
    </section>
  )
}
