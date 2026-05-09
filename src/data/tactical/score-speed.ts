/**
 * Speed pillar scorer. Per scenario `field`, applies Choice Scarf,
 * Tailwind, and Trick Room inversion to per-(our_slot × threat) speed
 * comparisons. Weighted mean × 100.
 *
 * TR inversion (Q3 binding): triggers iff team has TR setter ability +
 * ≥ 2 attackers with base spe < 60. Tunable via `tr_min_slow_attackers`.
 *
 * Stage-4 stub.
 */

import type {
  PillarScore,
  ScenarioOverview,
  ThreatPanel,
} from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { SpeedTable } from "./speed-table";

export interface SpeedDeps {
  /** Default 2 per Q3 binding; override for tuning tests. */
  tr_min_slow_attackers?: number;
  /** Base-spe threshold for "slow attacker"; default 60. */
  tr_slow_base_spe?: number;
}

export function scoreSpeed(
  _team: UserTeam,
  _panel: ThreatPanel,
  _scenarios: ScenarioOverview[],
  _speedTable: SpeedTable,
  _deps: SpeedDeps,
): PillarScore {
  throw new Error("not implemented (Stage 5)");
}
