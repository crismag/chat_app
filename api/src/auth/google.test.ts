/*
 * The claim checks, which are the part that has to be right.
 *
 * An unchecked audience means any Google application's token opens an account
 * here; an unchecked expiry means a token works forever. Both are tested
 * against constructed claims rather than real tokens, so the suite never needs
 * Google to be reachable and can exercise the failures that matter.
 */
import { expect, test } from 'vitest';
import type { TokenPayload } from 'google-auth-library';
import { GoogleTokenError, identityFromClaims, readGoogleClientId } from './google.ts';

const CLIENT_ID = '1234.apps.googleusercontent.com';
const NOW = Date.UTC(2026, 7, 21, 12, 0, 0);

const claims = (over: Partial<TokenPayload> = {}): TokenPayload =>
  ({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '110000000000000000001',
    exp: Math.floor(NOW / 1000) + 3600,
    iat: Math.floor(NOW / 1000),
    email: 'Reader@Example.com',
    email_verified: true,
    name: 'A Reader',
    picture: 'https://lh3.example/photo',
    ...over,
  }) as TokenPayload;

test('a good token yields the subject, and the email folded to lower case', () => {
  const identity = identityFromClaims(claims(), CLIENT_ID, NOW);
  expect(identity.subject).toBe('110000000000000000001');
  expect(identity.email).toBe('reader@example.com');
  expect(identity.emailVerified).toBe(true);
  expect(identity.name).toBe('A Reader');
});

test('a token for another application is refused', () => {
  expect(() => identityFromClaims(claims({ aud: 'someone-else.apps.googleusercontent.com' }), CLIENT_ID, NOW))
    .toThrow(GoogleTokenError);
  try {
    identityFromClaims(claims({ aud: 'someone-else.apps.googleusercontent.com' }), CLIENT_ID, NOW);
  } catch (error) {
    expect((error as GoogleTokenError).code).toBe('wrong-audience');
  }
});

test('an audience list is accepted only when ours is in it', () => {
  expect(identityFromClaims(claims({ aud: [CLIENT_ID, 'other'] as unknown as string }), CLIENT_ID, NOW).subject)
    .toBe('110000000000000000001');
  expect(() => identityFromClaims(claims({ aud: ['a', 'b'] as unknown as string }), CLIENT_ID, NOW))
    .toThrow(GoogleTokenError);
});

test('a token from somewhere that is not Google is refused', () => {
  try {
    identityFromClaims(claims({ iss: 'https://accounts.example.com' }), CLIENT_ID, NOW);
    throw new Error('should have thrown');
  } catch (error) {
    expect((error as GoogleTokenError).code).toBe('wrong-issuer');
  }
});

test('an expired token is refused, and one about to expire is not', () => {
  try {
    identityFromClaims(claims({ exp: Math.floor(NOW / 1000) - 1 }), CLIENT_ID, NOW);
    throw new Error('should have thrown');
  } catch (error) {
    expect((error as GoogleTokenError).code).toBe('expired');
  }
  expect(identityFromClaims(claims({ exp: Math.floor(NOW / 1000) + 1 }), CLIENT_ID, NOW).subject).toBeTruthy();
});

test('a token that identifies nobody is refused', () => {
  for (const sub of ['', '   ', undefined]) {
    try {
      identityFromClaims(claims({ sub } as Partial<TokenPayload>), CLIENT_ID, NOW);
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as GoogleTokenError).code).toBe('missing-subject');
    }
  }
});

test('no claims at all is refused rather than treated as anonymous', () => {
  try {
    identityFromClaims(undefined, CLIENT_ID, NOW);
    throw new Error('should have thrown');
  } catch (error) {
    expect((error as GoogleTokenError).code).toBe('malformed');
  }
});

test('an unverified Google address is recorded as unverified rather than refused', () => {
  const identity = identityFromClaims(claims({ email_verified: false }), CLIENT_ID, NOW);
  expect(identity.emailVerified).toBe(false);
  expect(identity.email).toBe('reader@example.com');
});

test('the client id comes from the environment, and absence is not an error', () => {
  expect(readGoogleClientId({ GOOGLE_CLIENT_ID: ' abc ' })).toBe('abc');
  expect(readGoogleClientId({})).toBeNull();
  expect(readGoogleClientId({ GOOGLE_CLIENT_ID: '' })).toBeNull();
});

test('the client secret is never read by this flow', async () => {
  const source = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('./google.ts', import.meta.url), 'utf8'),
  );
  /*
   * The ID-token flow does not use a client secret, and configuration that is
   * never loaded cannot be leaked. This is a cheap guard against somebody
   * later reaching for it out of habit.
   */
  expect(source).not.toContain('GOOGLE_CLIENT_SECRET');
});
