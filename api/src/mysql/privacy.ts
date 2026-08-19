/*
 * What the central database may and may not hold.
 *
 * This file used to say that AI conversation content never reaches the server
 * and belongs on the device. That rule is withdrawn, on the owner's decision
 * and for a stated reason: the published Privacy Policy tells people "we may
 * collect ... AI conversations", and a product that quietly did less than its
 * policy claimed would still be a product whose policy did not describe it.
 * The two now agree, and `reflection_messages` (migration 004) is where the
 * conversation lives.
 *
 * The rule beside it survives untouched, because it was never the same rule.
 * Usage telemetry meters cost and abuse; it is not an archive. A conversation
 * an author can open, read and delete is a record of their own writing. A
 * prompt copied into `ai_usage_events` is a second copy they were never shown
 * and cannot reach — which is the thing worth prohibiting, and still is.
 */

/**
 * Tables that would make usage metering into a content store under another
 * name. `reflection_messages` is deliberately NOT among them: it is the
 * conversation itself, owned by its author and deleted with their reflection.
 */
export const FORBIDDEN_CENTRAL_TABLES = [
  'ai_prompt_archives',
  'ai_response_archives',
] as const;

/** Column names that would turn usage telemetry into a conversation archive. */
export const FORBIDDEN_USAGE_COLUMNS = [
  'prompt',
  'prompts',
  'response',
  'responses',
  'message',
  'messages',
  'transcript',
  'conversation',
  'contents',
  'written',
] as const;
