import { describe, expect, test } from 'vitest';
import {
  CHAT_SECTION_TYPES,
  CREATE_FORMATS,
  CREATE_FORMAT_SIZE,
  CREATE_STYLES,
  isCommunityVisible,
  VISIBILITY,
  readVisibility,
} from './index.ts';

describe('publication visibility', () => {
  test('private content is not community-visible', () => {
    expect(isCommunityVisible(VISIBILITY.PRIVATE)).toBe(false);
  });

  test('only explicitly published content is community-visible', () => {
    expect(isCommunityVisible(VISIBILITY.SHARED)).toBe(true);
  });
});

describe('C.H.A.T. sections', () => {
  test('H is Heart, not a highlight field', () => {
    expect(CHAT_SECTION_TYPES.HEART).toBe('heart');
    expect(Object.values(CHAT_SECTION_TYPES)).toEqual([
      'content',
      'heart',
      'application',
      'testimony',
    ]);
  });
});

describe('Create engine palettes', () => {
  test('square and portrait sizes are distinct, and warm photographic is a style', () => {
    expect(CREATE_FORMAT_SIZE[CREATE_FORMATS.SQUARE]).toEqual({ width: 1080, height: 1080 });
    expect(CREATE_FORMAT_SIZE[CREATE_FORMATS.PORTRAIT]).toEqual({ width: 1080, height: 1350 });
    expect(CREATE_STYLES.WARM_PHOTOGRAPHIC).toBe('warm-photographic');
  });
});

/*
 * Rows written before sharing was called sharing say `published`. A reader
 * that did not understand them would turn every shared reflection private,
 * which is a data-loss bug wearing a rename's clothes.
 */
describe('reading a stored visibility', () => {
  test('understands the value it used to be written as', () => {
    expect(readVisibility('published')).toBe(VISIBILITY.SHARED);
    expect(readVisibility('shared')).toBe(VISIBILITY.SHARED);
  });

  test('treats anything else as private, because private is the safe answer', () => {
    expect(readVisibility('private')).toBe(VISIBILITY.PRIVATE);
    expect(readVisibility(undefined)).toBe(VISIBILITY.PRIVATE);
    expect(readVisibility('nonsense')).toBe(VISIBILITY.PRIVATE);
  });
});
