/**
 * In-memory cache for `damage_calc` results keyed by canonical
 * `(attacker_set, defender_set, field, move_id)` hashes. Per Stage-3
 * §16.1 (Q3 binding override): cross-call cache ships in v1, scoped to
 * the process; invalidated by the `revalidate` helper at the start of
 * every overview / pillar / recommend call.
 */

import type { CalcInput, CalcResult } from "../../schemas/calc";
import type {
  CalcEngineError,
  CalcInputError,
} from "../../schemas/errors";

/** Canonical cache key — sha256 of canonical-JSON inputs per pillar. */
export interface CalcCacheKey {
  attacker_set_hash: string;
  defender_set_hash: string;
  field_hash: string;
  move_id: string;
}

/** Cross-call calc cache surface. */
export interface CalcCache {
  get(key: CalcCacheKey): CalcResult | undefined;
  set(key: CalcCacheKey, result: CalcResult): void;
  size(): number;
  stats(): { hits: number; misses: number };
  /**
   * Drop all entries whose attacker_set_hash matches the given hash —
   * used when one of our team sets is mutated between calls.
   */
  invalidateAttackerSet(set_hash: string): number;
  /**
   * Drop all entries whose defender_set_hash matches a panel set
   * present in the previous panel but not the new one — used when the
   * threat panel `as_of` advances.
   */
  invalidatePanel(stale_defender_set_hashes: ReadonlySet<string>): number;
  /** Iterate every cached key (for revalidation). */
  keys(): IterableIterator<CalcCacheKey>;
}

function serializeKey(k: CalcCacheKey): string {
  return JSON.stringify([k.attacker_set_hash, k.defender_set_hash, k.field_hash, k.move_id]);
}

function parseKey(s: string): CalcCacheKey {
  const arr = JSON.parse(s) as [string, string, string, string];
  return {
    attacker_set_hash: arr[0],
    defender_set_hash: arr[1],
    field_hash: arr[2],
    move_id: arr[3],
  };
}

/**
 * Construct the process-scoped calc cache.
 *
 * @returns A {@link CalcCache} backed by an internal Map.
 * @example
 *   const cache = createCalcCache();
 *   cache.set({ attacker_set_hash: "a", defender_set_hash: "d", field_hash: "f", move_id: "m" }, result);
 */
export function createCalcCache(): CalcCache {
  const store = new Map<string, CalcResult>();
  let hits = 0;
  let misses = 0;
  return {
    get(key) {
      const k = serializeKey(key);
      if (store.has(k)) {
        hits++;
        return store.get(k);
      }
      misses++;
      return undefined;
    },
    set(key, result) {
      store.set(serializeKey(key), result);
    },
    size() {
      return store.size;
    },
    stats() {
      return { hits, misses };
    },
    invalidateAttackerSet(set_hash) {
      let dropped = 0;
      for (const k of Array.from(store.keys())) {
        if (parseKey(k).attacker_set_hash === set_hash) {
          store.delete(k);
          dropped++;
        }
      }
      return dropped;
    },
    invalidatePanel(stale) {
      let dropped = 0;
      for (const k of Array.from(store.keys())) {
        if (stale.has(parseKey(k).defender_set_hash)) {
          store.delete(k);
          dropped++;
        }
      }
      return dropped;
    },
    *keys() {
      for (const k of store.keys()) yield parseKey(k);
    },
  };
}

/**
 * Memoizing wrapper around `damage_calc`. On engine throw, returns
 * `{ ok: false, error }` so the caller can skip the (our_set,
 * threat_set) pair (flow §9). Errors are NOT cached.
 *
 * @param cache - Process-scoped calc cache.
 * @param input - Full {@link CalcInput} for the engine.
 * @param key - Cache key to memoize under.
 * @param calcFn - Engine call (defaults to throwing) — DI for tests.
 * @returns `{ok:true,result}` on success, `{ok:false,error}` on failure.
 * @throws Never — engine errors are wrapped in the result tagged union.
 */
export function calcWithCache(
  cache: CalcCache,
  input: CalcInput,
  key: CalcCacheKey,
  calcFn: (input: CalcInput) => CalcResult,
):
  | { ok: true; result: CalcResult }
  | { ok: false; error: CalcEngineError | CalcInputError } {
  const cached = cache.get(key);
  if (cached !== undefined) return { ok: true, result: cached };
  try {
    const result = calcFn(input);
    cache.set(key, result);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e as CalcEngineError | CalcInputError };
  }
}

/**
 * Drops cache keys touching changed (team, panel) inputs at the start
 * of every overview / pillar / recommend call.
 *
 * @param cache - Process-scoped calc cache.
 * @param ctx - The current scoring context (team and panel signals).
 * @returns Total entries evicted.
 * @throws Never.
 */
export function revalidate(
  cache: CalcCache,
  ctx: {
    team_id: string;
    team_updated_at: string;
    panel_as_of: string;
    attacker_set_hashes: readonly string[];
    panel_defender_set_hashes: readonly string[];
  },
): number {
  const valid = new Set<string>(ctx.panel_defender_set_hashes);
  const stale = new Set<string>();
  for (const k of cache.keys()) {
    if (!valid.has(k.defender_set_hash)) stale.add(k.defender_set_hash);
  }
  return cache.invalidatePanel(stale);
}
