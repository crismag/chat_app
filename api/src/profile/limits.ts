/*
 * The public profile's limits, in one place.
 *
 * They are exported to the browser through `GET /api/profiles/me` rather than
 * duplicated in the web app, for the same reason the format rules live in
 * `packages/shared`: a limit written twice is a limit that will disagree with
 * itself, and the disagreement always surfaces as a form that lets someone type
 * something the server then refuses.
 */

export const PROFILE_LIMITS = {
  displayName: 50,
  handleMin: 3,
  handleMax: 30,
  tagline: 160,
  favouriteVerses: 3,
  /* A reference, not a passage. "1 Thessalonians 5:16-18" is 24 characters. */
  favouriteVerseLength: 64,
} as const;

export type ProfileLimits = typeof PROFILE_LIMITS;

/*
 * Handles that must never belong to a person.
 *
 * `me` is the one that matters — `/api/profiles/me` is the owner's own route,
 * so a user holding the handle `me` would make their public profile
 * unreachable and their own profile ambiguous. The rest are reserved because
 * the web app routes under `/profile/…` and may grow segments there.
 */
export const RESERVED_HANDLES = new Set([
  'me',
  'new',
  'edit',
  'admin',
  'administrator',
  'api',
  'settings',
  'support',
  'help',
  'about',
  'chat',
  'community',
  'reflections',
  'reflect',
  'create',
  'login',
  'logout',
  'register',
  'profile',
  'profiles',
]);

export type FieldError = { field: string; message: string };

/** `null` when the handle is well formed; otherwise why it is not. */
export function handleProblem(handle: string): string | null {
  if (handle.length < PROFILE_LIMITS.handleMin || handle.length > PROFILE_LIMITS.handleMax) {
    return `A handle is between ${PROFILE_LIMITS.handleMin} and ${PROFILE_LIMITS.handleMax} characters.`;
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(handle)) {
    return 'A handle uses lowercase letters, numbers, hyphens and underscores, and starts with a letter or number.';
  }
  if (RESERVED_HANDLES.has(handle)) {
    return 'That handle is reserved. Please choose another.';
  }
  return null;
}

/**
 * A handle as it is stored and compared.
 *
 * Case is folded rather than preserved, because `@Cris` and `@cris` addressing
 * two different people is an impersonation vector, not a stylistic choice.
 */
export function normaliseHandle(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

/** A handle derived from an email, for a profile nobody has edited yet. */
export function suggestHandle(email: string): string {
  const base = normaliseHandle(email.split('@')[0] ?? '')
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, PROFILE_LIMITS.handleMax);
  return base.length >= PROFILE_LIMITS.handleMin ? base : `${base}reader`.slice(0, PROFILE_LIMITS.handleMax);
}

/** A display name derived from an email, for the same reason. */
export function suggestDisplayName(email: string): string {
  const local = email.split('@')[0] ?? 'Reader';
  const words = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return (words.join(' ') || 'Reader').slice(0, PROFILE_LIMITS.displayName);
}
