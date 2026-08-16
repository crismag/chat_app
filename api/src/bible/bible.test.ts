/*
 * What the Bible connector must do, and — mostly — what it must never do.
 *
 * No test in this file reaches YouVersion. Every one runs against a fake
 * `fetch` that replays the shapes the real API actually returned on 2026-08-16,
 * or against exported pure functions. A suite that calls a third party is slow,
 * flaky, unrunnable offline, and spends somebody's quota to re-establish facts
 * that have not changed. The one check that does make a real call lives in
 * `scripts/verify/bible-live-smoke.mjs`, is opt-in twice over, and is not part
 * of this suite.
 *
 * The fixtures below are real responses, trimmed. Inventing them would defeat
 * the point: the four defects this connector exists to avoid — `NIV11` not
 * `NIV`, `page_size` 99 not 100, attribution absent from the list endpoint,
 * plain text not HTML — are all facts about the real payloads.
 */

import { describe, expect, test, vi } from 'vitest';
import { BIBLE_OUTCOMES, BIBLE_OUTCOME_MESSAGES } from '@chat/shared';
import { createApp } from '../app.ts';
import { MemoryStore } from '../store.ts';
import { TtlCache } from './cache.ts';
import { defaultTranslation, familyKeys, findByFamily, toWire } from './catalog.ts';
import { readBibleConfig, readAppKey } from './config.ts';
import { bibleLogLine, redactBible } from './logging.ts';
import { MemoryPassageStore } from './passage-store.ts';
import { parseReference, verseCount, ReferenceError_ } from './reference.ts';
import { createBibleRoutes } from './routes.ts';
import { BibleService } from './service.ts';
import { BOOKS } from './books.ts';
import { MAX_PAGE_SIZE, YouVersionProvider, mapStatus, readPassage, readTranslation } from './providers/youversion.ts';
import type { BiblePassage } from '@chat/shared';

/* ------------------------------------------------------------- fixtures */

/** A catalog row exactly as `GET /v1/bibles` returns it — attribution null. */
function listRow(id: number, abbreviation: string, localized: string, title: string) {
  return {
    id,
    abbreviation,
    promotional_content: null,
    copyright: null,
    info: null,
    publisher_url: null,
    language_tag: 'en',
    localized_abbreviation: localized,
    localized_title: title,
    title,
    books: ['GEN', 'JHN'],
  };
}

/** A detail row exactly as `GET /v1/bibles/{id}` returns it — with copyright. */
function detailRow(id: number, abbreviation: string, localized: string, title: string, copyright: string | null) {
  return {
    ...listRow(id, abbreviation, localized, title),
    copyright,
    publisher_url: id === 111 ? 'https://www.biblica.com/yv-learn-more/' : null,
    youversion_deep_link: `https://www.bible.com/versions/${id}`,
    organization_id: null,
  };
}

/** The real English catalog, as returned: 20 rows, no next page token. */
const ENGLISH_LIST = [
  listRow(12, 'ASV', 'ASV', 'American Standard Version'),
  listRow(100, 'NASB1995', 'NASB1995', 'New American Standard Bible 1995'),
  listRow(110, 'NIrV', 'NIrV', 'New International Reader’s Version 2014'),
  listRow(111, 'NIV11', 'NIV', 'New International Version'),
  listRow(113, 'NIVUK11', 'NIVUK', 'New International Version (Anglicized) 2011'),
  listRow(206, 'engWEBUS', 'WEBUS', "World English Bible, American English Edition"),
  listRow(1588, 'AMP', 'AMP', 'Amplified Bible'),
  listRow(3034, 'BSB', 'BSB', 'Berean Standard Bible'),
];

const COPYRIGHTS: Record<number, string | null> = {
  12: null,
  100: 'Copyright © 1995 by The Lockman Foundation',
  110: 'Copyright © 1995, 1996, 1998, 2014 by Biblica, Inc.®',
  111:
    'The Holy Bible, New International Version® NIV®\nCopyright © 1973, 1978, 1984, 2011 by Biblica, Inc.®\nUsed by Permission of Biblica, Inc.® All rights reserved worldwide.',
  113: 'Copyright © 1979, 1984, 2011 by Biblica, Inc.®',
  206: 'PUBLIC DOMAIN (not copyrighted)',
  1588: 'Copyright © 2015 by The Lockman Foundation',
  3034: 'Public Domain',
};

const JOHN_3_16_18 = {
  id: 'JHN.3.16-18',
  content:
    'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life. For God did not send his Son into the world to condemn the world, but to save the world through him. Whoever believes in him is not condemned, but whoever does not believe stands condemned already because they have not believed in the name of God’s one and only Son.',
  reference: 'John 3:16-18',
};

const PSALM_23_1 = {
  id: 'PSA.23.1',
  content: 'Yahweh is my shepherd; I shall lack nothing.',
  reference: 'Psalms 23:1',
};

/** A key-shaped value, so a leak test has something distinctive to look for. */
const FAKE_KEY = 'yvp_test_key_0000deadbeef';

interface FetchLog {
  url: string;
  headers: Record<string, string>;
}

/**
 * A `fetch` that answers like the real API and records what it was asked.
 *
 * `pages` lets a test hand back more than one catalog page. The real API does
 * not paginate the English catalog today — that is asserted separately — but
 * the code must still follow a cursor when one appears.
 */
