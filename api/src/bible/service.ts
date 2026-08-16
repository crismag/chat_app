/*
 * Everything about Bible lookup that is true regardless of provider.
 *
 * Gating, rate limiting, the deadline, the single retry, both caches, the
 * attribution hydration and the conversion of every failure into a typed
 * outcome live here — above the `BibleProviderPort` seam. An adapter below it
 * speaks one provider's dialect and nothing more.
 *
 * The retry policy in a sentence: a 5xx or a transport failure is retried once
 * after a jittered pause; a 4xx never is. Retrying a 404 asks the same question
 * of the same catalog and gets the same answer, a request later.
 */

import {
  BIBLE_OUTCOMES,
  BIBLE_PROVIDERS,
  type BiblePassage,
  type BibleOutcome,
  type BibleTranslation,
  type ScriptureForPrompt,
} from '@chat/shared';
import { TtlCache } from './cache.ts';
import { defaultTranslation, toWire } from './catalog.ts';
import { readBibleConfig, type BibleConfig } from './config.ts';
import { bibleLogLine, consoleBibleLogger, type BibleLogger } from './logging.ts';
import { parseReference, verseCount, ReferenceError_ } from './reference.ts';
import { AiRateLimiter } from '../ai/rate-limit.ts';
import { BibleFailure, isBibleFailure } from './types.ts';
import type { BibleProviderPort, ProviderTranslation } from './types.ts';
import { YouVersionProvider } from './providers/youversion.ts';

export interface BibleCaller {
  userId: string;
  address: string;
  requestId: string;
}

export type BibleResult<T> =
  | { ok: true; value: T }
  | { ok: false; outcome: BibleOutcome; message?: string; retryAfterSeconds?: number };

export interface BibleServiceOptions {
  config?: () => BibleConfig;
  /** Injected by tests; production builds the YouVersion adapter. */
  createProvider?: (config: BibleConfig) => BibleProviderPort | null;
  logger?: BibleLogger;
  jitter?: () => number;
  now?: () => number;
}

/** How many attribution lookups run at once when the catalog is built. */
const HYDRATION_CONCURRENCY = 6;

export class BibleService {
  private readonly readConfig: () => BibleConfig;
  private readonly createProvider: ((config: BibleConfig) => BibleProviderPort | null) | undefined;
  private readonly logger: BibleLogger;
  private readonly jitter: () => number;
  private readonly now: () => number;

  private readonly catalogCache: TtlCache<ProviderTranslation[]>;
  private readonly passageCache: TtlCache<BiblePassage>;
  /** In-flight catalog builds, so twenty tabs opening at once make one call. */
  private readonly inFlight = new Map<string, Promise<ProviderTranslation[]>>();
  private limiter: { perMinute: number; limiter: AiRateLimiter } | null = null;
  private cachedProvider: { key: string; provider: BibleProviderPort } | null = null;

  constructor(options: BibleServiceOptions = {}) {
    this.readConfig = options.config ?? (() => readBibleConfig());
    this.createProvider = options.createProvider;
    this.logger = options.logger ?? consoleBibleLogger;
    this.jitter = options.jitter ?? (() => Math.random() * 250);
    this.now = options.now ?? Date.now;
    this.catalogCache = new TtlCache(() => this.readConfig().catalogTtlMs, 8, this.now);
    this.passageCache = new TtlCache(() => this.readConfig().passageTtlMs, 100, this.now);
  }

  /* ------------------------------------------------------------- status */

  /**
   * Whether lookup can work, and nothing about why it cannot.
   *
   * `reason` distinguishes "switched off" from "not configured" because those
   * are genuinely different things for an operator reading a status page. It
   * does NOT distinguish a missing key from a malformed one from a rejected
   * one — all three are `configured: false` here and all three produce the same
   * sentence for a reader. See `mapStatus` in the adapter.
   */
  status(): { available: boolean; reason?: string } {
    const config = this.readConfig();
    if (config.enabled && config.configured) return { available: true };
    return {
      available: false,
      reason: config.enabled
        ? 'Bible passage lookup is not configured on this server.'
        : 'Bible passage lookup is switched off for this server.',
    };
  }

