/*
 * The text a formatting button produces, as pure functions.
 *
 * ── Why a note is Markdown and not HTML ─────────────────────────────────────
 *
 * A note is stored as ordinary text, and formatting is Markdown inside it.
 * Storing the HTML a toolbar produced would mean a person's note is markup,
 * and markup a person wrote has to be either sanitised on the way in — where a
 * mistake is permanent, because the note now *is* the sanitiser's output — or
 * rendered through `dangerouslySetInnerHTML`, which this application does not
 * do anywhere.
 *
 * Text stays text. It survives export, search, a plain-text client and being
 * read in a database by hand; it needs no migration, because every note ever
 * written is already valid; and the worst a malformed note can do is look
 * wrong. The renderer builds React elements, so there is no path from a note's
 * body to an element the browser is asked to trust.
 *
 * ── Everything here is a pure function of (text, selection) ─────────────────
 *
 * No DOM, no refs, no component state. The editor passes what is in the box
 * and where the caret is, and gets back what should be in the box and where
 * the caret should end up. That makes every one of these testable, and it is
 * why the caret does not jump: the button decides where it goes.
 */

export type Edit = { text: string; start: number; end: number }

/** Underline has no Markdown of its own; `++text++` is the one used here. */
export const UNDERLINE = '++';

type Wrap = '**' | '*' | typeof UNDERLINE;

/**
 * Bold, italic and underline: wrap the selection, or unwrap it if it is
 * already wrapped.
 *
 * Pressing Bold on bold text takes the bold off, which is what every editor
 * does and what somebody will try within a minute of finding the button.
 *
 * With nothing selected it inserts the pair and puts the caret between them,
 * so typing continues inside the emphasis rather than after it.
 */
export function wrapSelection(text: string, start: number, end: number, mark: Wrap): Edit {
  const selected = text.slice(start, end);

  /* Already wrapped, inside the selection: **like this**. */
  if (selected.startsWith(mark) && selected.endsWith(mark) && selected.length > mark.length * 2) {
    const bare = selected.slice(mark.length, -mark.length);
    return {
      text: text.slice(0, start) + bare + text.slice(end),
      start,
      end: start + bare.length,
    };
  }

  /* Already wrapped, outside the selection: **like** this, selecting `like`. */
  const before = text.slice(start - mark.length, start);
  const after = text.slice(end, end + mark.length);
  if (selected.length > 0 && before === mark && after === mark) {
    return {
      text: text.slice(0, start - mark.length) + selected + text.slice(end + mark.length),
      start: start - mark.length,
      end: end - mark.length,
    };
  }

  const wrapped = `${mark}${selected}${mark}`;
  return {
    text: text.slice(0, start) + wrapped + text.slice(end),
    start: start + mark.length,
    end: start + mark.length + selected.length,
  };
}

/** The lines the selection touches, even partly, and where they begin and end. */
function selectedLines(text: string, start: number, end: number) {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const toNewline = text.indexOf('\n', end);
  const to = toNewline === -1 ? text.length : toNewline;
  return { from, to, lines: text.slice(from, to).split('\n') };
}

const BULLET = /^(\s*)- (?!\[[ xX]\] )/;
const TASK = /^(\s*)- \[([ xX])\] /;

/**
 * Turn the touched lines into a bulleted list, or take the bullets off.
 *
 * Off when **every** touched line already has one. A selection that is half
 * list and half prose becomes all list, because that is what somebody who
 * selected both and pressed the button meant; requiring uniformity to add
 * would make the button do nothing on the most common mixed selection.
 */
export function toggleBullets(text: string, start: number, end: number): Edit {
  const { from, to, lines } = selectedLines(text, start, end);
  const meaningful = lines.filter((line) => line.trim() !== '');
  /*
   * Task lines do not count as already bulleted.
   *
   * Counting them would make this button strip a task list rather than convert
   * it, so pressing "bulleted list" on a list of tasks would throw the list
   * away — the opposite of what the button says.
   */
  const allBulleted = meaningful.length > 0 && meaningful.every((line) => BULLET.test(line));

  const next = lines.map((line) => {
    if (line.trim() === '') return line;
    if (allBulleted) return line.replace(TASK, '$1').replace(BULLET, '$1');
    if (BULLET.test(line)) return line;
    /* A task line becomes a plain bullet rather than gaining a second dash. */
    if (TASK.test(line)) return line.replace(TASK, '$1- ');
    const indent = line.match(/^\s*/)?.[0] ?? '';
    return `${indent}- ${line.slice(indent.length)}`;
  });

  const replaced = next.join('\n');
  return { text: text.slice(0, from) + replaced + text.slice(to), start: from, end: from + replaced.length };
}

/** The same for `- [ ]` task lines, unticked when they are being created. */
export function toggleTasks(text: string, start: number, end: number): Edit {
  const { from, to, lines } = selectedLines(text, start, end);
  const meaningful = lines.filter((line) => line.trim() !== '');
  const allTasks = meaningful.length > 0 && meaningful.every((line) => TASK.test(line));

  const next = lines.map((line) => {
    if (line.trim() === '') return line;
    if (allTasks) return line.replace(TASK, '$1');
    if (TASK.test(line)) return line;
    if (BULLET.test(line)) return line.replace(BULLET, '$1- [ ] ');
    const indent = line.match(/^\s*/)?.[0] ?? '';
    return `${indent}- [ ] ${line.slice(indent.length)}`;
  });

  const replaced = next.join('\n');
  return { text: text.slice(0, from) + replaced + text.slice(to), start: from, end: from + replaced.length };
}

/**
 * Tick or untick the nth task in a note.
 *
 * By position among task lines, not by line number: the renderer counts the
 * tasks it drew and hands back the same index, so a checkbox cannot toggle a
 * different line than the one that was pressed even when the note has blank
 * lines, headings or paragraphs between its tasks.
 */
export function toggleTaskAt(text: string, index: number): string {
  let seen = -1;
  return text
    .split('\n')
    .map((line) => {
      const match = line.match(TASK);
      if (!match) return line;
      seen += 1;
      if (seen !== index) return line;
      const done = match[2] !== ' ';
      return line.replace(TASK, `$1- [${done ? ' ' : 'x'}] `);
    })
    .join('\n');
}

/**
 * A note's text with its formatting removed, for a card's one-line preview.
 *
 * A card is a glance, and `**Groceries**` at a glance is worse than
 * `Groceries` — the syntax is noise exactly where there is least room for it.
 * A ticked task keeps a mark, because whether something is done is the most
 * useful thing a preview of a task list can carry.
 */
export function plainPreview(body: string): string {
  return body
    .split('\n')
    .map((line) =>
      line
        .replace(TASK, (_full, indent: string, state: string) =>
          `${indent}${state === ' ' ? '' : '✓ '}`,
        )
        .replace(BULLET, '$1')
        .replace(/^\s*#{1,3}\s+/, '')
        .replace(/^\s*>\s?/, ''),
    )
    .join(' ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\+\+(.+?)\+\+/g, '$1')
    .replace(/(^|[^*])\*([^*]+?)\*/g, '$1$2')
    .replace(/`([^`]+?)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
