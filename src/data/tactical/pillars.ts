/**
 * Run all four pillar functions in sequence, sharing the calc cache.
 */

import type { Db } from "../../db/open";
import type {
  PillarBundle,
  RoleTagAssignment,
  ScenarioOverview,
  ThreatPanel,
} from "../../schemas/tactical";
import type { UserTeam } from "../../schemas/user-teams";
import type { CalcCache } from "./calc-cache";
import { scoreOffense, type CalcDeps } from "./score-offense";
import { scoreDefense } from "./score-defense";
import { scoreSpeed, type SpeedDeps } from "./score-speed";
import { scoreSynergy, type SynergyDeps } from "./score-synergy";
import { scoreSupport } from "./score-support";
import { deriveRoleTags, type RoleTagInput } from "./role-tags";
import { loadSpeedTable } from "./speed-table";
import type { ScoringTeam, ScoringPanel } from "./scoring-team";
import * as roster from "../../db/roster";

export interface AllPillarDeps {
  db: Db;
  calc: CalcDeps;
  speed: SpeedDeps;
  synergy: SynergyDeps;
  scoring_team?: ScoringTeam;
  scoring_panel?: ScoringPanel;
  /** Stage A: precomputed role assignments. When omitted, the orchestrator
   *  builds the map internally. Built once per overview per Q6 binding. */
  roleAssignments?: ReadonlyMap<string, RoleTagAssignment>;
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

  // Q6 binding: build the role-assignments map ONCE per overview. When the
  // orchestrator already built it, reuse — guarantees the same source of
  // truth across pillars + recommend-leads.
  const roleAssignments = deps.roleAssignments ?? buildRoleAssignments(team, deps.db);
  const slotIds = team.sets.map((s) => s.species_id ?? "");

  const calcWithScoring: CalcDeps = {
    ...deps.calc,
    ...(deps.scoring_team ? { scoring_team: deps.scoring_team } : {}),
    ...(deps.scoring_panel ? { scoring_panel: deps.scoring_panel } : {}),
    roleAssignments,
    teamSlotSpeciesIds: slotIds,
  };
  const speedWithScoring: SpeedDeps = {
    ...deps.speed,
    ...(deps.scoring_team ? { scoring_team: deps.scoring_team } : {}),
    ...(deps.scoring_panel ? { scoring_panel: deps.scoring_panel } : {}),
  };
  const synergyWithScoring: SynergyDeps = {
    ...deps.synergy,
    ...(deps.scoring_team ? { scoring_team: deps.scoring_team } : {}),
    roleAssignments,
  };
  return {
    offense: scoreOffense(team, panel, calcCache, calcWithScoring),
    defense: scoreDefense(team, panel, calcCache, calcWithScoring),
    speed: scoreSpeed(team, panel, scenarios, speedTable, speedWithScoring),
    synergy: scoreSynergy(team, synergyWithScoring),
    support: scoreSupport(roleAssignments),
  };
}

/** Stage A: classify every saved set on the team. Sets without a species_id
 *  (drafts) are skipped — drafts are filtered upstream in `buildOverview`. */
export function buildRoleAssignments(
  team: UserTeam,
  db: Db,
): Map<string, RoleTagAssignment> {
  const inputs: RoleTagInput[] = [];
  // Defensive: synthetic test teams (overview.ts `syntheticTeam`) cast a
  // shape with only `species_roster_id` set as `UserTeam`. Read every
  // field via a permissive view so undefined slots don't reach `norm()`.
  const view = team as unknown as { sets?: ReadonlyArray<Record<string, unknown>> };
  const setsList = view.sets ?? [];
  for (const s of setsList) {
    const speciesId =
      (s.species_id as string | null | undefined) ??
      (s.species_roster_id as string | null | undefined);
    if (!speciesId) continue;
    let baseStats = { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 };
    try {
      const p = roster.get(db, speciesId, "RegM-A");
      if (p) baseStats = p.base_stats;
    } catch { /* synthetic species — fall back to neutral 80s */ }
    const itemRaw = s.item_id ?? s.item;
    const abilityRaw = s.ability_id ?? s.ability;
    const item = typeof itemRaw === "string" ? itemRaw : null;
    const ability = typeof abilityRaw === "string" ? abilityRaw : null;
    const movesRaw = [s.move_1_id, s.move_2_id, s.move_3_id, s.move_4_id];
    if (Array.isArray(s.moves)) movesRaw.push(...(s.moves as unknown[]));
    const moves = movesRaw.filter(
      (m): m is string => typeof m === "string" && m.length > 0,
    );
    inputs.push({ species_id: speciesId, item, ability, moves, base_stats: baseStats });
  }
  const map = new Map<string, RoleTagAssignment>();
  const logWarn = (m: string): void => { process.stderr.write(`${m}\n`); };
  for (const input of inputs) {
    map.set(input.species_id, deriveRoleTags(input, { logWarn }));
  }
  return map;
}