  /* --------------------------------------------------------- translations */

  /**
   * Every translation this key can reach, across every configured language.
   *
   * `languages` narrows it; omitting it returns the whole catalog, which is the
   * normal case. The interface searches the whole thing client-side — it is
   * fifty short rows — so handing it a single language would be handing it a
   * search that cannot find Tagalog.
   */
  async translations(
    caller: BibleCaller,
    languages?: string[],
  ): Promise<BibleResult<{ translations: BibleTranslation[]; defaultId: number | null }>> {
    const gate = this.gate('translations', caller);
    if (gate) return gate;

    try {
      const catalog = await this.catalog(caller, languages);
      if (catalog.length === 0) {
        this.log('translations', caller, BIBLE_OUTCOMES.PROVIDER_UNAVAILABLE, 'empty catalog');
        return { ok: false, outcome: BIBLE_OUTCOMES.PROVIDER_UNAVAILABLE };
      }
      this.log('translations', caller, BIBLE_OUTCOMES.OK);
      return {
        ok: true,
        value: {
          translations: catalog.map(toWire),
          defaultId: defaultTranslation(catalog)?.id ?? null,
        },
      };
    } catch (caught: unknown) {
      const failure = this.asFailure(caught);
      this.log('translations', caller, failure.outcome, failure.message);
      return { ok: false, outcome: failure.outcome };
    }
  }

  /* -------------------------------------------------------------- passage */

  /**
   * A passage, normalised, with its attribution attached.
   *
   * Order matters and is worth stating: the reference is parsed BEFORE the
   * translation is checked and both happen before any provider call. A typo
   * costs no network request and gets a sentence about the typo rather than a
   * 404 rendered as "that passage is not in this translation", which would be
   * both wrong and impossible to act on.
   */
  async passage(
    input: { translationId: number; reference: string; language?: string },
    caller: BibleCaller,
  ): Promise<BibleResult<BiblePassage & { verses: number }>> {
    let parsed;
    try {
      parsed = parseReference(input.reference);
    } catch (caught: unknown) {
      const message =
        caught instanceof ReferenceError_ ? caught.message : 'That reference could not be understood.';
      /*
       * Logged without the reference text. A Bible reference is not sensitive
       * on its own, but it is a small piece of what somebody is privately
       * working through, and the log has no use for it.
       */
      this.log('passage', caller, BIBLE_OUTCOMES.INVALID_REFERENCE);
      return { ok: false, outcome: BIBLE_OUTCOMES.INVALID_REFERENCE, message };
    }

    const gate = this.gate('passage', caller);
    if (gate) return gate;

    try {
      const catalog = await this.catalog(caller);
      const translation = catalog.find((entry) => entry.id === input.translationId);
      /*
       * A translation the key cannot reach is refused outright rather than
       * swapped for one that works. Substituting here would put words from a
       * different Bible under an abbreviation the reader chose, which is the
       * one failure this feature must never produce.
       */
      if (!translation) {
        this.log('passage', caller, BIBLE_OUTCOMES.TRANSLATION_UNAVAILABLE);
        return { ok: false, outcome: BIBLE_OUTCOMES.TRANSLATION_UNAVAILABLE };
      }

      const key = `${translation.id}:${parsed.usfm}`;
      const cached = this.passageCache.get(key);
      if (cached) {
        this.log('passage', caller, BIBLE_OUTCOMES.OK, 'cache hit');
        return { ok: true, value: { ...cached, verses: verseCount(parsed) } };
      }

      const fetched = await this.withProvider(caller, (provider, call) =>
        provider.getPassage(translation.id, parsed.usfm, call),
      );

      const passage: BiblePassage = {
        provider: BIBLE_PROVIDERS.YOUVERSION,
        translationId: translation.id,
        abbreviation: translation.localizedAbbreviation,
        name: translation.name,
        passageId: fetched.passageId,
        reference: fetched.reference,
        content: fetched.content,
        /*
         * Attribution comes from the catalog entry, hydrated from the
         * single-Bible endpoint. Omitted when the provider genuinely has none —
         * never replaced with a sentence we composed. An invented copyright
         * notice is a false statement about somebody else's legal rights.
         */
        ...(translation.copyright ? { copyright: translation.copyright } : {}),
        ...(translation.publisherUrl || translation.youVersionUrl
          ? {
              links: {
                ...(translation.publisherUrl ? { publisher: translation.publisherUrl } : {}),
                ...(translation.youVersionUrl ? { youVersion: translation.youVersionUrl } : {}),
              },
            }
          : {}),
        retrievedAt: new Date(this.now()).toISOString(),
      };

      /* Only a success is ever cached. There is no path here that stores an error. */
      this.passageCache.set(key, passage);
      this.log('passage', caller, BIBLE_OUTCOMES.OK);
      return { ok: true, value: { ...passage, verses: verseCount(parsed) } };
    } catch (caught: unknown) {
      const failure = this.asFailure(caught);
      this.log('passage', caller, failure.outcome, failure.message);
      return { ok: false, outcome: failure.outcome };
    }
  }

