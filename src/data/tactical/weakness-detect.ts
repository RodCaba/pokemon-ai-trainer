/**
 * Pure helpers identifying species in the panel that constitute a
 * "clear weakness" per Q2 binding. Returns ≤ 2 entries.
 *
 * Triggers:
 *  - A: defense pillar shows ≥ 50% OHKO chance across our 6 slots vs the
 *       single threat (≥ 3/6 OHKO; tunable via `weakness_ohko_ratio`).
 *  - B: a niche species nullifies our offense plan (no offensive set has
 *       ≥ 30% max-roll on this species).
 *
 * Stage-4 stub.
 */

import type { ThreatPanel } from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache } from "./calc-cache";
import type { CalcDeps } from "./score-offense";

export interface WeaknessTriggerResult {
  species_id: string;
  trigger: "defense_pillar" | "offense_nullified";
  ohko_count?: number;
  best_max_roll?: number;
}

export interface WeaknessDeps extends CalcDeps {
  /** Default 0.5 (≥ 3/6 OHKO). Tunable for tests. */
  weakness_ohko_ratio?: number;
  /** Default 0.30 (max-roll fraction). */
  offense_max_roll_floor?: number;
}

export function detectWeaknessCounters(
  _team: UserTeam,
  _panel: ThreatPanel,
  _calcCache: CalcCache,
  _deps: WeaknessDeps,
): WeaknessTriggerResult[] {
  throw new Error("not implemented (Stage 5)");
}
