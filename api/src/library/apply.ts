/*
 * Turn a person's stored writing into an archive, and an archive back into
 * stored writing.
 *
 * Share is never restored. A live id is never reused. Length and tags go
 * through the same gates the editor uses.
 */

import { randomUUID } from 'node:crypto';
import {
  AUTHOR_ORIGINS,
  ARCHIVE_LIMITS,
  CHAT_FORMATS,
  CHAT_SECTION_TYPES,
  CONDENSED_SECTION_TYPES,
  VISIBILITY,
  filterArchive,
  reflectionFieldOverflow,
  type ArchiveNote,
  type ArchivePassage,
  type ArchiveReflection,
  type ArchiveSelection,
  type LibraryArchive,
} from '@chat/shared';
import type { BiblePassage } from '@chat/shared';
import { NOTE_BODY_MAX, NOTE_TITLE_MAX } from '../notes/limits.ts';
import type { NotesStore, PublicNote } from '../notes/store.ts';
import type { StoredConversation, StoredSection } from '../store.ts';
import { rawTagStrings } from '../tags/validate.ts';
import type { TagCandidate } from '@chat/shared';

const SECTION_KEYS = [
  ...Object.values(CHAT_SECTION_TYPES),
  ...Object.values(CONDENSED_SECTION_TYPES),
] as const;

export type ConversationTable = {
  get(id: string): StoredConversation | undefined;
  set(id: string, conversation: StoredConversation): unknown;
  values(): Iterable<StoredConversation>;
  byUser?(userId: string): StoredConversation[];
};

export type SectionTable = {
  get(conversationId: string): Record<string, StoredSection> | undefined;
  set(conversationId: string, sections: Record<string, StoredSection>): unknown;
};

export type PassageTable = {
  get(conversationId: string): BiblePassage | null;
  set(conversationId: string, passage: BiblePassage): void;
};

export type TagRecorder = {
  validate: (raw: readonly string[]) => { accepted: TagCandidate[] };
  record: (input: { userId: string; tags: readonly TagCandidate[]; published: boolean }) => void;
};

export type Skip = { kind: 'reflection' | 'note'; reason: string };

export function conversationsOf(table: ConversationTable, userId: string): StoredConversation[] {
  if (table.byUser) return table.byUser(userId);
  return [...table.values()].filter((conversation) => conversation.userId === userId);
}

function archivePassage(passage: BiblePassage | null): ArchivePassage | null {
  if (!passage) return null;
  return {
    reference: passage.reference,
    abbreviation: passage.abbreviation,
    name: passage.name,
    content: passage.content,
    translationId: passage.translationId,
    passageId: passage.passageId,
    ...(passage.copyright ? { copyright: passage.copyright } : {}),
    retrievedAt: passage.retrievedAt,
  };
}

function archiveSections(
  stored: Record<string, StoredSection> | undefined,
): ArchiveReflection['sections'] {
  const sections: ArchiveReflection['sections'] = {};
  if (!stored) return sections;
  for (const key of SECTION_KEYS) {
    const item = stored[key];
    if (!item?.content) continue;
    sections[key] = {
      content: item.content,
      authorOrigin:
        item.authorOrigin === AUTHOR_ORIGINS.AI_ASSISTED ||
        item.authorOrigin === AUTHOR_ORIGINS.AI_GENERATED
          ? item.authorOrigin
          : AUTHOR_ORIGINS.USER,
    };
  }
  return sections;
}

export function reflectionToArchive(
  conversation: StoredConversation,
  sections: Record<string, StoredSection> | undefined,
  passage: BiblePassage | null,
): ArchiveReflection {
  return {
    format: conversation.format === CHAT_FORMATS.CONDENSED ? CHAT_FORMATS.CONDENSED : CHAT_FORMATS.FULL,
    title: conversation.title,
    scriptureReference: conversation.scriptureReference,
    tags: (conversation.tags ?? []).map((tag) => ({ tag: tag.tag, label: tag.label })),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    sections: archiveSections(sections),
    passage: archivePassage(passage),
  };
}