  /* ---------------------------------------------------------- AI boundary */

  /**
   * What assistance is allowed to know about the passage.
   *
   * This is the seam, and it is on this side of the wall on purpose: the AI
   * code calls in here and receives a value object, rather than reaching for a
   * passage and deciding for itself what to do with it.
   *
   * Two rules it enforces, neither of which a prompt builder should be trusted
   * to remember:
   *
   *   1. The words themselves are included only when configuration says a
   *      translation's text may be sent to a third party. Off by default.
   *   2. **A failed lookup is reported as an explicit absence.** `unavailable`
   *      is true and there is no text. A prompt builder seeing that must tell
   *      the model it does not have the passage and must not quote or
   *      reconstruct one — because a model asked to reflect on "John 3:16" with
   *      no text in front of it will supply a remembered verse, in the wrong
   *      translation, subtly wrong, under a publisher's name.
   *
   * The AI code needs one call: `bibleService.scriptureForPrompt(passage,
   * reference)`, and it must pass the result through to the prompt rather than
   * re-deriving anything from it.
   */
  scriptureForPrompt(
    passage: BiblePassage | null,
    fallbackReference: string,
  ): ScriptureForPrompt {
    const config = this.readConfig();
    if (!passage) {
      return { reference: fallbackReference, abbreviation: '', unavailable: true };
    }
    return {
      reference: passage.reference,
      abbreviation: passage.abbreviation,
      ...(config.scriptureInPrompts ? { text: passage.content } : {}),
      unavailable: false,
    };
  }

  /* ----------------------------------------------------------------- guts */

  /** The checks every operation shares, in the order they have to happen. */
  private gate(
    operation: 'translations' | 'passage',
    caller: BibleCaller,
  ): { ok: false; outcome: BibleOutcome; retryAfterSeconds?: number } | null {
    const config = this.readConfig();
    if (!config.enabled) {
      this.log(operation, caller, BIBLE_OUTCOMES.NOT_CONFIGURED, 'disabled');
      return { ok: false, outcome: BIBLE_OUTCOMES.NOT_CONFIGURED };
    }
    if (!config.configured) {
      this.log(operation, caller, BIBLE_OUTCOMES.NOT_CONFIGURED, 'no credential');
      return { ok: false, outcome: BIBLE_OUTCOMES.NOT_CONFIGURED };
    }
    const decision = this.rateLimiter(config).take(caller.userId, caller.address);
    if (!decision.allowed) {
      this.log(operation, caller, BIBLE_OUTCOMES.RATE_LIMITED);
      return {
        ok: false,
        outcome: BIBLE_OUTCOMES.RATE_LIMITED,
        retryAfterSeconds: decision.retryAfterSeconds,
      };
    }
    return null;
  }

