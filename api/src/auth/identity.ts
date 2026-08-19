/*
 * Who is asking, and by what.
 *
 * Three states, and the difference between them matters.
 *
 *   A VISITOR has no account. Nothing has been created for them, no row
 *   exists, and no cookie has been set. Reading a shared reflection happens in
 *   this state and must stay that way -- a page view is not a reason to write
 *   anything down about somebody.
 *
 *   A GUEST chose to carry on without registering. They are a real user with a
 *   real id, and what they write belongs to them exactly as it would to
 *   anybody else. They exist because they asked to.
 *
 *   A REGISTERED user signed in, or was a guest and added an email and a
 *   password to the account they already had.
 *
 * Two credentials, deliberately not one:
 *
 *   The INSTALLATION credential is durable recognition of this browser. For a
 *   guest it is the account -- lose it and there is no way back to what they
 *   wrote -- so signing out must never touch it, and forgetting it is its own
 *   deliberate, warned-about action.
 *
 *   The SESSION is the current authorised interaction. It can end, be revoked,
 *   or expire, and none of that says anything about whether this browser is
 *   still recognised. A request with a live installation credential and no
 *   session gets a new session silently.
 *
 * Recognition is by credential and nothing else. Not the address, not the
 * User-Agent, not the screen, not the timezone: no characteristic of the
 * device or the browser is consulted to decide who somebody is, because
 * recognising a person by what their machine looks like is recognising
 * somebody who did not agree to be recognised. Browser and OS family are
 * recorded as diagnostics and are never part of the answer.
 *
 * What is promised is exactly this:
 *
 *   same browser profile + surviving installation credential = same account.
 *
 * Nothing stronger. Clearing site data loses the credential and, for an
 * unregistered guest, the way back to their reflections; another browser on
 * the same phone is a different installation. Both are said plainly in the
 * interface rather than being worked around.
 */

import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import type { AccountCreationContext, DeviceClass } from '@chat/shared';
import { DEVICE_CLASSES } from '@chat/shared';
import { isNativeWebViewOrigin } from '../http/origins.ts';
import {
  PERSISTENCE_TYPES,
  SESSION_TYPES,
  type AuthStore,
  type AuthUser,
  type InstallationContext,
  type PersistenceType,
  type SessionType,
} from './store.ts';

export const INSTALLATION_COOKIE = 'chat_install';

/**
 * How long a browser is asked to keep its installation credential.
 *
 * Long, and renewed on use. There is no inactivity expiry on the account
 * behind it: a guest who writes something, closes the tab and comes back next
 * year should find it there, and an arbitrary timeout would silently destroy
 * work for no security benefit anybody asked for.
 */
export const INSTALLATION_TTL_MS = 400 * 24 * 60 * 60 * 1000;

/**
 * The same protections as the session cookie, for the same reasons.
 *
 * HttpOnly, because no script on the page has any business reading a bearer
 * credential; SameSite, so another site cannot cause it to be sent; Secure in
 * production, because it must not cross the network in clear text.
 *
 * A native web view is the one exception to SameSite=Lax, and it is also
 * always Secure -- the app talks to the API from a different origin over
 * https, and Lax would drop the cookie entirely.
 */
export function installationCookieOptions(
  origin: string | undefined,
  env: NodeJS.Dict<string> = process.env,
): CookieOptions {
  const native = isNativeWebViewOrigin(origin);
  return {
    httpOnly: true,
    path: '/',
    maxAge: Math.floor(INSTALLATION_TTL_MS / 1000),
    sameSite: native ? 'None' : 'Lax',
    secure: native || env.NODE_ENV === 'production',
  };
}

export function setInstallationCookie(c: Context, credential: string): void {
  setCookie(c, INSTALLATION_COOKIE, credential, installationCookieOptions(c.req.header('origin')));
}

export function clearInstallationCookie(c: Context): void {
  deleteCookie(c, INSTALLATION_COOKIE, { path: '/' });
}

export function installationCredential(c: Context): string | undefined {
  return getCookie(c, INSTALLATION_COOKIE);
}

