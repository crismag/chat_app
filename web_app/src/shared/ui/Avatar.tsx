import { useEffect, useState } from 'react'

import { resolveApiPath } from '../api/client.ts'
import styles from './Avatar.module.css'

/*
 * One face for a person, wherever they appear.
 *
 * Four places were each deriving their own initial and their own circle — the
 * profile page, the account menu, a community card and a publication — which
 * is how the same person ends up looking like three different people as you
 * move through the application.
 *
 * There is no empty state. Somebody without a picture gets a generated one
 * rather than a broken image or a grey silhouette: a silhouette says "no
 * person", and every one of these belongs to a person who has written
 * something. The generated form is deterministic, so it does not change
 * between screens, between sessions, or when the page re-renders.
 */

/**
 * The four section colours, reused as identity.
 *
 * A hue from this product rather than a random one: the palette is already
 * what C.H.A.T. looks like, so a generated avatar belongs to the application
 * instead of looking like a placeholder from somewhere else.
 */
const TONES = ['content', 'heart', 'application', 'testimony'] as const

/**
 * Pick a tone from a key, stably.
 *
 * Any hash would do; what matters is that it depends only on the key, so the
 * same person is the same colour on every screen and after every deploy.
 */
function toneFor(key: string): (typeof TONES)[number] {
  let hash = 0
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0
  }
  return TONES[Math.abs(hash) % TONES.length] ?? 'content'
}

/**
 * One or two letters, from what the person is actually called.
 *
 * Two words give two initials; anything else gives one. Deliberately not
 * three or more — at 32px they stop being letters and become texture.
 */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = [...(words[0] ?? '')][0] ?? ''
  const second = words.length > 1 ? ([...(words.at(-1) ?? '')][0] ?? '') : ''
  return (first + second).toUpperCase() || '?'
}

export function Avatar({
  name,
  /** A stable key for the colour — a handle or id, so a rename keeps the face. */
  identity,
  src,
  size = 'medium',
  className,
}: {
  name: string
  identity?: string
  /** A custom picture, when there is one. */
  src?: string | null
  size?: 'small' | 'medium' | 'large'
  className?: string
}) {
  const label = name.trim() || 'This person'

  /*
   * A picture that fails to load becomes the generated face rather than a
   * broken image icon. Stored pictures outlive the pages that point at them —
   * a removed avatar, an expired cache, a request that simply failed — and the
   * one thing a person must never see where their face should be is a torn
   * page. Keyed on `src` so replacing a picture clears a previous failure.
   */
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])

  if (src && !failed) {
    return (
      <img
        className={`${styles.avatar} ${styles[size]} ${className ?? ''}`}
        /*
         * `src` is a path the server built, rooted at the API's own domain —
         * resolved against it here rather than passed through, or a browser
         * loads it against the page's origin instead wherever the two
         * differ. See `resolveApiPath` for the failure this avoids: not an
         * error anywhere, just this face quietly falling back to initials.
         */
        src={resolveApiPath(src)}
        /*
         * Empty, and deliberately. The picture repeats the name that is almost
         * always beside it, and a screen reader announcing "photo of Ada,
         * Ada" is worse than one that skips straight to the name.
         */
        alt=""
        width={64}
        height={64}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <span
      className={`${styles.avatar} ${styles[size]} ${styles.generated} ${className ?? ''}`}
      data-tone={toneFor(identity ?? label)}
      /*
       * A picture of somebody, so it is announced as one. The initials alone
       * would be read letter by letter, which tells nobody anything.
       */
      role="img"
      aria-label={label}
    >
      <span aria-hidden="true">{initialsFor(label)}</span>
    </span>
  )
}
