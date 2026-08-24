/*
 * Messaging limits and constants.
 *
 * Bodies are refused rather than clipped. A cooldown after decline is the
 * whole of V1 anti-spam — not a reputation system.
 */

export const MESSAGE_BODY_MAX = 4_000;
export const DECLINE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const MESSAGE_CHANGE_WINDOW_MS = 15 * 60 * 1000;
export const PARENT_BODY_MAX = 240;
export const MESSAGE_PAGE_DEFAULT = 50;
export const MESSAGE_PAGE_MAX = 100;
export const SEARCH_LIMIT = 50;
export const PIN_LIMIT = 3;
export const REACTION_EMOJIS = ['❤', '🙏', '👍', '✅'] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

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

export function parseReactionEmoji(
  value: unknown,
): { ok: true; emoji: ReactionEmoji } | { ok: false; error: string } {
  if (typeof value !== 'string' || !REACTION_EMOJIS.includes(value as ReactionEmoji)) {
    return { ok: false, error: 'That reaction is not available.' };
  }
  return { ok: true, emoji: value as ReactionEmoji };
}

export function changeWindowOpen(createdAt: string, nowMs: number = Date.now()): boolean {
  return nowMs - Date.parse(createdAt) <= MESSAGE_CHANGE_WINDOW_MS;
}

export function truncateParentBody(body: string): string {
  if (body.length <= PARENT_BODY_MAX) return body;
  return `${body.slice(0, PARENT_BODY_MAX).trimEnd()}…`;
}

export function likeFragment(needle: string): string {
  return needle.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function pageLimit(value: string | undefined): number {
  if (!value) return MESSAGE_PAGE_DEFAULT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return MESSAGE_PAGE_DEFAULT;
  return Math.min(parsed, MESSAGE_PAGE_MAX);
}

export function isMuted(mutedUntil: string | null, nowMs: number = Date.now()): boolean {
  if (!mutedUntil) return false;
  return Date.parse(mutedUntil) > nowMs;
}
