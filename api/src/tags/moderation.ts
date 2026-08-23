import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalHashtag, tagWords } from '@chat/shared';

/*
 * Whether a tag may exist, decided against a word list on disk.
 *
 * ── Deliberately small ──────────────────────────────────────────────────────
 *
 * One list, one question. There is no allowlist, no severity, no category and
 * no score, because none of those can be tested against real abuse that has not
 * happened yet. If a false positive turns up in practice, that is when an
 * override belongs here — an override file with nothing in it is a mechanism
 * nobody has exercised.
 *
 * ── Why it does not use substrings ──────────────────────────────────────────
 *
 * The obvious implementation — does the tag contain a listed word — refuses
 * `assessment`, `classic`, `grape`, `Scunthorpe` and a good deal of Scripture.
 * It is the single most common way a filter like this becomes the thing people
 * complain about. So matching is whole-word, in two places:
 *
 *   - the folded tag itself, so `#Sh*t` and `#shit` are one word; and
 *   - each word of what was typed, recovered before the fold removed the
 *     separators, so `#prayer-<slur>` is refused rather than passing because
 *     the run of letters as a whole is not on the list.
 *
 * A multi-word entry ("alabama hot pocket") is folded the same way the tag is,
 * so it can be matched at all: the tag `#alabamahotpocket` is one run of
 * letters and the entry has to become one too.
 *
 * Somebody who runs two words together to get past this will get past it. That
 * is accepted. This is V1, and the alternative is an adversarial text-detection
 * project that would refuse ten legitimate tags for every disguised one it
 * caught.
 */

/** Where the list lives. One path, in one place, per the configuration rule. */
const BANNED_WORDS_FILE = fileURLToPath(
  new URL('../../moderation-lists/banned-words.txt', import.meta.url),
);

/**
 * The list, read once.
 *
 * Read at module load rather than per request: it is 403 lines that change when
 * somebody deliberately updates a file in the repository, and re-reading it on
 * every keystroke would be a disk hit on the hot path for no benefit.
 */
function loadBannedWords(file: string): { words: Set<string>; folded: Set<string> } {
  const words = new Set<string>();
  const folded = new Set<string>();
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    /*
     * A missing list must not take the API down, and must not silently pass
     * everything either — the caller is told, once, at startup.
     */
    console.warn(`[tags] no banned-word list at ${file}; tag moderation is inactive`);
    return { words, folded };
  }
  for (const line of text.split('\n')) {
    const entry = line.trim().toLowerCase();
    if (!entry || entry.startsWith('#')) continue;
    const parts = tagWords(entry);
    /*
     * A multi-word entry contributes its folded form ONLY.
     *
     * Splitting one into its words is the subtle way this filter becomes
     * unusable: the list contains "god damn", and adding each word separately
     * refuses `#god` — on a Bible reflection application. The phrase is banned;
     * the words it is made of are not, and the list does not claim they are.
     */
    if (parts.length === 1 && parts[0]) words.add(parts[0]);
    const key = canonicalHashtag(entry);
    if (key) folded.add(key);
  }
  return { words, folded };
}

const LIST = loadBannedWords(BANNED_WORDS_FILE);

/** How many entries are loaded. For a startup log and for the tests. */
export function bannedWordCount(): number {
  return LIST.folded.size;
}

/**
 * Is this tag refused?
 *
 * Takes both forms because both are needed and the caller has already computed
 * them: `tag` is the canonical key, `raw` is what the person typed.
 */
export function isTagAllowed(raw: string, tag: string): boolean {
  if (LIST.folded.has(tag)) return false;
  /*
   * A single-word list entry is only ever matched as a whole word. A tag whose
   * words include one is refused; a tag that merely contains those letters is
   * not, which is the entire point.
   */
  for (const word of tagWords(raw)) {
    if (LIST.words.has(word)) return false;
  }
  return true;
}
