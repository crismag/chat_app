/*
 * Notes limits and list views, in one place.
 *
 * Lengths are refused rather than clipped: the API never silently shortens
 * what someone wrote. Views are the three Keep-like buckets — active, archive,
 * trash — and nothing else.
 */

export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX = 20_000;

export const NOTE_VIEWS = ['active', 'archived', 'trash'] as const;

export type NoteView = (typeof NOTE_VIEWS)[number];

/**
 * The list view a request asked for.
 *
 * Absent or empty becomes `active`. Anything else that is not one of the
 * three names is `null`, so the route can refuse it rather than guessing.
 */
export function readNoteView(value: string | undefined | null): NoteView | null {
  if (value === undefined || value === null || value === '') return 'active';
  return (NOTE_VIEWS as readonly string[]).includes(value) ? (value as NoteView) : null;
}

/**
 * A SQLite LIKE pattern that treats the query as a literal substring.
 *
 * `%`, `_` and `\` are escaped so a search for "100%" finds notes containing
 * those characters rather than matching everything. The caller must use
 * `ESCAPE '\'` on the statement.
 */
export function likePattern(value: string): string {
  return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}
