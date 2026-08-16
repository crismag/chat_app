/*
 * The application service. Everything that is true regardless of provider.
 *
 * Gating, limits, cancellation, the retry policy, logging and the conversion of
 * every failure into a typed outcome all live here, above the `AIProvider`
 * seam. Putting any of it in an adapter would mean re-implementing it — and
 * eventually getting it subtly wrong — for the second provider.
 *
 * The retry policy in one sentence: transient provider failures are retried at
 * most once with jitter; validation failures are never retried. Retrying a
 * schema mismatch is asking the same question and hoping for a different shape,
 * which spends someone's quota to arrive at the same refusal.
 */

import { AI_GUIDANCE_NOTICE, AI_OUTCOMES, type AiOutcome } from '@chat/shared';
import { AI_PROVIDER_NAMES, readAiConfig, type AiConfig } from './config.ts';
import { consoleAiLogger, type AiLogger } from './logging.ts';
import { PROMPT_VERSION } from './prompt.ts';
import { AiRateLimiter } from './rate-limit.ts';
import { AiFailure, isAiFailure } from './types.ts';
import type {
  AIProvider,
  ImproveWritingRequest,
  ImproveWritingResult,
  ReflectionGuidanceRequest,
  ReflectionGuidanceResult,
} from './types.ts';
import { FakeProvider } from './providers/fake.ts';

/** Who is asking. Enough to rate-limit, and nothing more. */
export interface AiCaller {
  userId: string;
  address: string;
  requestId: string;
}

export type AiServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; outcome: AiOutcome; retryAfterSeconds?: number };

export interface AiServiceOptions {
  /** Read fresh on every request unless a test pins it. */
  config?: () => AiConfig;
  /**
   * Build the provider. Injected by tests; production builds the real one.
   * Returning `null` means nothing can answer, and the service says so.
   */
  createProvider?: (config: AiConfig) => AIProvider | null;
  logger?: AiLogger;
  /** Jitter for the single retry. Fixed under test so timing is not luck. */
  jitter?: () => number;
}

/**
 * Build the provider named in configuration.
 *
 * The Gemini adapter is imported lazily so the SDK is not loaded — and its
 * absence is not fatal — on a server running without assistance. The app must
 * start when AI is disabled or unconfigured, and a top-level import of a
 * provider SDK is a quiet way to break that promise.
 */
async function defaultProviderModule(): Promise<
  typeof import('./providers/gemini.ts')
> {
  return import('./providers/gemini.ts');
}

export class AiService {
  private readonly readConfig: () => AiConfig;
  private readonly logger: AiLogger;
  private readonly jitter: () => number;
  private readonly createProvider: ((config: AiConfig) => AIProvider | null) | undefined;
  private limiter: { perMinute: number; limiter: AiRateLimiter } | null = null;
  /** Cached per model+provider, so a client is not rebuilt per request. */
  private cached: { key: string; provider: AIProvider } | null = null;

  constructor(options: AiServiceOptions = {}) {
    this.readConfig = options.config ?? (() => readAiConfig());
    this.logger = options.logger ?? consoleAiLogger;
    this.jitter = options.jitter ?? (() => Math.random() * 250);
    this.createProvider = options.createProvider;
  }

  /* ------------------------------------------------------------- status */

  /**
   * Whether a provider can answer, and which one.
   *
   * Deliberately narrower than the status endpoint. This service knows about
   * the model-backed operations and nothing else — the heuristic title
   * suggestion needs no key and no network, so whether *it* is available is not
   * this object's fact to state. The caller composes the two.
   *
   * What is absent is as deliberate as what is present: no project number, no
   * model name, no key fragment, no environment value, no quota, no internal
   * error. The temptation to add the model name "for debugging" is exactly the
   * one this comment refuses — it is a configuration value, it belongs in the
   * server's log, and a client that knows it gains nothing it can act on.
   */
  modelStatus(): { available: boolean; provider: string; reason?: string } {
    const config = this.readConfig();
    const available = config.enabled && config.configured;
    if (available) {
      return { available, provider: config.provider };
    }
    return {
      available,
      provider: AI_PROVIDER_NAMES.NONE,
      reason: config.enabled
        ? 'AI assistance is not configured on this server.'
        : 'AI assistance is switched off for this server.',
    };
  }

  /* ---------------------------------------------------------- operations */

  async reflectionGuidance(
    request: ReflectionGuidanceRequest,
    caller: AiCaller,
  ): Promise<AiServiceResult<ReflectionGuidanceResult>> {
    return this.run('reflection_guidance', caller, (provider, signal) =>
      provider.generateReflectionGuidance(request, { signal, requestId: caller.requestId }),
    );
  }

  async improveWriting(
    request: ImproveWritingRequest,
    caller: AiCaller,
  ): Promise<AiServiceResult<ImproveWritingResult>> {
    return this.run('improve_writing', caller, (provider, signal) =>
      provider.improveReflectionWriting(request, { signal, requestId: caller.requestId }),
    );
  }

  /* --------------------------------------------------------------- guts */

