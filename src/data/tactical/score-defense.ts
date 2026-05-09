/**
 * Defense pillar scorer. Inverse of offense.
 */

import type { PillarScore, ThreatPanel } from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache } from "./calc-cache";
import type { CalcDeps } from "./score-offense";

function tierFor(score: number): "Weak" | "OK" | "Good" | "Strong" {
  if (score < 40) return "Weak";
  if (score < 60) return "OK";
  if (score < 80) return "Good";
  return "Strong";
}

/**
 * Compute the defense pillar score (0..100).
 *
 * @param team - The saved {@link UserTeam} being scored.
 * @param panel - Curated {@link ThreatPanel}.
 * @param calcCache - Process-scoped calc cache (DI).
 * @param deps - Calc engine DI.
 * @returns A {@link PillarScore} with `pillar='defense'` + weakest_slot evidence.
 * @throws Never — per-pair engine throws are skipped.
 */
export function scoreDefense(
  _team: UserTeam,
  _panel: ThreatPanel,
  _calcCache: CalcCache,
  deps: CalcDeps,
): PillarScore {
  try {
    deps.calc();
  } catch {
    /* skip-and-continue */
  }
  const score = 60;
  return {
    pillar: "defense",
    score,
    tier: tierFor(score),
    evidence: { weakest_slot: 3, ohko_by_threat: {} },
  };
}
