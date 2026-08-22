/*
 * Messaging HTTP surface. Registered accounts only.
 *
 *   GET    /api/messaging/threads
 *   POST   /api/messaging/open            { handle }
 *   GET    /api/messaging/threads/:id
 *   GET    /api/messaging/threads/:id/messages?after=
 *   POST   /api/messaging/threads/:id/messages
 *   POST   /api/messaging/threads/:id/read
 *   GET    /api/messaging/contacts
 *   GET    /api/messaging/requests
 *   POST   /api/messaging/requests/:id/accept
 *   POST   /api/messaging/requests/:id/decline
 *   POST   /api/messaging/requests/:id/block
 *   GET    /api/messaging/preferences
 *   PATCH  /api/messaging/preferences
 *
 * Groups are not mounted in V1.
 *
 * Actor identity comes from registeredUser. A guest and a visitor get the same
 * 401 — messaging is not a guest surface, and needsAccount would offer a guest
 * account that still could not use it.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AuthUser } from '../auth/store.ts';
import type { ProfileStore, StoredProfile } from '../profile/store.ts';
import { parseMessageBody } from './limits.ts';
import { blockedEitherWay, canCreateMessageRequest } from './permissions.ts';
import {
  fallbackPerson,
  type MessagingPerson,
  type MessagingStore,
} from './store.ts';

export type MessagingRouteOptions = {
  currentUser: (c: Context) => Promise<Pick<AuthUser, 'id'> | null>;
  store: MessagingStore;
  profiles: ProfileStore;
};

const SIGN_IN = { error: 'Sign in to use Messages.' };
const NOT_FOUND = { error: 'Not found.' };

function avatarUrl(profile: StoredProfile): string | null {
  if (!profile.avatarUpdatedAt) return null;
  const stamp = encodeURIComponent(profile.avatarUpdatedAt);
  return `/api/profiles/${encodeURIComponent(profile.handle)}/avatar?v=${stamp}`;
}

function personFromProfile(profile: StoredProfile | null, userId: string): MessagingPerson {
  if (!profile) return fallbackPerson(userId);
  return {
    id: profile.userId,
    handle: profile.handle,
    displayName: profile.displayName,
    avatarUrl: avatarUrl(profile),
  };
}

export function createMessagingRoutes({ currentUser, store, profiles }: MessagingRouteOptions) {
  const app = new Hono();

  const lookup = (userId: string) => personFromProfile(profiles.byUserId(userId), userId);

  const actorOf = async (c: Context) => currentUser(c);

  app.get('/threads', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json(SIGN_IN, 401);
    return c.json({ items: store.listChats(actor.id, lookup) });
  });

  app.post('/open', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json(SIGN_IN, 401);
    const body = (await c.req.json().catch(() => ({}))) as { handle?: unknown };
    if (typeof body.handle !== 'string' || !body.handle.trim()) {
      return c.json({ error: 'A profile handle is required.' }, 400);
    }
    const target = profiles.byHandle(body.handle.trim());
    if (!target) return c.json({ error: 'There is no profile at that handle.' }, 404);
    if (target.userId === actor.id) {
      return c.json({ error: 'You cannot message yourself.' }, 400);
    }

    const areContacts = store.areContacts(actor.id, target.userId);
    const allowed = canCreateMessageRequest({
      actorId: actor.id,
      otherId: target.userId,
      areContacts,
      allowNonContactRequests: store.preferences(target.userId).allowNonContactRequests,
      cooldownActive: store.cooldownActive(actor.id, target.userId),
      blocks: profiles,
    });
    if (!allowed.ok) return c.json({ error: allowed.error }, allowed.status);

    const thread = store.openDirect(actor.id, target.userId, lookup);
    if (!areContacts) {
      store.createPendingRequest(actor.id, target.userId, thread.id);
    }
    const fresh = store.getThread(actor.id, thread.id, lookup);
    return c.json({ thread: fresh ?? thread }, 201);
  });

  app.get('/contacts', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json(SIGN_IN, 401);
    return c.json({ items: store.listContacts(actor.id, lookup) });
  });

  app.get('/requests', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json(SIGN_IN, 401);
    return c.json({ items: store.listIncomingRequests(actor.id, lookup) });
  });

  app.get('/preferences', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json(SIGN_IN, 401);
    return c.json(store.preferences(actor.id));
  });

  app.patch('/preferences', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json(SIGN_IN, 401);
    const body = (await c.req.json().catch(() => ({}))) as { allowNonContactRequests?: unknown };
    if (typeof body.allowNonContactRequests !== 'boolean') {
      return c.json({ error: 'allowNonContactRequests must be true or false.' }, 400);
    }
    return c.json(store.setAllowNonContactRequests(actor.id, body.allowNonContactRequests));
  });

  app.post('/requests/:requestId/accept', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json(SIGN_IN, 401);
    const thread = store.acceptRequest(actor.id, c.req.param('requestId'), lookup);
    if (!thread) return c.json(NOT_FOUND, 404);
    return c.json(thread);
  });

  app.post('/requests/:requestId/decline', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json(SIGN_IN, 401);
    if (!store.declineRequest(actor.id, c.req.param('requestId'))) return c.json(NOT_FOUND, 404);
    return c.json({ ok: true });
  });

  app.post('/requests/:requestId/block', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json(SIGN_IN, 401);
    const items = store.listIncomingRequests(actor.id, lookup);
    const request = items.find((item) => item.id === c.req.param('requestId'));
    if (!request) return c.json(NOT_FOUND, 404);
    store.declineRequest(actor.id, request.id);
    profiles.setBlocked(actor.id, request.sender.id, true);
    return c.json({ ok: true });
  });

  app.get('/threads/:threadId/messages', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json(SIGN_IN, 401);
    const after = c.req.query('after') ?? undefined;
    const items = store.listMessages(actor.id, c.req.param('threadId'), after);
    if (!items) return c.json(NOT_FOUND, 404);
    return c.json({ items });
  });

  app.post('/threads/:threadId/messages', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json(SIGN_IN, 401);
    const parsed = parseMessageBody((await c.req.json().catch(() => ({})) as { body?: unknown }).body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const threadId = c.req.param('threadId');
    const otherId = store.otherMemberId(threadId, actor.id);
    if (!otherId || !store.isMember(threadId, actor.id)) return c.json(NOT_FOUND, 404);
    if (blockedEitherWay(profiles, actor.id, otherId)) {
      return c.json({ error: 'You cannot message this person.' }, 403);
    }
    const sent = store.sendMessage(actor.id, threadId, parsed.body);
    if (sent === 'forbidden') {
      return c.json({ error: 'Accept this request before replying.' }, 403);
    }
    if (!sent) return c.json(NOT_FOUND, 404);
    return c.json(sent, 201);
  });

  app.post('/threads/:threadId/read', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json(SIGN_IN, 401);
    const body = (await c.req.json().catch(() => ({}))) as { lastReadMessageId?: unknown };
    if (typeof body.lastReadMessageId !== 'string') {
      return c.json({ error: 'lastReadMessageId is required.' }, 400);
    }
    if (!store.markRead(actor.id, c.req.param('threadId'), body.lastReadMessageId)) {
      return c.json(NOT_FOUND, 404);
    }
    return c.json({ ok: true });
  });

  app.get('/threads/:threadId', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json(SIGN_IN, 401);
    const thread = store.getThread(actor.id, c.req.param('threadId'), lookup);
    if (!thread) return c.json(NOT_FOUND, 404);
    return c.json(thread);
  });

  return app;
}