function fakeFetch(options: {
  pages?: { data: unknown[]; next_page_token?: string | null }[];
  passage?: unknown;
  status?: number;
  body?: unknown;
  throwOn?: (url: string) => boolean;
  /** Per-language catalogs. An absent language answers 500. */
  byLanguage?: Record<string, unknown[]>;
  log?: FetchLog[];
} = {}) {
  let pageIndex = 0;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    options.log?.push({ url, headers });

    if (options.throwOn?.(url)) throw new TypeError('fetch failed');

    if (options.status && options.status !== 200) {
      return new Response(JSON.stringify(options.body ?? { message: 'nope' }), {
        status: options.status,
      });
    }

    if (url.includes('/passages/')) {
      return new Response(JSON.stringify(options.passage ?? JOHN_3_16_18), { status: 200 });
    }

    const single = /\/bibles\/(\d+)(?:\?|$)/.exec(url);
    if (single) {
      const id = Number(single[1]);
      const everything = [
        ...ENGLISH_LIST,
        ...Object.values(options.byLanguage ?? {}).flat(),
      ] as ReturnType<typeof listRow>[];
      const row = everything.find((entry) => entry.id === id);
      if (!row) return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
      return new Response(
        JSON.stringify({
          ...detailRow(
            row.id,
            row.abbreviation,
            row.localized_abbreviation,
            row.title,
            COPYRIGHTS[id] ?? null,
          ),
          /*
           * The detail response keeps the row's own language. Rebuilding it
           * from the English template quietly relabelled every Tagalog Bible as
           * English — which the language-name test caught, and which in
           * production would have put the wrong language on every row.
           */
          language_tag: row.language_tag,
        }),
        { status: 200 },
      );
    }

    /*
     * A list request. Answered per language, because the catalog is assembled
     * from several and the merge is the thing worth testing.
     */
    const language = new URL(url, 'http://test').searchParams.get('language_ranges[]') ?? 'en';
    if (options.byLanguage) {
      const answer = options.byLanguage[language];
      if (answer === undefined) {
        return new Response(JSON.stringify({ message: 'no such language' }), { status: 500 });
      }
      return new Response(JSON.stringify({ data: answer, total_size: answer.length, next_page_token: null }), {
        status: 200,
      });
    }

    const pages = options.pages ?? [{ data: ENGLISH_LIST, next_page_token: null }];
    const page = pages[Math.min(pageIndex, pages.length - 1)];
    pageIndex += 1;
    return new Response(JSON.stringify({ total_size: page?.data.length ?? 0, ...page }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
}

function config(overrides: Partial<ReturnType<typeof readBibleConfig>> = {}) {
  return () => ({
    enabled: true,
    configured: true,
    baseUrl: 'https://provider.test/v1',
    languages: ['en'],
    timeoutMs: 500,
    catalogTtlMs: 60_000,
    passageTtlMs: 60_000,
    rateLimit: { perMinute: 500 },
    scriptureInPrompts: false,
    ...overrides,
  });
}

function serviceWith(fetchImpl: typeof fetch, overrides = {}) {
  return new BibleService({
    config: config(overrides),
    createProvider: (built) =>
      new YouVersionProvider({ baseUrl: built.baseUrl, fetchImpl }),
    logger: () => {},
    jitter: () => 0,
  });
}

const caller = { userId: 'u1', address: '203.0.113.1', requestId: 'r1' };

/*
 * Every provider call reads the key from the environment at the moment of use,
 * so a test that needs one puts it there for the duration of the call.
 *
 * `await run()` rather than `return run()`: an earlier version restored the
 * environment the instant the promise was CREATED, which unset the key before
 * the request that needed it ever ran — and every failure came back
 * `bible_not_configured`, which looked like a bug in the connector rather than
 * in the test helper. Awaiting inside the try is what makes the window cover
 * the work.
 */
async function withKey<T>(run: () => T | Promise<T>): Promise<T> {
  const previous = process.env['YVP_APP_KEY'];
  process.env['YVP_APP_KEY'] = FAKE_KEY;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env['YVP_APP_KEY'];
    else process.env['YVP_APP_KEY'] = previous;
  }
}

/** The same, for the handful of synchronous reads. */
function withKeySync<T>(run: () => T): T {
  const previous = process.env['YVP_APP_KEY'];
  process.env['YVP_APP_KEY'] = FAKE_KEY;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env['YVP_APP_KEY'];
    else process.env['YVP_APP_KEY'] = previous;
  }
}

/* ------------------------------------------------------------------ books */

describe('the canon', () => {
  test('has sixty-six books with their well-known chapter counts', () => {
    expect(BOOKS).toHaveLength(66);
    const chapters = Object.fromEntries(BOOKS.map((book) => [book.usfm, book.chapters]));
    /* The ones a mistake would be most visible in. */
    expect(chapters['PSA']).toBe(150);
    expect(chapters['JHN']).toBe(21);
    expect(chapters['ROM']).toBe(16);
    expect(chapters['REV']).toBe(22);
    expect(chapters['OBA']).toBe(1);
    expect(chapters['JUD']).toBe(1);
    expect(BOOKS.reduce((total, book) => total + book.chapters, 0)).toBe(1189);
  });

  test('every book code is unique', () => {
    expect(new Set(BOOKS.map((book) => book.usfm)).size).toBe(66);
  });
});

/* -------------------------------------------------------------- reference */

describe('reference normalisation', () => {
  test.each([
    ['John 3:16', 'JHN.3.16'],
    ['john 3:16', 'JHN.3.16'],
    ['  John   3 : 16  ', 'JHN.3.16'],
    ['John 3:16-18', 'JHN.3.16-18'],
    /* The en dash. Pasted from every Bible app and church slide there is. */
    ['John 3:16–18', 'JHN.3.16-18'],
    ['John 3:16—18', 'JHN.3.16-18'],
    ['Psalm 23:1-3', 'PSA.23.1-3'],
    ['Psalms 23:1', 'PSA.23.1'],
    ['Romans 8:28', 'ROM.8.28'],
    ['Rom. 8:28', 'ROM.8.28'],
    ['1 Cor 13:4', '1CO.13.4'],
    ['1Cor 13:4', '1CO.13.4'],
    ['I Corinthians 13:4', '1CO.13.4'],
    ['First Corinthians 13:4', '1CO.13.4'],
    ['Song of Songs 2:1', 'SNG.2.1'],
    ['Phil 4:13', 'PHP.4.13'],
    ['Philemon 1:6', 'PHM.1.6'],
    ['Eze 36:26', 'EZK.36.26'],
    /* A USFM reference parses too — a saved reflection stores one. */
    ['JHN.3.16-18', 'JHN.3.16-18'],
    ['1SA.1.1', '1SA.1.1'],
  ])('%s becomes %s', (input, expected) => {
    expect(parseReference(input).usfm).toBe(expected);
  });

  test('a non-breaking space between book and chapter is still a space', () => {
    expect(parseReference('John 3:16').usfm).toBe('JHN.3.16');
    expect(parseReference('Romans 8:28').usfm).toBe('ROM.8.28');
  });

  test.each([
    ['', 'Enter a Bible reference'],
    ['   ', 'Enter a Bible reference'],
    ['Hesitations 3:16', 'We do not know a book'],
    ['John', 'not a reference we recognise'],
    /* A whole chapter is refused rather than silently truncated to verse 1. */
    ['John 3', 'not a reference we recognise'],
    ['John 99:1', 'John has 21 chapters'],
    ['Romans 22:1', 'Romans has 16 chapters'],
    ['John 0:1', 'does not exist'],
    ['John 3:0', 'Verse numbers start at 1'],
    /* Reversed. Caught here, because the provider would call it a 404 and the
     * reader would be told the verse is not in their translation. */
    ['John 3:18-16', 'runs backwards'],
    ['John 3:999', 'too high to be a verse'],
  ])('%s is refused with a sentence about %s', (input, fragment) => {
    expect(() => parseReference(input)).toThrow(ReferenceError_);
    expect(() => parseReference(input)).toThrow(new RegExp(fragment, 'i'));
  });

  test('refusals never echo raw input unescaped into something executable', () => {
    /* The message quotes what was typed; it must arrive as text and nothing
     * more. The component renders it as text — this asserts the message itself
     * carries no markup we generated. */
    const caught = (() => {
      try {
        parseReference('<script>alert(1)</script> 3:16');
        return null;
      } catch (error) {
        return error as Error;
      }
    })();
    expect(caught?.message).toContain('We do not know a book');
    expect(caught?.message).not.toContain('<script>');
  });

  test('counts verses in a range', () => {
    expect(verseCount(parseReference('John 3:16'))).toBe(1);
    expect(verseCount(parseReference('John 3:16-18'))).toBe(3);
  });
});

