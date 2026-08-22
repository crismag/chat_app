import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { api } from '../shared/api/client.ts'
import styles from './ProfilePanels.module.css'

/*
 * The owner-only sections of a profile: communities, encouragements.
 *
 * Each fetches when it is opened rather than with the page. Four of the five
 * sections are never looked at in a given visit, and loading all of them to
 * render one is how a profile page ends up making five requests to show a
 * name.
 */

/** One shape for every "nothing here yet", so the sections agree with each other. */
export function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.empty}>
      <h3 className={styles.emptyTitle}>{title}</h3>
      <p className={styles.emptyBody}>{children}</p>
    </section>
  )
}

function useOwnedList<T>(path: string, pick: (body: never) => T[]) {
  const [items, setItems] = useState<T[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    setFailed(false)
    api<never>(path)
      .then((body) => {
        if (live) setItems(pick(body))
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
    /* `pick` is a literal at every call site; the path is what identifies the read. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  return { items, failed }
}

type Community = {
  id: string
  name: string
  description: string
  role: string
  memberCount: number
  closed: boolean
}

export function CommunitiesPanel() {
  const { items, failed } = useOwnedList<Community>(
    '/communities',
    (body: never) => (body as { communities: Community[] }).communities,
  )

  if (failed) return <Empty title="That could not be loaded">Please try again in a moment.</Empty>
  if (!items) return <p className={styles.loading}>Loading…</p>
  if (items.length === 0) {
    return (
      <Empty title="You are not in a community yet">
        A community is a small group who read each other&rsquo;s reflections. You can{' '}
        <Link to="/community">start or join one</Link>.
      </Empty>
    )
  }

  return (
    <ul className={styles.list}>
      {items.map((community) => (
        <li key={community.id} className={styles.row}>
          {/*
            One address, because there is one Community page: it opens on the
            group a person picks. Linking to a `/community/<id>` that does not
            exist would be a tab full of 404s.
          */}
          <Link className={styles.rowLink} to="/community">
            <span className={styles.rowTitle}>{community.name}</span>
            {community.description ? (
              <span className={styles.rowBody}>{community.description}</span>
            ) : null}
            <span className={styles.rowMeta}>
              {/*
                A role and a size, which is what tells somebody what this
                group is to them. Not a rank and not a score.
              */}
              {community.role === 'OWNER' ? 'You started this' : 'Member'}
              <span aria-hidden="true"> · </span>
              {community.memberCount === 1 ? '1 member' : `${community.memberCount} members`}
              {community.closed ? (
                <>
                  <span aria-hidden="true"> · </span>Closed
                </>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

type Publication = {
  id: string
  title: string
  scriptureReference: string | null
  author: { handle: string; displayName: string }
}

export function EncouragedPanel() {
  const { items, failed } = useOwnedList<Publication>(
    '/publications/encouraged',
    (body: never) => (body as { items: Publication[] }).items,
  )

  if (failed) return <Empty title="That could not be loaded">Please try again in a moment.</Empty>
  if (!items) return <p className={styles.loading}>Loading…</p>
  if (items.length === 0) {
    return (
      <Empty title="You have not encouraged anything yet">
        When a reflection in <Link to="/community">Community</Link> speaks to you, encouraging it
        tells the person who wrote it. What you encourage is kept here, for you.
      </Empty>
    )
  }

  return (
    <ul className={styles.list}>
      {items.map((publication) => (
        <li key={publication.id} className={styles.row}>
          <Link className={styles.rowLink} to={`/community/publications/${publication.id}`}>
            <span className={styles.rowTitle}>{publication.title}</span>
            <span className={styles.rowMeta}>
              {publication.author.displayName}
              {publication.scriptureReference ? (
                <>
                  <span aria-hidden="true"> · </span>
                  {publication.scriptureReference}
                </>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
