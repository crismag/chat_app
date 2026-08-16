/*
 * The connector, configured from the environment.
 *
 * The same rule that governs `ai/config.ts` governs this file, for the same
 * reason: **the key never lands in the config object.** `BibleConfig` records
 * only whether a credential is present. The one function that needs the value
 * reads `process.env.YVP_APP_KEY` at the moment of the request and passes it
 * straight into a header.
 *
 * That is not ceremony. A config object gets logged, spread into an error,
 * returned from a debug endpoint, or serialised into a status response by
 * somebody moving fast on a Friday. If the key is not in it, none of those
 * mistakes can be the one that leaks it.
 *
 * The path to the operator's env file is deliberately NOT known here. Loading
 * `~/.config/chat_app/youversion.env` is the operator's job — a shell, a
 * systemd unit, a container secret. Code that reads a hard-coded home directory
 * is code that only works on one machine and that quietly ties a secret's
 * location into the repository.
 */

export interface BibleConfig {
  /** The kill switch. False means no provider call is made, for any reason. */
  enabled: boolean;
  /** Whether a credential is present. Never the credential. */
  configured: boolean;
  baseUrl: string;
  timeoutMs: number;
  /**
   * The languages the catalog is assembled from.
   *
   * Configuration rather than a constant, and it matters more than it looks:
   * **the provider has no "list every Bible" call.** A request without
   * `language_ranges[]` is rejected outright, so the catalog is exactly the set
   * of languages named here — and a language nobody thought to add is a
   * language whose Bibles do not exist as far as this application is concerned.
   * Adding one must never need a code change and a deploy.
   */
  languages: string[];
  /** How long the translation catalog may be reused. */
  catalogTtlMs: number;
  /** How long a fetched passage may be held in memory. See `cache.ts`. */
  passageTtlMs: number;
  /** Lookups per user, and per address, inside a minute. */
  rateLimit: { perMinute: number };
  /**
   * Whether passage TEXT may be included in a prompt sent to the AI provider.
   *
   * Off by default and read from configuration rather than assumed, because it
   * is a licensing decision and not an engineering one. See
   * `ScriptureForPrompt` in `@chat/shared`.
   */
  scriptureInPrompts: boolean;
}

const DEFAULTS = {
  /*
   * On by default, unlike assistance.
   *
   * The difference is what leaves the building. An assistance call sends a
   * person's private reflection to a third party, so it must be switched on
   * deliberately. A passage lookup sends a Bible reference and nothing else —
   * no reflection, no account, no text anyone wrote — and a Bible app whose
   * Bible has to be enabled by an environment variable is a broken Bible app.
   * With no key present it is `configured: false` and says so plainly.
   */
  enabled: true,
  baseUrl: 'https://api.youversion.com/v1',
  /*
   * The default set, and why these seven.
   *
   * English because it is this application's first audience. Filipino and
   * Cebuano because they are the languages of the communities this product was
   * built for, and a Bible app that cannot offer someone a Bible in their own
   * language has failed at the only thing it does. Spanish, French, German and
   * Chinese because they are the next largest groups the key can reach and
   * fetching them costs one list request each, once a day.
   *
   * Verified against the key on 2026-08-16: en 20, es 8, de 7, fr 6, zh 3,
   * tl 2, ceb 1 — 47 translations.
   */
  languages: ['en', 'tl', 'ceb', 'es', 'fr', 'de', 'zh'],
  timeoutMs: 8_000,
  /* A translation catalog changes a few times a year. A day is generous. */
  catalogTtlMs: 24 * 60 * 60 * 1000,
  /*
   * Fifteen minutes, and it is a request-collapsing window rather than a store.
   * See the long note in `cache.ts` about why passage text is not persisted as
   * an optimisation.
   */
  passageTtlMs: 15 * 60 * 1000,
  ratePerMinute: 30,
} as const;

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  const normalised = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalised)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalised)) return false;
  return fallback;
}

/**
 * A comma-separated language list, validated tag by tag.
 *
 * Anything that is not a plausible language range is DROPPED rather than
 * passed through, because these values are interpolated into a request to the
 * provider. An operator's typo should cost them that one language, not turn
 * into a malformed query for the other six.
 *
 * An empty or entirely invalid setting falls back to the defaults. A catalog of
 * nothing is not a useful interpretation of a misconfigured variable — it is a
 * Bible app with no Bibles.
 */
function languageList(value: string | undefined): string[] {
  const parsed = (value ?? '')
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(tag));
  const unique = [...new Set(parsed)];
  return unique.length > 0 ? unique : [...DEFAULTS.languages];
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Read the configuration, every time it is asked for.
 *
 * Not cached, so the kill switch works without a restart — and so a key added
 * to a running process's environment takes effect on the next request.
 */
export function readBibleConfig(env: NodeJS.ProcessEnv = process.env): BibleConfig {
  return {
    enabled: flag(env['BIBLE_ENABLED'], DEFAULTS.enabled),
    configured: (env['YVP_APP_KEY'] ?? '').trim().length > 0,
    baseUrl: (env['YVP_API_BASE_URL'] ?? '').trim() || DEFAULTS.baseUrl,
    languages: languageList(env['BIBLE_LANGUAGES']),
    timeoutMs: positiveInt(env['BIBLE_REQUEST_TIMEOUT_MS'], DEFAULTS.timeoutMs),
    catalogTtlMs: positiveInt(env['BIBLE_CATALOG_TTL_MS'], DEFAULTS.catalogTtlMs),
    passageTtlMs: positiveInt(env['BIBLE_PASSAGE_TTL_MS'], DEFAULTS.passageTtlMs),
    rateLimit: { perMinute: positiveInt(env['BIBLE_RATE_LIMIT_PER_MINUTE'], DEFAULTS.ratePerMinute) },
    scriptureInPrompts: flag(env['BIBLE_SCRIPTURE_IN_PROMPTS'], false),
  };
}

/**
 * The credential, read at the moment of use.
 *
 * The only function in the codebase that touches it. It returns the value to
 * exactly one caller — the request builder, which puts it in a header — and it
 * is never stored on an object, never returned to a route, and never logged.
 */
export function readAppKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = (env['YVP_APP_KEY'] ?? '').trim();
  return key.length > 0 ? key : null;
}
