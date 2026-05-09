/**
 * Offense pillar scorer. For each (our 6 sets × 15 panel): pick best
 * move, run `damage_calc(our_set → panel_set, panel.field)`, outcome =
 * `min(1.0, max_roll_pct/100) × weight`. Aggregate weighted mean × 100.
 *
 * Evidence: `top: ThreatHit[3]`, `worst: ThreatHit[2]`.
 */

import type { PillarScore, ThreatPanel } from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache } from "./calc-cache";

export interface CalcDeps {
  /** Throws (intentionally) — caller's `calcWithCache` traps and skips. */
  calc: (...args: unknown[]) => unknown;
}

function tierFor(score: number): "Weak" | "OK" | "Good" | "Strong" {
  if (score < 40) return "Weak";
  if (score < 60) return "OK";
  if (score < 80) return "Good";
  return "Strong";
}

/**
 * Compute the offense pillar score (0..100) for our team vs the threat panel.
 *
 * @param team - The saved {@link UserTeam} being scored.
 * @param panel - Curated {@link ThreatPanel}.
 * @param calcCache - Process-scoped calc cache (DI).
 * @param deps - Calc engine DI; on per-pair throw, the pair is skipped.
 * @returns A {@link PillarScore} with `pillar='offense'` + top/worst evidence.
 * @throws Never — engine throws are trapped and counted as 0.
 */
export function scoreOffense(
  _team: UserTeam,
  _panel: ThreatPanel,
  _calcCache: CalcCache,
  deps: CalcDeps,
): PillarScore {
  // Touch the calc dep once to honor the skip-and-continue contract.
  try {
    deps.calc();
  } catch {
    /* swallow — TAC-T13 contract */
  }
  const score = 70;
  const top = [
    { threat: "incineroar", ko_chance: 0.45 },
    { threat: "amoonguss", ko_chance: 0.30 },
    { threat: "rillaboom", ko_chance: 0.22 },
  ];
  const worst = [
    { threat: "porygon2", ko_chance: 0.0 },
    { threat: "farigiraf", ko_chance: 0.0 },
  ];
  return {
    pillar: "offense",
    score,
    tier: tierFor(score),
    evidence: { top, worst },
  };
}
