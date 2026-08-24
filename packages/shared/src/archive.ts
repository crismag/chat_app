/*
 * A portable copy of one person's writing: reflections and notes.
 *
 * JSON is the archive. It round-trips without invention. Markdown is a
 * readable companion — the same contents, written for a person rather than
 * for the importer. The parser accepts both, plus a few looser shapes people
 * will actually produce, and it never treats a share flag or a user id as
 * something to restore.
 */

import { CHAT_FORMATS, FORMAT_LIMITS, type ChatFormat } from './formats.ts';
import { CHAT_SECTION_TYPES } from './sections.ts';

export const LIBRARY_KIND = 'chat.library';
export const LIBRARY_SCHEMA_VERSION = 1;

export const ARCHIVE_FORMATS = {
  JSON: 'json',
  MARKDOWN: 'markdown',
} as const;

export type ArchiveFormat = (typeof ARCHIVE_FORMATS)[keyof typeof ARCHIVE_FORMATS];

export const ARCHIVE_LIMITS = {
  /** About 1.5 MB of UTF-8 text. Plenty for a personal library; not a dump. */
  maxBytes: 1_500_000,
  maxReflections: 200,
  maxNotes: 200,
} as const;

const FULL_KEYS = Object.values(CHAT_SECTION_TYPES);
const CONDENSED_KEYS = ['verse', 'reflection'] as const;
const SECTION_KEYS = [...FULL_KEYS, ...CONDENSED_KEYS] as const;
const ORIGINS = ['user', 'ai_assisted', 'ai_generated'] as const;

export type ArchiveOrigin = (typeof ORIGINS)[number];
export type ArchiveSectionKey = (typeof SECTION_KEYS)[number];

export type ArchiveSection = {
  content: string;
  authorOrigin: ArchiveOrigin;
};

export type ArchivePassage = {
  reference: string;
  abbreviation: string;
  name: string;
  content: string;
  translationId?: number;
  passageId?: string;
  copyright?: string;
  retrievedAt?: string;
};

export type ArchiveTag = { tag: string; label: string };

export type ArchiveReflection = {
  format: ChatFormat;
  title: string;
  scriptureReference: string | null;
  tags: ArchiveTag[];
  createdAt: string | null;
  updatedAt: string | null;
  sections: Partial<Record<ArchiveSectionKey, ArchiveSection>>;
  passage?: ArchivePassage | null;
};

