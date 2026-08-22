import { randomUUID } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';

/*
 * One identifier per request, so a log line and a complaint can be joined up.
 *
 * Assistance and Bible calls already carried one, because those are the ones
 * that reach a provider and cost money. Everything else — a failed save, a
 * refused share, a 500 nobody can reproduce — had nothing to quote. "It broke
 * at about four o'clock" is not something anybody can search for.
 *
 * ── What is deliberately not in here ────────────────────────────────────────
 *
 * No path parameters, no bodies, no cookies, no email addresses. A request id
 * is a handle, not a record: it exists so a person can say "this one" and an
 * operator can find the same line. Anything else logged beside it would be the
 * thing this project spends most of its care keeping out of logs.
 *
 * A client may supply its own id, which is what makes a mobile shell's report
 * traceable through the gateway. It is length-capped and stripped to safe
 * characters, because it is going into log lines and an unbounded value from
 * outside is how a log gets forged.
 */

const HEADER = 'x-request-id';
const MAX_LENGTH = 64;

/** Whatever arrived, made safe to write down — or a fresh one. */
export function readRequestId(supplied: string | undefined): string {
  const cleaned = (supplied ?? '').trim().replace(/[^A-Za-z0-9._-]/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, MAX_LENGTH) : randomUUID();
}

/** The id for this request, for anything that wants to log or echo it. */
export function requestIdOf(c: Context): string {
  return c.get('requestId') ?? '';
}

export function requestId(): MiddlewareHandler {
  return async (c, next) => {
    const id = readRequestId(c.req.header(HEADER));
    c.set('requestId', id);
    /*
     * Echoed on every response, not only failures. A person reporting a
     * problem can read it out of their own network tab, and a gateway can
     * carry the same value onward.
     */
    c.header(HEADER, id);
    await next();
  };
}
