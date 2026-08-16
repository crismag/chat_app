/*
 * What an assistance call is allowed to write down.
 *
 * The rule is stated as an allow-list rather than a deny-list, because a
 * deny-list is a promise to have thought of everything. A log line carries the
 * fields named in `AiLogEvent` and no others: no passage, no reflection, no
 * prompt, no model output, no headers, no key, no cookie.
 *
 * That costs something real — a bad suggestion cannot be reproduced from the
 * logs — and it is the right trade. The content in question is a person's
 * private reflection on Scripture, often the most personal thing they have
 * written that week, and an application that quietly keeps a copy of it in a
 * log aggregator has not asked them about that.
 */

import type { AiOutcome } from '@chat/shared';
import type { AiUsage } from './types.ts';

export interface AiLogEvent {
  requestId: string;
  operation: 'reflection_guidance' | 'improve_writing' | 'reflection_chat';
  provider: string;
  /** The configured model name. A configuration value, not a credential. */
  model: string;
  promptVersion: string;
  latencyMs: number;
  outcome: AiOutcome;
  /** Whether the one permitted retry was used. */
  retried?: boolean;
  usage?: AiUsage;
  /** Our own short diagnosis. Never a provider message and never user text. */
  detail?: string;
}

/** Keys that must never appear in a log line, whatever their value. */
const FORBIDDEN_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'apikey',
  'api_key',
  'gemini_api_key',
  'key',
  'token',
  'password',
  'passage',
  'passagetext',
  'reflection',
  'text',
  'written',
  'prompt',
  'contents',
  'suggested',
  'original',
  'questions',
];

/**
 * Strip anything that must not be logged, at any depth.
 *
 * Exported because the test suite asserts on it directly. A redaction function
 * nobody can test is a redaction function nobody knows works.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value === null || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.includes(key.toLowerCase())) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = redact(item, depth + 1);
  }
  return out;
}

/**
 * The one place an assistance call writes anything down.
 *
 * Built field by field from the typed event rather than by spreading it, so a
 * field added to `AiLogEvent` in future has to be added here deliberately
 * before it can be printed.
 */
export function aiLogLine(event: AiLogEvent): Record<string, unknown> {
  return {
    at: new Date().toISOString(),
    kind: 'ai_request',
    requestId: event.requestId,
    operation: event.operation,
    provider: event.provider,
    model: event.model,
    promptVersion: event.promptVersion,
    latencyMs: event.latencyMs,
    outcome: event.outcome,
    ...(event.retried === undefined ? {} : { retried: event.retried }),
    ...(event.usage === undefined ? {} : { usage: redact(event.usage) }),
    ...(event.detail === undefined ? {} : { detail: event.detail }),
  };
}

export type AiLogger = (event: AiLogEvent) => void;

export const consoleAiLogger: AiLogger = (event) => {
  /* One JSON object per line, so a collector can read it without a parser. */
  console.info(JSON.stringify(aiLogLine(event)));
};

/** Writes nothing. The default under test, so a suite is not a log firehose. */
export const silentAiLogger: AiLogger = () => {};
