import { and, asc, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import type { Db } from "./open";
import {
  tournaments as tournamentsTable,
  tournamentTeams,
  tournamentTeamSpecies,
} from "./drizzle-schema";
import type {
  TournamentDetail,
  TournamentFilter,
  TournamentResult,
  TournamentTeam,
  TournamentTeamSpecies,
  TeamsWithArgs,
  UsageArgs,
  UsageRow,
} from "../schemas/tournament";
import type { TransformedTournament } from "../tools/labmaus/transform";
import { RosterDbError } from "../schemas/errors";

interface TournamentRow {
  id: string;
  external_id: number;
  tournament_code: string | null;
  name: string;
  organizer: string | null;
  format: string;
  division: string;
  status: string;
  date: string;
  num_players: number;
  num_phase_2: number | null;
  source_site: string;
  source_site_source: string | null;
  source_url: string;
  fetched_at: string;
}

interface TeamRow {
  id: string;
  tournament_id: string;
  external_team_id: number;
  player: string;
  player_key: string;
  country: string | null;
  placement: number | null;
  record: string;
  team_url: string;
  fetched_at: string;
}

interface SpeciesRow {
  team_id: string;
  slot: number;
  labmaus_id: string;
  roster_id: string;
}

function rowToTournament(r: TournamentRow): TournamentResult {
  return {
    schema_version: 1,
    id: r.id,
    external_id: r.external_id,
    tournament_code: r.tournament_code,
    name: r.name,
    organizer: r.organizer,
    format: "RegM-A",
    division: r.division as TournamentResult["division"],
    status: r.status as TournamentResult["status"],
    date: r.date,
    num_players: r.num_players,
    num_phase_2: r.num_phase_2,
    source: {
      schema_version: 1,
      site: "labmaus",
      site_source: r.source_site_source,
      source_url: r.source_url,
      fetched_at: r.fetched_at,
    },
  };
}

function rowToTeam(r: TeamRow): TournamentTeam {
  return {
    schema_version: 1,
    id: r.id,
    tournament_id: r.tournament_id,
    external_team_id: r.external_team_id,
    player: r.player,
    player_key: r.player_key,
    country: r.country,
    placement: r.placement,
    record: r.record,
    team_url: r.team_url,
    fetched_at: r.fetched_at,
  };
}

function rowToSpecies(r: SpeciesRow): TournamentTeamSpecies {
  return {
    team_id: r.team_id,
    slot: r.slot,
    labmaus_id: r.labmaus_id,
    roster_id: r.roster_id,
  };
}

/**
 * List tournaments matching a filter, ordered by `(date DESC, id ASC)`.
 *
 * **When to use it:** the meta-intelligence read path — paginate the recent
 * Reg M-A event window. For one row by id use {@link get}.
 *
 * @param db — Open Drizzle DB handle.
 * @param filter — `format`, optional date window, division, status.
 * @returns Array of {@link TournamentResult}.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function list(db: Db, filter: TournamentFilter): TournamentResult[] {
  try {
    const clauses: SQL[] = [eq(tournamentsTable.format, filter.format)];
    if (filter.date_from !== undefined) clauses.push(gte(tournamentsTable.date, filter.date_from));
    if (filter.date_to !== undefined) clauses.push(lte(tournamentsTable.date, filter.date_to));
    if (filter.division !== undefined) clauses.push(eq(tournamentsTable.division, filter.division));
    if (filter.status !== undefined) clauses.push(eq(tournamentsTable.status, filter.status));

    // Note: ordering by `id ASC` is lexical on `"labmaus:N"`, so for ties on
    // `date` the secondary sort is string-compared. Acceptable for the v1
    // surface (no test pins this); revisit if a date-tie test appears.
    const rows = db
      .select()
      .from(tournamentsTable)
      .where(and(...clauses))
      .orderBy(desc(tournamentsTable.date), asc(tournamentsTable.id))
      .all();
    return rows.map((r) =>
      rowToTournament({
        id: r.id,
        external_id: r.externalId,
        tournament_code: r.tournamentCode,
        name: r.name,
        organizer: r.organizer,
        format: r.format,
        division: r.division,
        status: r.status,
        date: r.date,
        num_players: r.numPlayers,
        num_phase_2: r.numPhase2,
        source_site: r.sourceSite,
        source_site_source: r.sourceSiteSource,
        source_url: r.sourceUrl,
        fetched_at: r.fetchedAt,
      }),
    );
  } catch (e) {
    if (e instanceof RosterDbError) throw e;
    throw new RosterDbError("tournaments.list failed", { cause: e, query: filter });
  }
}

/**
 * Look up one tournament's metadata by id (e.g. `"labmaus:56757"`).
 *
 * @param db — Open Drizzle DB handle.
 * @param id — Namespaced tournament id.
 * @returns The {@link TournamentResult} or `null` if absent.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function get(db: Db, id: string): TournamentResult | null {
  try {
    const row = db.$client
      .prepare(
        `SELECT id, external_id, tournament_code, name, organizer, format, division, status, date,
                num_players, num_phase_2, source_site, source_site_source, source_url, fetched_at
           FROM tournaments WHERE id = ?`,
      )
      .get(id) as TournamentRow | undefined;
    return row ? rowToTournament(row) : null;
  } catch (e) {
    throw new RosterDbError("tournaments.get failed", { cause: e, query: id });
  }
}

/**
 * Look up one tournament's full detail (tournament + teams + species rows).
 *
 * **When to use it:** when the caller materializes the joined view (lead planner
 * evidence, archive UI). For lightweight metadata only use {@link get}.
 *
 * @param db — Open Drizzle DB handle.
 * @param id — Namespaced tournament id.
 * @returns The {@link TournamentDetail} or `null` if absent.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function detail(db: Db, id: string): TournamentDetail | null {
  try {
    const t = get(db, id);
    if (t === null) return null;
    const teams = db.$client
      .prepare(
        `SELECT id, tournament_id, external_team_id, player, player_key, country, placement,
                record, team_url, fetched_at
           FROM tournament_teams WHERE tournament_id = ?
          ORDER BY (placement IS NULL), placement, external_team_id`,
      )
      .all(id) as TeamRow[];
    const species = db.$client
      .prepare(
        `SELECT s.team_id AS team_id, s.slot AS slot, s.labmaus_id AS labmaus_id, s.roster_id AS roster_id
           FROM tournament_team_species s
           JOIN tournament_teams t ON t.id = s.team_id
          WHERE t.tournament_id = ?
          ORDER BY s.team_id, s.slot`,
      )
      .all(id) as SpeciesRow[];
    return { tournament: t, teams: teams.map(rowToTeam), species: species.map(rowToSpecies) };
  } catch (e) {
    if (e instanceof RosterDbError) throw e;
    throw new RosterDbError("tournaments.detail failed", { cause: e, query: id });
  }
}

/**
 * Return teams that contain ALL of the given canonical roster ids
 * (set-intersection on `tournament_team_species.roster_id`).
 *
 * **When to use it:** the lead planner's "show me recent teams that paired
 * Sneasler with Kingambit" query.
 *
 * @param db — Open Drizzle DB handle.
 * @param args — `species` (≥1, ≤6), optional `lookback_days`, `min_placement`.
 * @returns Array of {@link TournamentTeam}, ordered by placement (NULLS LAST).
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function teams_with(db: Db, args: TeamsWithArgs): TournamentTeam[] {
  try {
    const placeholders = args.species.map(() => "?").join(",");
    const params: unknown[] = [...args.species, args.species.length, args.format];
    let sqlText = `
      SELECT t.id, t.tournament_id, t.external_team_id, t.player, t.player_key, t.country,
             t.placement, t.record, t.team_url, t.fetched_at
        FROM tournament_teams t
        JOIN tournaments tn ON tn.id = t.tournament_id
       WHERE t.id IN (
         SELECT team_id FROM tournament_team_species
          WHERE roster_id IN (${placeholders})
          GROUP BY team_id
         HAVING COUNT(DISTINCT roster_id) = ?
       )
         AND tn.format = ?`;
    if (args.lookback_days !== undefined) {
      sqlText += ` AND tn.date >= date('now', ?)`;
      params.push(`-${args.lookback_days} days`);
    }
    if (args.min_placement !== undefined) {
      sqlText += ` AND t.placement IS NOT NULL AND t.placement <= ?`;
      params.push(args.min_placement);
    }
    sqlText += ` ORDER BY (t.placement IS NULL), t.placement, t.id`;
    const rows = db.$client.prepare(sqlText).all(...params) as TeamRow[];
    return rows.map(rowToTeam);
  } catch (e) {
    throw new RosterDbError("tournaments.teams_with failed", { cause: e, query: args });
  }
}

/**
 * Aggregate usage rows for a window: per-species, per-item, per-move, or per-core.
 *
 * **When to use it:** the meta-intelligence "what's hot" surface. Item/move
 * dimensions require the parallel pokepaste-sets slice's `team_sets` table
 * (not available in this slice — those kinds return an empty array).
 *
 * @param db — Open Drizzle DB handle.
 * @param args — `format`, `lookback_days`, `weight_by`, `kind`.
 * @returns Array of {@link UsageRow}, sorted by `usage_percent DESC`.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function usage(db: Db, args: UsageArgs): UsageRow[] {
  try {
    const totalRow = db.$client
      .prepare(
        `SELECT COUNT(*) AS n
           FROM tournament_teams t
           JOIN tournaments tn ON tn.id = t.tournament_id
          WHERE tn.format = ?
            AND tn.date >= date('now', ?)`,
      )
      .get(args.format, `-${args.lookback_days} days`) as { n: number };
    const totalTeams = totalRow.n;

    if (args.kind === "item") {
      // LEFT JOIN through team_sets (owned by the pokepaste-sets slice). When
      // team_sets is empty (pokepaste hasn't ingested yet), this returns [].
      const rows = db.$client
        .prepare(
          `SELECT ts.item AS item, COUNT(*) AS n,
                  GROUP_CONCAT(DISTINCT tn.id) AS tournament_ids
             FROM team_sets ts
             JOIN tournament_teams t ON t.id = ts.tournament_team_id
             JOIN tournaments tn ON tn.id = t.tournament_id
            WHERE tn.format = ?
              AND tn.date >= date('now', ?)
              AND ts.item IS NOT NULL
            GROUP BY ts.item
            ORDER BY n DESC, ts.item`,
        )
        .all(args.format, `-${args.lookback_days} days`) as Array<{
          item: string;
          n: number;
          tournament_ids: string | null;
        }>;
      return rows.map((r): UsageRow => ({
        kind: "item",
        key: r.item,
        display_label: r.item,
        appearances: r.n,
        total_teams: totalTeams,
        usage_percent: totalTeams > 0 ? (100 * r.n) / totalTeams : 0,
        citations: r.tournament_ids ? r.tournament_ids.split(",") : [],
      }));
    }

    if (args.kind === "move") {
      // Expand moves_json via json_each so each move gets its own row. Same
      // graceful-empty contract as kind="item".
      const rows = db.$client
        .prepare(
          `SELECT j.value AS move, COUNT(*) AS n,
                  GROUP_CONCAT(DISTINCT tn.id) AS tournament_ids
             FROM team_sets ts
             JOIN tournament_teams t ON t.id = ts.tournament_team_id
             JOIN tournaments tn ON tn.id = t.tournament_id,
                  json_each(ts.moves_json) j
            WHERE tn.format = ?
              AND tn.date >= date('now', ?)
            GROUP BY j.value
            ORDER BY n DESC, j.value`,
        )
        .all(args.format, `-${args.lookback_days} days`) as Array<{
          move: string;
          n: number;
          tournament_ids: string | null;
        }>;
      return rows.map((r): UsageRow => ({
        kind: "move",
        key: r.move,
        display_label: r.move,
        appearances: r.n,
        total_teams: totalTeams,
        usage_percent: totalTeams > 0 ? (100 * r.n) / totalTeams : 0,
        citations: r.tournament_ids ? r.tournament_ids.split(",") : [],
      }));
    }

    if (args.kind === "core") {
      // TODO(stage6-deferred): plan §6 restricts to 2-mon; 3-/4-mon cores need a new flow doc
      // (see docs/reviews/labmaus-tournaments.md §9).
      const rows = db.$client
        .prepare(
          `SELECT s1.roster_id AS a, s2.roster_id AS b, COUNT(*) AS n,
                  GROUP_CONCAT(DISTINCT tn.id) AS tournament_ids
             FROM tournament_team_species s1
             JOIN tournament_team_species s2 ON s1.team_id = s2.team_id AND s1.roster_id < s2.roster_id
             JOIN tournament_teams t ON t.id = s1.team_id
             JOIN tournaments tn ON tn.id = t.tournament_id
            WHERE tn.format = ?
              AND tn.date >= date('now', ?)
            GROUP BY s1.roster_id, s2.roster_id
            ORDER BY n DESC, s1.roster_id, s2.roster_id`,
        )
        .all(args.format, `-${args.lookback_days} days`) as Array<{
          a: string;
          b: string;
          n: number;
          tournament_ids: string | null;
        }>;
      return rows.map((r): UsageRow => ({
        kind: "core",
        key: `${r.a}+${r.b}`,
        display_label: `${r.a} + ${r.b}`,
        appearances: r.n,
        total_teams: totalTeams,
        usage_percent: totalTeams > 0 ? (100 * r.n) / totalTeams : 0,
        citations: r.tournament_ids ? r.tournament_ids.split(",") : [],
      }));
    }

    // species
    const rows = db.$client
      .prepare(
        `SELECT s.roster_id AS roster_id, COUNT(*) AS n,
                GROUP_CONCAT(DISTINCT tn.id) AS tournament_ids
           FROM tournament_team_species s
           JOIN tournament_teams t ON t.id = s.team_id
           JOIN tournaments tn ON tn.id = t.tournament_id
          WHERE tn.format = ?
            AND tn.date >= date('now', ?)
          GROUP BY s.roster_id
          ORDER BY n DESC, s.roster_id`,
      )
      .all(args.format, `-${args.lookback_days} days`) as Array<{
        roster_id: string;
        n: number;
        tournament_ids: string | null;
      }>;
    return rows.map((r): UsageRow => ({
      kind: "species",
      key: r.roster_id,
      display_label: r.roster_id,
      appearances: r.n,
      total_teams: totalTeams,
      usage_percent: totalTeams > 0 ? (100 * r.n) / totalTeams : 0,
      citations: r.tournament_ids ? r.tournament_ids.split(",") : [],
    }));
  } catch (e) {
    throw new RosterDbError("tournaments.usage failed", { cause: e, query: args });
  }
}

/**
 * Idempotent upsert of one transformed tournament + its teams + species rows
 * inside a single transaction.
 *
 * **When to use it:** ingest-only. Two consecutive calls with the same payload
 * produce zero row deltas.
 *
 * @param db — Open Drizzle DB handle (writable).
 * @param t — Output of `transformTournament`.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function upsertTournament(db: Db, t: TransformedTournament): void {
  try {
    db.$client.transaction(() => {
      // Upsert tournament
      db.insert(tournamentsTable)
        .values({
          id: t.tournament.id,
          externalId: t.tournament.external_id,
          tournamentCode: t.tournament.tournament_code,
          name: t.tournament.name,
          organizer: t.tournament.organizer,
          format: t.tournament.format,
          division: t.tournament.division,
          status: t.tournament.status,
          date: t.tournament.date,
          numPlayers: t.tournament.num_players,
          numPhase2: t.tournament.num_phase_2,
          sourceSite: t.tournament.source.site,
          sourceSiteSource: t.tournament.source.site_source,
          sourceUrl: t.tournament.source.source_url,
          fetchedAt: t.tournament.source.fetched_at,
        })
        .onConflictDoUpdate({
          target: tournamentsTable.id,
          set: {
            externalId: t.tournament.external_id,
            tournamentCode: t.tournament.tournament_code,
            name: t.tournament.name,
            organizer: t.tournament.organizer,
            format: t.tournament.format,
            division: t.tournament.division,
            status: t.tournament.status,
            date: t.tournament.date,
            numPlayers: t.tournament.num_players,
            numPhase2: t.tournament.num_phase_2,
            sourceSite: t.tournament.source.site,
            sourceSiteSource: t.tournament.source.site_source,
            sourceUrl: t.tournament.source.source_url,
            fetchedAt: t.tournament.source.fetched_at,
          },
        })
        .run();

      // Wipe + reinsert teams (cascades to species). Simpler than per-team upsert.
      db.delete(tournamentTeams).where(eq(tournamentTeams.tournamentId, t.tournament.id)).run();

      for (const tm of t.teams) {
        db.insert(tournamentTeams)
          .values({
            id: tm.id,
            tournamentId: tm.tournament_id,
            externalTeamId: tm.external_team_id,
            player: tm.player,
            playerKey: tm.player_key,
            country: tm.country,
            placement: tm.placement,
            record: tm.record,
            teamUrl: tm.team_url,
            fetchedAt: tm.fetched_at,
          })
          .run();
      }

      for (const sp of t.species) {
        db.insert(tournamentTeamSpecies)
          .values({
            teamId: sp.team_id,
            slot: sp.slot,
            labmausId: sp.labmaus_id,
            rosterId: sp.roster_id,
          })
          .run();
      }
    })();
  } catch (e) {
    throw new RosterDbError("tournaments.upsertTournament failed", { cause: e, query: t.tournament.id });
  }
}

/**
 * Recompute per-species usage for one tournament (cross-check support).
 *
 * **When to use it:** ingest-time cross-check against labmaus's own `pokemon[]`
 * aggregate. Returns the same shape as {@link usage} restricted to one tournament.
 *
 * @param db — Open Drizzle DB handle.
 * @param tournamentId — Namespaced id.
 * @returns Per-species usage rows for that tournament.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function recomputeAggregatesForTournament(db: Db, tournamentId: string): UsageRow[] {
  try {
    const totalRow = db.$client
      .prepare(`SELECT COUNT(*) AS n FROM tournament_teams WHERE tournament_id = ?`)
      .get(tournamentId) as { n: number };
    const totalTeams = totalRow.n;
    const rows = db.$client
      .prepare(
        `SELECT s.roster_id AS roster_id, COUNT(*) AS n
           FROM tournament_team_species s
           JOIN tournament_teams t ON t.id = s.team_id
          WHERE t.tournament_id = ?
          GROUP BY s.roster_id
          ORDER BY n DESC, s.roster_id`,
      )
      .all(tournamentId) as Array<{ roster_id: string; n: number }>;
    return rows.map((r): UsageRow => ({
      kind: "species",
      key: r.roster_id,
      display_label: r.roster_id,
      appearances: r.n,
      total_teams: totalTeams,
      usage_percent: totalTeams > 0 ? (100 * r.n) / totalTeams : 0,
      citations: [tournamentId],
    }));
  } catch (e) {
    throw new RosterDbError("tournaments.recomputeAggregatesForTournament failed", {
      cause: e,
      query: tournamentId,
    });
  }
}

