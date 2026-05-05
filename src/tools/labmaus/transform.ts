import type {
  LabmausRawTournament,
  TournamentResult,
  TournamentTeam,
  TournamentTeamSpecies,
} from "../../schemas/tournament";
import { labmausIdToRosterIdOrThrow, type SpeciesMapDeps } from "./species-map";

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
 * - Generates `player_key = trim(lower(player))`.
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
  const overview = raw.overview;
  const tournamentId = `labmaus:${overview.id}`;
  const sourceUrl = `https://labmaus.net/tournaments/${overview.id}`;

  const tournament: TournamentResult = {
    schema_version: 1,
    id: tournamentId,
    external_id: overview.id,
    tournament_code: overview.tournament_code,
    name: overview.name,
    organizer: overview.organizer,
    format: "RegM-A",
    division: overview.division,
    status: overview.status,
    date: overview.date,
    num_players: overview.num_players,
    num_phase_2: overview.num_phase_2,
    source: {
      schema_version: 1,
      site: "labmaus",
      site_source: overview.source ?? null,
      source_url: sourceUrl,
      fetched_at: fetchedAt,
    },
  };

  const teams: TournamentTeam[] = [];
  const species: TournamentTeamSpecies[] = [];

  // Build display-name lookup per team from the comma-separated team_names field.
  for (const rt of raw.teams) {
    const teamId = `${tournamentId}:${rt.id}`;
    const displayNames = rt.team_names.split(",").map((s) => s.trim());

    teams.push({
      schema_version: 1,
      id: teamId,
      tournament_id: tournamentId,
      external_team_id: rt.id,
      player: rt.player,
      player_key: rt.player.trim().toLowerCase(),
      country: rt.country,
      placement: rt.placement,
      record: rt.record,
      team_url: rt.team_url,
      fetched_at: fetchedAt,
    });

    for (let slot = 0; slot < 6; slot++) {
      const labmausId = rt.team[slot] as string;
      const displayName = displayNames[slot] ?? null;
      const rosterId = labmausIdToRosterIdOrThrow(labmausId, displayName, deps);
      species.push({
        team_id: teamId,
        slot,
        labmaus_id: labmausId,
        roster_id: rosterId,
      });
    }
  }

  return { tournament, teams, species };
}
