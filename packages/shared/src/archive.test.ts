import { describe, expect, test } from 'vitest';
import { CHAT_FORMATS, FORMAT_LIMITS } from './formats.ts';
import {
  ARCHIVE_FORMATS,
  ARCHIVE_LIMITS,
  LIBRARY_KIND,
  archiveFilename,
  filterArchive,
  makeArchive,
  parseLibrary,
  reflectionFieldOverflow,
  serializeLibraryJson,
  serializeLibraryMarkdown,
  tooManyItems,
  type ArchiveNote,
  type ArchiveReflection,
} from './archive.ts';

const fullReflection = (): ArchiveReflection => ({
  format: CHAT_FORMATS.FULL,
  title: 'Trusting when I cannot see',
  scriptureReference: 'Romans 8:28',
  tags: [{ tag: 'prayer', label: 'prayer' }],
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-10T18:00:00.000Z',
  sections: {
    content: { content: 'And we know that in all things God works.', authorOrigin: 'user' },
    heart: { content: 'This met my fear.', authorOrigin: 'user' },
    application: { content: 'I will wait rather than invent a plan.', authorOrigin: 'ai_assisted' },
    testimony: { content: 'He has not left me.', authorOrigin: 'user' },
  },
  passage: {
    reference: 'Romans 8:28',
    abbreviation: 'NIV',
    name: 'New International Version',
    content: 'And we know that in all things God works for the good of those who love him.',
  },
});

const aNote = (): ArchiveNote => ({
  title: 'Sunday list',
  body: 'Milk and bread.',
  pinned: true,
  archived: false,
  deleted: false,
  createdAt: '2026-08-02T10:00:00.000Z',
  updatedAt: '2026-08-02T11:00:00.000Z',
});

