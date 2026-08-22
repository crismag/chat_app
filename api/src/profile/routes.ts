/*
 * The public profile endpoints.
 *
 *   GET    /api/profiles/me                 — the signed-in person's own profile
 *   PATCH  /api/profiles/me                 — edit handle, name, tagline, verses
 *   GET    /api/profiles/:handle            — a public profile and its Shares
 *   POST   /api/profiles/:handle/report     — report a profile
 *   POST   /api/profiles/:handle/block      — block a person
 *   DELETE /api/profiles/:handle/block      — unblock them
 *
 * What a profile is, in this product, is a **small portfolio of reflections** —
 * not an identity system. That decision is visible in what these responses do
 * not carry: no email, no user id, no follower or following counts, no private
 * publication count, no saved items, no reactions, no communities. Fields
 * cannot leak from a shape that never held them, and the shape is built here.
 *
 * `GET /:handle` requires a session for the same reason `GET /api/community`
 * does — this deployment has no anonymous surface yet — and because Report and
 * Block need to know who is asking.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  PROFILE_LIMITS,
  handleProblem,
  normaliseHandle,
  suggestDisplayName,
  suggestHandle,
} from './limits.ts';
import type { ProfileStore, StoredProfile } from './store.ts';

/**
 * Why a profile may be reported.
 *
 * The guidelines cover profile names, taglines and images, so the platform list
 * applies here minus "not a genuine C.H.A.T. reflection", which is about a
 * publication rather than a person. Served with the profile so the browser has
 * one source for them rather than a second copy that can drift.
 */
export const PROFILE_REPORT_REASONS = [
  { id: 'spam', label: 'Spam or advertising' },
  { id: 'harassment', label: 'Harassment or hateful content' },
  { id: 'sexual', label: 'Sexual or inappropriate content' },
  { id: 'harm', label: 'Threat or encouragement of harm' },
  { id: 'private_information', label: 'Reveals private information' },
  { id: 'impersonation', label: 'Impersonation' },
  { id: 'other', label: 'Something else' },
] as const;

const REPORT_REASON_IDS = new Set(PROFILE_REPORT_REASONS.map((reason) => reason.id as string));

const REPORT_DETAIL_LIMIT = 500;

export type ProfileUser = { id: string; email: string };

export type ProfileRouteOptions = {
  currentUser: (c: Context) => Promise<ProfileUser | null>;
  profiles: ProfileStore;
};

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * The owner's own view of their profile, provisioned on first read.
 *
 * A profile is not created at registration, because that would mean editing the
 * register handler in `app.ts` — a file another piece of work may be inside.
 * Deriving it on first read gives the same result for every existing account
 * too, which a registration-time hook would not.
 */