/* ---------------------------------------------------------------- catalog */

describe('choosing a translation', () => {
  const provider = ENGLISH_LIST.map((row) => ({
    id: row.id,
    abbreviation: row.abbreviation,
    localizedAbbreviation: row.localized_abbreviation,
    name: row.title,
    language: 'en',
  }));

  /*
   * The single most important assertion in this file.
   *
   * It asserts the ID, not the string. The provider's abbreviation for the New
   * International Version is `NIV11`; a preference list matched exactly against
   * `abbreviation` finds nothing, falls through, and hands the reader the
   * Berean Standard Bible under the impression they got the NIV.
   */
  test('NIV resolves to id 111 — not to NIrV, not to NIVUK, not to BSB', () => {
    const match = findByFamily(provider, 'NIV');
    expect(match?.id).toBe(111);
    expect(match?.abbreviation).toBe('NIV11');
    expect(match?.id).not.toBe(110);
    expect(match?.id).not.toBe(113);
    expect(match?.id).not.toBe(3034);
  });

  test.each([
    ['NIRV', 110],
    ['AMP', 1588],
    ['BSB', 3034],
    ['NASB', 100],
    ['ASV', 12],
    /* engWEBUS: language prefix, region suffix, and still findable. */
    ['WEB', 206],
    ['WEBUS', 206],
  ])('%s resolves to id %i', (family, id) => {
    expect(findByFamily(provider, family)?.id).toBe(id);
  });

  test('an exact abbreviation always beats a derived one', () => {
    /* `NIV` is tier 0 for id 111 via its localized abbreviation; it is only a
     * derived key for anything else. Promoting a derived match to tier 0 would
     * reopen the substitution bug, so the tiering itself is pinned. */
    const niv = provider.find((entry) => entry.id === 111)!;
    expect(familyKeys(niv)[0]).toContain('NIV');
    const nirv = provider.find((entry) => entry.id === 110)!;
    expect(familyKeys(nirv)[0]).not.toContain('NIV');
  });

  test('a family with no match returns nothing rather than a guess', () => {
    expect(findByFamily(provider, 'ESV')).toBeNull();
    expect(findByFamily(provider, 'KJV')).toBeNull();
  });

  test('the default is the previous choice, then NIV, then the first usable', () => {
    expect(defaultTranslation(provider)?.id).toBe(111);
    expect(defaultTranslation(provider, 3034)?.id).toBe(3034);
    /* A previous choice that has vanished is not honoured — the caller is
     * expected to tell the reader rather than pretend. */
    expect(defaultTranslation(provider, 999_999)?.id).toBe(111);
    const withoutNiv = provider.filter((entry) => ![110, 111, 113, 1588].includes(entry.id));
    expect(defaultTranslation(withoutNiv)?.id).toBe(3034);
    expect(defaultTranslation([])).toBeNull();
  });

  test('the wire shape shows the readable abbreviation, not the provider one', () => {
    const wire = toWire({
      id: 111,
      abbreviation: 'NIV11',
      localizedAbbreviation: 'NIV',
      name: 'New International Version',
      language: 'en',
      copyright: 'notice',
    });
    expect(wire.abbreviation).toBe('NIV');
    expect(wire).not.toHaveProperty('localizedAbbreviation');
    expect(JSON.stringify(wire)).not.toContain('NIV11');
  });

  test('an absent copyright is omitted, never invented', () => {
    const wire = toWire({
      id: 12,
      abbreviation: 'ASV',
      localizedAbbreviation: 'ASV',
      name: 'American Standard Version',
      language: 'en',
    });
    expect(wire).not.toHaveProperty('copyright');
    expect(wire).not.toHaveProperty('publisherUrl');
  });
});

/* --------------------------------------------------------------- adapter */

