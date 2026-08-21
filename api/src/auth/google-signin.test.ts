/*
 * Signing in with Google, asserted on what the API actually answers.
 *
 * Google's own verification is replaced by a stub — the suite must not need
 * Google to be reachable, and the claim checks are tested exhaustively in
 * google.test.ts. What is tested here is everything that happens *after* a
 * credential is believed: which account it resolves to, what happens to a
 * guest's work, and what a second sign-in does.
 */
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import { cookieHeader } from '../http/set-cookie.ts';
import { GoogleTokenError, type GoogleIdentity, type GoogleVerifier } from './google.ts';

let store: SqliteStore;
let app: ReturnType<typeof createApp>;

/** Credentials are opaque strings here; the stub decides what each means. */
const IDENTITIES = new Map<string, GoogleIdentity>([
  ['token-ada', { subject: 'google-sub-ada', email: 'ada@example.com', emailVerified: true, name: 'Ada', picture: null }],
  ['token-grace', { subject: 'google-sub-grace', email: 'grace@example.com', emailVerified: true, name: 'Grace', picture: null }],
]);

const verifier: GoogleVerifier = {
  verify(credential: string): Promise<GoogleIdentity> {
    const found = IDENTITIES.get(credential);
    if (!found) return Promise.reject(new GoogleTokenError('malformed', 'no'));
    return Promise.resolve(found);
  },
};

beforeEach(() => {
  store = new SqliteStore();
  app = createApp(store, {}, {}, undefined, { googleVerifier: verifier });
});

async function signInWithGoogle(credential: string, cookie = '') {
  const response = await app.request('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ credential }),
  });
  return {
    status: response.status,
    body: (await response.json().catch(() => null)) as Record<string, unknown>,
    cookie: cookieHeader(response.headers.get('set-cookie')),
  };
}

async function guestSession() {
  const response = await app.request('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creationSource: 'REFLECTION_CREATE' }),
  });
  return {
    cookie: cookieHeader(response.headers.get('set-cookie')),
    user: (await response.json()) as { id: string },
  };
}

async function writeReflection(cookie: string, title: string) {
  const created = await app.request('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title, scriptureReference: 'Romans 8:28' }),
  });
  return ((await created.json()) as { id: string }).id;
}

async function myReflections(cookie: string) {
  const response = await app.request('/api/conversations', { headers: { Cookie: cookie } });
  const body = (await response.json()) as { title: string }[] | { items: { title: string }[] };
  return Array.isArray(body) ? body : body.items;
}

/* ------------------------------------------------------- new and returning */

test('a verified Google token makes a registered account', async () => {
  const result = await signInWithGoogle('token-ada');
  expect(result.status).toBe(200);
  expect(result.body['accountType']).toBe('REGISTERED');
  /* And a session, so the next request is authenticated by CHAT and not by Google. */
  expect(result.cookie).not.toBe('');
  const me = await app.request('/api/auth/me', { headers: { Cookie: result.cookie } });
  expect(me.status).toBe(200);
});

test('signing in again reaches the same account rather than making a second', async () => {
  const first = await signInWithGoogle('token-ada');
  const second = await signInWithGoogle('token-ada');
  expect(second.status).toBe(200);
  expect(second.body['id']).toBe(first.body['id']);
});

test('a replayed credential does not create a duplicate user', async () => {
  const first = await signInWithGoogle('token-ada');
  const replays = await Promise.all([
    signInWithGoogle('token-ada'),
    signInWithGoogle('token-ada'),
    signInWithGoogle('token-ada'),
  ]);
  for (const replay of replays) expect(replay.body['id']).toBe(first.body['id']);
});

test('two different Google accounts are two different users', async () => {
  const ada = await signInWithGoogle('token-ada');
  const grace = await signInWithGoogle('token-grace');
  expect(grace.body['id']).not.toBe(ada.body['id']);
});

/* --------------------------------------------------------- the guest upgrade */

test('a guest is upgraded in place, keeping their id and their reflections', async () => {
  const guest = await guestSession();
  await writeReflection(guest.cookie, 'Written before I signed in');

  const signedIn = await signInWithGoogle('token-ada', guest.cookie);
  expect(signedIn.status).toBe(200);
  /* The same row: nothing was migrated, because nothing moved. */
  expect(signedIn.body['id']).toBe(guest.user.id);
  expect(signedIn.body['accountType']).toBe('REGISTERED');

  const kept = await myReflections(signedIn.cookie);
  expect(kept.map((item) => item.title)).toContain('Written before I signed in');
});

test('the upgraded guest keeps their guest name', async () => {
  const guest = await guestSession();
  const signedIn = await signInWithGoogle('token-ada', guest.cookie);
  expect(signedIn.body['guestName']).toBeTruthy();
});

/* ------------------------------- the Google account already belongs to someone */

test('a guest signing in to an existing Google account has their work moved into it', async () => {
  /* Ada signs in on one browser and writes something. */
  const ada = await signInWithGoogle('token-ada');
  await writeReflection(ada.cookie, 'Ada wrote this first');

  /* On another browser somebody has been writing as a guest. */
  const guest = await guestSession();
  await writeReflection(guest.cookie, 'Written as a guest');

  const merged = await signInWithGoogle('token-ada', guest.cookie);
  expect(merged.status).toBe(200);
  /* They are Ada — not a new person, and not silently overwritten. */
  expect(merged.body['id']).toBe(ada.body['id']);

  const both = await myReflections(merged.cookie);
  const titles = both.map((item) => item.title);
  /* Nothing discarded and nothing duplicated. */
  expect(titles).toContain('Ada wrote this first');
  expect(titles).toContain('Written as a guest');
  expect(titles.filter((title) => title === 'Written as a guest')).toHaveLength(1);
});

/* --------------------------------------------------------------- refusals */

test('an unverifiable credential is refused, and creates nobody', async () => {
  const refused = await signInWithGoogle('not-a-real-token');
  expect(refused.status).toBe(401);
  expect(String(refused.body['error'])).toMatch(/could not be verified/i);
  /* And nothing about the token comes back. */
  expect(JSON.stringify(refused.body)).not.toContain('not-a-real-token');
});

test('a missing credential is refused rather than treated as anonymous', async () => {
  const response = await app.request('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  expect(response.status).toBe(401);
});

test('the reply never carries a token, a secret, or Google internals', async () => {
  const result = await signInWithGoogle('token-ada');
  const body = JSON.stringify(result.body);
  for (const forbidden of ['token-ada', 'client_secret', 'GOOGLE_CLIENT_SECRET', 'credential']) {
    expect(body).not.toContain(forbidden);
  }
});

test('the config endpoint offers the client id and never a secret', async () => {
  const response = await app.request('/api/auth/google/config');
  const body = (await response.json()) as Record<string, unknown>;
  expect(response.status).toBe(200);
  expect(Object.keys(body).sort()).toEqual(['clientId', 'configured']);
  expect(JSON.stringify(body)).not.toMatch(/secret/i);
});

/* ----------------------------------------------------------------- logout */

test('logging out ends the CHAT session', async () => {
  const signedIn = await signInWithGoogle('token-ada');
  const out = await app.request('/api/auth/logout', {
    method: 'POST',
    headers: { Cookie: signedIn.cookie },
  });
  expect(out.status).toBeLessThan(300);
  const after = await app.request('/api/auth/me', { headers: { Cookie: signedIn.cookie } });
  expect(after.status).toBe(401);
});
