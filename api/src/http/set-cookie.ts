/*
 * Turning what a response set into what the next request should send.
 *
 * A browser does this and never thinks about it; a test client has to be told.
 * One response may set several cookies -- registering sets an installation
 * credential and a session, and logging out clears one while revoking another
 * -- and `Headers.get('set-cookie')` returns them joined with commas, which is
 * not a Cookie header and not a single pair either.
 *
 * So this lives in the application rather than in one test file: every caller
 * that got this wrong got it wrong the same way, by taking the first pair and
 * silently carrying an empty deletion around.
 */

/**
 * Split a joined `Set-Cookie` value into its individual cookies.
 *
 * The separator is a comma followed by something that looks like the start of
 * a new cookie, because `Expires=Wed, 21 Oct ...` contains commas of its own.
 */
export function splitSetCookie(header: string | null | undefined): string[] {
  if (!header) return [];
  return header.split(/,(?=\s*[^ ;,=]+=)/).map((part) => part.trim());
}

/** Just the `name=value` pairs, ready to be joined into a Cookie header. */
export function cookiePairs(header: string | null | undefined): string[] {
  return splitSetCookie(header)
    .map((cookie) => cookie.split(';')[0]?.trim() ?? '')
    .filter((pair) => pair.includes('=') && !pair.endsWith('='));
}

/** One named cookie's `name=value`, or empty when it was not set to anything. */
export function cookieNamed(header: string | null | undefined, name: string): string {
  return cookiePairs(header).find((pair) => pair.startsWith(`${name}=`)) ?? '';
}

/**
 * A Cookie header carrying everything the response set, minus deletions.
 *
 * Cleared cookies arrive as `name=` and are dropped rather than sent back
 * empty, which is what a browser does with them too.
 */
export function cookieHeader(header: string | null | undefined): string {
  return cookiePairs(header).join('; ');
}
