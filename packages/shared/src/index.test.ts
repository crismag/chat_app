import { describe, expect, test } from 'vitest';
import {
  CHAT_SECTION_TYPES,
  CREATE_FORMATS,
  CREATE_FORMAT_SIZE,
  CREATE_STYLES,
  isCommunityVisible,
  PUBLICATION_STATES,
} from './index.ts';

describe('publication visibility', () => {
  test('private content is not community-visible', () => {
    expect(isCommunityVisible(PUBLICATION_STATES.PRIVATE)).toBe(false);
  });

  test('only explicitly published content is community-visible', () => {
    expect(isCommunityVisible(PUBLICATION_STATES.PUBLISHED)).toBe(true);
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
