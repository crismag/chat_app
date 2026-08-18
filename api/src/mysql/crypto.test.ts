import { describe, expect, it } from 'vitest';
import { assertArgon2idHash, hashPassword, verifyPassword } from './passwords.ts';
import { hashSessionToken, newSessionToken } from './tokens.ts';

describe('password hashing', () => {
  it('stores Argon2id and never a reversible or MD5 digest', async () => {
    const digest = await hashPassword('correct horse battery staple');
    assertArgon2idHash(digest);
    expect(digest.toLowerCase()).not.toContain('md5');
    expect(digest).not.toBe('correct horse battery staple');
    expect(await verifyPassword(digest, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(digest, 'wrong')).toBe(false);
  });
});

describe('session tokens', () => {
  it('hashes tokens with SHA-256 hex and does not equal the raw token', () => {
    const token = newSessionToken();
    const hashed = hashSessionToken(token);
    expect(hashed).toHaveLength(64);
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).not.toBe(token);
    expect(hashSessionToken(token)).toBe(hashed);
  });
});
