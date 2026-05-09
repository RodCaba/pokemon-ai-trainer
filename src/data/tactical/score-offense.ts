/**
 * Offense pillar scorer. For each (our 6 sets × 15 panel): pick best
 * move, run `damage_calc(our_set → panel_set, panel.field)`, outcome =
 * `min(1.0, max_roll_pct/100) × weight`. Aggregate weighted mean × 100.
 *
 * Evidence: `top: ThreatHit[3]`, `worst: ThreatHit[2]`.
 *
 * Stage-4 stub.
 */

import type { PillarScore, ThreatPanel } from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache } from "./calc-cache";

export interface CalcDeps {
  /** Throws (intentionally) — caller's `calcWithCache` traps and skips. */
  calc: (...args: unknown[]) => unknown;
}

export function scoreOffense(
  _team: UserTeam,
  _panel: ThreatPanel,
  _calcCache: CalcCache,
  _deps: CalcDeps,
): PillarScore {
  throw new Error("not implemented (Stage 5)");
}
