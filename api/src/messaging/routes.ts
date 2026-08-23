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
import { SlidingWindowRateLimiter } from '../ai/rate-limit.ts';
import type { AuthUser } from '../auth/store.ts';
import { MIN_SEARCH_LENGTH, type ProfileStore, type StoredProfile } from '../profile/store.ts';
import { parseMessageBody } from './limits.ts';
import { blockedEitherWay, canCreateMessageRequest } from './permissions.ts';
import { waitingFor } from './waiting.ts';
import {
  fallbackPerson,
  type MessagingPerson,
  type MessagingStore,
} from './store.ts';

export type MessagingRouteOptions = {
  currentUser: (c: Context) => Promise<Pick<AuthUser, 'id' | 'emailVerified'> | null>;
  store: MessagingStore;
  profiles: ProfileStore;
};

const SIGN_IN = { error: 'Sign in to use Messages.' };
const NOT_FOUND = { error: 'Not found.' };

/*
 * Confirm the address before writing to a stranger.
 *
 * The same rule publishing keeps, for the same reason: this is where words
 * arrive in front of somebody who did not go looking for them, and an account
 * opened with a mailbox nobody can read is the one an abuser opens. Reading a
 * message, accepting a request and declining one all stay open — being unable
 * to answer a message somebody sent you would be a strange punishment for not
 * having clicked a link yet.
 */
const CONFIRM_FIRST = {
  error:
    'Confirm your email address before sending messages. We have sent a link to it; ask for another from your account if it has expired.',
  needsEmailVerification: true,
};

/*
 * How much one person may send.
 *
 * Two windows, because there are two different abuses. A minute-long window on
 * messages catches a flood into a conversation somebody is already in. A
 * day-long window on *new* conversations catches the one that matters more —
 * reaching many strangers — and is deliberately far tighter, because a person
 * starting twenty conversations with people who have never heard from them is
 * not doing what this feature is for.
 *
 * Generous for a real exchange either way: nobody having a conversation sends
 * thirty messages in a minute, and nobody honest opens ten a day.
 */
const MESSAGES_PER_MINUTE = 30;
const NEW_CONVERSATIONS_PER_DAY = 10;

/*
 * Finding somebody to write to.
 *
 * ── Why this route exists ──────────────────────────────────────────────────
 *
 * Messaging shipped with exactly one way to begin: the Message button on
 * somebody's profile. Nothing in the application linked to another person's
 * profile, so in practice a conversation could only be started by typing a
 * handle into the address bar. This is the other half of the repair.
 *
 * ── What it is careful about ───────────────────────────────────────────────
 *
 * Every profile it can return is already readable by anyone at
 * `/profile/<handle>`. What is new is not visibility but *enumerability*, and
 * that is the thing worth bounding: two characters minimum so the query has to
 * be about somebody, ten results so it is an answer rather than a page of a
 * directory, and a per-caller ceiling so it cannot be walked. Somebody who has
 * never opened a profile is not in it at all.
 *
 * A confirmed address is required, as sending is. Searching is only ever the
 * first half of writing to a stranger, and an unconfirmed account harvesting
 * names it is not allowed to write to is the shape of the abuse the
 * confirmation rule exists to stop.
 */
