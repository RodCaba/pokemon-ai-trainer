/**
 * Stage 4 scaffold for the mid-phase scorer (plan §6.1).
 * Stage 5 wires the 1-vs-1 survival + outgoing-damage calc loop.
 */

import type { CalcResult } from "../../schemas/calc";
import type { ScenarioOverview, TeamPlanScenario } from "../../schemas/tactical";
import type { CalcCache } from "./calc-cache";
import type { CalcDeps } from "./score-offense";

/** Pure score (0..150) for a mid-phase candidate slot. */
export function scoreMidPhase(
  _midSlot: number,
  _scenario: ScenarioOverview | TeamPlanScenario,
  _calcCache: CalcCache,
  _deps: CalcDeps,
): number {
  void {} as unknown as CalcResult;
  return 0;
}
