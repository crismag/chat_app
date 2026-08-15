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
  context: fill(200),
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
   * The rule most likely to be got wrong. Four sections of 500 are each under
   * their own 600 maximum, and 2,000 together is over the 1,200 recommended —
   * so the C.H.A.T. is Extended even though no single field is.
   */
  it('applies the combined limit even when every field is individually fine', () => {
    const draft = fullDraft({
      context: fill(500),
      heart: fill(500),
      application: fill(500),
      testimony: fill(500),
    });
    for (const field of ['context', 'heart', 'application', 'testimony'] as const) {
      expect(counterFor(CHAT_FORMATS.FULL, field, draft[field])!.status).not.toBe(
        LENGTH_STATUS.INVALID,
      );
    }
    const result = validateChat(CHAT_FORMATS.FULL, draft);
    expect(result.combined.length).toBe(2000);
    expect(result.status).toBe(LENGTH_STATUS.EXTENDED);
  });

  it('is invalid past the combined hard maximum, with no way to acknowledge it', () => {
    const draft = fullDraft({
      context: fill(700),
      heart: fill(600),
      application: fill(600),
      testimony: fill(600),
    });
    const result = validateChat(CHAT_FORMATS.FULL, draft, {
      extensionAcknowledged: true,
    });
    expect(result.combined.length).toBe(2500);
    expect(result.status).toBe(LENGTH_STATUS.INVALID);
    expect(result.publishable).toBe(false);
  });

  it('requires acknowledgement when extended, and accepts it', () => {
    const draft = fullDraft({ context: fill(700), heart: fill(600) });
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
    const { kept, overflow } = splitAtLimit(CHAT_FORMATS.FULL, 'heart', fill(700));
    expect(kept).toHaveLength(600);
    expect(overflow).toHaveLength(100);
  });

  it('leaves text under the limit untouched', () => {
    const { kept, overflow } = splitAtLimit(CHAT_FORMATS.FULL, 'heart', fill(100));
    expect(kept).toHaveLength(100);
    expect(overflow).toBe('');
  });
});
