/*
 * The registry, against SQLite.
 *
 * Not the memory backing: the ranking, the uniqueness and — the part that
 * matters — the privacy rule are all expressed as SQL, and a rule that only
 * holds in the lenient implementation is not a rule. This repository has been
 * burned by that before.
 */
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, test } from 'vitest';
import { TAG_SUGGEST_LIMIT } from '@chat/shared';
import { TAG_STATUS, boundedLimit, createTagRegistry, type TagRegistry } from './store.ts';
import { validateTags } from './validate.ts';

let db: DatabaseSync;
let registry: TagRegistry;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  registry = createTagRegistry({ db });
});

/** Put a tag in, the way a save would: validated first, then recorded. */
function use(userId: string, raw: string, published: boolean, times = 1) {
  const { accepted } = validateTags([raw]);
  for (let i = 0; i < times; i += 1) {
    registry.record({ userId, tags: accepted, published });
  }
  return accepted;
}

function names(suggestions: { tag: string }[]): string[] {
  return suggestions.map((s) => s.tag);
}

describe('normalization and reuse', () => {
  test('four spellings of one word are one registry row', () => {
    for (const raw of ['Prayer', 'PRAYER', '#prayer', '  prayer  ']) {
      use('u1', raw, true);
    }
    const tag = registry.get('prayer');
    expect(tag).not.toBeNull();
    expect(tag?.publicCount).toBe(4);
    expect(names(registry.suggest({ userId: 'u1', query: 'pray' }))).toEqual(['prayer']);
  });

  test('separators are already gone, so a hyphen makes no second tag', () => {
    use('u1', '#bible-study', true);
    use('u1', 'bible study', true);
    use('u1', 'biblestudy', true);
    expect(registry.get('biblestudy')?.publicCount).toBe(3);
    expect(registry.get('bible-study')).toBeNull();
  });

  test('the first spelling decides the label everyone sees', () => {
    use('u1', '#Bible-Study', true);
    use('u2', 'biblestudy', true);
    expect(registry.get('biblestudy')?.displayName).toBe('Bible-Study');
  });

  test('a new tag is created rather than refused', () => {
    expect(registry.get('lectiodivina')).toBeNull();
    use('u1', '#lectio-divina', true);
    expect(registry.get('lectiodivina')?.status).toBe(TAG_STATUS.ACTIVE);
  });
});

describe('suggestions', () => {
  test('at most five, whatever is asked for', () => {
    for (const word of ['pray', 'prayer', 'prayerlife', 'praying', 'prayerrequest', 'praise']) {
      use('u1', word, true);
    }
    expect(registry.suggest({ userId: 'u1', query: 'pra', limit: 500 })).toHaveLength(
      TAG_SUGGEST_LIMIT,
    );
    expect(boundedLimit(500)).toBe(TAG_SUGGEST_LIMIT);
    expect(boundedLimit(2)).toBe(2);
    expect(boundedLimit(0)).toBe(TAG_SUGGEST_LIMIT);
    expect(boundedLimit(Number.NaN)).toBe(TAG_SUGGEST_LIMIT);
  });

  test('a prefix matches; an unrelated word does not', () => {
    use('u1', 'prayer', true);
    use('u1', 'fasting', true);
    expect(names(registry.suggest({ userId: 'u1', query: 'pray' }))).toEqual(['prayer']);
    expect(registry.suggest({ userId: 'u1', query: 'zzz' })).toEqual([]);
  });

  test('an empty query suggests nothing rather than everything', () => {
    use('u1', 'prayer', true);
    expect(registry.suggest({ userId: 'u1', query: '' })).toEqual([]);
  });

  test('an exact match comes first even when a longer tag is more popular', () => {
    use('u1', 'pray', true);
    for (let i = 0; i < 50; i += 1) use('u2', 'prayer', true);
    expect(names(registry.suggest({ userId: 'u1', query: 'pray' }))[0]).toBe('pray');
  });
});

describe('ranking', () => {
  test("a person's own tag outranks a far more popular one", () => {
    /* Fifty strangers use `praise`; this person has used `prayerwalk` once. */
    for (let i = 0; i < 50; i += 1) use(`stranger${i}`, 'praise', true);
    use('mine', 'prayerwalk', false);
    expect(names(registry.suggest({ userId: 'mine', query: 'pra' }))[0]).toBe('prayerwalk');
  });

  test('their own most-used tag comes before their own least-used', () => {
    use('mine', 'prayerwalk', false, 1);
    use('mine', 'prayerlist', false, 5);
    expect(names(registry.suggest({ userId: 'mine', query: 'prayer' }))[0]).toBe('prayerlist');
  });

  test('with no personal history, popularity decides', () => {
    for (let i = 0; i < 9; i += 1) use(`u${i}`, 'praise', true);
    for (let i = 0; i < 2; i += 1) use(`v${i}`, 'prayer', true);
    expect(names(registry.suggest({ userId: 'newcomer', query: 'pra' }))).toEqual([
      'praise',
      'prayer',
    ]);
  });

  test('a visitor with no account gets the same global ranking', () => {
    for (let i = 0; i < 9; i += 1) use(`u${i}`, 'praise', true);
    use('u1', 'prayer', true);
    expect(names(registry.suggest({ userId: null, query: 'pra' }))).toEqual(['praise', 'prayer']);
  });
});