  private async run<T>(
    operation: 'reflection_guidance' | 'improve_writing',
    caller: AiCaller,
    call: (provider: AIProvider, signal: AbortSignal) => Promise<T>,
  ): Promise<AiServiceResult<T>> {
    const config = this.readConfig();
    const started = Date.now();

    const log = (outcome: AiOutcome, extra: { retried?: boolean; detail?: string } = {}) => {
      this.logger({
        requestId: caller.requestId,
        operation,
        provider: config.provider,
        model: config.model,
        promptVersion: PROMPT_VERSION,
        latencyMs: Date.now() - started,
        outcome,
        ...extra,
      });
    };

    /*
     * The kill switch, first. Nothing below this line runs when it is off —
     * not the limiter, not the provider construction, not a single byte to a
     * third party.
     */
    if (!config.enabled) {
      log(AI_OUTCOMES.AI_DISABLED);
      return { ok: false, outcome: AI_OUTCOMES.AI_DISABLED };
    }
    if (!config.configured) {
      log(AI_OUTCOMES.AI_NOT_CONFIGURED);
      return { ok: false, outcome: AI_OUTCOMES.AI_NOT_CONFIGURED };
    }

    const decision = this.rateLimiter(config).take(caller.userId, caller.address);
    if (!decision.allowed) {
      log(AI_OUTCOMES.RATE_LIMITED);
      return {
        ok: false,
        outcome: AI_OUTCOMES.RATE_LIMITED,
        retryAfterSeconds: decision.retryAfterSeconds,
      };
    }

    let provider: AIProvider;
    try {
      provider = await this.provider(config);
    } catch (caught: unknown) {
      const outcome = isAiFailure(caught) ? caught.outcome : AI_OUTCOMES.AI_NOT_CONFIGURED;
      log(outcome, { detail: 'provider could not be built' });
      return { ok: false, outcome };
    }

    let retried = false;
    for (;;) {
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const value = await call(provider, controller.signal);
        log(AI_OUTCOMES.OK, retried ? { retried } : {});
        return { ok: true, value };
      } catch (caught: unknown) {
        const failure = this.asFailure(caught, controller.signal.aborted);

        /*
         * One retry, for transient failures only, after a short jittered pause.
         * Jitter so that a provider blip does not turn every server in a fleet
         * into a synchronised second wave arriving at the same instant.
         */
        if (failure.retryable && !retried) {
          retried = true;
          await new Promise((resolve) => setTimeout(resolve, 150 + this.jitter()));
          continue;
        }

        log(failure.outcome, { retried, detail: failure.message });
        return { ok: false, outcome: failure.outcome };
      } finally {
        clearTimeout(deadline);
      }
    }
  }

  private asFailure(caught: unknown, timedOut: boolean): AiFailure {
    if (isAiFailure(caught)) {
      /*
       * Our own deadline fired. Whatever the adapter decided to call it, the
       * writer is waiting on a clock rather than on a broken provider, and
       * `timeout` is the outcome that lets the interface say so.
       */
      if (timedOut && caught.outcome !== AI_OUTCOMES.CONTENT_NOT_SUPPORTED) {
        return new AiFailure(AI_OUTCOMES.TIMEOUT, 'deadline reached', { retryable: false });
      }
      return caught;
    }
    if (timedOut) {
      return new AiFailure(AI_OUTCOMES.TIMEOUT, 'deadline reached', { retryable: false });
    }
    /*
     * Something threw that was not converted at the adapter boundary. It is
     * reported as an outage with a fixed message: an unexpected exception is
     * the most likely thing to be carrying detail nobody vetted.
     */
    return new AiFailure(AI_OUTCOMES.PROVIDER_UNAVAILABLE, 'unconverted provider exception', {
      retryable: false,
    });
  }

  private rateLimiter(config: AiConfig): AiRateLimiter {
    if (!this.limiter || this.limiter.perMinute !== config.rateLimit.perMinute) {
      this.limiter = {
        perMinute: config.rateLimit.perMinute,
        limiter: new AiRateLimiter(config.rateLimit.perMinute),
      };
    }
    return this.limiter.limiter;
  }

  private async provider(config: AiConfig): Promise<AIProvider> {
    const key = `${config.provider}:${config.model}:${config.timeoutMs}`;
    if (this.cached?.key === key) return this.cached.provider;

    const built = this.createProvider
      ? this.createProvider(config)
      : await this.buildProvider(config);

    if (!built) {
      throw new AiFailure(AI_OUTCOMES.AI_NOT_CONFIGURED, 'no provider is configured');
    }
    this.cached = { key, provider: built };
    return built;
  }

  private async buildProvider(config: AiConfig): Promise<AIProvider | null> {
    if (config.provider === AI_PROVIDER_NAMES.FAKE) return new FakeProvider();
    if (config.provider === AI_PROVIDER_NAMES.GEMINI) {
      const { GeminiProvider } = await defaultProviderModule();
      return new GeminiProvider({ model: config.model, timeoutMs: config.timeoutMs });
    }
    return null;
  }
}

/** The notice, re-exported so a route need not reach into shared for it. */
export { AI_GUIDANCE_NOTICE };
