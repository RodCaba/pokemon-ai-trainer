/**
 * Adapter: clone a tournament_teams row into a `UserTeam` partial.
 *
 * Reads `team_sets` first; falls back to `tournament_team_species` when
 * no team_sets exist (the labmaus-only path before pokepaste-sets has
 * resolved its paste). Original rows are not mutated. See
 * `docs/plans/user-teams.md` §2 + flow §2.3.
 */

import type { Db } from "../../db/open";
import {
  RosterDbError,
  UserTeamNotFoundError,
} from "../../schemas/errors";
import type { UserSet, UserTeam } from "../../schemas/user-teams";

export interface DuplicateResult {
  team: Omit<UserTeam, "id" | "created_at" | "updated_at" | "schema_version">;
  source_tournament_team_id: string;
}

interface TeamSetRow {
  slot: number;
  species_roster_id: string;
  item: string | null;
  ability: string | null;
  moves_json: string;
  sps_json: string | null;
  nature: string | null;
}

interface TournamentTeamSpeciesRow {
  slot: number;
  labmaus_id: string;
}

function emptySet(slot: number): UserSet {
  return {
    slot,
    species_id: null,
    nickname: null,
    item_id: null,
    ability_id: null,
    nature: null,
    hp_sps: 0,
    atk_sps: 0,
    def_sps: 0,
    spa_sps: 0,
    spd_sps: 0,
    spe_sps: 0,
    move_1_id: null,
    move_2_id: null,
    move_3_id: null,
    move_4_id: null,
    notes: null,
  };
}

/**
 * Clone a tournament team into a fresh draft `UserTeam`.
 *
 * **When to use it:** `from-tournament` CLI subcommand and the future
 * "duplicate" UI surface. The source rows are not mutated.
 *
 * @param db — Open Drizzle handle.
 * @param tournamentTeamId — `"labmaus:<tid>:<extTid>"` style id.
 * @returns `{ team, source_tournament_team_id }`. The team has six slots;
 *   slots without source data are empty placeholders. `origin` is
 *   `"duplicated_from_tournament"` and `source_tournament_team_id` is set.
 * @throws {UserTeamNotFoundError} If no `tournament_teams` row matches.
 * @throws {RosterDbError} On SQLite I/O failure.
 *
 * @example
 *   const r = duplicateFromTournament(db, "labmaus:56757:1");
 *   // r.team is ready to pass to userTeams.create.
 */
export function duplicateFromTournament(
  db: Db,
  tournamentTeamId: string,
): DuplicateResult {
  let parent: { id: string } | undefined;
  try {
    parent = db.$client
      .prepare("SELECT id FROM tournament_teams WHERE id = ?")
      .get(tournamentTeamId) as { id: string } | undefined;
  } catch (e) {
    throw new RosterDbError(
      `failed to read tournament_teams for ${tournamentTeamId}`,
      { cause: e, query: tournamentTeamId },
    );
  }
  if (!parent) {
    throw new UserTeamNotFoundError(
      `tournament_team ${tournamentTeamId} not found`,
      { team_id: tournamentTeamId },
    );
  }

  const sets: UserSet[] = [];
  for (let s = 0; s < 6; s++) sets.push(emptySet(s));

  // Primary path: team_sets rows.
  const teamSetRows = db.$client
    .prepare(
      `SELECT slot, species_roster_id, item, ability, moves_json, sps_json, nature
         FROM team_sets WHERE tournament_team_id = ? ORDER BY slot`,
    )
    .all(tournamentTeamId) as TeamSetRow[];

  if (teamSetRows.length > 0) {
    for (const r of teamSetRows) {
      if (r.slot < 0 || r.slot > 5) continue;
      const moves: string[] = JSON.parse(r.moves_json) as string[];
      const sps = r.sps_json
        ? (JSON.parse(r.sps_json) as {
            hp: number;
            atk: number;
            def: number;
            spa: number;
            spd: number;
            spe: number;
          })
        : null;
      sets[r.slot] = {
        slot: r.slot,
        species_id: r.species_roster_id,
        nickname: null,
        item_id: r.item,
        ability_id: r.ability,
        nature: r.nature,
        hp_sps: sps?.hp ?? 0,
        atk_sps: sps?.atk ?? 0,
        def_sps: sps?.def ?? 0,
        spa_sps: sps?.spa ?? 0,
        spd_sps: sps?.spd ?? 0,
        spe_sps: sps?.spe ?? 0,
        move_1_id: moves[0] ?? null,
        move_2_id: moves[1] ?? null,
        move_3_id: moves[2] ?? null,
        move_4_id: moves[3] ?? null,
        notes: null,
      };
    }
  } else {
    // Fallback: tournament_team_species (labmaus's species-id-only signal).
    const speciesRows = db.$client
      .prepare(
        `SELECT slot, labmaus_id FROM tournament_team_species
           WHERE team_id = ? ORDER BY slot`,
      )
      .all(tournamentTeamId) as TournamentTeamSpeciesRow[];
    for (const r of speciesRows) {
      if (r.slot < 0 || r.slot > 5) continue;
      // Resolve labmaus_id → roster id via labmaus_species_map if present;
      // otherwise pass through (validateTeam will surface unknown species).
      let speciesId: string | null = null;
      try {
        const map = db.$client
          .prepare(
            "SELECT roster_id FROM labmaus_species_map WHERE labmaus_id = ?",
          )
          .get(r.labmaus_id) as { roster_id?: string } | undefined;
        speciesId = map?.roster_id ?? r.labmaus_id;
      } catch {
        speciesId = r.labmaus_id;
      }
      sets[r.slot] = { ...emptySet(r.slot), species_id: speciesId };
    }
  }

  const team: DuplicateResult["team"] = {
    name: "Untitled team",
    description: null,
    win_condition: null,
    status: "draft",
    origin: "duplicated_from_tournament",
    origin_payload: null,
    source_tournament_team_id: tournamentTeamId,
    validation_errors: [],
    validation_warnings: [],
    sets: sets as UserTeam["sets"],
  };

  return { team, source_tournament_team_id: tournamentTeamId };
}
