/*
 * The YouVersion adapter. The only file that knows what their JSON looks like.
 *
 * Everything below was checked against the live API with a real key on
 * 2026-08-16, because the written brief for this work was wrong about it in
 * four places and each error would have shipped a real defect. The findings are
 * recorded here rather than in a commit message, since this is where the next
 * person will be standing when they need them.
 *
 *   • `page_size` must be between 1 and 99. `page_size=100` is a 400 with
 *     `{"message":"page_size must be between 1 and 99"}`.
 *
 *   • **Abbreviations are not what anyone expects.** The New International
 *     Version's `abbreviation` is `NIV11`, not `NIV`; the World English Bible's
 *     is `engWEBUS`; the 1995 New American Standard's is `NASB1995`. Matching a
 *     preference list against `abbreviation` exactly would miss NIV entirely
 *     and fall through to whatever came next — silently giving somebody a
 *     different Bible than the one they chose. There is a second field,
 *     `localized_abbreviation`, which for id 111 is exactly `NIV`, and it is
 *     the one worth showing a reader. Both are carried out of here.
 *
 *   • `GET /v1/bibles?language_ranges[]=en&page_size=99` returns 20 English
 *     translations, `total_size: 20` and `next_page_token: null`. Pagination is
 *     implemented anyway — a catalog that grows past a page must not silently
 *     truncate — but it is not exercised in practice today.
 *
 *   • **The list endpoint returns `copyright: null` for every translation.**
 *     The brief said attribution was unavailable from the API. It is not: the
 *     single-Bible endpoint `GET /v1/bibles/{id}` returns the real
 *     `copyright`, `publisher_url`, `promotional_content` and
 *     `youversion_deep_link`. For id 111 that is the full Biblica notice. So
 *     attribution is fetched per translation, and a translation whose copyright
 *     is genuinely null even in detail (the American Standard Version is one)
 *     has the field omitted rather than filled in with a guess.
 *
 *   • A passage response is `{ id, content, reference }` and nothing else.
 *     `content` is PLAIN TEXT — no markup, no verse numbers — so there is
 *     nothing to sanitise and nothing to strip. It is still never rendered as
 *     HTML anywhere; see the component.
 */

import { BIBLE_OUTCOMES } from '@chat/shared';
import { readAppKey } from '../config.ts';
import { BibleFailure } from '../types.ts';
import type {
  BibleProviderPort,
  ProviderCall,
  ProviderPassage,
  ProviderTranslation,
} from '../types.ts';

/** The provider's own ceiling, not ours. Requesting 100 is a 400. */
export const MAX_PAGE_SIZE = 99;

/** Pages we will follow before deciding something is wrong with the cursor. */
const MAX_PAGES = 20;

