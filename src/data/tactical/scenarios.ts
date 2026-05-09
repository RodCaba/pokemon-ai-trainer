/**
 * Generate 5–7 ScenarioOverview *skeletons* (leads/back/rejected filled
 * later by `recommendLeads`). 3 archetype clusters + 2–4 individual
 * top-usage threats + 0–2 weakness-counter scenarios (Q2 binding).
 *
 * Stage-4 stub.
 */

import type { Db } from "../../db/open";
import type { ScenarioOverview, ThreatPanel } from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache } from "./calc-cache";

export interface ScenarioGenDeps {
  db: Db;
  panel: ThreatPanel;
  team: UserTeam;
  calcCache: CalcCache;
  /** Tunable per Q2 binding — default 0.5 (≥3/6 OHKO). */
  weakness_ohko_ratio?: number;
}

/**
 * Produce 5–7 scenario skeletons. The recommend pass fills leads/back/
 * rejected/citations.
 *
 * @throws TacticalScenarioError when fewer than 3 scenarios producible.
 */
export function generateScenarios(
  _deps: ScenarioGenDeps,
): ScenarioOverview[] {
  throw new Error("not implemented (Stage 5)");
}