export function ensureProfile(profiles: ProfileStore, user: ProfileUser): StoredProfile {
  const existing = profiles.byUserId(user.id);
  if (existing) return existing;

  const base = suggestHandle(user.email);
  let handle = base;
  /*
   * Two people whose email local parts match get `cris` and `cris-2`. Bounded
   * rather than open-ended: after a few attempts the id's first characters make
   * it unique without another round trip.
   */
  for (let attempt = 2; attempt <= 6 && profiles.handleTaken(handle, user.id); attempt += 1) {
    handle = `${base.slice(0, PROFILE_LIMITS.handleMax - 2)}-${attempt}`;
  }
  if (profiles.handleTaken(handle, user.id)) {
    handle = `${base.slice(0, PROFILE_LIMITS.handleMax - 7)}-${user.id.slice(0, 6)}`;
  }

  const timestamp = nowIso();
  const profile: StoredProfile = {
    userId: user.id,
    handle,
    displayName: suggestDisplayName(user.email),
    tagline: '',
    favouriteVerses: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  profiles.save(profile);
  return profile;
}

/** The owner's editable view. Carries the limits so the form cannot invent them. */
/**
 * A creation date, to the month.
 *
 * The exact day somebody joined is a fact about them that no part of this
 * needs, and dates are one of the things that make a person identifiable
 * across sites. The month is enough to say "has been here a while".
 */
function monthOf(timestamp: string): string | null {
  const when = new Date(timestamp);
  if (Number.isNaN(when.getTime())) return null;
  return `${String(when.getUTCFullYear())}-${String(when.getUTCMonth() + 1).padStart(2, '0')}`;
}

function ownView(profile: StoredProfile, publicChatCount: number) {
  return {
    handle: profile.handle,
    memberSince: monthOf(profile.createdAt),
    displayName: profile.displayName,
    tagline: profile.tagline,
    favouriteVerses: profile.favouriteVerses,
    publicChatCount,
    limits: PROFILE_LIMITS,
  };
}

export function createProfileRoutes({ currentUser, profiles }: ProfileRouteOptions) {
  const app = new Hono();

  const requireUser = (c: Context) => currentUser(c);

  app.get('/me', async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: 'Unauthenticated.' }, 401);
    const profile = ensureProfile(profiles, user);
    return c.json(ownView(profile, profiles.publicShareCount(user.id)));
  });

  app.patch('/me', async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: 'Unauthenticated.' }, 401);

    type Patch = {
      handle?: string;
      displayName?: string;
      tagline?: string;
      favouriteVerses?: unknown;
    };
    const body = await c.req.json<Patch>().catch((): Patch => ({}));

    const current = ensureProfile(profiles, user);
    const next: StoredProfile = { ...current, updatedAt: nowIso() };

    if (body.handle !== undefined) {
      const handle = normaliseHandle(String(body.handle));
      const problem = handleProblem(handle);
      if (problem) return c.json({ error: problem, field: 'handle' }, 400);
      /*
       * 409, and a sentence that says what to do. "Constraint failed" is what
       * the database would say; it is not what the person needs to read.
       */
      if (profiles.handleTaken(handle, user.id)) {
        return c.json(
          { error: `The handle @${handle} is already taken. Please choose another.`, field: 'handle' },
          409,
        );
      }
      next.handle = handle;
    }

    if (body.displayName !== undefined) {
      const displayName = String(body.displayName).trim();
      if (displayName.length === 0) {
        return c.json({ error: 'A display name is required.', field: 'displayName' }, 400);
      }
      if (displayName.length > PROFILE_LIMITS.displayName) {
        return c.json(
          {
            error: `A display name is at most ${PROFILE_LIMITS.displayName} characters.`,
            field: 'displayName',
          },
          400,
        );
      }
      next.displayName = displayName;
    }

    if (body.tagline !== undefined) {
      const tagline = String(body.tagline).trim();
      if (tagline.length > PROFILE_LIMITS.tagline) {
        return c.json(
          { error: `A tagline is at most ${PROFILE_LIMITS.tagline} characters.`, field: 'tagline' },
          400,
        );
      }
      next.tagline = tagline;
    }

    if (body.favouriteVerses !== undefined) {
      if (!Array.isArray(body.favouriteVerses)) {
        return c.json(
          { error: 'Favourite Scripture references must be a list.', field: 'favouriteVerses' },
          400,
        );
      }
      const verses = (body.favouriteVerses as unknown[])
        .map((verse) => String(verse).trim())
        .filter((verse) => verse.length > 0);
      if (verses.length > PROFILE_LIMITS.favouriteVerses) {
        return c.json(
          {
            error: `Choose at most ${PROFILE_LIMITS.favouriteVerses} favourite Scripture references.`,
            field: 'favouriteVerses',
          },
          400,
        );
      }
      if (verses.some((verse) => verse.length > PROFILE_LIMITS.favouriteVerseLength)) {
        return c.json(
          {
            error: `A Scripture reference is at most ${PROFILE_LIMITS.favouriteVerseLength} characters.`,
            field: 'favouriteVerses',
          },
          400,
        );
      }
      next.favouriteVerses = verses;
    }

    profiles.save(next);
    return c.json(ownView(next, profiles.publicShareCount(user.id)));
  });

  /** The profile named in the path, or a 404 that says nothing else. */
  const subjectOf = (c: Context) => profiles.byHandle(c.req.param('handle') ?? '');

  app.get('/:handle', async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: 'Unauthenticated.' }, 401);

    const subject = subjectOf(c);
    if (!subject) return c.json({ error: 'No profile with that handle.' }, 404);

    const isOwner = subject.userId === user.id;

    /*
     * A blocked person's work is not fetched, not counted and not described.
     * The response says only that the viewer blocked them, which is the one
     * fact the viewer needs to undo it.
     */
    if (!isOwner && profiles.isBlocked(user.id, subject.userId)) {
      return c.json({
        handle: subject.handle,
        displayName: subject.displayName,
        tagline: '',
        favouriteVerses: [] as string[],
        publicChatCount: null,
        isOwner: false,
        blocked: true,
        shares: [],
        reportReasons: PROFILE_REPORT_REASONS,
      });
    }

    const shares = profiles.publicShares(subject.userId);
    return c.json({
      handle: subject.handle,
      displayName: subject.displayName,
      tagline: subject.tagline,
      favouriteVerses: subject.favouriteVerses,
      /*
       * The public count, and only the public count. It is derived from the
       * same predicate as `shares`, so it cannot become a side channel that
       * says "and eleven more you may not see".
       */
      publicChatCount: shares.length,
      /*
       * When the profile was made, to the month.
       *
       * A date is a small thing to know about somebody and a useful one — it
       * is the difference between an account that has been here a year and one
       * opened this morning. To the month rather than the day, because the
       * exact date is a fact about a person that nothing here needs.
       */
      memberSince: monthOf(subject.createdAt),
      isOwner,
      blocked: false,
      shares,
      reportReasons: PROFILE_REPORT_REASONS,
    });
  });

  app.post('/:handle/report', async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: 'Unauthenticated.' }, 401);

    const subject = subjectOf(c);
    if (!subject) return c.json({ error: 'No profile with that handle.' }, 404);
    if (subject.userId === user.id) {
      return c.json({ error: 'You cannot report your own profile.' }, 400);
    }

    type ReportBody = { reason?: string; detail?: string };
    const body = await c.req.json<ReportBody>().catch((): ReportBody => ({}));
    const reason = String(body.reason ?? '');
    if (!REPORT_REASON_IDS.has(reason)) {
      return c.json({ error: 'Choose a reason for the report.', field: 'reason' }, 400);
    }

    profiles.addReport({
      reporterUserId: user.id,
      subjectUserId: subject.userId,
      reason,
      detail: String(body.detail ?? '').slice(0, REPORT_DETAIL_LIMIT),
    });

    /*
     * A report is recorded and reviewed; it removes nothing for anyone. The
     * guidelines require that, and saying so in the response is what stops the
     * interface implying an instant takedown.
     */
    return c.json(
      {
        ok: true,
        message: 'Thank you. This profile has been reported and will be reviewed.',
      },
      201,
    );
  });

  const setBlock = (blocked: boolean) => async (c: Context) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: 'Unauthenticated.' }, 401);

    const subject = subjectOf(c);
    if (!subject) return c.json({ error: 'No profile with that handle.' }, 404);
    if (subject.userId === user.id) {
      return c.json({ error: 'You cannot block yourself.' }, 400);
    }

    profiles.setBlocked(user.id, subject.userId, blocked);
    return c.json({ ok: true, blocked });
  };

  app.post('/:handle/block', setBlock(true));
  app.delete('/:handle/block', setBlock(false));

  return app;
}
