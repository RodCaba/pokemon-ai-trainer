/**
 * Pair scoring helper used by the recommend-leads exhaustive search.
 * `score = α·offense + β·speed − γ·defense_loss`. Coefficients hard-coded
 * per Q6 binding; tunable in a future slice.
 *
 * Stage-4 stub.
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

export function scorePair(
  _team: UserTeam,
  _leads: [number, number],
  _back: [number, number],
  _scenario: ScenarioOverview,
  _calcCache: CalcCache,
  _deps: CalcDeps,
): number {
  throw new Error("not implemented (Stage 5)");
}
