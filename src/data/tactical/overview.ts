/**
 * Top-level orchestrator. Reads team via `userTeams.get`; refuses if
 * `status !== 'saved'` or `validation_errors.length > 0` (flow §9).
 * Builds threat panel → scenarios → pillars → recommends leads per
 * scenario → assembles `TeamTacticalOverview`. Single ~5–15s call.
 *
 * Stage-4 stub.
 */

// TODO(stage6-deferred): persistence — `tactical_overview_cache` table +
// invalidation hooks from pikalytics.upsertSnapshot + userTeams.update.

import type { Db } from "../../db/open";
import type { TeamTacticalOverview } from "../../schemas/tactical";
import type { CalcDeps } from "./score-offense";
import type { SpeedDeps } from "./score-speed";
import type { SynergyDeps } from "./score-synergy";

export interface OverviewDeps {
  db: Db;
  calc: CalcDeps;
  speed: SpeedDeps;
  synergy: SynergyDeps;
  knowledge?: unknown;
  /** Override "now" for deterministic tests. */
  now?: () => Date;
}

/**
 * @throws TacticalOverviewError on draft / validation_errors / unknown id.
 * @throws TacticalThreatPanelError on empty data.
 * @throws TacticalScenarioError on insufficient scenario data.
 */
export function buildOverview(
  _teamId: string,
  _deps: OverviewDeps,
): TeamTacticalOverview {
  throw new Error("not implemented (Stage 5)");
}
