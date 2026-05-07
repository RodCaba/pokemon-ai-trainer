/**
 * Bespoke repo for the `team_sets` table. Cannot use `createSimpleRepo`
 * per `docs/plans/pokepaste-sets.md` §6.2 (composite PK, multi-table joins,
 * write path).
 */

import type { Db } from "./open";
import {
  TeamSetSchema,
  type SetsListFilter,
  type SetsUsageArgs,
  type SetsUsageRow,
  type Sps,
  type Ivs,
  type TeamSet,
} from "../schemas/team-set";
import { RosterDbError } from "../schemas/errors";

interface TeamSetRow {
  tournament_team_id: string;
  slot: number;
  species_roster_id: string;
  item: string | null;
  ability: string | null;
  level: number | null;
  moves_json: string;
  sps_json: string | null;
  ivs_json: string | null;
  nature: string | null;
  completeness: string;
  source_site: string;
  source_paste_id: string;
  source_url: string;
  fetched_at: string;
}

function rowToTeamSet(r: TeamSetRow): TeamSet {
  const moves = JSON.parse(r.moves_json) as string[];
  const sps = r.sps_json ? (JSON.parse(r.sps_json) as Sps) : null;
  const ivs = r.ivs_json ? (JSON.parse(r.ivs_json) as Ivs) : null;
  const candidate = {
    schema_version: 1,
    id: `${r.tournament_team_id}:${r.slot}`,
    tournament_team_id: r.tournament_team_id,
    slot: r.slot,
    species_roster_id: r.species_roster_id,
    item: r.item,
    ability: r.ability,
    level: r.level,
    moves,
    sps,
    ivs,
    nature: r.nature,
    completeness: r.completeness,
    source: {
      schema_version: 1 as const,
      site: "pokepaste" as const,
      paste_id: r.source_paste_id,
      source_url: r.source_url,
      fetched_at: r.fetched_at,
    },
  };
  return TeamSetSchema.parse(candidate);
}

