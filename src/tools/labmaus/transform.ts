import type {
  LabmausRawTournament,
  TournamentResult,
  TournamentTeam,
  TournamentTeamSpecies,
} from "../../schemas/tournament";

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
 * - Records labmaus dex ids per slot. Canonical roster attribution is owned
 *   by the parallel `pokepaste-sets` slice via `team_sets.species_roster_id`.
 *
 * @param raw — Validated raw labmaus tournament payload.
 * @param fetchedAt — ISO-8601 UTC string injected by the caller (so tests are
 *   deterministic).
 * @returns A {@link TransformedTournament} with one tournament + N teams + 6N species rows.
 */
export function transformTournament(
  raw: LabmausRawTournament,
  fetchedAt: string,
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

  for (const rt of raw.teams) {
    const teamId = `${tournamentId}:${rt.id}`;

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
      species.push({
        team_id: teamId,
        slot,
        labmaus_id: labmausId,
      });
    }
  }

  return { tournament, teams, species };
}