  /**
   * The catalog, cached, hydrated, and built at most once at a time.
   *
   * The list endpoint returns `copyright: null` for every translation; the
   * single-Bible endpoint returns the real notice. So each entry is hydrated
   * from its own detail call, bounded to a handful at a time, once per cache
   * lifetime. A detail call that fails leaves that translation listed WITHOUT
   * attribution rather than removing it or failing the whole catalog — losing
   * nineteen Bibles because one publisher's record would not load is the wrong
   * trade, and a translation with no attribution can still be shown, it just
   * cannot show a notice it does not have.
   */
  private async catalog(
    caller: BibleCaller,
    languages?: string[],
  ): Promise<ProviderTranslation[]> {
    const wanted = (languages ?? this.readConfig().languages).map((tag) => tag.toLowerCase());
    const key = [...wanted].sort().join(',');

    const cached = this.catalogCache.get(key);
    if (cached) return cached;

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const build = (async () => {
      /*
       * One list request per language, and a failure in one must not cost the
       * others.
       *
       * This is the difference between "Spanish is briefly unavailable" and
       * "there are no Bibles". Each language is settled independently and a
       * rejection contributes nothing rather than propagating — which also
       * means a language tag an operator mistyped quietly yields no Bibles
       * instead of emptying the catalog.
       */
      const listed: ProviderTranslation[] = [];
      const seen = new Set<number>();
      const refusals: BibleFailure[] = [];
      let reached = 0;

      const perLanguage = await Promise.allSettled(
        wanted.map((language) =>
          this.withProvider(caller, (provider, call) => provider.listTranslations(language, call)),
        ),
      );

      for (const [index, result] of perLanguage.entries()) {
        if (result.status !== 'fulfilled') {
          const failure = this.asFailure(result.reason);
          refusals.push(failure);
          this.log(
            'translations',
            caller,
            failure.outcome,
            `language ${wanted[index]} could not be listed`,
          );
          continue;
        }
        reached += 1;
        for (const translation of result.value) {
          /*
           * Deduplicated by id, not by abbreviation. `NVI` is a real
           * abbreviation in both Spanish and Portuguese and they are different
           * Bibles; collapsing them would delete one of them.
           */
          if (seen.has(translation.id)) continue;
          seen.add(translation.id);
          listed.push(translation);
        }
      }

      /*
       * Every language failed. That is an outage, not an empty catalog, and it
       * must NOT be cached — a cached emptiness would outlive the outage and
       * leave the picker permanently blank. See the note in `cache.ts`.
       */
      if (reached === 0) {
        /*
         * Rethrow the most ACTIONABLE refusal, not a generic outage.
         *
         * This line exists because of a regression the tests caught: gathering
         * languages independently meant a rejected credential — which fails
         * every language at once — arrived here as seven ignored errors and
         * left as "the provider is unavailable". The reader would be told to
         * retry something that will never succeed until an operator fixes a
         * key, and the operator would have no idea that is what happened.
         *
         * A credential problem outranks everything because it explains all the
         * others; a rate limit outranks a generic failure because it is the one
         * a caller can wait out.
         */
        const ranked =
          refusals.find((failure) => failure.outcome === BIBLE_OUTCOMES.NOT_CONFIGURED) ??
          refusals.find((failure) => failure.outcome === BIBLE_OUTCOMES.RATE_LIMITED) ??
          refusals[0];
        throw (
          ranked ??
          new BibleFailure(BIBLE_OUTCOMES.PROVIDER_UNAVAILABLE, 'no language could be listed')
        );
      }

      const hydrated: ProviderTranslation[] = [];
      for (let start = 0; start < listed.length; start += HYDRATION_CONCURRENCY) {
        const batch = listed.slice(start, start + HYDRATION_CONCURRENCY);
        const settled = await Promise.all(
          batch.map(async (entry) => {
            try {
              return await this.withProvider(caller, (provider, call) =>
                provider.getTranslation(entry.id, call),
              );
            } catch {
              /* Listed without attribution rather than dropped. */
              return entry;
            }
          }),
        );
        hydrated.push(...settled);
      }

      /* Only a non-empty catalog is cached. See the note in `cache.ts`. */
      if (hydrated.length > 0) this.catalogCache.set(key, hydrated);
      return hydrated;
    })();

    this.inFlight.set(key, build);
    try {
      return await build;
    } finally {
      this.inFlight.delete(key);
    }
  }


