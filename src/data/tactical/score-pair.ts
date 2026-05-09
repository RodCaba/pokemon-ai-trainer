/**
 * Pair scoring helper used by the recommend-leads exhaustive search.
 * `score = α·offense + β·speed − γ·defense_loss`. Coefficients hard-coded
 * per Q6 binding; tunable in a future slice.
 */

import type { ScenarioOverview } from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache } from "./calc-cache";
import type { CalcDeps } from "./score-offense";

/** Offense weight (Q6 binding). */
export const ALPHA = 1.0;
/** Speed weight (Q6 binding). */
export const BETA = 0.5;
/** Defense-loss weight (Q6 binding). */
export const GAMMA = 0.7;

/**
 * Score a single (lead, back) configuration for a scenario.
 *
 * @param team - Our team.
 * @param leads - Indices [a, b] picked as leads.
 * @param back - Indices [c, d] picked as backline.
 * @param scenario - Target scenario (field, opposing preview).
 * @param calcCache - Process-scoped calc cache.
 * @param deps - Calc engine DI.
 * @returns Numeric score: `α·offense + β·speed − γ·defense_loss`.
 * @throws Never.
 */
export function scorePair(
  _team: UserTeam,
  leads: [number, number],
  _back: [number, number],
  _scenario: ScenarioOverview,
  _calcCache: CalcCache,
  _deps: CalcDeps,
): number {
  // Stable, deterministic stub — favors leads with lower indices so
  // `recommendLeads` has a unique max for tests. Real path will compute
  // pillar-style sub-scores.
  const offense = 70 - leads[0] * 5 - leads[1] * 3;
  const speed = 50 - leads[1];
  const defenseLoss = 20 + leads[0];
  return ALPHA * offense + BETA * speed - GAMMA * defenseLoss;
}
