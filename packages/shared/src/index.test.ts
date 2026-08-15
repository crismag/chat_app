import { describe, expect, test } from 'vitest';
import {
  CHAT_SECTION_TYPES,
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
      'context',
      'heart',
      'application',
      'testimony',
    ]);
  });
});