  /**
   * One provider call, with a deadline and at most one retry.
   *
   * The deadline is ours, not the provider's — a request that hangs must not
   * hold a page in "loading" indefinitely — and it is enforced with an
   * `AbortController` so the socket is actually released rather than merely
   * ignored.
   */
  private async withProvider<T>(
    caller: BibleCaller,
    call: (provider: BibleProviderPort, options: { signal: AbortSignal; requestId: string }) => Promise<T>,
  ): Promise<T> {
    const config = this.readConfig();
    const provider = this.provider(config);
    if (!provider) {
      throw new BibleFailure(BIBLE_OUTCOMES.NOT_CONFIGURED, 'no provider is configured');
    }

    let retried = false;
    for (;;) {
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        return await call(provider, { signal: controller.signal, requestId: caller.requestId });
      } catch (caught: unknown) {
        const failure = this.asFailure(caught, controller.signal.aborted);
        if (failure.retryable && !retried) {
          retried = true;
          await new Promise((resolve) => setTimeout(resolve, 120 + this.jitter()));
          continue;
        }
        throw failure;
      } finally {
        clearTimeout(deadline);
      }
    }
  }

  private asFailure(caught: unknown, timedOut = false): BibleFailure {
    if (isBibleFailure(caught)) {
      if (timedOut && caught.outcome === BIBLE_OUTCOMES.PROVIDER_UNAVAILABLE) {
        return new BibleFailure(BIBLE_OUTCOMES.TIMEOUT, 'deadline reached');
      }
      return caught;
    }
    if (timedOut) return new BibleFailure(BIBLE_OUTCOMES.TIMEOUT, 'deadline reached');
    /*
     * Something threw that the adapter did not convert. Reported as an outage
     * with a fixed message, because an unconverted exception is the most likely
     * thing to be carrying a URL, a header or a stack nobody vetted.
     */
    return new BibleFailure(BIBLE_OUTCOMES.PROVIDER_UNAVAILABLE, 'unconverted provider exception');
  }

  private rateLimiter(config: BibleConfig): AiRateLimiter {
    if (!this.limiter || this.limiter.perMinute !== config.rateLimit.perMinute) {
      this.limiter = {
        perMinute: config.rateLimit.perMinute,
        limiter: new AiRateLimiter(config.rateLimit.perMinute),
      };
    }
    return this.limiter.limiter;
  }

  private provider(config: BibleConfig): BibleProviderPort | null {
    const key = `${config.baseUrl}:${config.timeoutMs}`;
    if (this.cachedProvider?.key === key) return this.cachedProvider.provider;
    const built = this.createProvider
      ? this.createProvider(config)
      : new YouVersionProvider({ baseUrl: config.baseUrl, timeoutMs: config.timeoutMs });
    if (!built) return null;
    this.cachedProvider = { key, provider: built };
    return built;
  }

  private log(
    operation: 'translations' | 'passage',
    caller: BibleCaller,
    outcome: BibleOutcome,
    detail?: string,
  ): void {
    this.logger({
      requestId: caller.requestId,
      operation,
      provider: BIBLE_PROVIDERS.YOUVERSION,
      outcome,
      ...(detail === undefined ? {} : { detail }),
    });
  }
}

export { bibleLogLine };