/*
 * The privacy rule, which is the reason this feature has two counts.
 *
 * `hashtagsFor` in the community store put it best: a filter chip is a count
 * with a name on it, and counts leak. A suggestion list is the same thing with
 * a keyboard in front of it.
 */
describe('private tags stay private', () => {
  test("a tag used only in private reflections is never offered to anybody else", () => {
    use('author', 'miscarriage', false);
    expect(registry.get('miscarriage')).not.toBeNull();
    expect(registry.suggest({ userId: 'stranger', query: 'mis' })).toEqual([]);
    expect(registry.suggest({ userId: null, query: 'mis' })).toEqual([]);
  });

  test('its own author is still offered it, which is the point of keeping it', () => {
    use('author', 'miscarriage', false);
    expect(names(registry.suggest({ userId: 'author', query: 'mis' }))).toEqual(['miscarriage']);
  });

  test('sharing is what gives a tag standing with everybody else', () => {
    use('author', 'miscarriage', false);
    expect(registry.suggest({ userId: 'stranger', query: 'mis' })).toEqual([]);
    registry.record({
      userId: 'author',
      tags: [{ tag: 'miscarriage', label: 'miscarriage' }],
      published: true,
    });
    expect(names(registry.suggest({ userId: 'stranger', query: 'mis' }))).toEqual(['miscarriage']);
  });
});

describe('moderation cannot be poisoned', () => {
  test('a refused tag creates nothing, counts nothing and is never suggested', () => {
    const { accepted, refused } = validateTags(['#shit']);
    expect(accepted).toEqual([]);
    expect(refused).toHaveLength(1);
    registry.record({ userId: 'u1', tags: accepted, published: true });
    expect(registry.get('shit')).toBeNull();
    expect(registry.suggest({ userId: 'u1', query: 'sh' })).toEqual([]);
  });

  test('one refused tag does not cost the others in the same save', () => {
    const { accepted, refused } = validateTags(['prayer', '#shit', 'fasting']);
    expect(accepted.map((t) => t.tag)).toEqual(['prayer', 'fasting']);
    expect(refused).toHaveLength(1);
  });
});

describe('administrative status', () => {
  test('a blocked tag disappears from suggestions without losing its row', () => {
    use('u1', 'prayer', true);
    registry.setStatus('prayer', TAG_STATUS.BLOCKED);
    expect(registry.get('prayer')).not.toBeNull();
    expect(registry.suggest({ userId: 'u1', query: 'pray' })).toEqual([]);
  });

  test('a blocked tag cannot be counted again by using it', () => {
    use('u1', 'prayer', true);
    const before = registry.get('prayer')?.publicCount;
    registry.setStatus('prayer', TAG_STATUS.BLOCKED);
    use('u2', 'prayer', true);
    expect(registry.get('prayer')?.publicCount).toBe(before);
  });

  test('a hidden tag is not suggested either', () => {
    use('u1', 'prayer', true);
    registry.setStatus('prayer', TAG_STATUS.HIDDEN);
    expect(registry.suggest({ userId: 'u1', query: 'pray' })).toEqual([]);
  });
});

/*
 * The unique constraint, not the application-side lookup, is what makes this
 * safe. Node's SQLite is synchronous so there is no true concurrency to stage
 * here; what can be proved is that the constraint exists and that a second
 * insert of the same normalized name is refused by the database rather than
 * quietly making a second row.
 */
test('the database refuses a duplicate canonical tag', () => {
  use('u1', 'prayer', true);
  expect(() =>
    db
      .prepare(
        `INSERT INTO tags (id, normalizedName, displayName, publicCount, status, createdAt, lastUsedAt)
         VALUES ('other', 'prayer', 'Prayer', 0, 'active', 'now', 'now')`,
      )
      .run(),
  ).toThrow();
  const rows = db.prepare('SELECT COUNT(*) AS n FROM tags WHERE normalizedName = ?').get('prayer');
  expect(Number((rows as { n: number }).n)).toBe(1);
});

test('concurrent-shaped writes of one new tag converge on one row', () => {
  const tags = validateTags(['#lectio-divina']).accepted;
  for (const user of ['a', 'b', 'c', 'd']) {
    registry.record({ userId: user, tags, published: true });
  }
  const rows = db
    .prepare('SELECT COUNT(*) AS n FROM tags WHERE normalizedName = ?')
    .get('lectiodivina');
  expect(Number((rows as { n: number }).n)).toBe(1);
  expect(registry.get('lectiodivina')?.publicCount).toBe(4);
});

describe('unicode and multilingual input', () => {
  test('accented words are kept as themselves', () => {
    use('u1', '#alabaré', true);
    expect(names(registry.suggest({ userId: 'u1', query: 'alab' }))).toEqual(['alabaré']);
  });

  test('a non-Latin tag registers and suggests', () => {
    use('u1', '#오라시온', true);
    expect(names(registry.suggest({ userId: 'u1', query: '오라' }))).toEqual(['오라시온']);
  });

  test('a tag that folds to nothing is not a tag', () => {
    const { accepted } = validateTags(['#', '###', '   ', '-–—']);
    expect(accepted).toEqual([]);
  });

  test('one character is not a tag', () => {
    expect(validateTags(['#a']).accepted).toEqual([]);
    expect(validateTags(['#ab']).accepted).toHaveLength(1);
  });
});