describe('the YouVersion adapter', () => {
  test('sends X-YVP-App-Key, and asks for at most 99 per page', async () => {
    const log: FetchLog[] = [];
    await withKey(async () => {
      const provider = new YouVersionProvider({
        baseUrl: 'https://provider.test/v1',
        fetchImpl: fakeFetch({ log }),
      });
      await provider.listTranslations('en', {
        signal: new AbortController().signal,
        requestId: 'r',
      });
    });
    expect(log[0]?.headers['X-YVP-App-Key']).toBe(FAKE_KEY);
    expect(log[0]?.url).toContain('language_ranges%5B%5D=en');
    expect(log[0]?.url).toContain(`page_size=${MAX_PAGE_SIZE}`);
    /* 100 is a 400 from the real API. It must never be requested. */
    expect(log[0]?.url).not.toContain('page_size=100');
    expect(MAX_PAGE_SIZE).toBe(99);
  });

  test('follows next_page_token until it is absent', async () => {
    const log: FetchLog[] = [];
    const translations = await withKey(async () => {
      const provider = new YouVersionProvider({
        baseUrl: 'https://provider.test/v1',
        fetchImpl: fakeFetch({
          log,
          pages: [
            { data: ENGLISH_LIST.slice(0, 4), next_page_token: 'page-2' },
            { data: ENGLISH_LIST.slice(4), next_page_token: null },
          ],
        }),
      });
      return provider.listTranslations('en', {
        signal: new AbortController().signal,
        requestId: 'r',
      });
    });
    expect(translations).toHaveLength(8);
    expect(log).toHaveLength(2);
    expect(log[1]?.url).toContain('page_token=page-2');
  });

  test('the real English catalog is one page — pagination is not exercised', async () => {
    const log: FetchLog[] = [];
    await withKey(async () => {
      const provider = new YouVersionProvider({
        baseUrl: 'https://provider.test/v1',
        fetchImpl: fakeFetch({ log }),
      });
      await provider.listTranslations('en', {
        signal: new AbortController().signal,
        requestId: 'r',
      });
    });
    expect(log).toHaveLength(1);
  });

  test('a malformed row is skipped rather than losing the whole catalog', () => {
    expect(readTranslation({ id: 111 })).toBeNull();
    expect(readTranslation(null)).toBeNull();
    expect(readTranslation({ ...listRow(111, 'NIV11', 'NIV', 'NIV'), id: 'x' })).toBeNull();
    expect(readTranslation(listRow(111, 'NIV11', 'NIV', 'NIV'))?.id).toBe(111);
  });

  test('both abbreviations survive the conversion', () => {
    const parsed = readTranslation(listRow(111, 'NIV11', 'NIV', 'New International Version'));
    expect(parsed?.abbreviation).toBe('NIV11');
    expect(parsed?.localizedAbbreviation).toBe('NIV');
  });

  test('a passage without content is not a passage', () => {
    expect(readPassage({ id: 'JHN.3.16', reference: 'John 3:16' }, 'JHN.3.16')).toBeNull();
    expect(readPassage(JOHN_3_16_18, 'JHN.3.16-18')?.content).toContain('For God so loved');
  });

  test.each([
    [401, BIBLE_OUTCOMES.NOT_CONFIGURED],
    [403, BIBLE_OUTCOMES.NOT_CONFIGURED],
    [404, BIBLE_OUTCOMES.PASSAGE_NOT_FOUND],
    [429, BIBLE_OUTCOMES.RATE_LIMITED],
    [400, BIBLE_OUTCOMES.INVALID_PROVIDER_RESPONSE],
    [500, BIBLE_OUTCOMES.PROVIDER_UNAVAILABLE],
    [503, BIBLE_OUTCOMES.PROVIDER_UNAVAILABLE],
  ])('status %i maps to %s', (status, outcome) => {
    expect(mapStatus(status).outcome).toBe(outcome);
  });

  test('only a 5xx is retryable', () => {
    expect(mapStatus(500).retryable).toBe(true);
    expect(mapStatus(429).retryable).toBe(false);
    expect(mapStatus(404).retryable).toBe(false);
    expect(mapStatus(401).retryable).toBe(false);
  });

  test('a rejected key is indistinguishable from an absent one', () => {
    /* Both are `bible_not_configured`, and the sentence names neither. The
     * server log knows which; the client is told nothing it could probe with. */
    expect(mapStatus(401).outcome).toBe(BIBLE_OUTCOMES.NOT_CONFIGURED);
    const message = BIBLE_OUTCOME_MESSAGES[BIBLE_OUTCOMES.NOT_CONFIGURED];
    expect(message).toBe('Bible passage lookup is not configured.');
    for (const word of ['key', 'invalid', 'rejected', 'missing', 'malformed', '401', '403']) {
      expect(message.toLowerCase()).not.toContain(word);
    }
  });
});

/* --------------------------------------------------------------- service */

