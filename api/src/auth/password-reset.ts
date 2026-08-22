/*
 * Getting back in when the password is gone.
 *
 * This is the most abusable route an application has: it will send an email to
 * an address somebody typed, and it ends with a password being changed. So the
 * rules are set out here rather than being spread across the route.
 *
 *  1. **The answer never depends on whether the address has an account.** Same
 *     status, same wording, same time-to-respond as far as is reasonable. A
 *     form that says "no account with that email" is a way to find out who has
 *     an account here, and this application is a place people write about
 *     things they would not say out loud.
 *
 *  2. **Only the hash is stored.** The token in the link is a bearer
 *     credential for somebody's account; a database that leaked would
 *     otherwise contain a way in for every pending reset.
 *
 *  3. **One use, and it expires.** An hour is long enough to find the email
 *     and short enough that a link forwarded, logged or left in a shared inbox
 *     stops working.
 *
 *  4. **Completing one signs out everything.** Somebody resetting a password
 *     is often somebody who thinks another person has it. Leaving the old
 *     sessions and the remembered devices alive would leave that person
 *     exactly where they were.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { sha256Hex } from '../mysql/tokens.ts';

/** How long a reset link works. */
export const RESET_TTL_MS = 60 * 60 * 1000;

/** The shortest a new password may be. The same rule registration uses. */
export const PASSWORD_MIN = 8;

/**
 * What the request route always says.
 *
 * Written once, here, so that no future edit can accidentally make the reply
 * depend on whether the account exists — which is the whole protection.
 */
export const RESET_REQUESTED_MESSAGE =
  'If that address has an account, a link to set a new password is on its way. It works for one hour.';

/**
 * The value that goes in the link.
 *
 * 32 bytes from the system's random source, the same standard as a session
 * token, because that is what it is for the hour it lives.
 */
export function newResetToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashResetToken(token: string): string {
  return sha256Hex(token);
}

/** Compare a presented token with a stored hash without leaking timing. */
export function resetTokenMatches(token: string, storedHash: string): boolean {
  const presented = Buffer.from(hashResetToken(token), 'utf8');
  const stored = Buffer.from(storedHash, 'utf8');
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}

/** Where the link points. The web app owns the page; this owns the shape. */
export function resetUrl(webOrigin: string, token: string): string {
  return `${webOrigin.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
}

/** So a token or origin cannot break out of the HTML attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * The email itself.
 *
 * Plain, short, and it says what to do if it was not them — which is nothing.
 * A reset request is not a compromise, and telling somebody to panic about an
 * email they did not ask for is how people are talked into clicking things.
 */
export function resetEmail(link: string): { subject: string; text: string; html: string } {
  const subject = 'Set a new C.H.A.T. password';
  const text = [
    'Somebody asked to set a new password for your C.H.A.T. account.',
    '',
    'Open this link within the hour to choose one:',
    link,
    '',
    'If that was not you, you can ignore this. Nothing has changed, and your',
    'password still works.',
    '',
    'C.H.A.T. — reflections.crishub.com',
  ].join('\n');
  const html = [
    '<p>Somebody asked to set a new password for your C.H.A.T. account.</p>',
    `<p><a href="${escapeHtml(link)}">Choose a new password</a></p>`,
    '<p>The link works for one hour.</p>',
    '<p>If that was not you, you can ignore this. Nothing has changed, and your password still works.</p>',
    '<p>C.H.A.T. — reflections.crishub.com</p>',
  ].join('\n');
  return { subject, text, html };
}
