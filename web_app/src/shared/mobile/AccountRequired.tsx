import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'
import { isGuest } from '@chat/shared'
import { useAuth } from '../../auth/useAuth.ts'
import { Sheet } from './Sheet.tsx'
import styles from './PageMenu.module.css'

/*
 * What to say when something needs an account.
 *
 * Said before the attempt rather than after it. A control that looks available,
 * is pressed, and then produces an error has spent somebody's attention to
 * tell them something it knew before they touched it — and the error it
 * produced used to be a 401, which the interface rendered as "you are no
 * longer signed in" to a person who was signed in as a guest, looking at their
 * own avatar.
 *
 * The controls stay visible. Hiding them would make the product look smaller
 * than it is and leave nothing to explain; what changes is that pressing one
 * explains instead of failing.
 *
 * This is guidance and not a boundary. The server still refuses these actions
 * with ACCOUNT_REQUIRED, and nothing here is load-bearing for authorisation —
 * if this component vanished, the rules would be exactly as enforced.
 */
export function useAccountRequired(): {
  /** True when the person cannot do account-only things. */
  needsAccount: boolean
  /**
   * Wrap an action. Returns a handler that runs it for somebody with an
   * account, and explains instead for anybody else.
   */
  guard: (action: () => void) => () => void
  sheet: React.ReactNode
} {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const needsAccount = !user || isGuest(user)

  const guard = useCallback(
    (action: () => void) => () => {
      if (needsAccount) {
        setOpen(true)
        return
      }
      action()
    },
    [needsAccount],
  )

  const sheet = (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      title="Create your profile"
      /*
       * The reassurance is the important half. Somebody with reflections
       * already written needs to know that making an account keeps them —
       * otherwise "create an account" reads as "start again".
       */
      description="Create your profile to encourage and save reflections. Your current reflections will come with you."
    >
      <div className={styles.rows}>
        <button
          type="button"
          className={styles.row}
          onClick={() => {
            setOpen(false)
            void navigate('/login?create=1')
          }}
        >
          Create profile
        </button>
        <button type="button" className={styles.row} onClick={() => setOpen(false)}>
          Not now
        </button>
      </div>
    </Sheet>
  )

  return { needsAccount, guard, sheet }
}
