/*
 * Who is asking, when there may be nobody.
 *
 * The application used to answer one question — is this a signed-in user? —
 * and refuse everything else. That is the login wall: a visitor cannot write
 * anything until they have an account, so they must decide whether to trust
 * the product before they have used it.
 *
 * An owner is the smaller thing that question was standing in for. It is who a
 * reflection belongs to, and it exists from the first write, cookie-bound and
 * anonymous. Signing in attaches an account to it; nothing else about it
 * changes.
 *
 * Ownership is proved server-side on every request. The cookie carries an
 * identifier, and an identifier is not an assertion: it is looked up, and a
 * value naming an owner that does not exist is nobody rather than an error.
 */

import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import { isNativeWebViewOrigin } from '../http/origins.ts';
import type { SqliteStore, StoredOwner } from '../db.ts';
import type { MemoryStore } from '../store.ts';

export const OWNER_COOKIE = 'chat_owner';

/**
 * How long an unclaimed anonymous owner lasts.
 *
 * Long enough that somebody who writes something, closes the tab and comes
 * back next month still has it. Claimed owners have no expiry at all — that is
 * cleared the moment an account is attached.
 */
export const ANONYMOUS_OWNER_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The same flags as the session cookie, for the same reasons.
 *
 * This value is a bearer credential: whoever holds it owns those reflections,
 * because there is no account to check it against. So it is HttpOnly — script
 * on the page has no business reading it — and Secure in production.
 */
export function ownerCookieOptions(
  origin: string | undefined,
  env: NodeJS.Dict<string> = process.env,
): CookieOptions {
  const native = isNativeWebViewOrigin(origin);
  return {
    httpOnly: true,
    path: '/',
    maxAge: Math.floor(ANONYMOUS_OWNER_TTL_MS / 1000),
    sameSite: native ? 'None' : 'Lax',
    secure: native || env.NODE_ENV === 'production',
  };
}

type Store = MemoryStore | SqliteStore;

/** The owner named by the cookie, if it names one that exists. */
export function ownerFromCookie(c: Context, store: Store): StoredOwner | null {
  const id = getCookie(c, OWNER_COOKIE);
  if (!id) return null;
  const owner = store.owners.get(id);
  if (!owner) return null;
  if (owner.expiresAt && owner.expiresAt < new Date().toISOString()) return null;
  return owner;
}

/**
 * The owner for an account, made if this is the first time.
 *
 * Every signed-in person has exactly one, which is what makes "my reflections"
 * a single question rather than a union of sessions.
 */
export function ownerForUser(store: Store, userId: string): StoredOwner {
  return store.owners.forUser(userId) ?? store.owners.createForUser(userId);
}

/**
 * Who owns what this request is about to write.
 *
 * A signed-in person owns it as themselves. Anyone else owns it anonymously,
 * and the cookie is set here — on the first write rather than on the first
 * page view, so merely looking at the site does not hand out an identifier.
 */
export function ownerForWrite(c: Context, store: Store, user: { id: string } | null): StoredOwner {
  if (user) return ownerForUser(store, user.id);
  const existing = ownerFromCookie(c, store);
  if (existing) return existing;
  const owner = store.owners.createAnonymous(
    new Date(Date.now() + ANONYMOUS_OWNER_TTL_MS).toISOString(),
  );
  setCookie(c, OWNER_COOKIE, owner.id, ownerCookieOptions(c.req.header('origin')));
  return owner;
}

/**
 * Who owns what this request is reading, without creating anybody.
 *
 * A read must never mint an owner: a crawler fetching a public page would
 * otherwise leave a row behind, and so would every request that turns out to
 * be for something the visitor cannot see anyway.
 */
export function ownerForRead(c: Context, store: Store, user: { id: string } | null): StoredOwner | null {
  if (user) return store.owners.forUser(user.id) ?? null;
  return ownerFromCookie(c, store);
}
