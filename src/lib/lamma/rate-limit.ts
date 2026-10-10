/**
 * Fixed-window rate limiter. Each entry remembers its own window so expired entries can be
 * dropped; without pruning the map would grow with every key ever seen. The clock is injectable
 * so the behaviour can be tested without waiting.
 */
export type RateLimiter = {
  /** Record a hit for `key`. Returns true while the key is within `max` hits per `windowMs`. */
  allow: (key: string, max: number, windowMs: number) => boolean;
  /** Number of keys currently tracked. */
  size: () => number;
};

type Options = {
  now?: () => number;
  /** Pruning only starts once this many keys are tracked. */
  softLimit?: number;
  /** Minimum gap between prunes, so a busy server never pays O(n) on every request. */
  pruneEveryMs?: number;
};

export function createRateLimiter(options: Options = {}): RateLimiter {
  const now = options.now ?? Date.now;
  const softLimit = options.softLimit ?? 5000;
  const pruneEveryMs = options.pruneEveryMs ?? 10_000;
  const hits = new Map<string, { n: number; t: number; w: number }>();
  let lastPrune = 0;

  function prune(at: number) {
    for (const [key, row] of hits) {
      if (at - row.t > row.w) hits.delete(key);
    }
  }

  return {
    allow(key, max, windowMs) {
      const at = now();
      if (hits.size >= softLimit && at - lastPrune > pruneEveryMs) {
        lastPrune = at;
        prune(at);
      }
      const row = hits.get(key);
      if (!row || at - row.t > windowMs) {
        hits.set(key, { n: 1, t: at, w: windowMs });
        return true;
      }
      row.n += 1;
      return row.n <= max;
    },
    size: () => hits.size,
  };
}
