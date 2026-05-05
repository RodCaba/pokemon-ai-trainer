import type { Db } from "./open";
import type {
  TournamentDetail,
  TournamentFilter,
  TournamentResult,
  TournamentTeam,
  TeamsWithArgs,
  UsageArgs,
  UsageRow,
} from "../schemas/tournament";
import type { TransformedTournament } from "../tools/labmaus/transform";

const NI = "not implemented (Stage 5)";

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
 * @throws {RosterDataError} If a stored row fails schema validation.
 */
export function list(db: Db, filter: TournamentFilter): TournamentResult[] {
  void db;
  void filter;
  throw new Error(NI);
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
  void db;
  void id;
  throw new Error(NI);
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
  void db;
  void id;
  throw new Error(NI);
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
  void db;
  void args;
  throw new Error(NI);
}

/**
 * Aggregate usage rows for a window: per-species, per-item, per-move, or per-core.
 *
 * **When to use it:** the meta-intelligence "what's hot" surface. Item/move
 * dimensions require the parallel pokepaste-sets slice's `team_sets` table.
 *
 * @param db — Open Drizzle DB handle.
 * @param args — `format`, `lookback_days`, `weight_by`, `kind`.
 * @returns Array of {@link UsageRow}, sorted by `usage_percent DESC`.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function usage(db: Db, args: UsageArgs): UsageRow[] {
  void db;
  void args;
  throw new Error(NI);
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
  void db;
  void t;
  throw new Error(NI);
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
  void db;
  void tournamentId;
  throw new Error(NI);
}
