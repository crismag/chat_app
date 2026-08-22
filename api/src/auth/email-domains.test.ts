/*
 * Which addresses this application will send a link to.
 *
 * The order of the lists is the design, so it is asserted directly: an
 * allowlist that does not beat the registry is an allowlist that cannot
 * rescue a misclassified church.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  classifyDomain,
  loadDomainLists,
  normaliseDomain,
  normaliseEmail,
  parseDomainList,
  type DomainListSnapshot,
} from './email-domains.ts';

const lists = (over: Partial<DomainListSnapshot> = {}): DomainListSnapshot => ({
  allow: new Set(),
  block: new Set(),
  disposable: new Set(),
  disposableLoaded: true,
  ...over,
});

/* ------------------------------------------------------------ normalising */

test('a malformed address is refused', () => {
  for (const bad of ['', '   ', 'nobody', 'no@', '@example.com', 'a b@example.com', 'a@b', 'a@@b.com']) {
    expect(normaliseEmail(bad)).toBeNull();
  }
  expect(normaliseEmail(42)).toBeNull();
  expect(normaliseEmail(null)).toBeNull();
});

test('the domain folds for comparison while the address is kept as typed', () => {
  const email = normaliseEmail('  Reader.Name+notes@Example.COM  ');
  expect(email?.domain).toBe('example.com');
  /* Sent to exactly what they typed: the local part is the provider's business. */
  expect(email?.address).toBe('Reader.Name+notes@Example.COM');
  /* Compared case-folded, and with no dot or +tag rules invented for them. */
  expect(email?.comparable).toBe('reader.name+notes@example.com');
});

test('an internationalised domain compares equal to its punycode form', () => {
  const unicode = normaliseEmail('someone@münchen.de');
  const punycode = normaliseEmail('someone@xn--mnchen-3ya.de');
  expect(unicode?.domain).toBe(punycode?.domain);
});

test('a trailing dot and stray case are folded away', () => {
  expect(normaliseDomain('Example.COM.')).toBe('example.com');
});

/* ------------------------------------------------------------------ files */

test('comments, blanks and duplicates are handled when loading', () => {
  const parsed = parseDomainList(
    ['# why this is here', '', '  Example.COM  ', 'example.com', 'mail.example.net', '   ', 'not a domain'].join('\n'),
  );
  expect([...parsed].sort()).toEqual(['example.com', 'mail.example.net']);
});

test('a line that is not a domain is skipped rather than failing the file', () => {
  const parsed = parseDomainList(['good.com', '!!!', 'also-good.org'].join('\n'));
  expect(parsed.has('good.com')).toBe(true);
  expect(parsed.has('also-good.org')).toBe(true);
});

test('the three files load into sets, and a missing registry is distinguishable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chat-email-lists-'));
  await writeFile(join(directory, 'allowlist.txt'), '# rescued\nchurch-example.org\n');
  await writeFile(join(directory, 'blocklist.txt'), 'abusive.example\n');

  const withoutRegistry = await loadDomainLists(directory);
  expect(withoutRegistry.allow.has('church-example.org')).toBe(true);
  expect(withoutRegistry.block.has('abusive.example')).toBe(true);
  /*
   * The absence of the registry is carried, not flattened into "matched
   * nothing" — which is what a loaded-and-empty registry would look like.
   */
  expect(withoutRegistry.disposableLoaded).toBe(false);

  await writeFile(join(directory, 'disposable-domains.txt'), 'temporary.example\n');
  const withRegistry = await loadDomainLists(directory);
  expect(withRegistry.disposableLoaded).toBe(true);
  expect(withRegistry.disposable.has('temporary.example')).toBe(true);
});

/* ------------------------------------------------------------ the ordering */

test('an unknown domain is acceptable so far', () => {
  expect(classifyDomain('personal-domain.com', lists())).toBe('unknown');
});

test('the disposable registry rejects a temporary provider', () => {
  expect(classifyDomain('temporary.example', lists({ disposable: new Set(['temporary.example']) })))
    .toBe('disposable');
});

test('the local blocklist rejects a domain upstream has not caught', () => {
  expect(classifyDomain('abusive.example', lists({ block: new Set(['abusive.example']) }))).toBe('blocked');
});

test('the allowlist beats the disposable registry', () => {
  const verdict = classifyDomain(
    'church-example.org',
    lists({ allow: new Set(['church-example.org']), disposable: new Set(['church-example.org']) }),
  );
  /* The whole point: a misclassified organisation is rescued by a file. */
  expect(verdict).toBe('allowed');
});

test('the allowlist beats the local blocklist too', () => {
  const verdict = classifyDomain(
    'church-example.org',
    lists({ allow: new Set(['church-example.org']), block: new Set(['church-example.org']) }),
  );
  expect(verdict).toBe('allowed');
});

test('the local blocklist beats the downloaded registry', () => {
  /* Not observable through the verdict alone, so assert the precedence directly. */
  const verdict = classifyDomain(
    'contested.example',
    lists({ block: new Set(['contested.example']), disposable: new Set(['contested.example']) }),
  );
  expect(verdict).toBe('blocked');
});

test('a permanent provider is not treated as disposable for being easy to join', () => {
  /*
   * Privacy-oriented is not disposable. Refusing these would turn away exactly
   * the people most careful about what they write.
   */
  for (const domain of ['gmail.com', 'proton.me', 'protonmail.com', 'outlook.com', 'university.edu']) {
    expect(classifyDomain(domain, lists())).toBe('unknown');
  }
});
