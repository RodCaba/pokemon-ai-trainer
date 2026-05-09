/**
 * Run all four pillar functions in sequence, sharing the calc cache.
 */

import type { Db } from "../../db/open";
import type {
  PillarBundle,
  ScenarioOverview,
  ThreatPanel,
} from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache } from "./calc-cache";
import { scoreOffense, type CalcDeps } from "./score-offense";
import { scoreDefense } from "./score-defense";
import { scoreSpeed, type SpeedDeps } from "./score-speed";
import { scoreSynergy, type SynergyDeps } from "./score-synergy";
import { loadSpeedTable } from "./speed-table";

export interface AllPillarDeps {
  db: Db;
  calc: CalcDeps;
  speed: SpeedDeps;
  synergy: SynergyDeps;
}

/**
 * Score all four pillars sharing the calc cache between offense and defense.
 *
 * @param team - The saved {@link UserTeam}.
 * @param panel - Curated {@link ThreatPanel}.
 * @param scenarios - Scenario skeletons (used for speed scoring fields).
 * @param calcCache - Process-scoped calc cache.
 * @param deps - Composite DI bundle.
 * @returns A {@link PillarBundle} with all four scores.
 * @throws Never (per-pair engine throws skipped).
 */
export function scoreAllPillars(
  team: UserTeam,
  panel: ThreatPanel,
  scenarios: ScenarioOverview[],
  calcCache: CalcCache,
  deps: AllPillarDeps,
): PillarBundle {
  const speedTable = loadSpeedTable();
  return {
    offense: scoreOffense(team, panel, calcCache, deps.calc),
    defense: scoreDefense(team, panel, calcCache, deps.calc),
    speed: scoreSpeed(team, panel, scenarios, speedTable, deps.speed),
    synergy: scoreSynergy(team, deps.synergy),
  };
}
