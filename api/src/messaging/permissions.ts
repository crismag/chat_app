/*
 * Messaging permission decisions in one place.
 *
 * Routes call these instead of repeating block/contact/preference checks.
 * The browser never sends isContact / isOwner / senderUserId as authority.
 */

export type BlockLookup = {
  isBlocked(blockerUserId: string, blockedUserId: string): boolean;
};

export function blockedEitherWay(blocks: BlockLookup, a: string, b: string): boolean {
  return blocks.isBlocked(a, b) || blocks.isBlocked(b, a);
}

export function canMessageDirectly(input: {
  actorId: string;
  otherId: string;
  areContacts: boolean;
  blocks: BlockLookup;
}): boolean {
  if (input.actorId === input.otherId) return false;
  if (blockedEitherWay(input.blocks, input.actorId, input.otherId)) return false;
  return input.areContacts;
}

export function canCreateMessageRequest(input: {
  actorId: string;
  otherId: string;
  areContacts: boolean;
  allowNonContactRequests: boolean;
  cooldownActive: boolean;
  blocks: BlockLookup;
}): { ok: true } | { ok: false; status: 400 | 403 | 429; error: string } {
  if (input.actorId === input.otherId) {
    return { ok: false, status: 400, error: 'You cannot message yourself.' };
  }
  if (blockedEitherWay(input.blocks, input.actorId, input.otherId)) {
    return { ok: false, status: 403, error: 'You cannot message this person.' };
  }
  if (input.areContacts) return { ok: true };
  if (input.cooldownActive) {
    return { ok: false, status: 429, error: 'Wait before sending another request.' };
  }
  if (!input.allowNonContactRequests) {
    return {
      ok: false,
      status: 403,
      error: 'This person is not accepting message requests.',
    };
  }
  return { ok: true };
}
