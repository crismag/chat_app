# Signing in with Google

Identity only. Google answers one question — is this the person they say they
are — and is then out of the picture: the application's own session carries
every request afterwards. No access token, refresh token or scope is
requested, stored or wanted, and **the client secret is never read**, because
verifying a signed ID token needs only Google's public keys and the client id
the token was issued for.

## Configuration

One value, in the private `.env` outside the web root:

```dotenv
GOOGLE_CLIENT_ID=<the Google web client ID>
```

`GOOGLE_CLIENT_SECRET` may also be present for other purposes. This flow does
not read it, and a test asserts the module never mentions it.

The client id is **not** secret — Google Identity Services needs it in the page
— and is served to the browser by `GET /api/auth/google/config`. It is fetched
at runtime rather than baked into the build so the deployed `.env` stays the
single source, and a checkout without one still runs: the control is simply not
offered.

Authorized JavaScript origin, in the Google Cloud console:

```text
https://reflections.crishub.com
```

While the Google app is on the **Testing** audience, only configured test users
can sign in. That is why live verification happens against the deployed site
rather than locally.

## The flow

```text
Continue with Google → GIS popup → signed credential
  → POST /api/auth/google → verified server-side
  → resolve or link identity → CHAT session → authenticated
```

There is no OAuth callback URL and no authorization-code exchange.

## What is stored

`user_identities`, keyed on `(provider, provider_user_id)` with a unique
constraint. The subject is Google's own, never the email address: addresses are
reassigned, changed and shared, and a subject is stable for the life of the
account. The address is recorded as description and is never matched on.

`users.id` remains the canonical identity, so Google, a password and whatever
comes later all attach to the same person.

## Guests

A guest signing in with a Google account nobody has yet is **upgraded in
place** — same row, same id — so their reflections, drafts and images stay
theirs with nothing to migrate.

When the Google account already belongs to somebody, the guest cannot be
upgraded into it: that account exists and is not to be overwritten. Their work
moves into it instead, exactly as it does when somebody signs in with a
password they had forgotten they had. Nothing is duplicated and nothing is
discarded.

## Manual verification, on the deployed site

The suite never needs Google to be reachable, so this is the part only a person
can do. As a configured Google test user, at `https://reflections.crishub.com`:

1. **New account.** In a fresh private window, go to `/login`, press *Continue
   with Google*, sign in. Expect to land back where you came from, signed in.
2. **Returning.** Sign out, sign in again. Expect the *same* account — check
   the reflections are still listed.
3. **Guest upgrade.** In a new private window, write a reflection without
   signing in, then sign in with a Google account that has never been used
   here. Expect the reflection to still be there afterwards.
4. **Existing account with guest work.** In another private window, write a
   reflection as a guest, then sign in with a Google account that already
   exists. Expect both sets of reflections, each appearing once.
5. **Cancelled popup.** Press *Continue with Google* and close the popup.
   Expect nothing to happen and the button to still work.
6. **Sign out.** Expect to be signed out and *not* signed straight back in.
