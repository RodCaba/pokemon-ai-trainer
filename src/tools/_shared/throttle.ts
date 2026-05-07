/**
 * Per-host token-bucket throttle primitive. Sibling-extracted from the
 * original labmaus client per `docs/plans/pokepaste-sets.md` §9 / §12.
 *
 * Each consumer constructs its own bucket so per-host rate limits are
 * independent. Built on `Date.now()` + `setTimeout` so vitest fake timers
 * can observe pacing without real waits.
 */

/** Configuration for {@link createTokenBucket}.
 *
 * Burst capacity intentionally not supported in v1; the bucket is a
 * sustained-rate throttle only (one slot, gated on the "next allowed at"
 * timestamp). If a consumer needs bursty semantics, extend the type and
 * the `acquire()` impl together. */
export interface TokenBucketOpts {
  /** Sustained refill rate in tokens per second. */
  refillPerSec: number;
  /** Injectable clock (defaults to `Date.now`) for tests. */
  clock?: () => number;
}

/** A token bucket. Each `acquire()` resolves once a token is available. */
export interface TokenBucket {
  acquire(): Promise<void>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Build a {@link TokenBucket}.
 *
 * **When to use it:** as the throttle dep in any tool client (labmaus,
 * pokepaste). Each client constructs its own bucket so per-host limits
 * are independent.
 *
 * @param opts — see {@link TokenBucketOpts}.
 * @returns A {@link TokenBucket}.
 */
export function createTokenBucket(opts: TokenBucketOpts): TokenBucket {
  const clock = opts.clock ?? ((): number => Date.now());
  const intervalMs = opts.refillPerSec > 0 ? 1000 / opts.refillPerSec : 0;
  let nextAllowedAt = 0;

  return {
    async acquire(): Promise<void> {
      const t = clock();
      const wait = nextAllowedAt - t;
      if (wait > 0) await sleep(wait);
      nextAllowedAt = Math.max(t, nextAllowedAt) + intervalMs;
    },
  };
}
