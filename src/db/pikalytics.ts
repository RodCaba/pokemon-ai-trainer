/**
 * Bespoke `pikalytics_snapshots` repo. Per `docs/plans/pikalytics.md` §6 the
 * factory pattern (`createSimpleRepo`) doesn't fit:
 *   - lookups are by `species_roster_id` returning the *latest* row (composite
 *     key `(species, as_of)` resolved via `ORDER BY as_of DESC LIMIT 1`);
 *   - `teammates` and `usage(dimension="teammate")` expand a JSON column via
 *     `json_each(teammates_json)` and rank;
 *   - `usage` discriminates on `dimension` and joins through different JSON
 *     columns.
 */

import type { Db } from "./open";
import {
  PikalyticsSnapshotSchema,
  type PikalyticsSnapshot,
  type PikalyticsTeammatesArgs,
  type PikalyticsUsageArgs,
  type PikalyticsUsageRow,
  type TeammateEntry,
} from "../schemas/pikalytics";
import { RosterDbError } from "../schemas/errors";

interface SnapshotRow {
  id: string;
  format: string;
  format_slug: string;
  species_roster_id: string;
  as_of: string;
  usage_percent: number | null;
  teammates_json: string;
  items_json: string;
  abilities_json: string;
  moves_json: string;
  sample_size: number | null;
  source_url: string;
  ai_url: string;
  fetched_at: string;
}

function rowToSnapshot(row: SnapshotRow): PikalyticsSnapshot {
  return PikalyticsSnapshotSchema.parse({
    schema_version: 1,
    id: row.id,
    format: row.format,
    format_slug: row.format_slug,
    species_roster_id: row.species_roster_id,
    as_of: row.as_of,
    usage_percent: row.usage_percent,
    teammates: JSON.parse(row.teammates_json),
    items: JSON.parse(row.items_json),
    abilities: JSON.parse(row.abilities_json),
    moves: JSON.parse(row.moves_json),
    sample_size: row.sample_size,
    source: {
      site: "pikalytics",
      source_url: row.source_url,
      ai_url: row.ai_url,
      fetched_at: row.fetched_at,
    },
  });
}

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
export function get(
  db: Db,
  args: { species_roster_id: string },
): PikalyticsSnapshot | null {
  try {
    const row = db.$client
      .prepare(
        "SELECT * FROM pikalytics_snapshots WHERE species_roster_id = ? ORDER BY as_of DESC LIMIT 1",
      )
      .get(args.species_roster_id) as SnapshotRow | undefined;
    return row ? rowToSnapshot(row) : null;
  } catch (e) {
    throw new RosterDbError("pikalytics.get failed", { cause: e, query: args });
  }
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
export function teammates(
  db: Db,
  args: PikalyticsTeammatesArgs,
): TeammateEntry[] {
  const limit = args.limit ?? 10;
  const snap = get(db, { species_roster_id: args.species });
  if (!snap) return [];
  // Source-of-truth ranking is the persisted teammates_json itself; we copy +
  // sort to avoid relying on insertion order and respect the limit.
  return snap.teammates
    .slice()
    .sort((a, b) => b.percent - a.percent)
    .slice(0, limit);
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
export function usage(db: Db, args: PikalyticsUsageArgs): PikalyticsUsageRow[] {
  const limit = args.limit ?? 50;
  if (args.dimension === "species") {
    try {
      const rows = db.$client
        .prepare(
          `SELECT species_roster_id, usage_percent, source_url, as_of
           FROM pikalytics_snapshots
           WHERE usage_percent IS NOT NULL
           ORDER BY usage_percent DESC
           LIMIT ?`,
        )
        .all(limit) as Array<{
        species_roster_id: string;
        usage_percent: number;
        source_url: string;
        as_of: string;
      }>;
      return rows.map((r) => ({
        dimension: "species" as const,
        key: r.species_roster_id,
        display_label: r.species_roster_id,
        usage_percent: r.usage_percent,
        source_url: r.source_url,
        as_of: r.as_of,
      }));
    } catch (e) {
      throw new RosterDbError("pikalytics.usage(species) failed", { cause: e, query: args });
    }
  }

  // For non-species dimensions, `species` is required by the schema; we load
  // the latest snapshot and project the relevant array.
  if (!args.species) {
    return [];
  }
  const snap = get(db, { species_roster_id: args.species });
  if (!snap) return [];
  const source_url = snap.source.source_url;
  const as_of = snap.as_of;

  type Dim = "item" | "ability" | "move" | "teammate";
  type Row = { dimension: Dim; key: string; display_label: string; percent: number };
  let raw: Row[] = [];
  const dim: Dim = args.dimension;
  if (dim === "teammate") {
    raw = snap.teammates.map((t) => ({
      dimension: dim,
      key: t.roster_id,
      display_label: t.roster_id,
      percent: t.percent,
    }));
  } else if (dim === "item") {
    raw = snap.items.map((t) => ({
      dimension: dim,
      key: t.name,
      display_label: t.name,
      percent: t.percent,
    }));
  } else if (dim === "ability") {
    raw = snap.abilities.map((t) => ({
      dimension: dim,
      key: t.name,
      display_label: t.name,
      percent: t.percent,
    }));
  } else if (dim === "move") {
    raw = snap.moves.map((t) => ({
      dimension: dim,
      key: t.name,
      display_label: t.name,
      percent: t.percent,
    }));
  }

  return raw
    .sort((a, b) => b.percent - a.percent)
    .slice(0, limit)
    .map((r) => ({
      dimension: r.dimension,
      key: r.key,
      display_label: r.display_label,
      usage_percent: r.percent,
      source_url,
      as_of,
    }));
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
export function upsertSnapshot(
  db: Db,
  snapshot: PikalyticsSnapshot,
): { inserted: boolean } {
  try {
    const result = db.$client
      .prepare(
        `INSERT INTO pikalytics_snapshots
          (id, format, format_slug, species_roster_id, as_of, usage_percent,
           teammates_json, items_json, abilities_json, moves_json, sample_size,
           source_url, ai_url, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(species_roster_id, as_of) DO NOTHING`,
      )
      .run(
        snapshot.id,
        snapshot.format,
        snapshot.format_slug,
        snapshot.species_roster_id,
        snapshot.as_of,
        snapshot.usage_percent,
        JSON.stringify(snapshot.teammates),
        JSON.stringify(snapshot.items),
        JSON.stringify(snapshot.abilities),
        JSON.stringify(snapshot.moves),
        snapshot.sample_size,
        snapshot.source.source_url,
        snapshot.source.ai_url,
        snapshot.source.fetched_at,
      );
    return { inserted: result.changes > 0 };
  } catch (e) {
    throw new RosterDbError("pikalytics.upsertSnapshot failed", {
      cause: e,
      query: { id: snapshot.id },
    });
  }
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
export function exists(
  db: Db,
  species_roster_id: string,
  as_of: string,
): boolean {
  try {
    const row = db.$client
      .prepare(
        "SELECT 1 FROM pikalytics_snapshots WHERE species_roster_id = ? AND as_of = ? LIMIT 1",
      )
      .get(species_roster_id, as_of);
    return row !== undefined;
  } catch (e) {
    throw new RosterDbError("pikalytics.exists failed", {
      cause: e,
      query: { species_roster_id, as_of },
    });
  }
}
