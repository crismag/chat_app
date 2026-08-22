/*
 * Who a request is metered as.
 *
 * Guest creation, registration and forgot-password have no account to meter,
 * so this value *is* their rate limit. A caller who can choose it has none:
 * a header rotated per request is a fresh bucket every time.
 */
import type { Context } from 'hono';
import { expect, test } from 'vitest';

import { addressOf, isLoopback } from './address.ts';

/** A request as it arrives: from some peer, claiming some headers. */
function request({
  peer,
  headers = {},
}: {
  peer: string | null | undefined;
  headers?: Record<string, string>;
}): Context {
  return {
    env: peer === undefined ? undefined : { incoming: { socket: { remoteAddress: peer } } },
    req: { header: (name: string) => headers[name] },
  } as unknown as Context;
}

test('the gateway on this machine may speak for somebody else', () => {
  /* PHP sets the header from the socket it accepted; that is its whole job. */
  const address = addressOf(
    request({ peer: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.9' } }),
  );
  expect(address).toBe('203.0.113.9');
});

test('a caller reaching the port directly is named by its socket, whatever it claims', () => {
  const address = addressOf(
    request({ peer: '198.51.100.7', headers: { 'x-forwarded-for': '203.0.113.9' } }),
  );

  /*
   * The spoofed value must not become the bucket. If it did, one client could
   * mint a new allowance per request and the limit would not exist.
   */
  expect(address).toBe('198.51.100.7');
  expect(address).not.toBe('203.0.113.9');
});

test('rotating the header does not rotate the bucket for a direct caller', () => {
  const buckets = ['a', 'b', 'c'].map((claim) =>
    addressOf(request({ peer: '198.51.100.7', headers: { 'x-forwarded-for': claim } })),
  );
  expect(new Set(buckets).size).toBe(1);
});

test('an in-process request has no socket to spoof, and is read as written', () => {
  /* This is how the test suite drives the app; there is no network involved. */
  const address = addressOf(request({ peer: undefined, headers: { 'x-forwarded-for': '203.0.113.9' } }));
  expect(address).toBe('203.0.113.9');
});

test('loopback is recognised in every form Node reports it', () => {
  expect(isLoopback('127.0.0.1')).toBe(true);
  expect(isLoopback('127.0.0.53')).toBe(true);
  expect(isLoopback('::1')).toBe(true);
  /* Node reports an IPv4 peer on a dual-stack socket like this. */
  expect(isLoopback('::ffff:127.0.0.1')).toBe(true);

  expect(isLoopback('198.51.100.7')).toBe(false);
  expect(isLoopback('::ffff:198.51.100.7')).toBe(false);
  /* Not loopback, however much it looks like it. */
  expect(isLoopback('1.127.0.0')).toBe(false);
  expect(isLoopback(null)).toBe(false);
});

test('a peer with no headers is simply itself', () => {
  expect(addressOf(request({ peer: '198.51.100.7' }))).toBe('198.51.100.7');
});
