import { isMuted } from './limits.ts';
import type { MessagingStore, PersonLookup } from './store.ts';

/*
 * How much is waiting for one person, for the badge on the Messages icon.
 *
 * ── Why this counts by asking the store the same questions the page asks ────
 *
 * The obvious implementation is one SQL sum over unread messages plus one over
 * pending requests. It is wrong, and wrong in a way nobody would notice until a
 * badge said 2 when there was one thing to look at.
 *
 * A first message from somebody who is not a contact creates **both** an unread
 * message and a pending request, for the same event. The Messages page already
 * knows this: `listChats` skips any thread with a pending incoming request,
 * because that thread belongs under Requests instead. Summing the two tables
 * independently double-counts exactly those conversations — which are, by
 * definition, the ones a new user has.
 *
 * So this asks for the two lists the two tabs are built from and counts what is
 * actually in them. The badge is then the number of things a person will find
 * when they open the page, which is the only number that can be right.
 *
 * ── Why the two numbers stay apart ──────────────────────────────────────────
 *
 * `total` is what the badge shows, but messages and requests are returned
 * separately because they are not the same claim. An unread message is from
 * somebody already spoken to; a request is a stranger asking to start. A client
 * that wants to say so can; one that just wants a number has one.
 */

export type Waiting = {
  /** Unread messages in conversations already accepted. */
  messages: number;
  /** People waiting for an answer to a first message. */
  requests: number;
  /** What the badge shows. Never a double count of one conversation. */
  total: number;
};

export function waitingFor(
  store: MessagingStore,
  actorId: string,
  lookup: PersonLookup,
): Waiting {
  const messages = store
    .listChats(actorId, lookup)
    .filter((thread) => !isMuted(thread.mutedUntil))
    .reduce((sum, thread) => sum + thread.unreadCount, 0);
  const requests = store.listIncomingRequests(actorId, lookup).length;
  return { messages, requests, total: messages + requests };
}
