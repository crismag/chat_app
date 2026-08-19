/*
 * Who is asking, when they have not signed in and may not have an account.
 *
 * There are three states and the difference between them matters.
 *
 *   A VISITOR has no account. Nothing has been created for them, no row
 *   exists, and no cookie has been set. Reading a shared reflection is done in
 *   this state and must stay that way -- a page view is not a reason to write
 *   anything down about somebody.
 *
 *   A GUEST chose to carry on without signing in. They are a real user with a
 *   real id, and what they write belongs to them exactly as it would to
 *   anybody else. They exist because they asked to, at the moment they first
 *   tried to keep something.
 *
 *   A REGISTERED user signed in, or was a guest and added an email and a
 *   password to the account they already had.
 *
 * The guest is recognised by a credential and nothing else. Not the address,
 * not the User-Agent, not the screen, not the timezone: no characteristic of
 * the device or the browser is consulted, because recognising somebody by what
 * their machine looks like is recognising somebody who did not agree to be
 * recognised. The credential is a long random value the server generated, and
 * the server holds only its hash -- so what it proves is possession of the
 * cookie, and possession of the cookie is precisely the promise made:
 *
 *   same browser profile + surviving guest credential = same guest.
 *
 * Nothing stronger is claimed. Clearing site data loses the credential and the
 * guest with it; another browser on the same phone is a different guest. Both
 * of those are said plainly in the interface rather than being worked around.
 */

import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import type { AccountCreationContext, DeviceClass } from '@chat/shared';
import { DEVICE_CLASSES } from '@chat/shared';
import { isNativeWebViewOrigin } from '../http/origins.ts';
import type { AuthStore, AuthUser } from './store.ts';

export const GUEST_COOKIE = 'chat_guest';

/**
 * How long a guest credential lasts in the browser.
 *
 * Long, because a guest who writes something, closes the tab and comes back
 * next month should find it there. The account behind it does not expire at
 * all; this is only how long the browser is asked to keep the key to it.
 */
export const GUEST_CREDENTIAL_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The same protections as the session cookie, for the same reason.
 *
 * This value is a bearer credential for everything that guest has written, so:
 * HttpOnly, because no script on the page has any business reading it;
 * SameSite, so another site cannot cause it to be sent; Secure in production,
 * because it must not cross the network in clear text.
 *
 * A native web view is the one exception to SameSite=Lax, and it is also
 * always Secure -- the app talks to the API over https from a different
 * origin, so Lax would drop the cookie entirely.
 */
export function guestCookieOptions(
  origin: string | undefined,
  env: NodeJS.Dict<string> = process.env,
): CookieOptions {
  const native = isNativeWebViewOrigin(origin);
  return {
    httpOnly: true,
    path: '/',
    maxAge: Math.floor(GUEST_CREDENTIAL_TTL_MS / 1000),
    sameSite: native ? 'None' : 'Lax',
    secure: native || env.NODE_ENV === 'production',
  };
}

/**
 * The guest this request carries, if the credential still names one.
 *
 * A credential is not an assertion. It is looked up, and one naming an account
 * that no longer exists -- or that was merged into somebody's real account --
 * is nobody, rather than an error or a reason to make a new guest.
 */
export async function guestFromCookie(c: Context, auth: AuthStore): Promise<AuthUser | null> {
  const credential = getCookie(c, GUEST_COOKIE);
  if (!credential) return null;
  return auth.guestForCredential(credential);
}

/** Put a freshly minted credential where the browser will send it back. */
export function setGuestCookie(c: Context, credential: string): void {
  setCookie(c, GUEST_COOKIE, credential, guestCookieOptions(c.req.header('origin')));
}

/** Used after a merge: the credential names an account that is now retired. */
export function clearGuestCookie(c: Context): void {
  deleteCookie(c, GUEST_COOKIE, { path: '/' });
}

/**
 * Make a guest, because somebody asked for one.
 *
 * Deliberately not called from anywhere that merely reads. Creating an account
 * is a choice a person makes, and this function exists at exactly one route
 * for that reason: if it were called on a first write, a crawler fetching a
 * page would leave a user row behind and "we do not create accounts for
 * visitors" would be a claim rather than a fact.
 */
export async function createGuest(
  c: Context,
  auth: AuthStore,
  context: AccountCreationContext,
): Promise<AuthUser> {
  const { user, credential } = await auth.createGuest(context);
  setGuestCookie(c, credential);
  return user;
}

/**
 * Whoever this request is for: the signed-in account, else the guest, else
 * nobody. Never creates anything.
 */
export async function currentAccount(
  c: Context,
  auth: AuthStore,
  sessionUser: AuthUser | null,
): Promise<AuthUser | null> {
  return sessionUser ?? guestFromCookie(c, auth);
}

/**
 * A coarse guess at what kind of thing this is, for the creation record.
 *
 * Three buckets, from the client hints the browser volunteers, and `UNKNOWN`
 * when it does not. This is the one place the request's headers are read for
 * anything resembling a device, and what it produces is a statistic -- it is
 * never consulted to decide who somebody is, and losing it would cost nothing
 * but a column in a report.
 */
export function deviceClassFromRequest(c: Context): DeviceClass {
  const mobile = c.req.header('sec-ch-ua-mobile');
  if (mobile === '?1') return DEVICE_CLASSES.MOBILE;
  if (mobile === '?0') return DEVICE_CLASSES.DESKTOP;
  return DEVICE_CLASSES.UNKNOWN;
}
