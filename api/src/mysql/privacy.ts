/*
 * Central MySQL stores durable product records. It does not store the private
 * AI conversation used to arrive at a saved reflection.
 *
 * Conversation history belongs on the user's device (IndexedDB on the web).
 * The server may see a prompt only in memory while calling a provider.
 */

export const FORBIDDEN_CENTRAL_TABLES = [
  'reflection_messages',
  'ai_messages',
  'conversation_history',
  'conversation_transcripts',
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