/**
 * List parsed sets matching the filter.
 *
 * **When to use it:** enumerate the actual builds behind a tournament's
 * placing teams. For one set use {@link get}; for ranking dimensions use
 * {@link usage}.
 *
 * @param db — Open Drizzle DB handle.
 * @param filter — At least one of `tournament_id` / `tournament_team_id`
 *   / `species_roster_id` must be provided.
 * @returns Array of {@link TeamSet}, ordered by `(tournament_team_id, slot)`.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function list(db: Db, filter: SetsListFilter): TeamSet[] {
  try {
    const params: unknown[] = [];
    const where: string[] = [];
    let join = "";
    if (filter.tournament_id !== undefined) {
      join = " JOIN tournament_teams tt ON tt.id = ts.tournament_team_id";
      where.push("tt.tournament_id = ?");
      params.push(filter.tournament_id);
    }
    if (filter.tournament_team_id !== undefined) {
      where.push("ts.tournament_team_id = ?");
      params.push(filter.tournament_team_id);
    }
    if (filter.species_roster_id !== undefined) {
      where.push("ts.species_roster_id = ?");
      params.push(filter.species_roster_id);
    }
    const sql = `
      SELECT ts.tournament_team_id, ts.slot, ts.species_roster_id, ts.item,
             ts.ability, ts.level, ts.moves_json, ts.sps_json, ts.ivs_json,
             ts.nature, ts.completeness, ts.source_site, ts.source_paste_id,
             ts.source_url, ts.fetched_at
        FROM team_sets ts${join}
       WHERE ${where.join(" AND ")}
       ORDER BY ts.tournament_team_id, ts.slot`;
    const rows = db.$client.prepare(sql).all(...params) as TeamSetRow[];
    return rows.map(rowToTeamSet);
  } catch (e) {
    if (e instanceof RosterDbError) throw e;
    throw new RosterDbError("sets.list failed", { cause: e, query: filter });
  }
}

/**
 * Look up one set by composite key.
 *
 * @param db — Open Drizzle DB handle.
 * @param tournament_team_id — `"labmaus:<tid>:<extTid>"`.
 * @param slot — 0..5, matches labmaus species order.
 * @returns The `TeamSet` or `null` if absent.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function get(db: Db, tournament_team_id: string, slot: number): TeamSet | null {
  try {
    const row = db.$client
      .prepare(
        `SELECT tournament_team_id, slot, species_roster_id, item, ability, level,
                moves_json, sps_json, ivs_json, nature, completeness,
                source_site, source_paste_id, source_url, fetched_at
           FROM team_sets WHERE tournament_team_id = ? AND slot = ?`,
      )
      .get(tournament_team_id, slot) as TeamSetRow | undefined;
    return row ? rowToTeamSet(row) : null;
  } catch (e) {
    throw new RosterDbError("sets.get failed", {
      cause: e,
      query: { tournament_team_id, slot },
    });
  }
}

interface UsageAggRow {
  key: string;
  appearances: number;
  total_sets: number;
  citations_csv: string;
}

/**
 * Rank items / abilities / moves / natures for a species across a date
 * window.
 *
 * **When to use it:** the meta-intelligence "what's species X running?"
 * surface, grounded in placing-team paste data (not Pikalytics).
 *
 * @param db — Open Drizzle DB handle.
 * @param args — Species + format + lookback_days + dimension.
 * @returns Array of {@link SetsUsageRow}, sorted by usage_percent DESC.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function usage(db: Db, args: SetsUsageArgs): SetsUsageRow[] {
  try {
    const lookback = `-${args.lookback_days} days`;

    let valueExpr: string;
    let extraJoin = "";
    let groupCol: string;
    if (args.dimension === "item") {
      valueExpr = "ts.item";
      groupCol = "ts.item";
    } else if (args.dimension === "ability") {
      valueExpr = "ts.ability";
      groupCol = "ts.ability";
    } else if (args.dimension === "nature") {
      valueExpr = "ts.nature";
      groupCol = "ts.nature";
    } else {
      // move — expand JSON array via json_each
      extraJoin = ", json_each(ts.moves_json) je";
      valueExpr = "je.value";
      groupCol = "je.value";
    }

    const sql = `
      WITH scoped AS (
        SELECT ts.tournament_team_id, ts.slot, ts.item, ts.ability, ts.nature,
               ts.moves_json
          FROM team_sets ts
          JOIN tournament_teams tt ON tt.id = ts.tournament_team_id
          JOIN tournaments tn ON tn.id = tt.tournament_id
         WHERE ts.species_roster_id = ?
           AND tn.format = ?
           AND tn.date >= date('now', ?)
      ),
      total AS (SELECT COUNT(*) AS n FROM scoped)
      SELECT ${valueExpr} AS key,
             COUNT(*) AS appearances,
             (SELECT n FROM total) AS total_sets,
             COALESCE(GROUP_CONCAT(DISTINCT ts.tournament_team_id), '') AS citations_csv
        FROM scoped ts${extraJoin}
       WHERE ${valueExpr} IS NOT NULL
       GROUP BY ${groupCol}
       ORDER BY appearances DESC, key ASC`;
    const rows = db.$client
      .prepare(sql)
      .all(args.species, args.format, lookback) as UsageAggRow[];
    return rows.map((r) => {
      const totalSets = r.total_sets;
      const usagePercent = totalSets > 0 ? (100 * r.appearances) / totalSets : 0;
      const citations = r.citations_csv
        ? r.citations_csv.split(",").slice(0, 50)
        : [];
      return {
        dimension: args.dimension,
        key: r.key,
        display_label: r.key,
        appearances: r.appearances,
        total_sets: totalSets,
        usage_percent: usagePercent,
        citations,
      };
    });
  } catch (e) {
    throw new RosterDbError("sets.usage failed", { cause: e, query: args });
  }
}

/**
 * Idempotent insert of one team's parsed sets in a single transaction.
 *
 * **When to use it:** ingest-only. Re-running the labmaus pipeline
 * produces zero `team_sets` deltas.
 *
 * **Skip-existing semantics (2026-05-04):** uses `ON CONFLICT DO NOTHING`.
 * Pokepaste URLs are content-addressed (the paste id is a hex hash) — the
 * same paste id always produces the same Showdown export. A conflict on
 * `(tournament_team_id, slot)` therefore means we already have the right
 * rows; no point in overwriting them. The hook in `pokepaste-hook.ts` also
 * guards with a `sets.list(...).length > 0` check before fetching, so the
 * conflict path is belt-and-braces.
 *
 * Previously this function used `ON CONFLICT DO UPDATE` for every column,
 * which would happily clobber a finalized row's parsed fields with a
 * re-fetched copy. The new contract: first-write wins.
 *
 * @param db — Open Drizzle DB handle.
 * @param sets — All sets for one team (≤ 6 entries, unique slots).
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function upsertTeamSets(db: Db, sets: TeamSet[]): void {
  try {
    const stmt = db.$client.prepare(
      `INSERT INTO team_sets
         (tournament_team_id, slot, species_roster_id, item, ability, level,
          moves_json, sps_json, ivs_json, nature, completeness,
          source_site, source_paste_id, source_url, fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(tournament_team_id, slot) DO NOTHING`,
    );
    const tx = db.$client.transaction((rows: TeamSet[]) => {
      for (const s of rows) {
        stmt.run(
          s.tournament_team_id,
          s.slot,
          s.species_roster_id,
          s.item,
          s.ability,
          s.level,
          JSON.stringify(s.moves),
          s.sps ? JSON.stringify(s.sps) : null,
          s.ivs ? JSON.stringify(s.ivs) : null,
          s.nature,
          s.completeness,
          s.source.site,
          s.source.paste_id,
          s.source.source_url,
          s.source.fetched_at,
        );
      }
    });
    tx(sets);
  } catch (e) {
    throw new RosterDbError("sets.upsertTeamSets failed", { cause: e });
  }
}
