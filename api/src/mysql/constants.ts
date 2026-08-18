export const IDENTITY_PROVIDERS = ['GOOGLE', 'FACEBOOK', 'APPLE', 'LOCAL'] as const;
export type IdentityProvider = (typeof IDENTITY_PROVIDERS)[number];

export const CHAT_TYPES = ['FULL', 'SHORT'] as const;
export type ChatType = (typeof CHAT_TYPES)[number];

export const AI_USAGE_FEATURES = [
  'REFLECTION_CHAT',
  'TITLE_GENERATION',
  'REFLECTION_REWRITE',
  'IMAGE_PROMPT',
  'IMAGE_GENERATION',
  'FORMAT_REFLECTION',
  'OTHER',
] as const;
export type AiUsageFeature = (typeof AI_USAGE_FEATURES)[number];