const PEOPLE_LIMIT = 10;
const SEARCHES_PER_MINUTE = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

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

  /* Per sender, not per address: an account is the person, and cannot be rotated. */
  const sendLimiter = new SlidingWindowRateLimiter(MESSAGES_PER_MINUTE);
  const openLimiter = new SlidingWindowRateLimiter(NEW_CONVERSATIONS_PER_DAY, Date.now, DAY_MS);
  const searchLimiter = new SlidingWindowRateLimiter(SEARCHES_PER_MINUTE);

  const refused = (c: Context, retryAfterSeconds: number, error: string) => {
    c.header('Retry-After', String(retryAfterSeconds));
    return c.json({ error, retryAfterSeconds }, 429);
  };

  const lookup = (userId: string) => personFromProfile(profiles.byUserId(userId), userId);

  const actorOf = async (c: Context) => currentUser(c);

  /*
   * How much is waiting, for the badge on the Messages icon.
   *
   * Answers 200 with zeros for a signed-out or unverified visitor rather than
   * 401 or 403. Every page in the shell asks this, most of them belonging to
   * people who are not signed in; an error would be the correct status and
   * would put a red line in the console of somebody who has simply not signed
   * in yet. Nothing is disclosed by "you have nothing waiting".
   */
  app.get('/waiting', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json({ messages: 0, requests: 0, total: 0 });
    return c.json(waitingFor(store, actor.id, lookup));
  });

  app.get('/threads', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json(SIGN_IN, 401);
    return c.json({ items: store.listChats(actor.id, lookup) });
  });

  app.get('/people', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json(SIGN_IN, 401);
    if (actor.emailVerified === false) return c.json(CONFIRM_FIRST, 403);

    const query = (c.req.query('q') ?? '').trim();
    /*
     * Too short is an empty answer, not a refusal. The box is typed into one
     * character at a time, and an error appearing on the first keystroke and
     * vanishing on the second is noise about nothing.
     */
    if (query.length < MIN_SEARCH_LENGTH) return c.json({ items: [] });

    const decision = searchLimiter.take(actor.id);
    if (!decision.allowed) {
      return refused(c, decision.retryAfterSeconds, 'You are searching very fast. Take a moment.');
    }

    /*
     * Asked for more than are returned, because three kinds of match are
     * dropped after the store has found them and the caller should still get a
     * full page when there is one.
     */
    const found = profiles.search(query, PEOPLE_LIMIT * 4);
    const items = found
      .filter((profile) => profile.userId !== actor.id)
      .filter((profile) => !blockedEitherWay(profiles, actor.id, profile.userId))
      /*
       * Somebody who is not taking requests from strangers is left out unless
       * they are already a contact. Listing them would offer a person who
       * cannot be written to — the refusal comes at `/open` either way, so
       * this hides nothing that trying would not reveal, and it stops the
       * search from being a list of doors that do not open.
       */
      .filter(
        (profile) =>
          /*
           * `(them, me)` — has this person put me in *their* contacts? That is
           * what decides whether writing to them reaches them without asking,
           * so it is what decides whether listing them offers a door that
           * opens. My own list is my address book and grants me nothing.
           */
          store.areContacts(profile.userId, actor.id) ||
          store.preferences(profile.userId).allowNonContactRequests,
      )
      .slice(0, PEOPLE_LIMIT)
      .map((profile) => personFromProfile(profile, profile.userId));

    return c.json({ items });
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

    if (actor.emailVerified === false) return c.json(CONFIRM_FIRST, 403);

    /*
     * `(target, actor)` — has the person being written to put me in their
     * contacts? A contact list is not reciprocal, so the list that decides
     * whether I may skip their request queue is theirs, not mine. Asking it
     * the other way round would let anybody grant themselves the right to
     * write to a stranger by adding that stranger to their own address book.
     */
    const mayWriteDirectly = store.areContacts(target.userId, actor.id);
    const allowed = canCreateMessageRequest({
      actorId: actor.id,
      otherId: target.userId,
      areContacts: mayWriteDirectly,
      allowNonContactRequests: store.preferences(target.userId).allowNonContactRequests,
      cooldownActive: store.cooldownActive(actor.id, target.userId),
      blocks: profiles,
    });
    if (!allowed.ok) return c.json({ error: allowed.error }, allowed.status);

    /*
     * Only a *new* conversation is counted. Reopening one that already exists
     * is navigation — somebody returning to a thread they are already in —
     * and charging for it would put a daily cap on reading your own messages.
     */
    const existed = store.hasDirectThread(actor.id, target.userId);
    if (!mayWriteDirectly && !existed) {
      const decision = openLimiter.take(actor.id);
      if (!decision.allowed) {
        return refused(
          c,
          decision.retryAfterSeconds,
          'That is a lot of new conversations today. Try again tomorrow.',
        );
      }
    }

    const thread = store.openDirect(actor.id, target.userId, lookup);
    /*
     * A request is what a *first* approach is. Reopening a conversation that
     * already exists must never make one — it would put a thread somebody is
     * already in back behind a door they have already opened.
     */
    if (!mayWriteDirectly && !existed) {
      store.createPendingRequest(actor.id, target.userId, thread.id);
    }
    /*
     * Writing to somebody puts them in my contacts. It is my own list, it says
     * only that I have spoken to this person, and it is what lets them write
     * back without joining a queue — which is the least somebody deserves for
     * having been written to first.
     */
    store.addContactFor(actor.id, target.userId);
    const fresh = store.getThread(actor.id, thread.id, lookup);
    return c.json({ thread: fresh ?? thread }, 201);
  });

  app.get('/contacts', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json(SIGN_IN, 401);
    return c.json({ items: store.listContacts(actor.id, lookup) });
  });

  /*
   * Add somebody to my own contacts, from anywhere their profile can be seen.
   *
   * ── Why this needs no permission from them ──────────────────────────────
   *
   * Because it grants me nothing. The list is an address book: it is read to
   * decide who may write to *me* without asking, so adding somebody widens
   * what they may do and narrows nothing for them. That is why it takes only a
   * public handle and why there is no request, no acceptance and no notice — a
   * person who has been added has been given something, and telling them would
   * be telling them about a list of mine that is not their business.
   *
   * A block is the exception, and it is checked both ways round: adding is
   * harmless but the row would sit there implying a relationship that one of
   * the two has explicitly ended.
   */
  app.post('/contacts', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json(SIGN_IN, 401);
    const body = (await c.req.json().catch(() => ({}))) as { handle?: unknown };
    if (typeof body.handle !== 'string' || !body.handle.trim()) {
      return c.json({ error: 'A profile handle is required.' }, 400);
    }
    const target = profiles.byHandle(body.handle.trim());
    if (!target) return c.json({ error: 'There is no profile at that handle.' }, 404);
    if (target.userId === actor.id) {
      return c.json({ error: 'You are already yourself.' }, 400);
    }
    if (blockedEitherWay(profiles, actor.id, target.userId)) {
      return c.json({ error: 'You cannot add this person.' }, 403);
    }
    store.addContactFor(actor.id, target.userId);
    return c.json({ ok: true, isContact: true });
  });

  /* Out of my own list. Theirs is untouched, and they are not told. */
  app.delete('/contacts/:handle', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json(SIGN_IN, 401);
    const target = profiles.byHandle(c.req.param('handle'));
    if (!target) return c.json({ error: 'There is no profile at that handle.' }, 404);
    store.removeContactFor(actor.id, target.userId);
    return c.json({ ok: true, isContact: false });
  });

  /*
   * Where one person stands with another, for a profile page to draw a button.
   *
   * `isContact` is about the asker's own list. `theyHaveMe` is deliberately not
   * returned: whether somebody has added me is a fact about their address book,
   * and answering it would turn a private list into something anybody could
   * enumerate one handle at a time.
   */
  app.get('/contacts/:handle', async (c) => {
    const actor = await actorOf(c);
    if (!actor) return c.json({ isContact: false, isSelf: false });
    const target = profiles.byHandle(c.req.param('handle'));
    if (!target) return c.json({ error: 'There is no profile at that handle.' }, 404);
    return c.json({
      isContact: store.areContacts(actor.id, target.userId),
      isSelf: target.userId === actor.id,
    });
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
    if (actor.emailVerified === false) return c.json(CONFIRM_FIRST, 403);

    const decision = sendLimiter.take(actor.id);
    if (!decision.allowed) {
      return refused(c, decision.retryAfterSeconds, 'You are sending very fast. Take a moment.');
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
