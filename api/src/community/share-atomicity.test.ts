/*
 * A publication and the share event that meters it are one write.
 *
 * The ceilings are counted from `share_events`. When the row was inserted by
 * the route after `publish()` had already committed, a crash in between left a
 * publication that existed and had cost its author nothing — the difference
 * between a limit and a suggestion. These pin the coupling: the store writes
 * both, in one transaction, and nothing outside it has to remember to.
 */
import { expect, test } from 'vitest';
import { AUDIENCES, REFLECTION_VISIBILITY } from '@chat/shared';

import { SqliteStore } from '../db.ts';
import { CommunityStore, type NewPublication } from './store.ts';

const source = {
  format: 'full',
  title: 'Trusting while I cannot see',
  scriptureReference: 'Romans 8:28',
  sections: {
    content: { content: 'The passage itself.', authorOrigin: 'user' },
    heart: { content: 'What it met in me.', authorOrigin: 'user' },
  },
};

function publication(over: Partial<NewPublication> = {}): NewPublication {
  return {
    authorUserId: 'author-1',
    conversationId: 'conversation-1',
    audience: AUDIENCES.PUBLIC,
    shareVisibility: REFLECTION_VISIBILITY.PUBLIC,
    communityId: null,
    caption: 'For anyone.',
    sectionTypes: ['content', 'heart'],
    hashtags: [],
    ...over,
  };
}

function freshStore() {
  const store = new SqliteStore();
  /* publications.authorUserId is a real foreign key; the author has to exist. */
  store.db
    .prepare(
      `INSERT INTO users (id, accountType, email, createdAt)
       VALUES (?, 'REGISTERED', ?, ?)`,
    )
    .run('author-1', 'ada@example.com', new Date().toISOString());
  return new CommunityStore(store.db);
}

function shares(community: CommunityStore, conversationId = 'conversation-1') {
  return community.shareHistory({
    userId: 'author-1',
    conversationId,
    communityId: null,
    now: Date.now(),
  });
}

test('publishing records the share it should be metered by', () => {
  const community = freshStore();
  expect(shares(community).everythingDay.count).toBe(0);

  community.publish(publication(), source);

  /* One call, both rows. The route does not have to remember. */
  expect(shares(community).everythingDay.count).toBe(1);
  expect(shares(community).publicDay.count).toBe(1);
});

test('Only Me is not metered, because it reaches nobody', () => {
  const community = freshStore();

  community.publish(publication({ audience: AUDIENCES.ONLY_ME }), source);

  expect(shares(community).everythingDay.count).toBe(0);
});

test('a publication that fails to commit does not spend a share', () => {
  const community = freshStore();

  /*
   * A section type the source does not carry is skipped, but a null caption
   * violates NOT NULL on the publication row itself — the insert that happens
   * before the share event. If the two were not one transaction, the ceiling
   * would still have been charged for a publication that does not exist.
   */
  expect(() =>
    community.publish(publication({ caption: null as unknown as string }), source),
  ).toThrow();

  expect(shares(community).everythingDay.count).toBe(0);
});
