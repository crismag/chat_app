/*
 * People waiting on a decision, shown to whoever may make it.
 *
 * Approving is not moderation dressed up: it decides who is in a space where
 * everything shared is readable by members, so it defaults to the owner and
 * admins. A community may open that to every member — `canDecideJoins` is
 * what the pages ask — and this component only renders when somebody is
 * actually waiting.
 */

import { useCallback, useEffect, useState } from 'react'
import { AuthorLink } from '../shared/ui/AuthorLink.tsx'
import { decideJoinRequest, fetchJoinRequests } from './api.ts'
import styles from './CommunityPage.module.css'

export function JoinRequests({
  communityId,
  headingLevel = 'h4',
  onNotice,
  onError,
  onChanged,
}: {
  communityId: string
  headingLevel?: 'h2' | 'h4'
  onNotice: (message: string) => void
  onError: (caught: unknown) => void
  onChanged?: () => void
}) {
  const [requests, setRequests] = useState<
    Awaited<ReturnType<typeof fetchJoinRequests>>['requests']
  >([])

  const refresh = useCallback(() => {
    void fetchJoinRequests(communityId)
      .then((found) => setRequests(found.requests))
      /* Not permitted to see them is not an error worth showing anybody. */
      .catch(() => setRequests([]))
  }, [communityId])

  useEffect(refresh, [refresh])

  if (requests.length === 0) return null

  const Heading = headingLevel

  return (
    <div className={styles.joinRequests}>
      <Heading className={styles.joinRequestsHeading}>
        {requests.length === 1
          ? 'One person is asking to join'
          : `${requests.length} people are asking to join`}
      </Heading>
      <ul className={styles.joinRequestList}>
        {requests.map((request) => (
          <li key={request.userId} className={styles.joinRequestRow}>
            <AuthorLink
              className={styles.author}
              author={{
                handle: request.handle ?? '',
                displayName: request.displayName ?? request.handle ?? 'A C.H.A.T. writer',
              }}
            />
            <span className={styles.joinRequestActions}>
              {(['approve', 'decline'] as const).map((decision) => (
                <button
                  key={decision}
                  type="button"
                  className={
                    decision === 'approve' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'
                  }
                  onClick={() => {
                    void decideJoinRequest(communityId, request.userId, decision)
                      .then(() => {
                        onNotice(
                          decision === 'approve'
                            ? 'They are in.'
                            : 'Declined. They can ask again later.',
                        )
                        refresh()
                        onChanged?.()
                      })
                      .catch(onError)
                  }}
                >
                  {decision === 'approve' ? 'Approve' : 'Decline'}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
