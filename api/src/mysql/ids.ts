import { randomUUID } from 'node:crypto';

export function newPublicUuid(): string {
  return randomUUID();
}

export function asBigIntId(value: unknown): number {
  const n = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('expected a positive integer identifier');
  }
  return n;
}
