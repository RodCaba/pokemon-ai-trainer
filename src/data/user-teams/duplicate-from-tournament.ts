/**
 * Adapter: clone a tournament_teams row + its 6 team_sets / fallback
 * tournament_team_species rows into a `UserTeam` partial.
 *
 * Stage-4 stub. Stage 5 wires per `docs/plans/user-teams.md` §2.3.
 */

import type { Db } from "../../db/open";
import type { UserTeam } from "../../schemas/user-teams";

export interface DuplicateResult {
  team: Omit<UserTeam, "id" | "created_at" | "updated_at" | "schema_version">;
  source_tournament_team_id: string;
}

/**
 * Clone a tournament team into a fresh draft `UserTeam`.
 *
 * **When to use it:** `from-tournament` CLI subcommand; future "duplicate"
 * UI. The source rows are not mutated.
 *
 * @param db — Open Drizzle handle.
 * @param tournamentTeamId — `"labmaus:<tid>:<extTid>"`.
 * @returns `{ team, source_tournament_team_id }`.
 * @throws {UserTeamNotFoundError} If the tournament_team_id doesn't exist.
 * @throws {RosterDbError} On SQLite I/O failure.
 *
 * @example
 *   const r = duplicateFromTournament(db, "labmaus:56757:1");
 */
export function duplicateFromTournament(
  _db: Db,
  _tournamentTeamId: string,
): DuplicateResult {
  throw new Error(
    "not implemented (Stage 5): src/data/user-teams/duplicate-from-tournament.ts::duplicateFromTournament",
  );
}
