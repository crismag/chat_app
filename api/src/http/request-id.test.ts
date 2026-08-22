/*
 * Request ids, and what a thrown request says back.
 *
 * The rules worth pinning are the ones about what does *not* travel: no stack
 * and no driver message in the body, and nothing in the log line that a person
 * wrote.
 */
import { Hono } from 'hono';
import { afterEach, expect, test, vi } from 'vitest';

import { onError } from './errors.ts';
import { readRequestId, requestId, requestIdOf } from './request-id.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

function app() {
  const api = new Hono();
  api.use('*', requestId());
  api.onError(onError);
  api.get('/ok', (c) => c.json({ id: requestIdOf(c) }));
  api.get('/broken', () => {
    throw new Error('SELECT * FROM users WHERE email = "ada@example.com" failed');
  });
  return api;
}

test('every response carries an id, whether or not anything went wrong', async () => {
  const response = await app().request('/ok');
  const header = response.headers.get('x-request-id');

  expect(header).toBeTruthy();
  /* The same one the handler saw, so a log line and a network tab agree. */
  expect((await response.json()) as { id: string }).toEqual({ id: header });
});

test("a client's own id is honoured, so a report can be traced through the gateway", async () => {
  const response = await app().request('/ok', { headers: { 'x-request-id': 'phone-42' } });
  expect(response.headers.get('x-request-id')).toBe('phone-42');
});

test('an id from outside is made safe before it is ever written down', () => {
  /* A log line is a place a forged value would otherwise be believed. */
  expect(readRequestId('a b\nINFO fake line')).toBe('abINFOfakeline');
  expect(readRequestId('x'.repeat(200))).toHaveLength(64);
  expect(readRequestId('   ')).toMatch(/^[0-9a-f-]{36}$/);
  expect(readRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
});

test('a thrown request answers JSON, and tells the reader nothing about the database', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const response = await app().request('/broken');

  expect(response.status).toBe(500);
  const body = (await response.json()) as { error: string; requestId: string };
  expect(body.error).toBe('Something went wrong on our side. Please try again.');
  /* Not the table, not the column, not the address that was being looked up. */
  expect(JSON.stringify(body)).not.toMatch(/SELECT|users|ada@example\.com/);
  expect(body.requestId).toBe(response.headers.get('x-request-id'));
});

test('the failure is logged with the id, and the query string is not', async () => {
  const logged: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
    logged.push(String(line));
  });

  await app().request('/broken?q=something%20somebody%20typed');

  expect(logged).toHaveLength(1);
  expect(logged[0]).toContain('/broken');
  /* A search term is what somebody was looking for. It is not diagnostics. */
  expect(logged[0]).not.toContain('something');
});
