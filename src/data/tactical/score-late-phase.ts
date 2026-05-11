/**
 * Stage 4 scaffold for the late-phase scorer (plan §6.2).
 * Stage 5 implements the usage-weighted top-2-bulky-panel KO sweep.
 */

import type { ScenarioOverview, TeamPlanScenario, ThreatPanel } from "../../schemas/tactical";
import type { CalcCache } from "./calc-cache";
import type { CalcDeps } from "./score-offense";

/** Pure score (0..100) for a cleaner slot vs the bulkiest panel members. */
export function scoreLatePhase(
  _cleanerSlot: number,
  _scenario: ScenarioOverview | TeamPlanScenario,
  _panel: ThreatPanel,
  _calcCache: CalcCache,
  _deps: CalcDeps,
): number {
  return 0;
}
