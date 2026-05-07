/**
 * Stage 4 stubs for the bespoke `pikalytics_snapshots` repo. Real bodies land
 * in Stage 5 per `docs/plans/pikalytics.md` §6.
 *
 * Cannot use `createSimpleRepo` per plan §6.2 — composite-keyed-with-LIMIT,
 * JSON-expansion queries, ON CONFLICT semantics on a write path.
 */

import type { Db } from "./open";
import type {
  PikalyticsSnapshot,
  PikalyticsTeammatesArgs,
  PikalyticsUsageArgs,
  PikalyticsUsageRow,
  TeammateEntry,
} from "../schemas/pikalytics";

/**
 * Latest pikalytics snapshot for a species, or `null`.
 *
 * **When to use it:** the `pikalytics.get` agent surface and the `teammates` /
 * `usage` paths' shared internal load. For ranked-list queries use
 * {@link teammates} / {@link usage} directly.
 *
 * @param db — Open Drizzle DB handle.
 * @param args — `{ species_roster_id }`.
 * @returns The latest {@link PikalyticsSnapshot} for the species (highest
 *   `as_of`), or `null` if no row exists.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function get(_db: Db, _args: { species_roster_id: string }): PikalyticsSnapshot | null {
  void _db;
  void _args;
  throw new Error("not implemented (Stage 5): pikalytics.get");
}

/**
 * Top-N teammates for a species, ranked by co-occurrence % descending.
 *
 * **When to use it:** the `pikalytics_teammates` agent surface — answers
 * "what pairs well with X?". For the full snapshot use {@link get}; for
 * non-teammate dimensions use {@link usage}.
 *
 * @param db — Open Drizzle DB handle.
 * @param args — `{ format, species, limit?: number }`. Default limit 10.
 * @returns Array of {@link TeammateEntry}, length ≤ limit, ordered by
 *   `percent DESC`. Empty array if no snapshot exists for the species.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function teammates(_db: Db, _args: PikalyticsTeammatesArgs): TeammateEntry[] {
  void _db;
  void _args;
  throw new Error("not implemented (Stage 5): pikalytics.teammates");
}

/**
 * Rank items / abilities / moves / teammates / overall species by Pikalytics
 * usage %, sourced from the latest persisted snapshot per species.
 *
 * **When to use it:** the `pikalytics_usage` agent surface — multi-dimension
 * usage rankings with citations. For the species-specific teammate ranking,
 * {@link teammates} is the load-bearing equivalent.
 *
 * @param db — Open Drizzle DB handle.
 * @param args — `{ format, dimension, species?, limit? }`. `species` required
 *   when `dimension !== "species"`.
 * @returns Array of {@link PikalyticsUsageRow}, ordered by usage_percent DESC.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function usage(_db: Db, _args: PikalyticsUsageArgs): PikalyticsUsageRow[] {
  void _db;
  void _args;
  throw new Error("not implemented (Stage 5): pikalytics.usage");
}

/**
 * Idempotent insert of one snapshot. Conflict on `(species_roster_id, as_of)`
 * is a DO NOTHING; first-write wins.
 *
 * **When to use it:** ingest-only.
 *
 * @param db — Open Drizzle DB handle (writable).
 * @param snapshot — Validated {@link PikalyticsSnapshot}.
 * @returns `{ inserted: true }` on insert; `{ inserted: false }` on conflict.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function upsertSnapshot(_db: Db, _snapshot: PikalyticsSnapshot): { inserted: boolean } {
  void _db;
  void _snapshot;
  throw new Error("not implemented (Stage 5): pikalytics.upsertSnapshot");
}

/**
 * Cheap existence probe on `(species_roster_id, as_of)` — used by the ingest's
 * skip-existing pre-check.
 *
 * @param db — Open Drizzle DB handle.
 * @param species_roster_id — Canonical roster id.
 * @param as_of — ISO date.
 * @returns `true` iff a row exists.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function exists(_db: Db, _species_roster_id: string, _as_of: string): boolean {
  void _db;
  void _species_roster_id;
  void _as_of;
  throw new Error("not implemented (Stage 5): pikalytics.exists");
}