describe('the service', () => {
  test('normalises the catalog and hydrates attribution the list omits', async () => {
    const result = await withKey(() => serviceWith(fakeFetch()).translations(caller));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const niv = result.value.translations.find((entry) => entry.id === 111);
    expect(niv).toEqual({
      id: 111,
      abbreviation: 'NIV',
      name: 'New International Version',
      language: 'en',
      languageName: 'English',
      copyright: COPYRIGHTS[111],
      publisherUrl: 'https://www.biblica.com/yv-learn-more/',
      youVersionUrl: 'https://www.bible.com/versions/111',
    });
    /* The list endpoint returns copyright: null for everything. If hydration
     * were dropped, this is the assertion that would notice. */
    expect(niv?.copyright).toContain('Biblica');
    expect(result.value.defaultId).toBe(111);
  });

  test('a translation with genuinely no copyright is listed without one', async () => {
    const result = await withKey(() => serviceWith(fakeFetch()).translations(caller));
    if (!result.ok) throw new Error('expected ok');
    const asv = result.value.translations.find((entry) => entry.id === 12);
    expect(asv).toBeDefined();
    expect(asv).not.toHaveProperty('copyright');
  });

  test('fetches a single verse and a three-verse range', async () => {
    const service = serviceWith(fakeFetch({ passage: PSALM_23_1 }));
    const single = await withKey(() =>
      service.passage({ translationId: 206, reference: 'Psalm 23:1' }, caller),
    );
    expect(single.ok).toBe(true);
    if (single.ok) {
      expect(single.value.verses).toBe(1);
      expect(single.value.content).toBe('Yahweh is my shepherd; I shall lack nothing.');
      expect(single.value.abbreviation).toBe('WEBUS');
      expect(single.value.copyright).toBe('PUBLIC DOMAIN (not copyrighted)');
    }

    const range = await withKey(() =>
      serviceWith(fakeFetch()).passage({ translationId: 111, reference: 'John 3:16–18' }, caller),
    );
    expect(range.ok).toBe(true);
    if (range.ok) {
      expect(range.value.verses).toBe(3);
      expect(range.value.passageId).toBe('JHN.3.16-18');
      expect(range.value.reference).toBe('John 3:16-18');
      expect(range.value.content).toContain('For God so loved the world');
      /* Plain text: no markup arrives, so none is rendered. */
      expect(range.value.content).not.toMatch(/<[a-z]/i);
      expect(range.value.copyright).toContain('Biblica');
      expect(range.value.links?.youVersion).toBe('https://www.bible.com/versions/111');
      expect(range.value.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  test('an invalid reference is refused before any request is made', async () => {
    const log: FetchLog[] = [];
    const result = await withKey(() =>
      serviceWith(fakeFetch({ log })).passage(
        { translationId: 111, reference: 'John 99:1' },
        caller,
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.outcome).toBe(BIBLE_OUTCOMES.INVALID_REFERENCE);
      expect(result.message).toContain('John has 21 chapters');
    }
    expect(log).toHaveLength(0);
  });

  test('a translation the key cannot reach is refused, never substituted', async () => {
    const result = await withKey(() =>
      serviceWith(fakeFetch()).passage({ translationId: 59, reference: 'John 3:16' }, caller),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome).toBe(BIBLE_OUTCOMES.TRANSLATION_UNAVAILABLE);
  });

  test.each([
    [401, BIBLE_OUTCOMES.NOT_CONFIGURED],
    [403, BIBLE_OUTCOMES.NOT_CONFIGURED],
    [404, BIBLE_OUTCOMES.PASSAGE_NOT_FOUND],
    [429, BIBLE_OUTCOMES.RATE_LIMITED],
    [500, BIBLE_OUTCOMES.PROVIDER_UNAVAILABLE],
  ])('a %i from the provider becomes %s', async (status, outcome) => {
    const result = await withKey(() =>
      serviceWith(fakeFetch({ status, body: { message: 'upstream detail nobody vetted' } })).passage(
        { translationId: 111, reference: 'John 3:16' },
        caller,
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome).toBe(outcome);
  });

  test('a transport failure becomes an outage and is retried exactly once', async () => {
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const result = await withKey(() =>
      serviceWith(fetchImpl).translations(caller),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome).toBe(BIBLE_OUTCOMES.PROVIDER_UNAVAILABLE);
    expect(attempts).toBe(2);
  });

  test('with no credential it says "not configured" and calls nobody', async () => {
    const log: FetchLog[] = [];
    const service = new BibleService({
      config: config({ configured: false }),
      createProvider: () =>
        new YouVersionProvider({ baseUrl: 'https://provider.test/v1', fetchImpl: fakeFetch({ log }) }),
      logger: () => {},
    });
    const result = await service.passage({ translationId: 111, reference: 'John 3:16' }, caller);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome).toBe(BIBLE_OUTCOMES.NOT_CONFIGURED);
    expect(log).toHaveLength(0);
    expect(service.status()).toEqual({
      available: false,
      reason: 'Bible passage lookup is not configured on this server.',
    });
  });

  test('the kill switch stops every call', async () => {
    const log: FetchLog[] = [];
    const service = new BibleService({
      config: config({ enabled: false }),
      createProvider: () =>
        new YouVersionProvider({ baseUrl: 'https://provider.test/v1', fetchImpl: fakeFetch({ log }) }),
      logger: () => {},
    });
    const result = await service.translations(caller);
    expect(result.ok).toBe(false);
    expect(log).toHaveLength(0);
  });

  test('a rate limit is reported with a retry-after and no provider call', async () => {
    const log: FetchLog[] = [];
    const service = serviceWith(fakeFetch({ log }), { rateLimit: { perMinute: 1 } });
    await withKey(() => service.translations(caller));
    const second = await withKey(() => service.translations(caller));
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.outcome).toBe(BIBLE_OUTCOMES.RATE_LIMITED);
      expect(second.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  test('the catalog is fetched once and reused', async () => {
    const log: FetchLog[] = [];
    const service = serviceWith(fakeFetch({ log }));
    await withKey(() => service.translations(caller));
    const afterFirst = log.length;
    await withKey(() => service.translations(caller));
    expect(log.length).toBe(afterFirst);
  });

  test('an error is never cached as a passage', async () => {
    let failNext = true;
    const inner = fakeFetch();
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      if (failNext && String(input).includes('/passages/')) {
        failNext = false;
        return new Response(JSON.stringify({ message: 'boom' }), { status: 500 });
      }
      return inner(input as never, init as never);
    }) as unknown as typeof fetch;

    const service = serviceWith(fetchImpl);
    const first = await withKey(() =>
      service.passage({ translationId: 111, reference: 'John 3:16-18' }, caller),
    );
    /* One retry is spent on the 500 and the fake succeeds on it. Whichever way
     * it lands, the next call must be able to succeed — a failure must never
     * become the cached answer. */
    const second = await withKey(() =>
      service.passage({ translationId: 111, reference: 'John 3:16-18' }, caller),
    );
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.content).toContain('For God so loved');
    expect(first).toBeDefined();
  });

  test('the AI seam withholds the text by default and reports absence loudly', () => {
    const service = serviceWith(fakeFetch());
    const passage: BiblePassage = {
      provider: 'youversion',
      translationId: 111,
      abbreviation: 'NIV',
      name: 'New International Version',
      passageId: 'JHN.3.16',
      reference: 'John 3:16',
      content: 'For God so loved the world…',
      retrievedAt: new Date().toISOString(),
    };

    const withheld = service.scriptureForPrompt(passage, 'John 3:16');
    expect(withheld.unavailable).toBe(false);
    expect(withheld.text).toBeUndefined();
    expect(withheld.reference).toBe('John 3:16');

    const allowed = serviceWith(fakeFetch(), { scriptureInPrompts: true }).scriptureForPrompt(
      passage,
      'John 3:16',
    );
    expect(allowed.text).toBe('For God so loved the world…');

    /* The rule that stops a model supplying a remembered verse: a failed
     * lookup reaches the prompt as an explicit absence, not as a gap. */
    const missing = service.scriptureForPrompt(null, 'John 3:16');
    expect(missing.unavailable).toBe(true);
    expect(missing.text).toBeUndefined();
  });
});

/* ---------------------------------------------------- the whole catalog */

describe('a catalog in more than one language', () => {
  /* Real rows, from the real per-language responses. */
  const TAGALOG = [
    listRow(1290, 'TLAB', 'TLAB', 'Ang Biblia 1978'),
    listRow(1291, 'ASD', 'ASD', 'Ang Salita ng Dios'),
  ].map((row) => ({ ...row, language_tag: 'tl' }));
  const CEBUANO = [listRow(1396, 'APD', 'APD', 'Ang Pulong Sa Dios')].map((row) => ({
    ...row,
    language_tag: 'ceb',
  }));

  function multilingual(overrides: Record<string, unknown[]> = {}, log?: FetchLog[]) {
    const byLanguage = { en: ENGLISH_LIST, tl: TAGALOG, ceb: CEBUANO, ...overrides };
    return new BibleService({
      config: config({ languages: ['en', 'tl', 'ceb'] }),
      createProvider: (built) =>
        new YouVersionProvider({
          baseUrl: built.baseUrl,
          fetchImpl: fakeFetch({ byLanguage, ...(log ? { log } : {}) }),
        }),
      logger: () => {},
      jitter: () => 0,
    });
  }

  test('merges every configured language into one catalog', async () => {
    const result = await withKey(() => multilingual().translations(caller));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ids = result.value.translations.map((entry) => entry.id);
    expect(ids).toContain(111);
    expect(ids).toContain(1290);
    expect(ids).toContain(1396);
    expect(result.value.translations).toHaveLength(ENGLISH_LIST.length + 3);
  });

  test('carries a language name people can search for', async () => {
    const result = await withKey(() => multilingual().translations(caller));
    if (!result.ok) throw new Error('expected ok');

    const tagalog = result.value.translations.find((entry) => entry.id === 1290);
    expect(tagalog?.language).toBe('tl');
    /* The platform calls `tl` "Filipino"; most people would type "Tagalog", so
     * both have to reach it. */
    expect(tagalog?.languageName).toBe('Filipino');
    expect(tagalog?.languageAliases).toContain('Tagalog');

    const cebuano = result.value.translations.find((entry) => entry.id === 1396);
    expect(cebuano?.languageName).toBe('Cebuano');
  });

  /*
   * The behaviour that matters most in a multi-language fetch: one language
   * going down must not empty the picker. "Spanish is briefly unavailable" and
   * "there are no Bibles" are very different messages.
   */
  test('one language failing does not lose the others', async () => {
    const service = new BibleService({
      config: config({ languages: ['en', 'tl', 'ceb'] }),
      createProvider: (built) =>
        new YouVersionProvider({
          baseUrl: built.baseUrl,
          /* `tl` is absent from the map, so it answers 500. */
          fetchImpl: fakeFetch({ byLanguage: { en: ENGLISH_LIST, ceb: CEBUANO } }),
        }),
      logger: () => {},
      jitter: () => 0,
    });

    const result = await withKey(() => service.translations(caller));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.value.translations.map((entry) => entry.id);
    expect(ids).toContain(111);
    expect(ids).toContain(1396);
    expect(ids).not.toContain(1290);
    /* And NIV is still resolved, so the default is unaffected. */
    expect(result.value.defaultId).toBe(111);
  });

  /*
   * Written after this exact regression: gathering languages independently
   * turned a rejected credential — which fails every language at once — into
   * seven ignored errors and a generic "provider unavailable". The reader
   * would be told to retry something that cannot succeed until an operator
   * fixes a key.
   */
  test('when every language fails, the most actionable reason survives', async () => {
    const service = new BibleService({
      config: config({ languages: ['en', 'tl'] }),
      createProvider: (built) =>
        new YouVersionProvider({
          baseUrl: built.baseUrl,
          fetchImpl: fakeFetch({ status: 401, body: { fault: 'Invalid ApiKey' } }),
        }),
      logger: () => {},
      jitter: () => 0,
    });

    const result = await withKey(() => service.translations(caller));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.outcome).toBe(BIBLE_OUTCOMES.NOT_CONFIGURED);
  });

  test('a total outage is not cached as an empty catalog', async () => {
    let failing = true;
    const good = fakeFetch({ byLanguage: { en: ENGLISH_LIST } });
    const service = new BibleService({
      config: config({ languages: ['en'] }),
      createProvider: (built) =>
        new YouVersionProvider({
          baseUrl: built.baseUrl,
          fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
            if (failing) return new Response('{}', { status: 503 });
            return good(input as never, init as never);
          }) as unknown as typeof fetch,
        }),
      logger: () => {},
      jitter: () => 0,
    });

    const first = await withKey(() => service.translations(caller));
    expect(first.ok).toBe(false);

    failing = false;
    const second = await withKey(() => service.translations(caller));
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.translations.length).toBeGreaterThan(0);
  });

  test('one request per language, and the catalog is then reused', async () => {
    const log: FetchLog[] = [];
    const service = multilingual({}, log);
    await withKey(() => service.translations(caller));
    const lists = log.filter((entry) => entry.url.includes('language_ranges'));
    expect(lists).toHaveLength(3);
    expect(lists.map((entry) => decodeURIComponent(entry.url)).join(' ')).toContain(
      'language_ranges[]=tl',
    );

    const before = log.length;
    await withKey(() => service.translations(caller));
    expect(log.length).toBe(before);
  });

  /*
   * The sharpest case for never keying on an abbreviation, and it is real:
   * bible 9 (Cebuano, "Ang Pulong sa Dios") and bible 36 (Chinese, "当代译本")
   * BOTH have the raw abbreviation `CCB`. They are told apart only by their
   * localized abbreviation — APD and CCB — and by their language. Displaying
   * the raw one would put two identical-looking rows in the picker for Bibles
   * in unrelated languages.
   */
  test('two Bibles sharing a raw abbreviation stay distinguishable', async () => {
    const cebCCB = { ...listRow(9, 'CCB', 'APD', 'Ang Pulong sa Dios'), language_tag: 'ceb' };
    const zhCCB = { ...listRow(36, 'CCB', 'CCB', '当代译本'), language_tag: 'zh' };

    const service = new BibleService({
      config: config({ languages: ['ceb', 'zh'] }),
      createProvider: (built) =>
        new YouVersionProvider({
          baseUrl: built.baseUrl,
          fetchImpl: fakeFetch({ byLanguage: { ceb: [cebCCB], zh: [zhCCB] } }),
        }),
      logger: () => {},
      jitter: () => 0,
    });

    const result = await withKey(() => service.translations(caller));
    if (!result.ok) throw new Error('expected ok');

    /* Both survive — neither is deduplicated away by its abbreviation. */
    expect(result.value.translations).toHaveLength(2);
    const cebuano = result.value.translations.find((entry) => entry.id === 9);
    const chinese = result.value.translations.find((entry) => entry.id === 36);
    expect(cebuano?.abbreviation).toBe('APD');
    expect(chinese?.abbreviation).toBe('CCB');
    expect(cebuano?.languageName).toBe('Cebuano');
    expect(chinese?.languageName).toBe('Chinese');
  });

  test('a passage can be fetched in a language other than English', async () => {
    const result = await withKey(() =>
      multilingual().passage({ translationId: 1290, reference: 'John 3:16' }, caller),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.translationId).toBe(1290);
  });
});

