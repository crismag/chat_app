/*
 * Messaging limits and constants.
 *
 * Bodies are refused rather than clipped. A cooldown after decline is the
 * whole of V1 anti-spam — not a reputation system.
 */

export const MESSAGE_BODY_MAX = 4_000;
export const DECLINE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const THREAD_KINDS = {
  DIRECT: 'direct',
} as const;

export type ThreadKind = (typeof THREAD_KINDS)[keyof typeof THREAD_KINDS];

export const REQUEST_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
} as const;

export type RequestStatus = (typeof REQUEST_STATUS)[keyof typeof REQUEST_STATUS];

export const MEMBER_ROLES = {
  OWNER: 'owner',
  MEMBER: 'member',
} as const;

/** Canonical A↔B key so A→B and B→A are one direct thread. */
export function directPairKey(userA: string, userB: string): string {
  return userA < userB ? `${userA}:${userB}` : `${userB}:${userA}`;
}

export function parseMessageBody(value: unknown): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof value !== 'string') return { ok: false, error: 'Message must be text.' };
  const body = value.trim();
  if (!body) return { ok: false, error: 'Write something before sending.' };
  if (body.length > MESSAGE_BODY_MAX) {
    return {
      ok: false,
      error: `A message can be at most ${MESSAGE_BODY_MAX} characters.`,
    };
  }
  return { ok: true, body };
}
