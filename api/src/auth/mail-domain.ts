/*
 * Whether a domain could receive mail at all.
 *
 * This is the cheapest way to catch a typed-wrong or invented domain before
 * an email is sent to it — and every message sent to a domain that cannot
 * receive mail is a bounce, and enough bounces are what ruin a sender's
 * reputation and stop the real messages arriving.
 *
 * What it does not mean is worth writing down, because it is easy to assume
 * otherwise: a domain with MX records says nothing about whether the mailbox
 * exists, whether the provider is trustworthy, or whether there is a person
 * involved. Only clicking the link proves any of that.
 *
 * The distinction that matters is between "this domain does not take mail" and
 * "the resolver could not tell us right now". The first is a decision; the
 * second is weather. Treating a timeout as a bad domain would refuse real
 * people whenever DNS hiccupped, and would cache that refusal.
 */

export type MailDomainVerdict =
  /** Has somewhere to deliver to. */
  | 'deliverable'
  /** Definitively does not take mail. */
  | 'undeliverable'
  /** The resolver could not say. Try again; do not remember this. */
  | 'unavailable';

export interface MailDomainResolver {
  resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  /** For the RFC fallback: a domain with an address record but no MX. */
  resolveAddress(domain: string): Promise<string[]>;
}

/*
 * Codes the resolver uses for "asked and answered: nothing there", as opposed
 * to "could not ask". Anything not listed is treated as temporary, which is
 * the safe direction to be wrong in: a real person is delayed rather than
 * refused.
 */
const DEFINITIVE = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

interface CacheEntry {
  verdict: MailDomainVerdict;
  expiresAt: number;
}

export const MAIL_DOMAIN_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Ask DNS, remembering the answer for a while.
 *
 * Only decisions are cached. A temporary failure is never remembered — that
 * would turn one bad minute for the resolver into hours of refusing a domain
 * that was fine all along.
 */
export class MailDomainCheck {
  private readonly resolver: MailDomainResolver;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    resolver: MailDomainResolver,
    options: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.resolver = resolver;
    this.ttlMs = options.ttlMs ?? MAIL_DOMAIN_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async check(domain: string): Promise<MailDomainVerdict> {
    const cached = this.cache.get(domain);
    if (cached && cached.expiresAt > this.now()) return cached.verdict;

    const verdict = await this.ask(domain);
    /* Weather is not remembered. */
    if (verdict !== 'unavailable') {
      this.cache.set(domain, { verdict, expiresAt: this.now() + this.ttlMs });
    }
    return verdict;
  }

  private async ask(domain: string): Promise<MailDomainVerdict> {
    try {
      const records = await this.resolver.resolveMx(domain);
      if (records.length > 0) return 'deliverable';
    } catch (error: unknown) {
      const code = (error as { code?: string }).code ?? '';
      /* Could not ask, rather than asked and told no. */
      if (!DEFINITIVE.has(code)) return 'unavailable';
    }

    /*
     * No MX. A domain with an address record still accepts mail under the
     * fallback rule, so it is asked for rather than assumed either way — the
     * conservative reading, since refusing here refuses a real domain.
     */
    try {
      const addresses = await this.resolver.resolveAddress(domain);
      return addresses.length > 0 ? 'deliverable' : 'undeliverable';
    } catch (error: unknown) {
      const code = (error as { code?: string }).code ?? '';
      return DEFINITIVE.has(code) ? 'undeliverable' : 'unavailable';
    }
  }
}

/** The real resolver, over the system's DNS. */
export async function systemMailDomainResolver(): Promise<MailDomainResolver> {
  const dns = await import('node:dns/promises');
  return {
    resolveMx: (domain) => dns.resolveMx(domain),
    resolveAddress: async (domain) => {
      /*
       * Either family counts: a domain reachable only over IPv6 still takes
       * mail, and refusing it would refuse a real correspondent.
       */
      const [v4, v6] = await Promise.allSettled([dns.resolve4(domain), dns.resolve6(domain)]);
      const found = [
        ...(v4.status === 'fulfilled' ? v4.value : []),
        ...(v6.status === 'fulfilled' ? v6.value : []),
      ];
      if (found.length === 0 && v4.status === 'rejected' && v6.status === 'rejected') {
        throw v4.reason as Error;
      }
      return found;
    },
  };
}