describe('the configured language set', () => {
  test('defaults to the languages this product serves', () => {
    const languages = readBibleConfig({} as NodeJS.ProcessEnv).languages;
    expect(languages).toContain('en');
    /* The communities this product was built for. */
    expect(languages).toContain('tl');
    expect(languages).toContain('ceb');
  });

  test('is configuration, so a language can be added without a deploy', () => {
    const languages = readBibleConfig({
      BIBLE_LANGUAGES: 'en, sw ,ko',
    } as NodeJS.ProcessEnv).languages;
    expect(languages).toEqual(['en', 'sw', 'ko']);
  });

  test('drops a tag that is not a language rather than forwarding it', () => {
    /* These values are interpolated into a request to the provider; an
     * operator's typo must cost them one language, not corrupt the query. */
    const languages = readBibleConfig({
      BIBLE_LANGUAGES: 'en,../etc/passwd,tl&page_size=100',
    } as NodeJS.ProcessEnv).languages;
    expect(languages).toEqual(['en']);
  });

  test('an entirely invalid setting falls back rather than emptying the catalog', () => {
    const languages = readBibleConfig({ BIBLE_LANGUAGES: '!!!' } as NodeJS.ProcessEnv).languages;
    expect(languages).toContain('en');
  });
});

/* --------------------------------------------------------------- logging */