/**
 * The account this browser is durably recognised as, if any.
 *
 * A credential is not an assertion: it is looked up, its secret is checked
 * against a stored hash, and one naming an installation that was revoked --
 * or an account that was merged away -- is nobody, rather than an error or a
 * reason to hand out a new account.
 */
export async function recognisedAccount(
  c: Context,
  auth: AuthStore,
): Promise<{ user: AuthUser; installationId: string } | null> {
  const credential = installationCredential(c);
  if (!credential) return null;
  return auth.accountForInstallation(credential);
}

/**
 * Give this browser durable recognition of an account.
 *
 * Used in two places and no others: taking the guest option, and signing in
 * with "keep me signed in" ticked. Both are somebody choosing it.
 */
export async function rememberInstallation(
  c: Context,
  auth: AuthStore,
  userId: string,
  persistenceType: PersistenceType,
): Promise<string> {
  const { installationId, credential } = await auth.createInstallation(
    userId,
    installationContext(c),
    persistenceType,
  );
  setInstallationCookie(c, credential);
  return installationId;
}

/**
 * Coarse diagnostics about the client, recorded once.
 *
 * Client hints and nothing else -- what the browser volunteers about itself in
 * two headers, bucketed to families. Deliberately not a measurement: no
 * screen, no fonts, no canvas, no timezone, nothing derived. It exists to
 * answer "what sort of clients are these" in aggregate, and it is never read
 * back to decide who anybody is.
 */
export function installationContext(c: Context): InstallationContext {
  return {
    platform: 'WEB',
    deviceClass: deviceClassFromRequest(c),
    browserFamily: browserFamily(c.req.header('sec-ch-ua')),
    osFamily: osFamily(c.req.header('sec-ch-ua-platform')),
  };
}

const KNOWN_BROWSERS = ['Firefox', 'Edge', 'Opera', 'Chromium', 'Chrome', 'Safari'] as const;

function browserFamily(brands: string | undefined): string | null {
  if (!brands) return null;
  /* A family, not a version, and only one this code already knows a name for. */
  return KNOWN_BROWSERS.find((name) => brands.includes(name)) ?? null;
}

function osFamily(platform: string | undefined): string | null {
  const cleaned = platform?.replaceAll('"', '').trim();
  return cleaned ? cleaned.slice(0, 32) : null;
}

/**
 * A coarse guess at what kind of thing this is, for the creation record.
 *
 * Three buckets, from the one client hint that answers it, and `UNKNOWN` when
 * the browser does not say. Losing this would cost a column in a report and
 * nothing else.
 */
export function deviceClassFromRequest(c: Context): DeviceClass {
  const mobile = c.req.header('sec-ch-ua-mobile');
  if (mobile === '?1') return DEVICE_CLASSES.MOBILE;
  if (mobile === '?0') return DEVICE_CLASSES.DESKTOP;
  return DEVICE_CLASSES.UNKNOWN;
}

/**
 * Make a guest, because somebody asked for one.
 *
 * Deliberately not called from anywhere that merely reads or writes. Creating
 * an account is a choice a person makes, and this exists at exactly one route
 * for that reason: called on a first write instead, a crawler fetching a page
 * would leave a user row behind and "no account is created for a visitor"
 * would be a claim rather than a fact.
 */
export async function createGuest(
  c: Context,
  auth: AuthStore,
  context: AccountCreationContext,
): Promise<{ user: AuthUser; installationId: string }> {
  const { user, installationId, credential } = await auth.createGuest(context);
  setInstallationCookie(c, credential);
  return { user, installationId };
}

/** Which kind of session a newly recognised account should get. */
export function sessionTypeFor(user: AuthUser, persistent: boolean): SessionType {
  if (user.accountType === 'ANONYMOUS') return SESSION_TYPES.GUEST;
  return persistent ? SESSION_TYPES.REGISTERED_PERSISTENT : SESSION_TYPES.REGISTERED_TEMPORARY;
}

export { PERSISTENCE_TYPES, SESSION_TYPES };
