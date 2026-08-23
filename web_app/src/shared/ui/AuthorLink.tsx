import { Link } from 'react-router'
import { Avatar } from './Avatar.tsx'

/*
 * Who wrote this, and a way to go and see who they are.
 *
 * The identity line on a shared reflection named its author and stopped there,
 * which made the person the one dead end on a page built for reading other
 * people's work: a name that is not a link is a name you cannot follow. Public
 * profiles already existed at `/profile/:handle` — the route, the page and the
 * endpoint were all in place — and nothing on the Community pages pointed at
 * them.
 *
 * Two things this has to get right, and both are why it is a component rather
 * than a `<Link>` written out at each call site:
 *
 *   - **A handle is optional.** An account that has never chosen one has no
 *     address to link to, and a link to `/profile/` is worse than plain text.
 *     Those authors render exactly as they did before.
 *   - **The card is a stretched link.** `ReflectionCard` lays the title's
 *     `::after` over the whole tile so that anywhere on it opens the
 *     reflection. Anything meant to stay clickable inside it has to be lifted
 *     above that overlay — the same `position: relative; z-index: 1` the
 *     Encourage and Save row already carries. Without it this renders as a
 *     link, reads as a link, and opens the reflection.
 */
export function AuthorLink({
  author,
  className,
  size = 'small',
  showHandle = false,
}: {
  author: { handle: string; displayName: string }
  className?: string
  size?: 'small' | 'medium'
  /** The @handle beside the name, where there is room for it. */
  showHandle?: boolean
}) {
  const handle = author.handle.trim()
  const inner = (
    <>
      <Avatar name={author.displayName} identity={handle || author.displayName} size={size} />
      {author.displayName}
      {showHandle && handle ? <span className="author-handle">@{handle}</span> : null}
    </>
  )

  if (!handle) return <span className={className}>{inner}</span>

  return (
    <Link
      className={className}
      to={`/profile/${handle}`}
      /*
       * The visible name is the label, and it is a person's name — so the
       * accessible name says what following it does. Twenty cards in a feed
       * otherwise read as twenty links whose names are the only difference.
       */
      aria-label={`${author.displayName}’s profile`}
    >
      {inner}
    </Link>
  )
}
