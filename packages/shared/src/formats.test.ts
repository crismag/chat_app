import { describe, expect, it } from 'vitest';
import {
  CHAT_FORMATS,
  FORMAT_LIMITS,
  LENGTH_STATUS,
  counterFor,
  splitAtLimit,
  validateChat,
} from './formats.ts';

const fill = (n: number) => 'a'.repeat(n);

const fullDraft = (over: Partial<Record<string, string>> = {}) => ({
  title: 'Trusting when I cannot see',
  scriptureReference: 'Romans 8:28',
  content: fill(200),
  heart: fill(200),
  application: fill(200),
  testimony: fill(200),
  ...over,
});

const condensedDraft = (over: Partial<Record<string, string>> = {}) => ({
  scriptureReference: 'Psalm 46:10',
  verse: fill(200),
  reflection: fill(200),
  ...over,
});

describe('Full C.H.A.T.', () => {
  it('is publishable when complete and within the recommended budget', () => {
    const result = validateChat(CHAT_FORMATS.FULL, fullDraft());
    expect(result.status).toBe(LENGTH_STATUS.RECOMMENDED);
    expect(result.publishable).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('is not publishable while a required section is empty', () => {
    const result = validateChat(CHAT_FORMATS.FULL, fullDraft({ testimony: '' }));
    expect(result.missing).toContain('testimony');
    expect(result.publishable).toBe(false);
  });

  /*
   * The combined budget still overrides the per-field ones. Four sections of
   * 510 are each under 700, and 2,040 together is over the 2,000 recommended.
   */
  it('applies the combined limit even when every field is individually fine', () => {
    const draft = fullDraft({
      content: fill(510),
      heart: fill(510),
      application: fill(510),
      testimony: fill(510),
    });
    for (const field of ['content', 'heart', 'application', 'testimony'] as const) {
      expect(counterFor(CHAT_FORMATS.FULL, field, draft[field])!.status).not.toBe(
        LENGTH_STATUS.INVALID,
      );
    }
    const result = validateChat(CHAT_FORMATS.FULL, draft);
    expect(result.combined.length).toBe(2040);
    expect(result.status).toBe(LENGTH_STATUS.EXTENDED);
  });

  it('is invalid past the combined hard maximum, with no way to acknowledge it', () => {
    const draft = fullDraft({
      content: fill(1000),
      heart: fill(1000),
      application: fill(1000),
      testimony: fill(1000),
    });
    const result = validateChat(CHAT_FORMATS.FULL, draft, {
      extensionAcknowledged: true,
    });
    expect(result.combined.length).toBe(4000);
    expect(result.status).toBe(LENGTH_STATUS.INVALID);
    expect(result.publishable).toBe(false);
  });

  /*
   * The C section holds the passage, and often nothing else.
   *
   * Roughly thirty real reflections were transcribed in
   * `docs/examples/REAL_CHAT_SAMPLES.md` and most of their Content sections are
   * the verse, its reference and its translation with no commentary after them.
   * An author who writes that has finished the section, and nothing may report
   * it as missing, partial or awaiting an explanation.
   */
  it('treats a Content section that is only the passage as complete', () => {
    const verseOnly =
      '"For God so loved the world that he gave his one and only Son…"\nJohn 3:16 NIV';
    const result = validateChat(CHAT_FORMATS.FULL, fullDraft({ content: verseOnly }));

    expect(result.missing).not.toContain('content');
    expect(result.missing).toEqual([]);
    expect(result.publishable).toBe(true);
    expect(
      counterFor(CHAT_FORMATS.FULL, 'content', verseOnly)!.status,
    ).toBe(LENGTH_STATUS.RECOMMENDED);
  });

  it('requires acknowledgement when extended, and accepts it', () => {
    const draft = fullDraft({ content: fill(700), heart: fill(700), application: fill(450) });
    const unacknowledged = validateChat(CHAT_FORMATS.FULL, draft);
    expect(unacknowledged.requiresExtensionAcknowledgement).toBe(true);
    expect(unacknowledged.publishable).toBe(false);

    const acknowledged = validateChat(CHAT_FORMATS.FULL, draft, {
      extensionAcknowledged: true,
    });
    expect(acknowledged.publishable).toBe(true);
  });
});

describe('Condensed C.H.A.T.', () => {
  it('is publishable within budget', () => {
    const result = validateChat(CHAT_FORMATS.CONDENSED, condensedDraft());
    expect(result.publishable).toBe(true);
    expect(result.maxPages).toBe(1);
  });

  /* A 350-character verse leaves at most 450 for the reflection. */
  it('enforces the combined 800 over the individual maximums', () => {
    const draft = condensedDraft({ verse: fill(350), reflection: fill(500) });
    expect(counterFor(CHAT_FORMATS.CONDENSED, 'verse', draft.verse!)!.status).not.toBe(
      LENGTH_STATUS.INVALID,
    );
    expect(
      counterFor(CHAT_FORMATS.CONDENSED, 'reflection', draft.reflection!)!.status,
    ).not.toBe(LENGTH_STATUS.INVALID);
    const result = validateChat(CHAT_FORMATS.CONDENSED, draft);
    expect(result.combined.length).toBe(850);
    expect(result.status).toBe(LENGTH_STATUS.INVALID);
  });

  /* The absolute rule: acknowledgement must not rescue a one-page failure. */
  it('never allows an override for length or pages', () => {
    const draft = condensedDraft({ verse: fill(350), reflection: fill(550) });
    const result = validateChat(CHAT_FORMATS.CONDENSED, draft, {
      extensionAcknowledged: true,
    });
    expect(result.status).toBe(LENGTH_STATUS.INVALID);
    expect(result.publishable).toBe(false);
    expect(result.requiresExtensionAcknowledgement).toBe(false);
    expect(FORMAT_LIMITS.condensed.extensionAllowed).toBe(false);
  });

  it('requires a translation when verse text is quoted', () => {
    const result = validateChat(CHAT_FORMATS.CONDENSED, condensedDraft(), {
      quotesVerseText: true,
    });
    expect(result.missing).toContain('translation');
    expect(result.publishable).toBe(false);

    const named = validateChat(
      CHAT_FORMATS.CONDENSED,
      { ...condensedDraft(), translation: 'NIV' },
      { quotesVerseText: true },
    );
    expect(named.publishable).toBe(true);
  });
});

describe('input handling', () => {
  /* Nothing the author wrote may be discarded silently. */
  it('returns the overflow rather than dropping it', () => {
    const heartLimit = FORMAT_LIMITS.full.fields.heart!.hard;
    const { kept, overflow } = splitAtLimit(
      CHAT_FORMATS.FULL,
      'heart',
      fill(heartLimit + 100),
    );
    expect(kept).toHaveLength(heartLimit);
    expect(overflow).toHaveLength(100);
  });

  it('leaves text under the limit untouched', () => {
    const { kept, overflow } = splitAtLimit(CHAT_FORMATS.FULL, 'heart', fill(100));
    expect(kept).toHaveLength(100);
    expect(overflow).toBe('');
  });
});
