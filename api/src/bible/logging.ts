/*
 * What a passage lookup is allowed to write down.
 *
 * Stated as an allow-list, exactly as `ai/logging.ts` is, and for the harder of
 * the two reasons. That file is protecting a person's private reflection; this
 * one is also protecting a credential that travels in a header on every single
 * request. A log line is built field by field from the typed event — never by
 * spreading an object, never from a `Response`, never from a caught error's
 * message — so there is no code path along which a header, a URL with a query
 * string, or an upstream body can reach the output.
 *
 * `detail` is our own short diagnosis, written in this codebase. It is never a
 * provider message. That distinction is load-bearing: provider messages are
 * where keys, account identifiers and internal hostnames live.
 *
 * There is no `debug` mode that prints more. A debug flag that reveals headers
 * is a key leak waiting for the day somebody sets it in production to work out
 * why a lookup is failing — which is exactly the day they would.
 */

import type { BibleOutcome, BibleProvider } from '@chat/shared';

export interface BibleLogEvent {
  requestId: string;
  operation: 'translations' | 'passage';
  provider: BibleProvider;
  outcome: BibleOutcome;
  /** Our own diagnosis. Never a provider message, never user text, never a key. */
  detail?: string;
}

/**
 * Anything that must never appear, whatever its value.
 *
 * Checked by the test suite against a real-shaped key, and against the header
 * name itself — because a line reading `"x-yvp-app-key": "…"` is a leak even
 * when the value has been trimmed to a prefix.
 */
const FORBIDDEN_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-yvp-app-key',
  'xyvpappkey',
  'yvp_app_key',
  'appkey',
  'app_key',
  'apikey',
  'api_key',
  'key',
  'token',
  'password',
  'headers',
  'url',
  'content',
  'passage',
  'passagetext',
  'reference',
  'text',
];

export function redactBible(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (Array.isArray(value)) return value.map((item) => redactBible(item, depth + 1));
  if (value === null || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.includes(key.toLowerCase().replace(/[^a-z_]/g, ''))) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = redactBible(item, depth + 1);
  }
  return out;
}

/**
 * The one place a lookup writes anything down.
 *
 * Built field by field on purpose: a field added to `BibleLogEvent` later has
 * to be added here deliberately before it can ever be printed.
 */
export function bibleLogLine(event: BibleLogEvent): Record<string, unknown> {
  return {
    at: new Date().toISOString(),
    kind: 'bible_request',
    requestId: event.requestId,
    operation: event.operation,
    provider: event.provider,
    outcome: event.outcome,
    ...(event.detail === undefined ? {} : { detail: event.detail }),
  };
}

export type BibleLogger = (event: BibleLogEvent) => void;

export const consoleBibleLogger: BibleLogger = (event) => {
  console.info(JSON.stringify(bibleLogLine(event)));
};

/** Writes nothing. The default under test. */
export const silentBibleLogger: BibleLogger = () => {};
