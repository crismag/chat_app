/*
 * Assistance, configured entirely from the environment.
 *
 * Two rules govern this file and neither is negotiable.
 *
 *   1. **The key never lands here.** `AiConfig` records only whether a
 *      credential is present, not what it is. The adapter that needs it reads
 *      `process.env.GEMINI_API_KEY` itself at the moment of use. A config
 *      object is the sort of thing that gets logged, serialised into an error,
 *      or spread into a response by someone in a hurry; if the key is not in
 *      it, none of those mistakes can be the one that leaks it.
 *
 *   2. **The model name is configuration, not a constant.** Changing which
 *      model answers must need an environment variable and a restart, never a
 *      code edit and a deploy. The default below is a stable model — never a
 *      preview one, because a preview name can be withdrawn underneath a
 *      running server.
 */

/** Providers the service knows how to build. */
export const AI_PROVIDER_NAMES = {
  GEMINI: 'gemini',
  /*
   * A deterministic stand-in. It exists so tests and browser verification can
   * exercise the entire path — routes, validation, accept and discard — without
   * a key, without a network, and without spending anyone's quota.
   */
  FAKE: 'fake',
  NONE: 'none',
} as const;

export type AiProviderName = (typeof AI_PROVIDER_NAMES)[keyof typeof AI_PROVIDER_NAMES];

export interface AiConfig {
  /** The kill switch. False means no provider call is made, for any reason. */
  enabled: boolean;
  provider: AiProviderName;
  /** Whether the chosen provider has what it needs. Never the credential. */
  configured: boolean;
  model: string;
  timeoutMs: number;
  maxInputChars: number;
  /** Requests per user, and per IP, inside the window. */
  rateLimit: { perMinute: number };
}

const DEFAULTS = {
  /*
   * Off unless someone turned it on. A feature that reaches a paid third party
   * with a person's private reflection in the payload should not begin working
   * because a variable was forgotten.
   */
  enabled: false,
  provider: AI_PROVIDER_NAMES.GEMINI,
  /* Stable, low latency, low cost. Verified against the official model list. */
  model: 'gemini-2.5-flash-lite',
  timeoutMs: 15_000,
  maxInputChars: 12_000,
  ratePerMinute: 12,
} as const;

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  const normalised = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalised)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalised)) return false;
  return fallback;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function providerFrom(value: string | undefined): AiProviderName {
  const normalised = (value ?? DEFAULTS.provider).trim().toLowerCase();
  if (normalised === AI_PROVIDER_NAMES.FAKE) return AI_PROVIDER_NAMES.FAKE;
  if (normalised === AI_PROVIDER_NAMES.GEMINI) return AI_PROVIDER_NAMES.GEMINI;
  /*
   * An unrecognised provider is not a reason to fall back to a real one. It
   * resolves to nothing, the service reports `ai_not_configured`, and the
   * manual workflow carries on untouched.
   */
  return AI_PROVIDER_NAMES.NONE;
}

/**
 * Read the configuration, every time it is asked for.
 *
 * Deliberately not cached. The kill switch has to work without a redeploy, and
 * a value read once at import is a switch that only works on restart.
 */
export function readAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  /*
   * `CHAT_AI_DISABLED` predates this work and switches off *all* assistance,
   * including the heuristic title suggestion that needs no provider at all. It
   * is honoured here too, so one variable can still silence everything.
   */
  const killed = flag(env['CHAT_AI_DISABLED'], false);
  const enabled = !killed && flag(env['AI_ENABLED'], DEFAULTS.enabled);
  const provider = providerFrom(env['AI_PROVIDER']);

  const configured =
    provider === AI_PROVIDER_NAMES.FAKE
      ? true
      : provider === AI_PROVIDER_NAMES.GEMINI
        ? (env['GEMINI_API_KEY'] ?? '').trim().length > 0
        : false;

  return {
    enabled,
    provider,
    configured,
    model: (env['GEMINI_MODEL'] ?? '').trim() || DEFAULTS.model,
    timeoutMs: positiveInt(env['AI_REQUEST_TIMEOUT_MS'], DEFAULTS.timeoutMs),
    maxInputChars: positiveInt(env['AI_MAX_INPUT_CHARS'], DEFAULTS.maxInputChars),
    rateLimit: { perMinute: positiveInt(env['AI_RATE_LIMIT_PER_MINUTE'], DEFAULTS.ratePerMinute) },
  };
}