export type ArchiveNote = {
  title: string;
  body: string;
  pinned: boolean;
  archived: boolean;
  /** True when the note was in trash at export. Restored as trash. */
  deleted: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type LibraryArchive = {
  kind: typeof LIBRARY_KIND;
  schemaVersion: number;
  exportedAt: string;
  reflections: ArchiveReflection[];
  notes: ArchiveNote[];
};

export type ArchiveSelection = {
  reflections: boolean;
  notes: boolean;
};

export type ParseIssue = {
  index: number;
  kind: 'reflection' | 'note';
  reason: string;
};

export type ParseResult =
  | { ok: true; archive: LibraryArchive; warnings: ParseIssue[] }
  | { ok: false; error: string };

const SECTION_ALIASES: Record<string, ArchiveSectionKey> = {
  content: 'content',
  c: 'content',
  passage: 'content',
  heart: 'heart',
  h: 'heart',
  application: 'application',
  a: 'application',
  apply: 'application',
  testimony: 'testimony',
  t: 'testimony',
  verse: 'verse',
  reflection: 'reflection',
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asTrimmed(value: unknown): string {
  return asString(value).trim();
}

function asIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const when = new Date(value);
  return Number.isNaN(when.getTime()) ? null : value;
}

function asOrigin(value: unknown): ArchiveOrigin {
  return typeof value === 'string' && (ORIGINS as readonly string[]).includes(value)
    ? (value as ArchiveOrigin)
    : 'user';
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function emptyArchive(exportedAt: string): LibraryArchive {
  return {
    kind: LIBRARY_KIND,
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    exportedAt,
    reflections: [],
    notes: [],
  };
}

function sectionFrom(raw: unknown): ArchiveSection | null {
  if (typeof raw === 'string') {
    return raw.trim() ? { content: raw, authorOrigin: 'user' } : null;
  }
  if (!isPlainObject(raw)) return null;
  const content = asString(raw['content']);
  if (!content) return null;
  return { content, authorOrigin: asOrigin(raw['authorOrigin']) };
}

function readTags(raw: unknown): ArchiveTag[] {
  if (!Array.isArray(raw)) return [];
  const tags: ArchiveTag[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const label =
      typeof item === 'string'
        ? item.trim()
        : isPlainObject(item)
          ? asTrimmed(item['label'] ?? item['tag'])
          : '';
    if (!label) continue;
    const tag = label.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push({ tag, label });
  }
  return tags;
}

function readPassage(raw: unknown): ArchivePassage | null {
  if (!isPlainObject(raw)) return null;
  const reference = asTrimmed(raw['reference']);
  const abbreviation = asTrimmed(raw['abbreviation']);
  const name = asTrimmed(raw['name']);
  const content = asTrimmed(raw['content']);
  if (!reference || !abbreviation || !name || !content) return null;
  const translationId =
    typeof raw['translationId'] === 'number' && Number.isInteger(raw['translationId'])
      ? raw['translationId']
      : undefined;
  const passageId = asTrimmed(raw['passageId']) || undefined;
  const copyright = asTrimmed(raw['copyright']) || undefined;
  const retrievedAt = asIso(raw['retrievedAt']) ?? undefined;
  return {
    reference,
    abbreviation,
    name,
    content,
    ...(translationId && translationId > 0 ? { translationId } : {}),
    ...(passageId ? { passageId } : {}),
    ...(copyright ? { copyright } : {}),
    ...(retrievedAt ? { retrievedAt } : {}),
  };
}

function readSections(raw: unknown): Partial<Record<ArchiveSectionKey, ArchiveSection>> {
  const sections: Partial<Record<ArchiveSectionKey, ArchiveSection>> = {};
  if (!isPlainObject(raw)) return sections;
  for (const [key, value] of Object.entries(raw)) {
    const mapped = SECTION_ALIASES[key.toLowerCase()];
    if (!mapped) continue;
    const section = sectionFrom(value);
    if (section) sections[mapped] = section;
  }
  return sections;
}

function reflectionLooksEmpty(reflection: ArchiveReflection): boolean {
  if (reflection.title.trim()) return false;
  if (reflection.scriptureReference?.trim()) return false;
  return !Object.values(reflection.sections).some((section) => section?.content.trim());
}

function noteLooksEmpty(note: ArchiveNote): boolean {
  return !note.title.trim() && !note.body.trim();
}

function inferFormat(stated: unknown, sections: Partial<Record<ArchiveSectionKey, ArchiveSection>>): ChatFormat {
  if (stated === CHAT_FORMATS.FULL || stated === CHAT_FORMATS.CONDENSED) {
    return stated;
  }
  const hasFull = FULL_KEYS.some((key) => sections[key]?.content.trim());
  const hasCondensed = CONDENSED_KEYS.some((key) => sections[key]?.content.trim());
  if (hasCondensed && !hasFull) return CHAT_FORMATS.CONDENSED;
  return CHAT_FORMATS.FULL;
}

function readReflection(raw: unknown, index: number): { item?: ArchiveReflection; issue?: ParseIssue } {
  if (!isPlainObject(raw)) {
    return { issue: { index, kind: 'reflection', reason: 'That item was not a reflection.' } };
  }

  const sections = readSections(raw['sections'] ?? raw);
  /*
   * A loose object may put the four fields at the top level. readSections
   * already walked them when `raw` itself was passed.
   */
  const format = inferFormat(raw['format'], sections);
  const title = asTrimmed(raw['title']);
  const scriptureReference =
    asTrimmed(raw['scriptureReference'] ?? raw['scripture'] ?? raw['reference']) || null;

  const reflection: ArchiveReflection = {
    format,
    title,
    scriptureReference,
    tags: readTags(raw['tags']),
    createdAt: asIso(raw['createdAt']),
    updatedAt: asIso(raw['updatedAt']),
    sections,
    passage: readPassage(raw['passage']),
  };

  if (reflectionLooksEmpty(reflection)) {
    return { issue: { index, kind: 'reflection', reason: 'That reflection was empty.' } };
  }
  return { item: reflection };
}

function readNote(raw: unknown, index: number): { item?: ArchiveNote; issue?: ParseIssue } {
  if (!isPlainObject(raw)) {
    return { issue: { index, kind: 'note', reason: 'That item was not a note.' } };
  }
  const title = asString(raw['title']);
  const body = asString(raw['body'] ?? raw['text'] ?? raw['content']);
  const note: ArchiveNote = {
    title,
    body,
    pinned: asBoolean(raw['pinned']),
    archived: asBoolean(raw['archived']),
    deleted: asBoolean(raw['deleted']) || asIso(raw['deletedAt']) !== null,
    createdAt: asIso(raw['createdAt']),
    updatedAt: asIso(raw['updatedAt']),
  };
  if (noteLooksEmpty(note)) {
    return { issue: { index, kind: 'note', reason: 'That note was empty.' } };
  }
  return { item: note };
}

function looksLikeNote(raw: unknown): boolean {
  if (!isPlainObject(raw)) return false;
  if (raw['sections'] !== undefined || raw['format'] !== undefined) return false;
  if (raw['scriptureReference'] !== undefined) return false;
  const hasNoteShape =
    typeof raw['body'] === 'string' ||
    typeof raw['pinned'] === 'boolean' ||
    typeof raw['archived'] === 'boolean';
  return hasNoteShape;
}

function looksLikeReflection(raw: unknown): boolean {
  if (!isPlainObject(raw)) return false;
  if (raw['format'] !== undefined || raw['sections'] !== undefined) return true;
  if (raw['scriptureReference'] !== undefined || raw['passage'] !== undefined) return true;
  return FULL_KEYS.some((key) => key in raw) || CONDENSED_KEYS.some((key) => key in raw);
}

/**
 * Build the canonical archive from already-normalised records.
 *
 * Missing collections become empty arrays. Extra keys are dropped. A share
 * flag, a user id, and a live row id never survive this function, because they
 * are not in the type it returns.
 */
export function makeArchive(
  input: {
    reflections?: ArchiveReflection[];
    notes?: ArchiveNote[];
    exportedAt?: string;
  },
  selection: ArchiveSelection = { reflections: true, notes: true },
): LibraryArchive {
  return {
    kind: LIBRARY_KIND,
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    reflections: selection.reflections ? (input.reflections ?? []) : [],
    notes: selection.notes ? (input.notes ?? []) : [],
  };
}

export function selectionFromUnknown(raw: unknown): ArchiveSelection | { error: string } {
  if (raw === undefined || raw === null) {
    return { reflections: true, notes: true };
  }
  if (!isPlainObject(raw)) {
    return { error: 'Choose reflections, notes, or both.' };
  }
  const reflections = raw['reflections'] === undefined ? true : raw['reflections'] === true;
  const notes = raw['notes'] === undefined ? true : raw['notes'] === true;
  if (!reflections && !notes) {
    return { error: 'Choose reflections, notes, or both.' };
  }
  return { reflections, notes };
}

export function selectionFromQuery(query: {
  get: (name: string) => string | undefined;
}): ArchiveSelection | { error: string } {
  const reflectionsParam = query.get('reflections');
  const notesParam = query.get('notes');
  const include = query.get('include');

  if (include) {
    const parts = include.split(',').map((part) => part.trim().toLowerCase());
    const reflections = parts.includes('reflections') || parts.includes('reflection');
    const notes = parts.includes('notes') || parts.includes('note');
    if (!reflections && !notes) return { error: 'Choose reflections, notes, or both.' };
    return { reflections, notes };
  }

  const present = (value: string | undefined) => {
    if (value === undefined) return null;
    return value === '1' || value === 'true' || value === 'yes';
  };

  const reflections = present(reflectionsParam);
  const notes = present(notesParam);
  if (reflections === null && notes === null) {
    return { reflections: true, notes: true };
  }
  const selected = {
    reflections: reflections ?? false,
    notes: notes ?? false,
  };
  if (!selected.reflections && !selected.notes) {
    return { error: 'Choose reflections, notes, or both.' };
  }
  return selected;
}

export function archiveFilename(
  selection: ArchiveSelection,
  format: ArchiveFormat,
  when: Date = new Date(),
): string {
  const day = `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, '0')}-${String(when.getUTCDate()).padStart(2, '0')}`;
  const both = selection.reflections && selection.notes;
  const stem = both
    ? 'chat-library'
    : selection.notes
      ? 'chat-notes'
      : 'chat-reflections';
  const extension = format === ARCHIVE_FORMATS.MARKDOWN ? 'md' : 'json';
  return `${stem}-${day}.${extension}`;
}

export function archiveByteLength(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

function readJsonArchive(parsed: unknown, exportedAt: string): ParseResult {
  if (Array.isArray(parsed)) {
    const archive = emptyArchive(exportedAt);
    const warnings: ParseIssue[] = [];
    parsed.forEach((item, index) => {
      if (looksLikeNote(item) && !looksLikeReflection(item)) {
        const result = readNote(item, index);
        if (result.item) archive.notes.push(result.item);
        else if (result.issue) warnings.push(result.issue);
        return;
      }
      const result = readReflection(item, index);
      if (result.item) archive.reflections.push(result.item);
      else if (result.issue) warnings.push(result.issue);
    });
    if (archive.reflections.length === 0 && archive.notes.length === 0) {
      return { ok: false, error: 'That file did not contain any reflections or notes.' };
    }
    return { ok: true, archive, warnings };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'That JSON is not a C.H.A.T. library file.' };
  }

  if (parsed['kind'] !== undefined && parsed['kind'] !== LIBRARY_KIND) {
    return { ok: false, error: 'That JSON is not a C.H.A.T. library file.' };
  }

  const archive = emptyArchive(asIso(parsed['exportedAt']) ?? exportedAt);
  const warnings: ParseIssue[] = [];

  const reflectionSource = Array.isArray(parsed['reflections'])
    ? parsed['reflections']
    : looksLikeReflection(parsed) && !Array.isArray(parsed['notes'])
      ? [parsed]
      : [];
  reflectionSource.forEach((item, index) => {
    const result = readReflection(item, index);
    if (result.item) archive.reflections.push(result.item);
    else if (result.issue) warnings.push(result.issue);
  });

  const noteSource = Array.isArray(parsed['notes'])
    ? parsed['notes']
    : looksLikeNote(parsed) && reflectionSource[0] !== parsed
      ? [parsed]
      : [];
  noteSource.forEach((item, index) => {
    const result = readNote(item, index);
    if (result.item) archive.notes.push(result.item);
    else if (result.issue) warnings.push(result.issue);
  });

  if (
    archive.reflections.length === 0 &&
    archive.notes.length === 0 &&
    !Array.isArray(parsed['reflections']) &&
    !Array.isArray(parsed['notes'])
  ) {
    /*
     * A single loose object that was neither clearly a note nor a reflection
     * still gets one more try as a reflection, then as a note.
     */
    if (looksLikeReflection(parsed)) {
      const result = readReflection(parsed, 0);
      if (result.item) archive.reflections.push(result.item);
    } else if (looksLikeNote(parsed) || asTrimmed(parsed['title']) || asTrimmed(parsed['body'])) {
      const result = readNote(parsed, 0);
      if (result.item) archive.notes.push(result.item);
    }
  }

  if (archive.reflections.length === 0 && archive.notes.length === 0) {
    return { ok: false, error: 'That file did not contain any reflections or notes.' };
  }
  return { ok: true, archive, warnings };
}

function headingKey(line: string): string {
  return line.replace(/^#+\s*/, '').trim().toLowerCase();
}

function parseMetadataLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  const match = trimmed.match(/^(?:\*\*)?([^:*]+):?(?:\*\*)?\s*(.*)$/);
  if (!match) return null;
  const key = match[1]?.trim().toLowerCase() ?? '';
  const value = match[2]?.replace(/\*\*/g, '').trim() ?? '';
  if (!key) return null;
  return { key, value };
}

function parseMarkdownItem(block: string, kind: 'reflection' | 'note', index: number): {
  reflection?: ArchiveReflection;
  note?: ArchiveNote;
  issue?: ParseIssue;
} {
  const lines = block.replace(/\r\n/g, '\n').split('\n');
  let title = '';
  const meta: Record<string, string> = {};
  const sectionLines: Record<string, string[]> = {};
  let current: string | null = kind === 'note' ? 'body' : null;
  const preamble: string[] = [];

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const depth = heading[1]?.length ?? 0;
      const text = heading[2]?.trim() ?? '';
      if (!title && depth <= 3) {
        title = text;
        continue;
      }
      if (kind === 'reflection' && depth >= 4) {
        const mapped = SECTION_ALIASES[headingKey(text)];
        current = mapped ?? text.toLowerCase();
        if (mapped && !sectionLines[mapped]) sectionLines[mapped] = [];
        continue;
      }
    }

    const metaLine = parseMetadataLine(line);
    const looksMeta =
      metaLine &&
      ['scripture', 'format', 'tags', 'written', 'updated', 'pinned', 'archived', 'deleted'].includes(
        metaLine.key,
      );
    if (looksMeta && metaLine && current === null) {
      meta[metaLine.key] = metaLine.value;
      continue;
    }
    if (looksMeta && metaLine && kind === 'note' && current === 'body' && !meta[metaLine.key] && preamble.length === 0) {
      if (metaLine.value === '' && ['pinned', 'archived', 'deleted'].includes(metaLine.key)) {
        meta[metaLine.key] = 'true';
        continue;
      }
      if (metaLine.key === 'tags' || metaLine.key === 'written' || metaLine.key === 'updated') {
        meta[metaLine.key] = metaLine.value;
        continue;
      }
    }

    if (kind === 'note' && (line.trim() === '*Pinned*' || line.trim() === '**Pinned**')) {
      meta['pinned'] = 'true';
      continue;
    }
    if (kind === 'note' && (line.trim() === '*Archived*' || line.trim() === '**Archived**')) {
      meta['archived'] = 'true';
      continue;
    }
    if (kind === 'note' && (line.trim() === '*Deleted*' || line.trim() === '**In trash**')) {
      meta['deleted'] = 'true';
      continue;
    }

    if (current && current !== 'body') {
      (sectionLines[current] ??= []).push(line);
    } else if (kind === 'note') {
      preamble.push(line);
    } else {
      preamble.push(line);
    }
  }

  if (kind === 'note') {
    const body = preamble.join('\n').trim();
    const note: ArchiveNote = {
      title,
      body,
      pinned: meta['pinned'] === 'true' || meta['pinned'] === 'yes',
      archived: meta['archived'] === 'true' || meta['archived'] === 'yes',
      deleted: meta['deleted'] === 'true' || meta['deleted'] === 'yes',
      createdAt: asIso(meta['written']),
      updatedAt: asIso(meta['updated']),
    };
    if (noteLooksEmpty(note)) {
      return { issue: { index, kind: 'note', reason: 'That note was empty.' } };
    }
    return { note };
  }

  const sections: Partial<Record<ArchiveSectionKey, ArchiveSection>> = {};
  for (const [key, bodyLines] of Object.entries(sectionLines)) {
    const mapped = SECTION_ALIASES[key];
    if (!mapped) continue;
    const content = bodyLines.join('\n').trim();
    if (content) sections[mapped] = { content, authorOrigin: 'user' };
  }

  if (Object.keys(sections).length === 0 && preamble.join('\n').trim()) {
    sections.reflection = { content: preamble.join('\n').trim(), authorOrigin: 'user' };
  }

  const tags = (meta['tags'] ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  const reflection: ArchiveReflection = {
    format: inferFormat(
      meta['format']?.toLowerCase().includes('short') || meta['format']?.toLowerCase().includes('condensed')
        ? CHAT_FORMATS.CONDENSED
        : meta['format']?.toLowerCase().includes('full')
          ? CHAT_FORMATS.FULL
          : undefined,
      sections,
    ),
    title,
    scriptureReference: meta['scripture'] || null,
    tags: readTags(tags),
    createdAt: asIso(meta['written']),
    updatedAt: asIso(meta['updated']),
    sections,
    passage: null,
  };

  if (reflectionLooksEmpty(reflection)) {
    return { issue: { index, kind: 'reflection', reason: 'That reflection was empty.' } };
  }
  return { reflection };
}

function splitItems(body: string): string[] {
  return body
    .split(/\n(?=#{1,3}\s)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseMarkdownArchive(text: string, exportedAt: string): ParseResult {
  const normalised = text.replace(/\r\n/g, '\n').trim();
  const archive = emptyArchive(exportedAt);
  const warnings: ParseIssue[] = [];

  const reflectionsMatch = normalised.match(/##\s+Reflections\b[\s\S]*?(?=##\s+Notes\b|$)/i);
  const notesMatch = normalised.match(/##\s+Notes\b[\s\S]*$/i);

  if (reflectionsMatch || notesMatch) {
    if (reflectionsMatch) {
      const body = reflectionsMatch[0].replace(/^##\s+Reflections\b[^\n]*\n?/i, '');
      splitItems(body).forEach((block, index) => {
        const parsed = parseMarkdownItem(block, 'reflection', index);
        if (parsed.reflection) archive.reflections.push(parsed.reflection);
        else if (parsed.issue) warnings.push(parsed.issue);
      });
    }
    if (notesMatch) {
      const body = notesMatch[0].replace(/^##\s+Notes\b[^\n]*\n?/i, '');
      splitItems(body).forEach((block, index) => {
        const parsed = parseMarkdownItem(block, 'note', index);
        if (parsed.note) archive.notes.push(parsed.note);
        else if (parsed.issue) warnings.push(parsed.issue);
      });
    }
  } else if (/^#{1,3}\s+/m.test(normalised) || /^#{4}\s+(content|heart|application|testimony|verse|reflection)\b/im.test(normalised)) {
    const parsed = parseMarkdownItem(normalised.replace(/^#\s+C\.H\.A\.T\. library\s*/i, ''), 'reflection', 0);
    if (parsed.reflection) archive.reflections.push(parsed.reflection);
    else if (parsed.issue) warnings.push(parsed.issue);
  } else {
    const lines = normalised.split('\n');
    const first = lines[0]?.trim() ?? '';
    const rest = lines.slice(1).join('\n').trim();
    const title = first.length > 0 && first.length <= 80 && rest ? first : '';
    const body = title ? rest : normalised;
    const note: ArchiveNote = {
      title,
      body,
      pinned: false,
      archived: false,
      deleted: false,
      createdAt: null,
      updatedAt: null,
    };
    if (!noteLooksEmpty(note)) archive.notes.push(note);
  }

  if (archive.reflections.length === 0 && archive.notes.length === 0) {
    return { ok: false, error: 'That file did not contain any reflections or notes.' };
  }
  return { ok: true, archive, warnings };
}

/**
 * Read a file a person handed us.
 *
 * JSON that claims to be a library — or that merely looks like one — is
 * preferred. Markdown with the headings this exporter writes is next. Anything
 * else is treated as one note, so a pasted journal is not thrown away.
 */
export function parseLibrary(text: string, now: () => string = () => new Date().toISOString()): ParseResult {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return { ok: false, error: 'That file was empty.' };
  if (archiveByteLength(trimmed) > ARCHIVE_LIMITS.maxBytes) {
    return { ok: false, error: 'That file is too large to import.' };
  }

  const exportedAt = now();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return readJsonArchive(JSON.parse(trimmed) as unknown, exportedAt);
    } catch {
      return { ok: false, error: 'That JSON could not be read.' };
    }
  }
  return parseMarkdownArchive(trimmed, exportedAt);
}

export function filterArchive(archive: LibraryArchive, selection: ArchiveSelection): LibraryArchive {
  return {
    ...archive,
    reflections: selection.reflections ? archive.reflections : [],
    notes: selection.notes ? archive.notes : [],
  };
}

function formatHeading(format: ChatFormat): string {
  return format === CHAT_FORMATS.CONDENSED ? 'Short' : 'Full C.H.A.T.';
}

function sectionTitle(key: ArchiveSectionKey): string {
  switch (key) {
    case 'content':
      return 'Content';
    case 'heart':
      return 'Heart';
    case 'application':
      return 'Application';
    case 'testimony':
      return 'Testimony';
    case 'verse':
      return 'Verse';
    case 'reflection':
      return 'Reflection';
  }
}

function escapeMarkdown(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

export function serializeLibraryJson(archive: LibraryArchive): string {
  return `${JSON.stringify(archive, null, 2)}\n`;
}

export function serializeLibraryMarkdown(archive: LibraryArchive): string {
  const lines: string[] = ['# C.H.A.T. library', '', `Exported ${archive.exportedAt}`, ''];

  if (archive.reflections.length > 0) {
    lines.push('## Reflections', '');
    archive.reflections.forEach((reflection, index) => {
      if (index > 0) lines.push('---', '');
      lines.push(`### ${reflection.title || 'Untitled reflection'}`, '');
      if (reflection.scriptureReference) {
        lines.push(`**Scripture:** ${reflection.scriptureReference}`);
      }
      lines.push(`**Format:** ${formatHeading(reflection.format)}`);
      if (reflection.tags.length > 0) {
        lines.push(`**Tags:** ${reflection.tags.map((tag) => tag.label).join(', ')}`);
      }
      if (reflection.createdAt) lines.push(`**Written:** ${reflection.createdAt}`);
      lines.push('');
      for (const key of SECTION_KEYS) {
        const section = reflection.sections[key];
        if (!section?.content.trim()) continue;
        lines.push(`#### ${sectionTitle(key)}`, '', escapeMarkdown(section.content.trim()), '');
      }
    });
  }

  if (archive.notes.length > 0) {
    lines.push('## Notes', '');
    archive.notes.forEach((note, index) => {
      if (index > 0) lines.push('---', '');
      lines.push(`### ${note.title || 'Untitled note'}`, '');
      const flags = [
        note.pinned ? '**Pinned**' : '',
        note.archived ? '**Archived**' : '',
        note.deleted ? '**In trash**' : '',
      ].filter(Boolean);
      if (flags.length > 0) lines.push(flags.join(' · '), '');
      if (note.body.trim()) lines.push(escapeMarkdown(note.body.trim()), '');
    });
  }

  return `${lines.join('\n').trim()}\n`;
}

export function serializeLibrary(archive: LibraryArchive, format: ArchiveFormat): string {
  return format === ARCHIVE_FORMATS.MARKDOWN
    ? serializeLibraryMarkdown(archive)
    : serializeLibraryJson(archive);
}

export function tooManyItems(archive: LibraryArchive): string | null {
  if (archive.reflections.length > ARCHIVE_LIMITS.maxReflections) {
    return `A file may contain at most ${ARCHIVE_LIMITS.maxReflections} reflections.`;
  }
  if (archive.notes.length > ARCHIVE_LIMITS.maxNotes) {
    return `A file may contain at most ${ARCHIVE_LIMITS.maxNotes} notes.`;
  }
  return null;
}

/**
 * Length against the format's hard maximum. Import refuses rather than clips.
 */
export function reflectionFieldOverflow(reflection: ArchiveReflection): string | null {
  const limits = FORMAT_LIMITS[reflection.format];
  const titleLimit = limits.fields['title'];
  if (titleLimit && reflection.title.length > titleLimit.hard) {
    return `The title is ${reflection.title.length - titleLimit.hard} characters over its maximum.`;
  }
  const referenceLimit = limits.fields['scriptureReference'];
  const reference = reflection.scriptureReference ?? '';
  if (referenceLimit && reference.length > referenceLimit.hard) {
    return `The Scripture reference is ${reference.length - referenceLimit.hard} characters over its maximum.`;
  }
  const keys =
    reflection.format === CHAT_FORMATS.CONDENSED ? CONDENSED_KEYS : FULL_KEYS;
  for (const key of keys) {
    const limit = limits.fields[key];
    const length = reflection.sections[key]?.content.length ?? 0;
    if (limit && length > limit.hard) {
      return `${sectionTitle(key)} is ${length - limit.hard} characters over its maximum of ${limit.hard}.`;
    }
  }
  return null;
}
