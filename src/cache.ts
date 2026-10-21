/** A tiny in-memory cache with per-entry TTL and a size cap. One process, no persistence. */

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export interface TtlCacheOptions {
  /** Upper bound on stored entries; the oldest entry is evicted first. */
  maxEntries?: number;
  /** Clock in milliseconds, injectable for tests. */
  now?: () => number;
}

export class TtlCache<V> {
  readonly #entries = new Map<string, Entry<V>>();
  readonly #maxEntries: number;
  readonly #now: () => number;

  constructor(options: TtlCacheOptions = {}) {
    this.#maxEntries = options.maxEntries ?? 1000;
    this.#now = options.now ?? Date.now;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: string): V | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlSeconds: number): void {
    this.#entries.delete(key); // re-insert so Map order tracks recency of writes
    this.#entries.set(key, { value, expiresAt: this.#now() + ttlSeconds * 1000 });
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  clear(): void {
    this.#entries.clear();
  }
}
