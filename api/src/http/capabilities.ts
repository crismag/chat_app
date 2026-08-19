/*
 * Switches for the outward-facing features, so an incident does not have to
 * take the application down.
 *
 * The reason this exists is a product decision rather than an operational one.
 * Private reflection writing is what C.H.A.T. is; Public and Communities are
 * layers on top of it. If a spam wave arrives, or the provider bill starts
 * climbing in a way nobody can explain at midnight, the answer must not be to
 * stop somebody writing about Romans 8 — so each outward capability can be
 * turned off on its own and the core stays up:
 *
 *     private writing        ON
 *     external sharing       ON
 *     public publishing      OFF
 *     community publishing   OFF
 *     community creation     OFF
 *     assistance             limited or OFF
 *
 * Read from the environment and re-read on every request, so switching one off
 * is a configuration change rather than a deploy. Absent means on: a missing
 * variable must never be the thing that silently disables a feature.
 */

/** The things that can be switched off without touching private writing. */
export const CAPABILITIES = {
  REGISTRATION: 'registration',
  PUBLIC_SHARING: 'public_sharing',
  COMMUNITY_SHARING: 'community_sharing',
  COMMUNITY_CREATION: 'community_creation',
  COMMUNITY_JOINING: 'community_joining',
  AI_REQUESTS: 'ai_requests',
  IMAGE_GENERATION: 'image_generation',
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

const ENV_NAMES: Record<Capability, string> = {
  [CAPABILITIES.REGISTRATION]: 'CHAT_DISABLE_REGISTRATION',
  [CAPABILITIES.PUBLIC_SHARING]: 'CHAT_DISABLE_PUBLIC_SHARING',
  [CAPABILITIES.COMMUNITY_SHARING]: 'CHAT_DISABLE_COMMUNITY_SHARING',
  [CAPABILITIES.COMMUNITY_CREATION]: 'CHAT_DISABLE_COMMUNITY_CREATION',
  [CAPABILITIES.COMMUNITY_JOINING]: 'CHAT_DISABLE_COMMUNITY_JOINING',
  [CAPABILITIES.AI_REQUESTS]: 'CHAT_DISABLE_AI_REQUESTS',
  [CAPABILITIES.IMAGE_GENERATION]: 'CHAT_DISABLE_IMAGE_GENERATION',
};

/**
 * What a person is told when a capability is off.
 *
 * Honest and finite: something is switched off, it is not their fault, and
 * their own writing is untouched. Not "an error occurred", which invites
 * somebody to keep pressing.
 */
const REASONS: Record<Capability, string> = {
  [CAPABILITIES.REGISTRATION]: 'New accounts are paused for a short while. Nothing you have written is affected.',
  [CAPABILITIES.PUBLIC_SHARING]: 'Sharing publicly is paused for a short while. Your reflection is saved and unchanged.',
  [CAPABILITIES.COMMUNITY_SHARING]: 'Sharing to communities is paused for a short while. Your reflection is saved and unchanged.',
  [CAPABILITIES.COMMUNITY_CREATION]: 'Creating communities is paused for a short while.',
  [CAPABILITIES.COMMUNITY_JOINING]: 'Joining communities is paused for a short while.',
  [CAPABILITIES.AI_REQUESTS]: 'Assistance is paused for a short while. You can keep writing without it.',
  [CAPABILITIES.IMAGE_GENERATION]: 'Image creation is paused for a short while.',
};

function truthy(value: string | undefined): boolean {
  const normalised = value?.trim().toLowerCase();
  return normalised === '1' || normalised === 'true' || normalised === 'yes';
}

/** Whether a capability is available right now. */
export function isEnabled(
  capability: Capability,
  env: NodeJS.Dict<string> = process.env,
): boolean {
  return !truthy(env[ENV_NAMES[capability]]);
}

export function unavailableReason(capability: Capability): string {
  return REASONS[capability];
}

/** Every switch, as an operator sees it. Never exposed to a client. */
export function capabilityReport(env: NodeJS.Dict<string> = process.env): Record<string, boolean> {
  return Object.fromEntries(
    Object.values(CAPABILITIES).map((capability) => [capability, isEnabled(capability, env)]),
  );
}
