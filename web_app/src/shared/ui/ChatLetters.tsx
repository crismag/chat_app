import styles from './ChatLetters.module.css'

/*
 * The four letters, and what each one is for.
 *
 * This is the only definition. It was written three times over — on the
 * sign-in page, the welcome page and About — and the copies had already
 * drifted: one of them still described Content as commentary, which is the
 * thing this wording was corrected away from.
 *
 * C's blurb used to say "what the passage is saying, and what is happening
 * around it", which is the commentary framing the section was renamed away
 * from. In roughly thirty real reflections the C section is the verse, usually
 * with its reference and translation, and frequently nothing else; see
 * `docs/examples/REAL_CHAT_SAMPLES.md`. Explanation, where it appears at all,
 * appears under Heart, which is where H's blurb now admits it.
 *
 * The blurbs are modern and short on purpose — four lines somebody reads once,
 * not the method restated. What they must not do is drift from it. The method
 * as it was taught lives in `chat-method.ts` in `@chat/shared`, and two of
 * these lines are shorter renderings of the two clauses it is most easily lost
 * without: that knowledge never applied stays misunderstood, and that Testimony
 * is about the Lord's faithfulness rather than about the writer.
 */
export const CHAT_LETTERS = [
  {
    letter: 'C',
    word: 'Content',
    blurb: 'The passage itself — the verse, its reference and its translation.',
    tone: 'content',
  },
  {
    letter: 'H',
    word: 'Heart',
    blurb: 'What it means to you, and how it touched, convicted or encouraged you.',
    tone: 'heart',
  },
  {
    letter: 'A',
    word: 'Application',
    blurb: 'What you will actually do about it — knowledge never applied stays misunderstood.',
    tone: 'application',
  },
  {
    letter: 'T',
    word: 'Testimony',
    blurb: 'What God has done, and His faithfulness in it — remembered, and worth saying.',
    tone: 'testimony',
  },
] as const

/**
 * The name, in its four colours.
 *
 * Rendered as one heading rather than four, with the punctuation inside the
 * coloured spans, so it is read as "C.H.A.T." and not as four separate
 * letters — and so a person who has used the app recognises it instantly.
 */
export function ChatWordmark({
  as: Tag = 'p',
  size = 'default',
}: {
  as?: 'h1' | 'h2' | 'p'
  size?: 'default' | 'banner'
}) {
  return (
    <Tag className={styles.wordmark} data-size={size}>
      <span className={styles.content}>C.</span>
      <span className={styles.heart}>H.</span>
      <span className={styles.application}>A.</span>
      <span className={styles.testimony}>T.</span>
    </Tag>
  )
}

/**
 * The four, explained.
 *
 * A description list, because that is what it is: four terms and their
 * meanings. `grid` lays them out side by side where there is width for it,
 * which is every page except the sign-in column they were designed in.
 */
export function ChatLetters({ layout = 'list' }: { layout?: 'list' | 'grid' }) {
  return (
    <dl className={styles.letters} data-layout={layout}>
      {CHAT_LETTERS.map(({ letter, word, blurb, tone }) => (
        <div className={styles.letterRow} key={letter}>
          <dt className={`${styles.letterMark} ${styles[tone]}`}>{letter}</dt>
          <dd className={styles.letterBody}>
            <strong className={styles.letterWord}>{word}</strong>
            <span className={styles.letterBlurb}>{blurb}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}
