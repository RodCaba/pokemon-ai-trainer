/**
 * Bespoke repo for the `team_sets` table. Stage 4 stub — every export
 * throws "not implemented (Stage 5)". Cannot use `createSimpleRepo` per
 * `docs/plans/pokepaste-sets.md` §6.2 (composite PK, multi-table joins,
 * write path).
 */

import type { Db } from "./open";
import type { SetsListFilter, SetsUsageArgs, SetsUsageRow, TeamSet } from "../schemas/team-set";

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
export function list(_db: Db, _filter: SetsListFilter): TeamSet[] {
  throw new Error("not implemented (Stage 5)");
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
export function get(_db: Db, _tournament_team_id: string, _slot: number): TeamSet | null {
  throw new Error("not implemented (Stage 5)");
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
export function usage(_db: Db, _args: SetsUsageArgs): SetsUsageRow[] {
  throw new Error("not implemented (Stage 5)");
}

/**
 * Idempotent upsert of one team's parsed sets in a single transaction.
 *
 * **When to use it:** ingest-only. Re-running the labmaus pipeline
 * produces zero `team_sets` deltas.
 *
 * @param db — Open Drizzle DB handle.
 * @param sets — All sets for one team (≤ 6 entries, unique slots).
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function upsertTeamSets(_db: Db, _sets: TeamSet[]): void {
  throw new Error("not implemented (Stage 5)");
}
