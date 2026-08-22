import type { Context } from 'hono';

/*
 * The caller's address, for rate limiting only.
 *
 * Not logged, not stored, not returned, and never part of deciding who
 * somebody is.
 *
 * ── Why the peer decides whether the header is believed ─────────────────────
 *
 * Guest creation, registration and forgot-password are metered by address
 * alone — there is no account yet to meter instead. So the value this returns
 * is the whole limit for those routes, and a caller who can choose it has no
 * limit at all: a header, rotated per request, is a fresh bucket every time.
 *
 * `x-forwarded-for` is therefore believed only when the connection came from
 * this machine, which in this deployment means the PHP gateway — the one thing
 * entitled to speak for somebody else, because it sets the header from the
 * socket it accepted. A request that reaches the port directly is named by its
 * own socket, whatever it claims about itself.
 *
 * Login keeps its per-email ceiling regardless. That one is not addressed at
 * all, and must stay that way: it is the limit that still holds when this one
 * is wrong.
 */

/** The address the socket actually came from, when the runtime exposes one. */
function peerAddress(c: Context): string | null {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? null;
}

/** IPv4 loopback, IPv6 loopback, and the IPv4-mapped form Node reports. */
export function isLoopback(address: string | null): boolean {
  if (!address) return false;
  const plain = address.replace(/^::ffff:/i, '');
  return plain === '::1' || plain.startsWith('127.');
}

export function addressOf(c: Context): string {
  const peer = peerAddress(c);

  /*
   * No socket at all means this request was not carried over a network: an
   * in-process call, which is how the tests drive the app. There is nobody to
   * spoof, so the headers are read as written.
   */
  if (peer === null || isLoopback(peer)) {
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0]?.trim() || peer || 'unknown';
    const real = c.req.header('x-real-ip')?.trim();
    if (real) return real;
  }

  return peer ?? 'unknown';
}
