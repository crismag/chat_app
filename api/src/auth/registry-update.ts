import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DOMAIN_LIST_FILES, parseDomainList } from './email-domains.ts';

/*
 * Refreshing the cached disposable-domain registry.
 *
 * Run from a deployment step or a cron job, never from a sign-in request:
 * authentication must keep working when GitHub does not, so the registry is a
 * local file that this replaces occasionally and nothing fetches at the moment
 * somebody is waiting.
 *
 * The rule that matters is the one about failure. A working registry is worth
 * more than a fresh one, so a download that is empty, truncated, or not a list
 * of domains leaves the existing file exactly where it is. An update that
 * cannot be trusted is not applied — the alternative is a half-written file
 * that silently stops rejecting anything, which looks like everything working.
 */

export const UPSTREAM_URL =
  'https://raw.githubusercontent.com/groundcat/disposable-email-domain-list/master/domains.txt';

/**
 * The fewest domains a believable registry has.
 *
 * Upstream carries thousands. A download that parses to a handful is a
 * redirect, an error page or a truncated transfer, and applying it would
 * quietly disarm the check while looking like a success.
 */
export const MINIMUM_DOMAINS = 1000;

export type RegistryUpdate =
  | { ok: true; domains: number; path: string }
  | { ok: false; reason: string; domains?: number };

export interface RegistryUpdateOptions {
  directory: string;
  /** Injectable so tests never depend on GitHub being reachable. */
  fetchList: () => Promise<string>;
  minimumDomains?: number;
  now?: () => Date;
  source?: string;
}

/**
 * Download, check, and only then replace.
 *
 * The write is to a temporary file in the same directory followed by a rename,
 * because a rename within a filesystem is atomic: a reader either sees the old
 * registry or the new one, never a file being written. A partially written
 * registry is the worst outcome available — it parses, it looks fine, and it
 * has stopped protecting anything.
 */
export async function updateDisposableRegistry(
  options: RegistryUpdateOptions,
): Promise<RegistryUpdate> {
  const minimum = options.minimumDomains ?? MINIMUM_DOMAINS;
  const now = options.now ?? (() => new Date());

  let downloaded: string;
  try {
    downloaded = await options.fetchList();
  } catch (error: unknown) {
    return { ok: false, reason: `download failed: ${error instanceof Error ? error.name : 'unknown'}` };
  }

  if (typeof downloaded !== 'string' || downloaded.trim() === '') {
    return { ok: false, reason: 'the download was empty' };
  }

  /*
   * Parsed rather than counted by line, so the check is on usable domains. An
   * error page is many lines and no domains.
   */
  const domains = parseDomainList(downloaded);
  if (domains.size < minimum) {
    return {
      ok: false,
      reason: `only ${domains.size} usable domains, fewer than the ${minimum} a real registry has`,
      domains: domains.size,
    };
  }

  const target = join(options.directory, DOMAIN_LIST_FILES.disposable);
  const temporary = `${target}.${process.pid}.tmp`;
  const stamp = now().toISOString();
  const body = [
    `# ${DOMAIN_LIST_FILES.disposable}`,
    `# source: ${options.source ?? UPSTREAM_URL}`,
    `# updated: ${stamp}`,
    `# domains: ${domains.size}`,
    '#',
    '# Generated. Local overrides belong in allowlist.txt and blocklist.txt,',
    '# which this never touches.',
    ...[...domains].sort(),
    '',
  ].join('\n');

  try {
    await writeFile(temporary, body, 'utf8');
    await rename(temporary, target);
  } catch (error: unknown) {
    /*
     * The existing registry is untouched: nothing was written over it, only
     * beside it. A leftover temporary file is harmless and is not read.
     */
    return { ok: false, reason: `could not write: ${error instanceof Error ? error.name : 'unknown'}` };
  }

  return { ok: true, domains: domains.size, path: target };
}

/** Download over HTTP, for the command-line updater. */
export async function fetchUpstreamList(url = UPSTREAM_URL): Promise<string> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`upstream answered ${String(response.status)}`);
  return response.text();
}
