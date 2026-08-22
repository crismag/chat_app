import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/*
 * Which email domains this application will send a sign-in link to.
 *
 * The decision is deliberately deny-based rather than a list of approved
 * providers. A whitelist of the big four would turn away the pastor at
 * `church.org`, the student at `university.edu` and everybody with a domain of
 * their own — which is a large share of the people this is for. So the
 * question is never "is this a provider we have heard of", it is "is this a
 * mailbox that will still exist tomorrow".
 *
 * Four sources, in a fixed order, and the order is the whole design:
 *
 *   1. **The local allowlist wins.** Upstream registries misclassify real
 *      organisations, and when that happens somebody needs a way to fix it in
 *      a file rather than in a deployment.
 *   2. **The local blocklist is next.** A domain being abused here today
 *      should be refused today, not whenever upstream notices.
 *   3. **The disposable registry.** Maintained by somebody else, cached
 *      locally, and never fetched while somebody is waiting.
 *   4. Anything else is unknown, which means acceptable so far — the
 *      remaining checks are DNS and the link itself.
 *
 * Being privacy-oriented is not the same as being disposable. A permanent
 * inbox that happens to be easy to open is a permanent inbox, and refusing
 * those would turn away exactly the people most careful about what they write.
 */

export type DomainVerdict = 'allowed' | 'blocked' | 'disposable' | 'unknown';

export const DOMAIN_LIST_FILES = {
  disposable: 'disposable-domains.txt',
  allow: 'allowlist.txt',
  block: 'blocklist.txt',
} as const;

/**
 * A normalised address: what to compare on, and what to actually send to.
 *
 * The domain is lowercased and IDN-folded because that is what comparison
 * needs. The address is kept exactly as it was typed, because the local part
 * of an email address is the mail provider's business and not ours — folding
 * case or stripping tags there would change who the message reaches.
 */
export interface NormalisedEmail {
  /** As typed, trimmed. Use this to send. */
  address: string;
  /** Lowercased, IDN-folded. Use this to compare. */
  domain: string;
  /**
   * Lowercased whole address, for account lookup and rate limiting.
   *
   * Case-folded only. Deliberately no provider-specific rules: removing dots
   * or `+tags` treats two addresses as one person, and being wrong about that
   * either merges two people or locks somebody out of their own account.
   */
  comparable: string;
}

/*
 * Deliberately conservative rather than RFC-complete.
 *
 * A perfectly compliant address that no mail system would accept is not worth
 * supporting; what matters is refusing the obviously malformed before any
 * work is done. The domain must have a dot and a plausible last label, since
 * everything downstream assumes there is a domain to resolve.
 */
const ADDRESS = /^[^\s@,;:<>"[\]\\]+@[^\s@,;:<>"[\]\\]+$/;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Fold a domain for comparison, including internationalised names. */
export function normaliseDomain(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/\.$/, '');
  if (trimmed === '') return null;
  let folded = trimmed;
  try {
    /*
     * `URL` performs the IDNA conversion the runtime supports, so `münchen.de`
     * and its punycode form compare equal. A domain the parser refuses is one
     * no resolver would accept either.
     */
    folded = new URL(`http://${trimmed}`).hostname;
  } catch {
    return null;
  }
  return DOMAIN.test(folded) ? folded : null;
}

/** Split and fold an address, or refuse it. */
export function normaliseEmail(raw: unknown): NormalisedEmail | null {
  if (typeof raw !== 'string') return null;
  const address = raw.trim();
  if (address === '' || address.length > 254 || !ADDRESS.test(address)) return null;
  const at = address.lastIndexOf('@');
  const local = address.slice(0, at);
  if (local === '' || local.length > 64) return null;
  const domain = normaliseDomain(address.slice(at + 1));
  if (!domain) return null;
  return { address, domain, comparable: `${local.toLowerCase()}@${domain}` };
}

/**
 * One line of a list file, or nothing.
 *
 * Comments and blank lines are skipped so a file can say why an override
 * exists — an allowlist entry with no explanation is one nobody can safely
 * remove later. A line that is not a usable domain is skipped rather than
 * failing the load: one bad line must not disarm the whole registry.
 */
export function readDomainLine(line: string): string | null {
  const withoutComment = line.split('#')[0] ?? '';
  const trimmed = withoutComment.trim();
  if (trimmed === '') return null;
  return normaliseDomain(trimmed);
}

/** Parse a whole file into a deduplicated set. */
export function parseDomainList(contents: string): Set<string> {
  const domains = new Set<string>();
  for (const line of contents.split(/\r?\n/)) {
    const domain = readDomainLine(line);
    if (domain) domains.add(domain);
  }
  return domains;
}

export interface DomainListSnapshot {
  allow: Set<string>;
  block: Set<string>;
  disposable: Set<string>;
  /** Whether the disposable registry was found and parsed. */
  disposableLoaded: boolean;
}

export const EMPTY_LISTS: DomainListSnapshot = {
  allow: new Set(),
  block: new Set(),
  disposable: new Set(),
  disposableLoaded: false,
};

/**
 * Read the three files once, into sets.
 *
 * Membership is asked on every sign-in request, so it is a hash lookup against
 * memory rather than a scan of a file with tens of thousands of lines. The
 * files are read at startup or first use and never while somebody is waiting,
 * and nothing here reaches the network: the registry is a local cache that a
 * separate updater refreshes.
 */
export async function loadDomainLists(directory: string): Promise<DomainListSnapshot> {
  const read = async (file: string): Promise<Set<string> | null> => {
    try {
      return parseDomainList(await readFile(join(directory, file), 'utf8'));
    } catch {
      return null;
    }
  };

  const [allow, block, disposable] = await Promise.all([
    read(DOMAIN_LIST_FILES.allow),
    read(DOMAIN_LIST_FILES.block),
    read(DOMAIN_LIST_FILES.disposable),
  ]);

  return {
    /* Absent local overrides are ordinary: most deployments have none. */
    allow: allow ?? new Set(),
    block: block ?? new Set(),
    disposable: disposable ?? new Set(),
    /*
     * An absent registry is not ordinary, and the difference is kept rather
     * than being flattened into "no disposable domains" — which would look
     * exactly like a registry that had loaded and matched nothing.
     */
    disposableLoaded: disposable !== null,
  };
}

/**
 * The verdict on one domain, in the order the lists are meant to be consulted.
 */
export function classifyDomain(domain: string, lists: DomainListSnapshot): DomainVerdict {
  if (lists.allow.has(domain)) return 'allowed';
  if (lists.block.has(domain)) return 'blocked';
  if (lists.disposable.has(domain)) return 'disposable';
  return 'unknown';
}
