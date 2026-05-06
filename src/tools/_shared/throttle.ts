/**
 * Per-host token-bucket throttle primitive. Stage 4 stub — full
 * implementation lands in Stage 5 (sibling-extracted from
 * `src/tools/labmaus/client.ts` per `docs/plans/pokepaste-sets.md` §9).
 */

/** Configuration for {@link createTokenBucket}. */
export interface TokenBucketOpts {
  /** Burst capacity in tokens. */
  capacity: number;
  /** Sustained refill rate in tokens per second. */
  refillPerSec: number;
  /** Injectable clock (defaults to `Date.now`) for tests. */
  clock?: () => number;
}

/** A token bucket. Each `acquire()` resolves once a token is available. */
export interface TokenBucket {
  acquire(): Promise<void>;
}

/**
 * Build a {@link TokenBucket}. Stub — throws "not implemented (Stage 5)".
 *
 * **When to use it:** as the throttle dep in any tool client (labmaus,
 * pokepaste). Each client constructs its own bucket so per-host limits
 * are independent.
 *
 * @param opts — see {@link TokenBucketOpts}.
 * @returns A {@link TokenBucket}.
 * @throws Always (Stage 4 stub).
 */
export function createTokenBucket(_opts: TokenBucketOpts): TokenBucket {
  throw new Error("not implemented (Stage 5)");
}