describe('serialize and parse JSON', () => {
  test('a library round-trips, without a user id or a share flag', () => {
    const archive = makeArchive({
      reflections: [fullReflection()],
      notes: [aNote()],
      exportedAt: '2026-08-24T12:00:00.000Z',
    });
    const json = serializeLibraryJson(archive);
    expect(json).toContain('"kind": "chat.library"');
    expect(json).not.toMatch(/userId/);
    expect(json).not.toMatch(/visibility/);

    const parsed = parseLibrary(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.archive.kind).toBe(LIBRARY_KIND);
    expect(parsed.archive.reflections).toHaveLength(1);
    expect(parsed.archive.notes).toHaveLength(1);
    expect(parsed.archive.reflections[0]?.title).toBe('Trusting when I cannot see');
    expect(parsed.archive.reflections[0]?.sections.heart?.content).toBe('This met my fear.');
    expect(parsed.archive.reflections[0]?.sections.application?.authorOrigin).toBe('ai_assisted');
    expect(parsed.archive.notes[0]?.title).toBe('Sunday list');
    expect(parsed.archive.notes[0]?.pinned).toBe(true);
  });

  test('a userId or visibility in the file is dropped, not restored', () => {
    const parsed = parseLibrary(
      JSON.stringify({
        kind: LIBRARY_KIND,
        reflections: [
          {
            title: 'Kept',
            userId: 'u-secret',
            visibility: 'shared',
            id: 'conv-1',
            content: 'The passage.',
            heart: 'The response.',
          },
        ],
        notes: [{ title: 'A note', body: 'Private', userId: 'u-secret' }],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(JSON.stringify(parsed.archive)).not.toMatch(/u-secret/);
    expect(JSON.stringify(parsed.archive)).not.toMatch(/visibility/);
    expect(parsed.archive.reflections[0]?.title).toBe('Kept');
  });

  test('a loose array of reflections is accepted', () => {
    const parsed = parseLibrary(
      JSON.stringify([
        { title: 'One', scriptureReference: 'John 1:1', heart: 'It began with the Word.' },
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.archive.reflections[0]?.title).toBe('One');
    expect(parsed.archive.reflections[0]?.sections.heart?.content).toContain('Word');
  });

  test('a notes-only object is accepted', () => {
    const parsed = parseLibrary(JSON.stringify({ notes: [{ title: 'List', body: 'Eggs.' }] }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.archive.notes).toHaveLength(1);
    expect(parsed.archive.reflections).toHaveLength(0);
  });

  test('a single note object is accepted', () => {
    const parsed = parseLibrary(JSON.stringify({ title: 'List', body: 'Eggs.' }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.archive.notes[0]?.body).toBe('Eggs.');
  });

  test('unknown kind is refused', () => {
    const parsed = parseLibrary(JSON.stringify({ kind: 'other.thing', reflections: [] }));
    expect(parsed.ok).toBe(false);
  });

  test('broken JSON is refused', () => {
    const parsed = parseLibrary('{ not json');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/could not be read/i);
  });

  test('an empty file is refused', () => {
    expect(parseLibrary('').ok).toBe(false);
    expect(parseLibrary('   ').ok).toBe(false);
  });
});

describe('markdown', () => {
  test('the markdown this writes can be read back', () => {
    const archive = makeArchive({
      reflections: [fullReflection()],
      notes: [aNote(), { ...aNote(), title: 'Old', body: 'Done.', archived: true, pinned: false }],
      exportedAt: '2026-08-24T12:00:00.000Z',
    });
    const markdown = serializeLibraryMarkdown(archive);
    expect(markdown).toContain('# C.H.A.T. library');
    expect(markdown).toContain('## Reflections');
    expect(markdown).toContain('## Notes');
    expect(markdown).toContain('#### Heart');
    expect(markdown).toContain('**Archived**');

    const parsed = parseLibrary(markdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.archive.reflections[0]?.title).toBe('Trusting when I cannot see');
    expect(parsed.archive.reflections[0]?.scriptureReference).toBe('Romans 8:28');
    expect(parsed.archive.reflections[0]?.sections.heart?.content).toBe('This met my fear.');
    expect(parsed.archive.notes.map((note) => note.title)).toEqual(['Sunday list', 'Old']);
    expect(parsed.archive.notes[1]?.archived).toBe(true);
  });

  test('plain text becomes a note, so a pasted journal is not thrown away', () => {
    const parsed = parseLibrary('Milk\nand bread.');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.archive.notes).toHaveLength(1);
    expect(parsed.archive.reflections).toHaveLength(0);
    expect(parsed.archive.notes[0]?.body).toContain('bread');
  });
});

describe('selection and filenames', () => {
  test('filtering drops the unselected collection', () => {
    const archive = makeArchive({
      reflections: [fullReflection()],
      notes: [aNote()],
    });
    const notesOnly = filterArchive(archive, { reflections: false, notes: true });
    expect(notesOnly.reflections).toHaveLength(0);
    expect(notesOnly.notes).toHaveLength(1);
  });

  test('the filename names what is in the file', () => {
    expect(archiveFilename({ reflections: true, notes: true }, ARCHIVE_FORMATS.JSON, new Date('2026-08-24T12:00:00Z'))).toBe(
      'chat-library-2026-08-24.json',
    );
    expect(
      archiveFilename({ reflections: true, notes: false }, ARCHIVE_FORMATS.MARKDOWN, new Date('2026-08-24T12:00:00Z')),
    ).toBe('chat-reflections-2026-08-24.md');
    expect(archiveFilename({ reflections: false, notes: true }, ARCHIVE_FORMATS.JSON, new Date('2026-08-24T12:00:00Z'))).toBe(
      'chat-notes-2026-08-24.json',
    );
  });

  test('caps are stated, and an over-long field is named', () => {
    expect(ARCHIVE_LIMITS.maxReflections).toBe(200);
    const over = fullReflection();
    const hard = FORMAT_LIMITS[CHAT_FORMATS.FULL].fields.title?.hard ?? 100;
    over.title = 'a'.repeat(hard + 1);
    expect(reflectionFieldOverflow(over)).toMatch(/title/i);
  });
});

describe('too many items', () => {
  test('a file over the reflection cap is refused as a whole', () => {
    const archive = makeArchive({
      reflections: Array.from({ length: ARCHIVE_LIMITS.maxReflections + 1 }, (_, index) => ({
        ...fullReflection(),
        title: `Item ${index}`,
      })),
    });
    expect(tooManyItems(archive)).toMatch(/200 reflections/i);
  });
});