export function noteToArchive(note: PublicNote): ArchiveNote {
  return {
    title: note.title,
    body: note.body,
    pinned: note.pinned,
    archived: note.archived,
    deleted: note.deletedAt !== null,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

export function buildArchiveFromStores(
  userId: string,
  selection: ArchiveSelection,
  deps: {
    conversations: ConversationTable;
    sections: SectionTable;
    passages?: PassageTable;
    notes: NotesStore;
    exportedAt: string;
  },
): LibraryArchive {
  const reflections = selection.reflections
    ? conversationsOf(deps.conversations, userId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((conversation) =>
          reflectionToArchive(
            conversation,
            deps.sections.get(conversation.id),
            deps.passages?.get(conversation.id) ?? null,
          ),
        )
    : [];
  const notes = selection.notes ? deps.notes.listAll(userId).map(noteToArchive) : [];
  return {
    kind: 'chat.library',
    schemaVersion: 1,
    exportedAt: deps.exportedAt,
    reflections,
    notes,
  };
}

function storedSectionsOf(reflection: ArchiveReflection): Record<string, StoredSection> {
  const complete: Record<string, StoredSection> = {};
  for (const key of SECTION_KEYS) {
    const given = reflection.sections[key];
    complete[key] = {
      type: key,
      content: given?.content ?? '',
      authorOrigin: given?.authorOrigin ?? AUTHOR_ORIGINS.USER,
    };
  }
  return complete;
}

function biblePassageFrom(passage: ArchivePassage | null | undefined): BiblePassage | null {
  if (!passage) return null;
  if (
    !passage.translationId ||
    !passage.passageId ||
    !passage.retrievedAt ||
    Number.isNaN(Date.parse(passage.retrievedAt))
  ) {
    return null;
  }
  return {
    provider: 'youversion',
    translationId: passage.translationId,
    abbreviation: passage.abbreviation,
    name: passage.name,
    passageId: passage.passageId,
    reference: passage.reference,
    content: passage.content,
    ...(passage.copyright ? { copyright: passage.copyright } : {}),
    retrievedAt: passage.retrievedAt,
  };
}

function importReflection(
  userId: string,
  reflection: ArchiveReflection,
  deps: {
    conversations: ConversationTable;
    sections: SectionTable;
    passages?: PassageTable;
    tags: TagRecorder;
    now: string;
  },
): Skip | null {
  const overflow = reflectionFieldOverflow(reflection);
  if (overflow) return { kind: 'reflection', reason: overflow };

  const title =
    reflection.title.trim() || reflection.scriptureReference?.trim() || 'Imported reflection';
  const verdict = deps.tags.validate(rawTagStrings(reflection.tags));
  const id = randomUUID();
  const conversation: StoredConversation = {
    id,
    userId,
    format: reflection.format,
    title,
    scriptureReference: reflection.scriptureReference,
    visibility: VISIBILITY.PRIVATE,
    tags: verdict.accepted,
    createdAt: deps.now,
    updatedAt: deps.now,
  };
  deps.conversations.set(id, conversation);
  deps.sections.set(id, storedSectionsOf(reflection));
  if (verdict.accepted.length > 0) {
    deps.tags.record({ userId, tags: verdict.accepted, published: false });
  }
  const passage = biblePassageFrom(reflection.passage);
  if (passage) deps.passages?.set(id, passage);
  return null;
}

function importNote(userId: string, note: ArchiveNote, notes: NotesStore): Skip | null {
  if (note.title.length > NOTE_TITLE_MAX) {
    return {
      kind: 'note',
      reason: `Title is ${note.title.length - NOTE_TITLE_MAX} characters over its maximum of ${NOTE_TITLE_MAX}.`,
    };
  }
  if (note.body.length > NOTE_BODY_MAX) {
    return {
      kind: 'note',
      reason: `Body is ${note.body.length - NOTE_BODY_MAX} characters over its maximum of ${NOTE_BODY_MAX}.`,
    };
  }
  const created = notes.create(userId, {
    title: note.title,
    body: note.body,
    pinned: note.deleted ? false : note.pinned,
    archived: note.deleted ? false : note.archived,
  });
  if (note.deleted) notes.softDelete(userId, created.id);
  return null;
}

export function applyArchive(
  userId: string,
  archive: LibraryArchive,
  selection: ArchiveSelection,
  deps: {
    conversations: ConversationTable;
    sections: SectionTable;
    passages?: PassageTable;
    notes: NotesStore;
    tags: TagRecorder;
    now: string;
  },
): { imported: { reflections: number; notes: number }; skipped: Skip[] } {
  const chosen = filterArchive(archive, selection);
  const skipped: Skip[] = [];
  let reflections = 0;
  let notes = 0;

  const reflectionCap = Math.min(chosen.reflections.length, ARCHIVE_LIMITS.maxReflections);
  if (chosen.reflections.length > ARCHIVE_LIMITS.maxReflections) {
    skipped.push({
      kind: 'reflection',
      reason: `Only the first ${ARCHIVE_LIMITS.maxReflections} reflections were imported.`,
    });
  }
  for (let index = 0; index < reflectionCap; index += 1) {
    const item = chosen.reflections[index];
    if (!item) continue;
    const skip = importReflection(userId, item, deps);
    if (skip) skipped.push(skip);
    else reflections += 1;
  }

  const noteCap = Math.min(chosen.notes.length, ARCHIVE_LIMITS.maxNotes);
  if (chosen.notes.length > ARCHIVE_LIMITS.maxNotes) {
    skipped.push({
      kind: 'note',
      reason: `Only the first ${ARCHIVE_LIMITS.maxNotes} notes were imported.`,
    });
  }
  for (let index = 0; index < noteCap; index += 1) {
    const item = chosen.notes[index];
    if (!item) continue;
    const skip = importNote(userId, item, deps.notes);
    if (skip) skipped.push(skip);
    else notes += 1;
  }

  return { imported: { reflections, notes }, skipped };
}
