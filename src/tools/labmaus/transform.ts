import type {
  LabmausRawTournament,
  TournamentResult,
  TournamentTeam,
  TournamentTeamSpecies,
} from "../../schemas/tournament";
import type { SpeciesMapDeps } from "./species-map";

/**
 * Output of {@link transformTournament}: the canonical tournament row plus
 * per-team and per-slot species rows ready to upsert.
 */
export interface TransformedTournament {
  tournament: TournamentResult;
  teams: TournamentTeam[];
  /** Flattened, ordered by `(team_id, slot)`. */
  species: TournamentTeamSpecies[];
}

/**
 * Map a validated raw labmaus payload into our domain rows.
 *
 * **When to use it:** inside `getTournament` after the raw response has been
 * validated by `LabmausRawTournamentSchema`, and inside the ingest script
 * before calling `tournaments.upsertTournament`.
 *
 * - Strips Tera fields (defense-in-depth — schema also strips).
 * - Generates `player_key = trim(lower(player))` (plan Q10).
 * - Generates ids: `tournament.id = "labmaus:<external_id>"`,
 *   `team.id = "labmaus:<tournament_external_id>:<team_external_id>"`.
 * - Maps each labmaus dex-id through {@link labmausIdToRosterIdOrThrow}.
 *
 * @param raw — Validated raw labmaus tournament payload.
 * @param fetchedAt — ISO-8601 UTC string injected by the caller (so tests are
 *   deterministic).
 * @param deps — Species-map dependencies (alias repo + db).
 * @returns A {@link TransformedTournament} with one tournament + N teams + 6N species rows.
 * @throws {LabmausUnknownSpeciesError} If any team's labmaus id has no mapping.
 */
export function transformTournament(
  raw: LabmausRawTournament,
  fetchedAt: string,
  deps: SpeciesMapDeps,
): TransformedTournament {
  void raw;
  void fetchedAt;
  void deps;
  throw new Error("not implemented (Stage 5)");
}
