/*
 * What a guest is called, and why it reads like a name.
 *
 * `guest_827192` tells somebody they are a row in a table. The point of the
 * guest account is the opposite — that what they wrote is theirs before they
 * have decided anything — so the name is two ordinary words and a number, in
 * the register of the rest of the application: quiet, made of things that grow
 * or give light, nothing clever.
 *
 * The number is a per-base-name sequence rather than random digits. Random
 * digits look like an identifier and invite the reader to wonder what they
 * encode; `QuietCedar-14` is plainly the fourteenth QuietCedar and encodes
 * nothing about the person. It is allocated atomically, because two guests
 * created in the same millisecond must not be given the same name.
 *
 * The name is display and audit metadata. It is never an identity and never a
 * credential: nothing anywhere looks an account up by it.
 */

const ADJECTIVES = [
  'Quiet',
  'Gentle',
  'Golden',
  'Still',
  'Kind',
  'Morning',
  'Little',
  'Bright',
  'Steady',
  'Patient',
  'Humble',
  'Faithful',
  'Evening',
  'Distant',
  'Open',
  'Warm',
] as const;

const NOUNS = [
  'Cedar',
  'River',
  'Sparrow',
  'Harbor',
  'Lantern',
  'Olive',
  'Mustard',
  'Vine',
  'Meadow',
  'Anchor',
  'Willow',
  'Beacon',
  'Thicket',
  'Fountain',
  'Almond',
  'Shepherd',
] as const;

/** Every base name the vocabulary can produce, in a stable order. */
export const GUEST_BASE_NAMES: readonly string[] = ADJECTIVES.flatMap((adjective) =>
  NOUNS.map((noun) => `${adjective}${noun}`),
);

/**
 * A base name chosen without bias.
 *
 * `randomInt` rather than `Math.random`, not because a guest name is a secret
 * — it is not — but because the alternative invites somebody to reason about
 * how guessable it is, and there is no reason to have that conversation.
 */
export function randomGuestBaseName(pick: (limit: number) => number): string {
  const name = GUEST_BASE_NAMES[pick(GUEST_BASE_NAMES.length)];
  /* The vocabulary is a constant, so this is unreachable; the types ask. */
  return name ?? 'QuietCedar';
}

/** `QuietCedar` and `14` become the thing shown on screen. */
export function guestName(baseName: string, sequence: number): string {
  return `${baseName}-${sequence}`;
}

/**
 * How many times to try when the allocated name is somehow already taken.
 *
 * The sequence allocator makes collisions impossible in the ordinary case; the
 * unique index behind it makes them impossible in every case, at the price of
 * an error. This is what turns that error into another attempt rather than a
 * failed sign-up, and it is small because a second collision means something
 * is wrong that retrying will not fix.
 */
export const GUEST_NAME_ATTEMPTS = 5;
