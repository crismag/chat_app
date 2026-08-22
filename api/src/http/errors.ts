import type { Context } from 'hono';

import { requestIdOf } from './request-id.ts';

/*
 * What a request that threw says back.
 *
 * Without this, an uncaught throw left Hono to answer — an empty body, or an
 * HTML page, with a stack in it if the runtime felt like it. A client that
 * reads `{ error }` everywhere else then failed to parse the one response that
 * mattered, and reported "unexpected end of JSON" instead of the actual
 * problem.
 *
 * Two rules.
 *
 * **Nothing from the exception reaches the body.** A message from a database
 * driver names tables, columns and sometimes the values in them. It goes to
 * the log, where an operator can read it, and never to a browser.
 *
 * **The request id does reach the body**, because it is the one thing that
 * makes the log line findable and is safe to hand out: a random identifier
 * this request minted, tied to nothing.
 */

export function onError(error: Error, c: Context): Response {
  const id = requestIdOf(c);

  /*
   * The one place a raw error message is written. Method and path, so a
   * pattern is visible across requests; never the query string, which carries
   * search terms somebody typed.
   */
  console.error(
    `[${id}] ${c.req.method} ${new URL(c.req.url).pathname} failed: ${error.message}`,
  );

  return c.json(
    {
      error: 'Something went wrong on our side. Please try again.',
      requestId: id,
    },
    500,
  );
}
