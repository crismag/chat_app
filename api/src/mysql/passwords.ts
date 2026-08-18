import { hash, verify, argon2id } from 'argon2';

export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error('password is required');
  return hash(password, { type: argon2id });
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  if (!hashValue || !password) return false;
  try {
    return await verify(hashValue, password);
  } catch {
    return false;
  }
}

export function assertArgon2idHash(hashValue: string): void {
  if (!hashValue.startsWith('$argon2id$')) {
    throw new Error('local credentials must use Argon2id');
  }
}
