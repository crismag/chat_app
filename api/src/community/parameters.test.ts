/*
 * No numbered SQL parameters, anywhere.
 *
 * `?1` repeated inside one statement binds differently depending on the Node
 * release: it works on 22.23, which is what this suite runs on, and raises
 * SQLITE_RANGE on 22.18, which is what the production host runs. The community
 * feed was therefore broken in production and green in CI at the same time —
 * for weeks, because nothing here could see it.
 *
 * A test cannot run on a Node it does not have. What it can do is forbid the
 * construct, which is what this does: named parameters mean the same thing on
 * every version, and a value used in five places is still supplied once.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const here = fileURLToPath(new URL('.', import.meta.url));
const apiSrc = join(here, '..');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [path]
      : [];
  });
}

describe('SQL parameters', () => {
  test('nothing binds by number', () => {
    /*
     * `?` on its own is fine — it is positional and unambiguous. `?1` is the
     * one that behaves differently across versions, and it is exactly the
     * construct somebody reaches for when one value is needed in several
     * places in a statement. The alternative is `$name`, which is supported
     * everywhere and reads better anyway.
     */
    const numbered = /\?\d/;
    /*
     * Line by line, skipping comments and quoted values. A client hint is
     * literally the string '?1' and a comment explaining this rule contains
     * one too — neither is a bound parameter, and a check that flagged them
     * would be turned off within a week.
     */
    const offenders = sourceFiles(apiSrc)
      .filter((path) =>
        readFileSync(path, 'utf8')
          .split('\n')
          .some((line) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
              return false;
            }
            return numbered.test(line.replace(/'[^']*'/g, ''));
          }),
      )
      .map((path) => path.slice(apiSrc.length + 1));

    expect(offenders).toEqual([]);
  });
});
