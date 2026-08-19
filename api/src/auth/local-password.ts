import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/*
 * Password hashing for the SQLite account store.
 *
 * Lifted out of `app.ts` unchanged so the entry point can build the same store
 * the application defaults to, rather than a second implementation that agrees
 * with it only by inspection.
 *
 * The MariaDB store hashes with argon2id instead, and the two are not
 * interchangeable: a hash written by one cannot be verified by the other. That
 * is survivable only because accounts moved while the production database held
 * none. Anything that has to read both would need a rehash-on-login path, and
 * this is deliberately not that.
 */

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) {
    return false;
  }
  const actual = scryptSync(password, salt, 32);
  const expectedBuffer = Buffer.from(expected, 'hex');
  /* Constant time, so a wrong password cannot be narrowed by how long it took. */
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}