export interface YouVersionOptions {
  baseUrl: string;
  /**
   * Accepted and deliberately unused.
   *
   * The deadline is enforced ABOVE this adapter, by the service, with an
   * `AbortController` whose signal arrives on every call. An adapter with its
   * own second timer would mean two clocks disagreeing about when a request
   * died, and the retry policy reading whichever fired first. It stays in the
   * options so the construction site reads honestly.
   */
  timeoutMs?: number;
  /** Injected by tests. Production uses the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Map an HTTP status onto an outcome.
 *
 * Exported so the test suite can assert on the mapping directly rather than by
 * standing up a server for each code.
 *
 * 401 and 403 both become `NOT_CONFIGURED`. That is deliberate and it is the
 * single most important line in this file: a rejected key, an absent key and a
 * malformed key are indistinguishable to the person using the app, and the
 * difference between them is exactly what an attacker probing a deployment
 * wants to learn. The server's log knows which it was; the client is told
 * "Bible passage lookup is not configured."
 */
export function mapStatus(status: number): BibleFailure {
  if (status === 401 || status === 403) {
    return new BibleFailure(BIBLE_OUTCOMES.NOT_CONFIGURED, `provider rejected the credential (${status})`);
  }
  if (status === 404) {
    return new BibleFailure(BIBLE_OUTCOMES.PASSAGE_NOT_FOUND, 'provider has no such passage or version');
  }
  if (status === 429) {
    /*
     * Not retried here. The service has one retry to spend and spending it on
     * a limit we have just been told about makes the limit worse.
     */
    return new BibleFailure(BIBLE_OUTCOMES.RATE_LIMITED, 'provider rate limit');
  }
  if (status === 400 || status === 422) {
    /*
     * The provider refused a request WE built. Reported as an invalid response
     * rather than as the caller's mistake, because by this point the caller's
     * reference has already been validated and a 400 means our own request
     * construction is wrong.
     */
    return new BibleFailure(BIBLE_OUTCOMES.INVALID_PROVIDER_RESPONSE, `provider rejected our request (${status})`);
  }
  if (status >= 500) {
    return new BibleFailure(BIBLE_OUTCOMES.PROVIDER_UNAVAILABLE, `provider error (${status})`, {
      retryable: true,
    });
  }
  return new BibleFailure(BIBLE_OUTCOMES.PROVIDER_UNAVAILABLE, `unexpected status (${status})`);
}

/** Trim to a string, or undefined. Empty and null are the same thing here. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * One catalog entry, converted.
 *
 * Exported for the tests, which assert on the conversion rather than on a live
 * response — including that `NIV11` and `NIV` both survive, since losing either
 * one is how the wrong Bible gets selected.
 */
export function readTranslation(raw: unknown): ProviderTranslation | null {
  if (raw === null || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;

  const id = typeof row['id'] === 'number' ? row['id'] : Number.NaN;
  if (!Number.isInteger(id) || id <= 0) return null;

  const abbreviation = text(row['abbreviation']);
  const localized = text(row['localized_abbreviation']);
  const name = text(row['localized_title']) ?? text(row['title']);
  const language = text(row['language_tag']);
  if (!abbreviation || !name || !language) return null;

  return {
    id,
    abbreviation,
    localizedAbbreviation: localized ?? abbreviation,
    name,
    language,
    ...(text(row['copyright']) ? { copyright: text(row['copyright']) as string } : {}),
    ...(text(row['publisher_url']) ? { publisherUrl: text(row['publisher_url']) as string } : {}),
    ...(text(row['youversion_deep_link'])
      ? { youVersionUrl: text(row['youversion_deep_link']) as string }
      : {}),
  };
}

/** One passage, converted. A response missing text is not a passage. */
export function readPassage(raw: unknown, requestedUsfm: string): ProviderPassage | null {
  if (raw === null || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const content = text(row['content']);
  if (!content) return null;
  return {
    passageId: text(row['id']) ?? requestedUsfm,
    reference: text(row['reference']) ?? requestedUsfm,
    content,
  };
}

export class YouVersionProvider implements BibleProviderPort {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: YouVersionOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * One request, with the credential attached and never anywhere else.
   *
   * The key is read here, used here, and goes out of scope here. It is not
   * stored on the instance, so an instance that ends up in a heap dump, a
   * debugger, an error's `cause` chain or `JSON.stringify` carries nothing.
   *
   * Nothing in this method logs. Not the URL, not the headers, not the body —
   * a header object printed "just while debugging" is precisely how a key ends
   * up in a log aggregator, and the way to prevent it is to have no line here
   * that could.
   */
  private async request(path: string, call: ProviderCall): Promise<unknown> {
    const key = readAppKey();
    if (!key) {
      throw new BibleFailure(BIBLE_OUTCOMES.NOT_CONFIGURED, 'no credential present');
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: {
          'X-YVP-App-Key': key,
          Accept: 'application/json',
        },
        signal: call.signal,
      });
    } catch {
      /*
       * A transport failure. The caught error is NOT inspected at all — it is
       * not even bound to a name, so there is nothing to be tempted to log. The
       * reason:
       * a DNS or TLS error can contain the request URL, and a proxy error can
       * contain a header dump. The outcome is all that travels.
       */
      if (call.signal.aborted) {
        throw new BibleFailure(BIBLE_OUTCOMES.TIMEOUT, 'deadline reached');
      }
      throw new BibleFailure(BIBLE_OUTCOMES.PROVIDER_UNAVAILABLE, 'network failure', {
        retryable: true,
      });
    }

    if (!response.ok) {
      throw mapStatus(response.status);
    }

    try {
      return await response.json();
    } catch {
      throw new BibleFailure(BIBLE_OUTCOMES.INVALID_PROVIDER_RESPONSE, 'response was not JSON');
    }
  }

  /**
   * Every translation in a language range.
   *
   * `language_ranges[]` is the parameter name, brackets and all, and it is
   * encoded rather than interpolated so a language tag can never smuggle in a
   * second parameter.
   *
   * The loop follows `next_page_token` until it is absent. Today the English
   * catalog is a single page of 20, but a catalog that silently stops at one
   * page is a catalog that will one day be missing the translation somebody is
   * looking for, and nobody will be able to say when it started.
   */
  async listTranslations(language: string, call: ProviderCall): Promise<ProviderTranslation[]> {
    const translations: ProviderTranslation[] = [];
    const seen = new Set<number>();
    let token: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams();
      query.append('language_ranges[]', language);
      query.append('page_size', String(MAX_PAGE_SIZE));
      if (token) query.append('page_token', token);

      const payload = await this.request(`/bibles?${query.toString()}`, call);
      if (payload === null || typeof payload !== 'object') {
        throw new BibleFailure(BIBLE_OUTCOMES.INVALID_PROVIDER_RESPONSE, 'catalog was not an object');
      }
      const body = payload as Record<string, unknown>;
      const rows = body['data'];
      if (!Array.isArray(rows)) {
        throw new BibleFailure(BIBLE_OUTCOMES.INVALID_PROVIDER_RESPONSE, 'catalog had no data array');
      }

      for (const row of rows) {
        const translation = readTranslation(row);
        /*
         * An unreadable row is skipped, not fatal. One malformed entry must not
         * cost the reader the other nineteen Bibles.
         */
        if (translation && !seen.has(translation.id)) {
          seen.add(translation.id);
          translations.push(translation);
        }
      }

      const next = body['next_page_token'];
      if (typeof next !== 'string' || !next.trim()) break;
      token = next.trim();
    }

    return translations;
  }

  /**
   * One translation, with its attribution.
   *
   * This exists because the list endpoint returns `copyright: null` for
   * everything and this endpoint does not. Without it the passage card would
   * have no publisher notice to show, which for a licensed translation is not a
   * cosmetic omission.
   */
  async getTranslation(id: number, call: ProviderCall): Promise<ProviderTranslation> {
    const payload = await this.request(`/bibles/${encodeURIComponent(String(id))}`, call);
    const translation = readTranslation(payload);
    if (!translation) {
      throw new BibleFailure(BIBLE_OUTCOMES.INVALID_PROVIDER_RESPONSE, 'translation was unreadable');
    }
    return translation;
  }

  async getPassage(translationId: number, usfm: string, call: ProviderCall): Promise<ProviderPassage> {
    const payload = await this.request(
      `/bibles/${encodeURIComponent(String(translationId))}/passages/${encodeURIComponent(usfm)}`,
      call,
    );
    const passage = readPassage(payload, usfm);
    if (!passage) {
      throw new BibleFailure(BIBLE_OUTCOMES.INVALID_PROVIDER_RESPONSE, 'passage had no content');
    }
    return passage;
  }
}
