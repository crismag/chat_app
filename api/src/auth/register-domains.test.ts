/*
 * Which addresses may open an account.
 *
 * Deny-based on purpose. A list of approved providers turns away the pastor at
 * a church domain, the student at a university and everybody running their own
 * — a large share of the people this is for. These pin that, and pin that a
 * deployment which has configured nothing refuses nobody.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';

let previous: string | undefined;

function listsIn(files: { allow?: string; block?: string; disposable?: string }) {
  const directory = mkdtempSync(join(tmpdir(), 'email-lists-'));
  writeFileSync(join(directory, 'allowlist.txt'), files.allow ?? '');
  writeFileSync(join(directory, 'blocklist.txt'), files.block ?? '');
  if (files.disposable !== undefined) {
    writeFileSync(join(directory, 'disposable-domains.txt'), files.disposable);
  }
  process.env['EMAIL_DOMAIN_LIST_DIR'] = directory;
}

beforeEach(() => {
  previous = process.env['EMAIL_DOMAIN_LIST_DIR'];
});

afterEach(() => {
  if (previous === undefined) delete process.env['EMAIL_DOMAIN_LIST_DIR'];
  else process.env['EMAIL_DOMAIN_LIST_DIR'] = previous;
});

function register(app: ReturnType<typeof createApp>, email: string) {
  return app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret12' }),
  });
}

test('a throwaway domain is refused, and told why it may use another', async () => {
  listsIn({ disposable: 'throwaway.example\n' });
  const app = createApp(new SqliteStore());

  const response = await register(app, 'ada@throwaway.example');

  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: string };
  expect(body.error).toMatch(/still have next month/i);
  /*
   * Which list caught it is not said. That would tell somebody probing
   * exactly which one to try next.
   */
  expect(body.error).not.toMatch(/disposable|blocklist|registry/i);
});

test('a domain this application refuses today does not wait for upstream', async () => {
  listsIn({ block: 'abused-today.example\n' });
  const app = createApp(new SqliteStore());

  expect((await register(app, 'ada@abused-today.example')).status).toBe(400);
});

test('the local allowlist wins, because upstream misclassifies real organisations', async () => {
  /* Somebody must be able to fix that in a file, not in a deployment. */
  listsIn({ allow: 'church.example\n', disposable: 'church.example\n' });
  const app = createApp(new SqliteStore());

  expect((await register(app, 'pastor@church.example')).status).toBe(201);
});

test('an ordinary address is not turned away', async () => {
  listsIn({ disposable: 'throwaway.example\n' });
  const app = createApp(new SqliteStore());

  /* The people this product is for, who do not use one of four providers. */
  for (const email of ['pastor@church.example', 'student@university.example', 'ada@ada.example']) {
    expect((await register(app, email)).status).toBe(201);
  }
});

test('a deployment with no lists configured refuses nobody', async () => {
  delete process.env['EMAIL_DOMAIN_LIST_DIR'];
  const app = createApp(new SqliteStore());

  expect((await register(app, 'ada@throwaway.example')).status).toBe(201);
});

test('an unreadable list directory refuses nobody either', async () => {
  process.env['EMAIL_DOMAIN_LIST_DIR'] = join(tmpdir(), 'definitely-not-here-' + String(Date.now()));
  const app = createApp(new SqliteStore());

  /* Misconfiguration must not become a closed door. */
  expect((await register(app, 'ada@throwaway.example')).status).toBe(201);
});
