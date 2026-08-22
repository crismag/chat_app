import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';

import { escapeHtml } from './password-reset.ts';

/*
 * Proving somebody can read the address they registered with.
 *
 * ── What this is not ────────────────────────────────────────────────────────
 *
 * It is not a way to sign in. Opening the link proves the mailbox and does
 * exactly that: it marks the address verified and creates no session, sets no
 * cookie, and grants no access on its own. Somebody who finds the link in a
 * forwarded email learns nothing and gains nothing; they cannot become the
 * person whose mailbox it is.
 *
 * That distinction is the whole design. A link that signs you in is a second
 * credential for the account, with all the reasoning that implies about
 * forwarding, shared inboxes and mail-server logs. A link that only says "yes,
 * this mailbox is real and reachable" carries none of it.
 *
 * ── Why only the hash is kept ───────────────────────────────────────────────
 *
 * The token is the proof. A database that leaked while holding the tokens
 * themselves would contain a working proof for every pending verification, so
 * what is stored is a hash and what is emailed is the pre-image.
 */

/** Long enough that guessing is not a strategy. */
export function newVerificationToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Compare without leaking timing. */
export function verificationTokenMatches(token: string, storedHash: string): boolean {
  const presented = Buffer.from(hashVerificationToken(token), 'utf8');
  const stored = Buffer.from(storedHash, 'utf8');
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}

/**
 * A day, not an hour.
 *
 * A password reset is urgent and short-lived because it changes something. This
 * changes nothing; it only confirms. People read email the next morning, and
 * expiring overnight would mean asking them to start again for no gain.
 */
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export function verificationUrl(webOrigin: string, token: string): string {
  return `${webOrigin.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(token)}`;
}

/**
 * The email itself.
 *
 * It says what the link is for and what happens if it is ignored, because
 * both are true and neither is alarming: an unverified account can still be
 * written in privately. Nothing here asks anybody to hurry.
 */
export function verificationEmail(link: string): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = 'Confirm your C.H.A.T. email address';
  const text = [
    'Confirm this address so you can share reflections with other people.',
    '',
    'Open this link within a day:',
    link,
    '',
    'Until you do, everything still works for writing privately — this only',
    'affects sharing, where other people see your name beside your words.',
    '',
    'If you did not create a C.H.A.T. account, you can ignore this. Nothing',
    'will happen and the address will not be used again.',
    '',
    'C.H.A.T. — reflections.crishub.com',
  ].join('\n');
  const html = [
    '<p>Confirm this address so you can share reflections with other people.</p>',
    `<p><a href="${escapeHtml(link)}">Confirm my email address</a></p>`,
    '<p>The link works for a day.</p>',
    '<p>Until you use it everything still works for writing privately — this only affects sharing, where other people see your name beside your words.</p>',
    '<p>If you did not create a C.H.A.T. account, you can ignore this. Nothing will happen and the address will not be used again.</p>',
    '<p>C.H.A.T. — reflections.crishub.com</p>',
  ].join('\n');
  return { subject, text, html };
}

/** The same answer whatever the token was, so a probe learns nothing. */
export const VERIFICATION_SPENT_MESSAGE =
  'That link is no longer valid. Ask for a new one from your account.';

export const VERIFICATION_SENT_MESSAGE =
  'If that address needs confirming, a link is on its way to it.';
