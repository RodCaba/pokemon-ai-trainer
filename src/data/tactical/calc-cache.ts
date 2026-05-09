/**
 * In-memory cache for `damage_calc` results keyed by canonical
 * `(attacker_set, defender_set, field, move_id)` hashes. Per Stage-3
 * §16.1 (Q3 binding override): cross-call cache ships in v1, scoped to
 * the process; invalidated by the `revalidate` helper at the start of
 * every overview / pillar / recommend call.
 *
 * Stage-4 stub — every export throws "not implemented (Stage 5)".
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
}

/**
 * Construct the process-scoped calc cache. Per §16.1, the cache lives
 * on the heap for the lifetime of the process; eviction is handled by
 * `revalidate`.
 */
export function createCalcCache(): CalcCache {
  throw new Error("not implemented (Stage 5)");
}

/**
 * Memoizing wrapper around `damage_calc`. On engine throw, returns
 * `{ ok: false, error }` so the caller can skip the (our_set,
 * threat_set) pair (flow §9). Errors are NOT cached.
 */
export function calcWithCache(
  _cache: CalcCache,
  _input: CalcInput,
):
  | { ok: true; result: CalcResult }
  | { ok: false; error: CalcEngineError | CalcInputError } {
  throw new Error("not implemented (Stage 5)");
}

/**
 * Drops the keys touching changed (team, panel) inputs at the start of
 * every overview / pillar / recommend call. Returns the number of
 * entries dropped.
 */
export function revalidate(
  _cache: CalcCache,
  _ctx: {
    team_id: string;
    team_updated_at: string;
    panel_as_of: string;
    /** sha256s of the team's 6 attacker sets, in slot order. */
    attacker_set_hashes: readonly string[];
    /** sha256s of the new panel's defender sets. */
    panel_defender_set_hashes: readonly string[];
  },
): number {
  throw new Error("not implemented (Stage 5)");
}
