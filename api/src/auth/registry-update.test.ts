/*
 * Refreshing the registry, and refusing to when the download cannot be trusted.
 *
 * A working registry is worth more than a fresh one: the failure cases matter
 * more than the success, because a half-applied update looks exactly like
 * everything working while protecting nothing.
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parseDomainList } from './email-domains.ts';
import { updateDisposableRegistry } from './registry-update.ts';

const REGISTRY = 'disposable-domains.txt';

/** A believable download: more domains than the floor. */
const plausible = (count = 1200) =>
  Array.from({ length: count }, (_, index) => `throwaway-${String(index)}.example`).join('\n');

async function directoryWithRegistry(contents = 'already-here.example\n') {
  const directory = await mkdtemp(join(tmpdir(), 'chat-registry-'));
  await writeFile(join(directory, REGISTRY), contents);
  return directory;
}

test('a good download replaces the registry and records where it came from', async () => {
  const directory = await directoryWithRegistry();
  const result = await updateDisposableRegistry({
    directory,
    fetchList: () => Promise.resolve(plausible()),
    now: () => new Date('2026-08-21T12:00:00.000Z'),
  });

  expect(result.ok).toBe(true);
  const written = await readFile(join(directory, REGISTRY), 'utf8');
  expect(parseDomainList(written).size).toBe(1200);
  expect(written).toContain('# updated: 2026-08-21T12:00:00.000Z');
  expect(written).toContain('# source: https://raw.githubusercontent.com/groundcat/');
});

test('an empty download cannot replace a working registry', async () => {
  const directory = await directoryWithRegistry('already-here.example\n');
  const result = await updateDisposableRegistry({
    directory,
    fetchList: () => Promise.resolve('   '),
  });

  expect(result.ok).toBe(false);
  /* The previous list is exactly where it was. */
  expect(await readFile(join(directory, REGISTRY), 'utf8')).toBe('already-here.example\n');
});

test('a truncated or error-page download cannot replace a working registry', async () => {
  const directory = await directoryWithRegistry('already-here.example\n');
  const result = await updateDisposableRegistry({
    directory,
    /* Many lines, no domains: what a 404 page parses to. */
    fetchList: () => Promise.resolve('<html><body>Not Found</body></html>\n'.repeat(50)),
  });

  expect(result.ok).toBe(false);
  expect(String((result as { reason: string }).reason)).toMatch(/fewer than|empty/i);
  expect(await readFile(join(directory, REGISTRY), 'utf8')).toBe('already-here.example\n');
});

test('a failed download leaves the previous registry intact', async () => {
  const directory = await directoryWithRegistry('already-here.example\n');
  const result = await updateDisposableRegistry({
    directory,
    fetchList: () => Promise.reject(new Error('network is down')),
  });

  expect(result.ok).toBe(false);
  expect(await readFile(join(directory, REGISTRY), 'utf8')).toBe('already-here.example\n');
});

test('an unwritable directory fails without destroying the old list', async () => {
  const directory = await directoryWithRegistry('already-here.example\n');
  const result = await updateDisposableRegistry({
    directory: join(directory, 'does-not-exist'),
    fetchList: () => Promise.resolve(plausible()),
  });

  expect(result.ok).toBe(false);
  expect(await readFile(join(directory, REGISTRY), 'utf8')).toBe('already-here.example\n');
});

test('the local overrides are never touched by an update', async () => {
  const directory = await directoryWithRegistry();
  await writeFile(join(directory, 'allowlist.txt'), '# rescued\nchurch-example.org\n');
  await writeFile(join(directory, 'blocklist.txt'), 'abusive.example\n');

  await updateDisposableRegistry({ directory, fetchList: () => Promise.resolve(plausible()) });

  expect(await readFile(join(directory, 'allowlist.txt'), 'utf8')).toContain('church-example.org');
  expect(await readFile(join(directory, 'blocklist.txt'), 'utf8')).toContain('abusive.example');
});

test('the written registry is normalised and deduplicated', async () => {
  const directory = await directoryWithRegistry();
  const messy = [plausible(), 'Example.COM', 'example.com', '  MAIL.Example.NET  ', ''].join('\n');
  await updateDisposableRegistry({ directory, fetchList: () => Promise.resolve(messy) });

  const written = parseDomainList(await readFile(join(directory, REGISTRY), 'utf8'));
  expect(written.has('example.com')).toBe(true);
  expect(written.has('mail.example.net')).toBe(true);
  expect(written.size).toBe(1202);
});
