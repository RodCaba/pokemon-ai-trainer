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
import type { ScoringTeam, ScoringPanel } from "./scoring-team";

export interface AllPillarDeps {
  db: Db;
  calc: CalcDeps;
  speed: SpeedDeps;
  synergy: SynergyDeps;
  scoring_team?: ScoringTeam;
  scoring_panel?: ScoringPanel;
}

/**
 * Score all four pillars sharing the calc cache between offense and defense.
 *
 * @param team - The saved {@link UserTeam}.
 * @param panel - Curated {@link ThreatPanel}.
 * @param scenarios - Scenario skeletons (used for speed scoring fields).
 * @param calcCache - Process-scoped calc cache.
 * @param deps - Composite DI bundle (incl. optional scoring_team/scoring_panel
 *   to drive real engine loops in production / live demo).
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
  const calcWithScoring: CalcDeps = {
    ...deps.calc,
    ...(deps.scoring_team ? { scoring_team: deps.scoring_team } : {}),
    ...(deps.scoring_panel ? { scoring_panel: deps.scoring_panel } : {}),
  };
  const speedWithScoring: SpeedDeps = {
    ...deps.speed,
    ...(deps.scoring_team ? { scoring_team: deps.scoring_team } : {}),
    ...(deps.scoring_panel ? { scoring_panel: deps.scoring_panel } : {}),
  };
  const synergyWithScoring: SynergyDeps = {
    ...deps.synergy,
    ...(deps.scoring_team ? { scoring_team: deps.scoring_team } : {}),
  };
  return {
    offense: scoreOffense(team, panel, calcCache, calcWithScoring),
    defense: scoreDefense(team, panel, calcCache, calcWithScoring),
    speed: scoreSpeed(team, panel, scenarios, speedTable, speedWithScoring),
    synergy: scoreSynergy(team, synergyWithScoring),
  };
}
