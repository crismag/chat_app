import { createHash, randomBytes } from 'node:crypto';

/** SHA-256 hex. Stored in user_sessions.token_hash. Never persist the raw token. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
