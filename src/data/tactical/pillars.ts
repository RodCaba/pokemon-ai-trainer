/**
 * Run all four pillar functions in sequence, sharing the calc cache.
 */

import type { Db } from "../../db/open";
import type {
  PillarBundle,
  RoleTagAssignment,
  ScenarioSkeleton,
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
  scenarios: ScenarioSkeleton[],
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

/** Narrow shape `buildRoleAssignments` needs from a team. Both the real
 *  `UserTeam` (saved sets from the DB) and the `syntheticTeam` test fixture
 *  in `overview.ts` (which casts itself to `UserTeam` but only carries
 *  `species_roster_id` per set) satisfy this interface. Defined here so
 *  the cast at the call boundary is narrow and documented. */
export interface RoleTagSet {
  species_id?: string | null;
  species_roster_id?: string | null;
  item_id?: string | null;
  item?: string | null;
  ability_id?: string | null;
  ability?: string | null;
  move_1_id?: string | null;
  move_2_id?: string | null;
  move_3_id?: string | null;
  move_4_id?: string | null;
  moves?: ReadonlyArray<string | null | undefined>;
}
export interface RoleTagTeamView {
  sets?: ReadonlyArray<RoleTagSet>;
}

/** Stage A: classify every saved set on the team. Sets without a species_id
 *  (drafts) are skipped — drafts are filtered upstream in `buildOverview`. */
export function buildRoleAssignments(
  team: UserTeam,
  db: Db,
): Map<string, RoleTagAssignment> {
  const inputs: RoleTagInput[] = [];
  const view = team as unknown as RoleTagTeamView;
  const setsList = view.sets ?? [];
  for (const s of setsList) {
    const speciesId = s.species_id ?? s.species_roster_id ?? null;
    if (!speciesId) continue;
    let baseStats = { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 };
    try {
      const p = roster.get(db, speciesId, "RegM-A");
      if (p) baseStats = p.base_stats;
    } catch { /* synthetic species — fall back to neutral 80s */ }
    const item = s.item_id ?? s.item ?? null;
    const ability = s.ability_id ?? s.ability ?? null;
    const movesRaw: Array<string | null | undefined> = [
      s.move_1_id, s.move_2_id, s.move_3_id, s.move_4_id,
    ];
    if (s.moves) movesRaw.push(...s.moves);
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