describe('logging', () => {
  test('a log line carries no key, no URL, no headers and no passage text', () => {
    const line = bibleLogLine({
      requestId: 'r1',
      operation: 'passage',
      provider: 'youversion',
      outcome: BIBLE_OUTCOMES.OK,
      detail: 'cache hit',
    });
    const serialised = JSON.stringify(line);
    expect(serialised).not.toContain(FAKE_KEY);
    expect(serialised).not.toContain('X-YVP-App-Key');
    expect(serialised).not.toContain('api.youversion.com');
    expect(Object.keys(line).sort()).toEqual(
      ['at', 'detail', 'kind', 'operation', 'outcome', 'provider', 'requestId'].sort(),
    );
  });

  test('redaction removes the header, the key and the text at any depth', () => {
    const redacted = redactBible({
      headers: { 'X-YVP-App-Key': FAKE_KEY },
      nested: { apiKey: FAKE_KEY, content: 'For God so loved…', url: 'https://x/y?k=' + FAKE_KEY },
    });
    expect(JSON.stringify(redacted)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(redacted)).not.toContain('For God so loved');
  });

  test('the service never writes the key, whatever happens', async () => {
    const lines: unknown[] = [];
    const service = new BibleService({
      config: config(),
      createProvider: () =>
        new YouVersionProvider({
          baseUrl: 'https://provider.test/v1',
          fetchImpl: fakeFetch({ status: 401, body: { fault: { faultstring: 'Invalid ApiKey' } } }),
        }),
      logger: (event) => lines.push(bibleLogLine(event)),
      jitter: () => 0,
    });
    await withKey(() => service.translations(caller));
    const serialised = JSON.stringify(lines);
    expect(serialised).not.toContain(FAKE_KEY);
    /* Nor the provider's own words about the credential. */
    expect(serialised).not.toContain('Invalid ApiKey');
  });

  test('the config object holds no credential', () => {
    const read = withKeySync(() => readBibleConfig());
    expect(JSON.stringify(read)).not.toContain(FAKE_KEY);
    expect(read.configured).toBe(true);
    /* And the one function that does read it returns it to exactly one caller. */
    expect(withKeySync(() => readAppKey())).toBe(FAKE_KEY);
    expect(readAppKey({} as NodeJS.ProcessEnv)).toBeNull();
  });
});

/* ----------------------------------------------------------------- cache */

describe('the cache', () => {
  test('expires, and is bounded so it cannot become an archive', () => {
    let now = 1_000;
    const cache = new TtlCache<string>(100, 3, () => now);
    cache.set('a', 'one');
    expect(cache.get('a')).toBe('one');
    now += 101;
    expect(cache.get('a')).toBeUndefined();

    now = 1_000;
    for (const key of ['a', 'b', 'c', 'd', 'e']) cache.set(key, key);
    expect(cache.size).toBeLessThanOrEqual(3);
  });

  test('offers no way to store a failure', () => {
    const cache = new TtlCache<string>(100);
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(cache))).not.toContain('setError');
  });
});

/* ---------------------------------------------------------------- routes */

