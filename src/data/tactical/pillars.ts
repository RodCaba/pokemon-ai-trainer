/**
 * Run all four pillar functions in sequence, sharing the calc cache
 * across offense/defense. Returns the PillarBundle for `score_pillars`.
 *
 * Stage-4 stub.
 */

import type { Db } from "../../db/open";
import type {
  PillarBundle,
  ScenarioOverview,
  ThreatPanel,
} from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache } from "./calc-cache";
import type { CalcDeps } from "./score-offense";
import type { SpeedDeps } from "./score-speed";
import type { SynergyDeps } from "./score-synergy";

export interface AllPillarDeps {
  db: Db;
  calc: CalcDeps;
  speed: SpeedDeps;
  synergy: SynergyDeps;
}

export function scoreAllPillars(
  _team: UserTeam,
  _panel: ThreatPanel,
  _scenarios: ScenarioOverview[],
  _calcCache: CalcCache,
  _deps: AllPillarDeps,
): PillarBundle {
  throw new Error("not implemented (Stage 5)");
}
