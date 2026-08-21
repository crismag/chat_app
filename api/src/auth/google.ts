import { OAuth2Client, type TokenPayload } from 'google-auth-library';

/*
 * Establishing who somebody is with Google, and nothing else.
 *
 * This is an identity flow, not an authorisation one. Google is asked one
 * question — "is this the person they say they are" — and once it has answered,
 * Google is out of the picture: the application's own session carries every
 * request afterwards. No access token is requested, kept or refreshed, no scope
 * beyond the sign-in profile is asked for, and the client secret is never
 * needed, because verifying a signed ID token requires only Google's public
 * keys and the client id the token was issued for.
 *
 * The claim checks are a pure function on purpose. They are the part that must
 * be right — an unchecked audience means any Google application's token opens
 * an account here — and a pure function can be tested exhaustively without a
 * network, a clock, or a real token.
 */

/** Google's own issuers. Anything else is not a Google token. */
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/** What the application takes from a verified token, and nothing more. */
export interface GoogleIdentity {
  /** Google's stable subject. The permanent key; never the email address. */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export type GoogleTokenFailure =
  | 'malformed'
  | 'wrong-audience'
  | 'wrong-issuer'
  | 'expired'
  | 'missing-subject';

export class GoogleTokenError extends Error {
  readonly code: GoogleTokenFailure;

  constructor(code: GoogleTokenFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GoogleTokenError';
    this.code = code;
  }
}

/**
 * Turn verified claims into an identity, refusing anything that is not ours.
 *
 * `verifyIdToken` already checks the signature, the audience and the expiry —
 * this repeats the checks that decide *whose* token it is rather than merely
 * whether it is well formed. A token can be perfectly valid, correctly signed
 * by Google, unexpired, and still belong to a different application entirely;
 * the audience is the only thing that says otherwise.
 */
export function identityFromClaims(
  payload: TokenPayload | undefined,
  clientId: string,
  now: number = Date.now(),
): GoogleIdentity {
  if (!payload) throw new GoogleTokenError('malformed', 'The Google token carried no claims.');

  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(clientId)) {
    throw new GoogleTokenError('wrong-audience', 'The Google token was issued for another application.');
  }
  if (!ISSUERS.has(payload.iss)) {
    throw new GoogleTokenError('wrong-issuer', 'The token was not issued by Google.');
  }
  /*
   * `exp` is in seconds. Checked here as well as in the library because an
   * expiry that is merely assumed is an expiry that stops being checked the
   * day the library call is replaced.
   */
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) {
    throw new GoogleTokenError('expired', 'The Google sign-in has expired. Try again.');
  }
  const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
  if (!subject) {
    throw new GoogleTokenError('missing-subject', 'The Google token identifies nobody.');
  }

  return {
    subject,
    email: typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : null,
    /*
     * Google's own word on whether it has confirmed the address. An
     * unverified address is still recorded, but nothing may be matched on it
     * — which is why the subject, not the email, is the key.
     */
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name.trim() || null : null,
    picture: typeof payload.picture === 'string' ? payload.picture.trim() || null : null,
  };
}

/** Verifies a credential from Google Identity Services. */
export interface GoogleVerifier {
  verify(credential: string): Promise<GoogleIdentity>;
}

/**
 * The real verifier, over Google's published keys.
 *
 * Injectable, so tests never depend on Google being reachable — and so the
 * suite can exercise the failures that matter (a token for another audience,
 * an expired one, one with no subject) without minting real tokens.
 */
export function createGoogleVerifier(clientId: string, client = new OAuth2Client()): GoogleVerifier {
  return {
    async verify(credential: string): Promise<GoogleIdentity> {
      if (typeof credential !== 'string' || credential.trim() === '') {
        throw new GoogleTokenError('malformed', 'No Google credential was supplied.');
      }
      let ticket;
      try {
        ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
      } catch (cause: unknown) {
        /*
         * The library's message can name key ids, audiences and timings. None
         * of that goes to a browser; the caller logs the cause and shows the
         * sentence.
         */
        throw new GoogleTokenError('malformed', 'That Google sign-in could not be verified.', {
          cause,
        });
      }
      return identityFromClaims(ticket.getPayload(), clientId);
    },
  };
}

/**
 * The Google client id, from the environment.
 *
 * The id is not a secret — Google Identity Services needs it in the browser —
 * so it is served to the frontend deliberately. The client secret is not read
 * here at all: this flow does not use one, and configuration that is never
 * loaded cannot be leaked.
 */
export function readGoogleClientId(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const clientId = env['GOOGLE_CLIENT_ID']?.trim();
  return clientId ? clientId : null;
}
