import { useCallback, useEffect, useState } from 'react'

import { api } from '../shared/api/client.ts'
import styles from './SettingsPanel.module.css'

/*
 * Where this account is signed in, and how to stop being signed in there.
 *
 * The question this answers is "I lost my phone" — so the list has to be
 * actionable, and honest about what an entry is. Two deliberate limits:
 *
 *   • No session token reaches this page. An entry is named by a hash; the
 *     value that authenticates never leaves the browser holding it.
 *   • The device facts are the coarse ones recorded at first sight, and an
 *     unknown one says "Unknown device" rather than guessing.
 */

type Session = {
  id: string
  current: boolean
  sessionType: string
  createdAt: string | null
  lastSeenAt: string | null
  platform: string | null
  deviceClass: string | null
  browserFamily: string | null
  osFamily: string | null
}

/** What to call a device, from whatever coarse facts were recorded. */
export function describeDevice(session: Session): string {
  const parts = [session.browserFamily, session.osFamily].filter(Boolean)
  if (parts.length > 0) return parts.join(' on ')
  if (session.deviceClass) return session.deviceClass
  if (session.platform) return session.platform
  /* Nothing was recorded. Say so rather than inventing a device. */
  return 'Unknown device'
}

export function whenSeen(session: Session): string | null {
  const raw = session.lastSeenAt ?? session.createdAt
  if (!raw) return null
  const when = new Date(raw)
  if (Number.isNaN(when.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    when,
  )
}

export function DevicesSection() {
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const body = await api<{ sessions: Session[] }>('/auth/sessions')
      setSessions(body.sessions)
    } catch {
      setSessions([])
      setError('Your devices could not be loaded.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function act(run: () => Promise<unknown>, failure: string) {
    setBusy(true)
    setError(null)
    try {
      await run()
      await load()
    } catch {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }

  const others = (sessions ?? []).filter((session) => !session.current)

  return (
    <section className={styles.group} aria-labelledby="devices-heading">
      <h3 className={styles.legend} id="devices-heading">
        Where you are signed in
      </h3>
      <p className={styles.help}>
        Signing out a device ends its session and forgets it, so it will ask for your password
        again.
      </p>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {sessions === null ? (
        <p className={styles.help}>Loading…</p>
      ) : (
        <ul className={styles.devices}>
          {sessions.map((session) => (
            <li key={session.id} className={styles.device}>
              <span className={styles.choiceText}>
                <span className={styles.choiceName}>
                  {describeDevice(session)}
                  {session.current ? (
                    <span className={styles.here}> · This device</span>
                  ) : null}
                </span>
                {whenSeen(session) ? (
                  <span className={styles.choiceBody}>Last used {whenSeen(session)}</span>
                ) : null}
              </span>
              {session.current ? null : (
                <button
                  type="button"
                  className={styles.action}
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => api(`/auth/sessions/${session.id}`, { method: 'DELETE' }),
                      'That device could not be signed out.',
                    )
                  }
                >
                  {/* Named, so a screen reader hears which of several it is. */}
                  Sign out
                  <span className="sr-only"> {describeDevice(session)}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {others.length > 0 ? (
        <p>
          <button
            type="button"
            className={styles.action}
            disabled={busy}
            onClick={() =>
              void act(
                () => api('/auth/sessions/revoke-others', { method: 'POST' }),
                'Those devices could not be signed out.',
              )
            }
          >
            Sign out everywhere else
          </button>
        </p>
      ) : null}
    </section>
  )
}
