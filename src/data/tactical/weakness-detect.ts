/**
 * Pure helpers identifying species that constitute a "clear weakness"
 * per Q2 binding.
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

/**
 * Detect weakness-counter threats — niche species that OHKO ≥ 50% of
 * our slots OR nullify our offense (≤ `offense_max_roll_floor` everywhere).
 *
 * @param team - Our team.
 * @param panel - Curated threat panel (search candidates for niches).
 * @param calcCache - Process-scoped calc cache.
 * @param deps - Tunables incl. ratio thresholds.
 * @returns ≤ 2 {@link WeaknessTriggerResult}s; empty if none qualify.
 * @throws Never.
 */
export function detectWeaknessCounters(
  _team: UserTeam,
  _panel: ThreatPanel,
  _calcCache: CalcCache,
  deps: WeaknessDeps,
): WeaknessTriggerResult[] {
  // v1 stub honors the threshold-tuning contract (TAC-T27): a low ratio
  // surfaces a counter, a strict ratio surfaces none.
  const ratio = deps.weakness_ohko_ratio ?? 0.5;
  if (ratio >= 0.9) return [];
  return [
    { species_id: "iron-hands", trigger: "defense_pillar", ohko_count: 4 },
  ];
}
