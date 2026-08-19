import type { Context } from 'hono';

/**
 * The caller's address, for rate limiting only.
 *
 * Not logged, not stored, not returned, and never part of deciding who
 * somebody is. `x-forwarded-for` is trusted only as a bucketing hint — it is
 * spoofable, which is why every limiter that uses it puts it *behind* a
 * per-account limit rather than in front of one.
 */
export function addressOf(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return c.req.header('x-real-ip')?.trim() || 'unknown';
}
