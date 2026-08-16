/*
 * Two caches with deliberately different characters, and the reasoning for the
 * difference written down where it cannot be lost.
 *
 * ── The catalog ─────────────────────────────────────────────────────────────
 * A list of twenty translations and their copyright notices. It changes a few
 * times a year. Caching it for a day is ordinary good manners toward the
 * provider and saves the reader a second of latency on every page load.
 *
 * ── Passage text ────────────────────────────────────────────────────────────
 * This is copyrighted content belonging to a publisher, delivered under a
 * licence granted for *display in this application*. Building a local
 * accumulating copy of it — a table of every verse anyone ever looked up,
 * growing forever, purely to save a round trip — is building an unlicensed
 * reproduction of the New International Version one request at a time. That it
 * would be faster is not a defence.
 *
 * So passage text gets an in-memory window measured in minutes, sized to
 * collapse the burst of identical requests a single page makes (a load, a
 * re-render, a translation toggle and back). It never touches the disk, it dies
 * with the process, and it is bounded so it cannot grow into the thing it is
 * not allowed to be.
 *
 * The one place passage text IS stored durably is on the reflection the person
 * wrote — see `passage-store.ts`. That is not an optimisation; it is the record
 * of what they wrote against, and a reflection that re-renders itself in a
 * different translation next year is a broken reflection.
 *
 * ── The rule that matters most ──────────────────────────────────────────────
 * **Only successes are cached.** A cached failure is a failure that outlives
 * its cause: a provider blip at 09:00 would still be refusing lookups at 09:15
 * after the provider recovered, and no one would be able to tell why. Nothing
 * in this file has a code path that stores an error.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly ttlMs: () => number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(ttlMs: number | (() => number), maxEntries = 200, now: () => number = Date.now) {
    this.ttlMs = typeof ttlMs === 'function' ? ttlMs : () => ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Store a value that is known to be good.
   *
   * There is no `setError`, no negative caching and no "remember that this
   * failed" flag, and there should never be one. See the note above.
   */
  set(key: string, value: T): void {
    /*
     * Bounded by eviction of the oldest insertion. `Map` preserves insertion
     * order, so the first key is the least recently *added* — good enough for a
     * cache whose job is collapsing a burst, and it means the structure cannot
     * become an accumulating archive of licensed text.
     */
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs() });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