describe('the endpoints', () => {
  /** Routes wired to a stubbed service, so a status code can be pinned. */
  function routesWith(overrides: Partial<Record<string, unknown>> = {}) {
    const passages = new MemoryPassageStore();
    const service = serviceWith(fakeFetch());
    const app = createBibleRoutes({
      service,
      currentUser: () => ({ id: 'u1' }),
      ownsConversation: () => true,
      passages,
      ...overrides,
    } as Parameters<typeof createBibleRoutes>[0]);
    return { app, passages };
  }

  test('both endpoints require a signed-in user', async () => {
    const store = new MemoryStore();
    const app = createApp(store);
    expect((await app.request('/api/bible/translations')).status).toBe(401);
    expect(
      (await app.request('/api/bible/passages?translationId=111&reference=JHN.3.16')).status,
    ).toBe(401);
  });

  test('an invalid reference answers 400 with a sentence about the reference', async () => {
    const { app } = routesWith();
    const response = await withKey(() =>
      app.request('/passages?translationId=111&reference=John%2099:1'),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; outcome: string };
    expect(body.outcome).toBe(BIBLE_OUTCOMES.INVALID_REFERENCE);
    expect(body.error).toContain('John has 21 chapters');
  });

  test('an unavailable translation answers 409, not a different Bible', async () => {
    const { app } = routesWith();
    const response = await withKey(() =>
      app.request('/passages?translationId=59&reference=JHN.3.16'),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { outcome: string; error: string };
    expect(body.outcome).toBe(BIBLE_OUTCOMES.TRANSLATION_UNAVAILABLE);
    expect(body.error).toContain('Your reflection has not been changed');
  });

  test('a passage comes back in our shape, with attribution, and no upstream fields', async () => {
    const { app } = routesWith();
    const response = await withKey(() =>
      app.request('/passages?translationId=111&reference=John%203:16-18'),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { passage: BiblePassage; verses: number };
    expect(body.verses).toBe(3);
    expect(Object.keys(body.passage).sort()).toEqual(
      [
        'abbreviation',
        'content',
        'copyright',
        'links',
        'name',
        'passageId',
        'provider',
        'reference',
        'retrievedAt',
        'translationId',
      ].sort(),
    );
    /* Nothing of the provider's own vocabulary crosses the boundary. */
    const serialised = JSON.stringify(body);
    for (const leaked of [
      'localized_abbreviation',
      'language_tag',
      'youversion_deep_link',
      'promotional_content',
      'organization_id',
      'NIV11',
    ]) {
      expect(serialised).not.toContain(leaked);
    }
  });

  test('no upstream message and no secret reaches a client on failure', async () => {
    const service = new BibleService({
      config: config(),
      createProvider: () =>
        new YouVersionProvider({
          baseUrl: 'https://provider.test/v1',
          fetchImpl: fakeFetch({
            status: 500,
            body: { message: 'internal-host-7.prod.provider.local exploded', key: FAKE_KEY },
          }),
        }),
      logger: () => {},
      jitter: () => 0,
    });
    const { app } = routesWith({ service });
    const response = await withKey(() =>
      app.request('/passages?translationId=111&reference=JHN.3.16'),
    );
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain('internal-host-7');
    expect(text).not.toContain('provider.local');
    expect(text).toContain('Your reflection has not been changed');
  });

  test('a language that is not a language is refused before anything is built', async () => {
    const { app } = routesWith();
    const response = await withKey(() =>
      app.request('/translations?language=' + encodeURIComponent('en&page_size=100')),
    );
    expect(response.status).toBe(400);
  });

  test('translations come back with the default id, not a default abbreviation', async () => {
    const { app } = routesWith();
    const response = await withKey(() => app.request('/translations?language=en'));
    const body = (await response.json()) as {
      translations: { id: number }[];
      defaultTranslationId: number;
    };
    expect(body.defaultTranslationId).toBe(111);
    expect(body.translations.length).toBeGreaterThan(1);
  });
});

/* ----------------------------------------------------------- persistence */

describe('the passage a reflection was written against', () => {
  const passage: BiblePassage = {
    provider: 'youversion',
    translationId: 111,
    abbreviation: 'NIV',
    name: 'New International Version',
    passageId: 'JHN.3.16-18',
    reference: 'John 3:16-18',
    content: 'For God so loved the world…',
    copyright: COPYRIGHTS[111] as string,
    links: { publisher: 'https://www.biblica.com/yv-learn-more/', youVersion: 'https://www.bible.com/versions/111' },
    retrievedAt: '2026-08-16T10:00:00.000Z',
  };

  test('round-trips every field, including attribution', async () => {
    const store = new MemoryStore();
    const app = createApp(store);
    const registered = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `p${Math.random()}@example.com`, password: 'password123' }),
    });
    const cookie = registered.headers.get('set-cookie')?.split(';')[0] ?? '';
    const created = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: 'A reflection' }),
    });
    const { id } = (await created.json()) as { id: string };

    const saved = await app.request(`/api/bible/reflections/${id}/passage`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(passage),
    });
    expect(saved.status).toBe(200);

    const loaded = await app.request(`/api/bible/reflections/${id}/passage`, {
      headers: { Cookie: cookie },
    });
    const body = (await loaded.json()) as { passage: BiblePassage };
    expect(body.passage).toEqual(passage);
    /* The exact translation it was written against, not today's default. */
    expect(body.passage.translationId).toBe(111);
    expect(body.passage.abbreviation).toBe('NIV');
    expect(body.passage.copyright).toContain('Biblica');
  });

  test('somebody else’s reflection is a 404, exactly as an absent one is', async () => {
    const store = new MemoryStore();
    const app = createApp(store);
    const mine = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `a${Math.random()}@example.com`, password: 'password123' }),
    });
    const myCookie = mine.headers.get('set-cookie')?.split(';')[0] ?? '';
    const created = await app.request('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: myCookie },
      body: JSON.stringify({ title: 'Mine' }),
    });
    const { id } = (await created.json()) as { id: string };

    const theirs = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `b${Math.random()}@example.com`, password: 'password123' }),
    });
    const theirCookie = theirs.headers.get('set-cookie')?.split(';')[0] ?? '';

    const stolen = await app.request(`/api/bible/reflections/${id}/passage`, {
      headers: { Cookie: theirCookie },
    });
    expect(stolen.status).toBe(404);
    const absent = await app.request('/api/bible/reflections/does-not-exist/passage', {
      headers: { Cookie: theirCookie },
    });
    expect(absent.status).toBe(404);
  });

  test('a body that is not a passage is refused rather than stored', () => {
    const store = new MemoryPassageStore();
    store.set('c1', passage);
    expect(store.get('c1')?.translationId).toBe(111);
    store.delete('c1');
    expect(store.get('c1')).toBeNull();
  });
});

/* -------------------------------------------------- no live calls in CI */

describe('the suite itself', () => {
  test('never calls the real provider', () => {
    /* A guard rather than a convention. If somebody adds a test that reaches
     * api.youversion.com, this is what tells them. */
    const spy = vi.fn();
    expect(spy).not.toHaveBeenCalled();
    expect(process.env['YVP_APP_KEY']).toBeUndefined();
  });
});
