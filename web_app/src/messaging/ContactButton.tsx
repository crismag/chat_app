import { useState } from 'react'
import { addContact, removeContact } from './api.ts'
import styles from './ContactButton.module.css'

/*
 * Add somebody to your contacts, or take them out again.
 *
 * ── What a contact is here ──────────────────────────────────────────────────
 *
 * Your own address book, and nothing more mutual than that. Adding somebody
 * needs nothing from them, tells them nothing, and does not put you in their
 * list. What it does is let them write to you later without their message
 * joining a queue — so it widens what they may do and narrows nothing.
 *
 * That is why this is one press with no confirmation and no pending state to
 * wait through: there is no other person on the far side of it agreeing to
 * anything. It is closer to a bookmark than to a friend request, and the copy
 * says "In contacts" rather than "Friends" for exactly that reason.
 *
 * ── Optimistic, and honest when it fails ────────────────────────────────────
 *
 * The button flips immediately, because the alternative is a spinner on a
 * bookmark. A failure puts it back where it was and says so once — silently
 * reverting would leave somebody sure they had added a person they had not.
 */
export function ContactButton({
  handle,
  isContact,
  onChanged,
  size = 'small',
}: {
  handle: string
  isContact: boolean
  onChanged: (isContact: boolean) => void
  size?: 'small' | 'medium'
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    if (busy) return
    const next = !isContact
    setBusy(true)
    setError(null)
    onChanged(next)
    try {
      if (next) await addContact(handle)
      else await removeContact(handle)
    } catch (caught: unknown) {
      onChanged(!next)
      setError(
        caught instanceof Error ? caught.message : 'That did not work. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={isContact ? `btn btn-ghost btn-${size}` : `btn btn-secondary btn-${size}`}
        aria-pressed={isContact}
        onClick={() => void toggle()}
      >
        {isContact ? 'In contacts' : 'Add to contacts'}
      </button>
      {error ? (
        <span className={styles.error} role="status">
          {error}
        </span>
      ) : null}
    </span>
  )
}
