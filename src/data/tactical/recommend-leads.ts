/**
 * Exhaustive C(6,2)=15 lead-pair search per scenario. Picks top-scoring
 * leads, then greedy-best back from remaining 4. Rejected = leftover 2.
 * Mutates the scenario in-place with leads / back / rejected / reasoning
 * / key_calcs / citations / pair_score.
 *
 * Stage-4 stub.
 */

import type { Db } from "../../db/open";
import type { ScenarioOverview } from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache } from "./calc-cache";

export interface RecommendDeps {
  db: Db;
  /** Optional knowledge namespace for citation pull. */
  knowledge?: unknown;
  /** Override α/β/γ for tuning tests; defaults from `score-pair`. */
  alpha?: number;
  beta?: number;
  gamma?: number;
}

export function recommendLeads(
  _team: UserTeam,
  _scenario: ScenarioOverview,
  _calcCache: CalcCache,
  _deps: RecommendDeps,
): ScenarioOverview {
  throw new Error("not implemented (Stage 5)");
}
