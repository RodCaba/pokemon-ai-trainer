import type { Db } from "./open";
import { moves as movesTable } from "./drizzle-schema";
import { MoveSchema, type Move } from "../schemas/move";
import { createSimpleRepo, parseOrThrow } from "./simple-repo";

interface Row {
  id: string;
  displayName: string;
  type: string;
  category: string;
  basePower: number;
  accuracy: number | null;
  sourceJson: string;
}

const repo = createSimpleRepo<Row, Move>({
  name: "moves",
  table: movesTable,
  idColumn: movesTable.id,
  displayNameColumn: movesTable.displayName,
  rowToEntity: (r) =>
    parseOrThrow(
      MoveSchema,
      {
        schema_version: 1,
        id: r.id,
        display_name: r.displayName,
        type: r.type,
        category: r.category,
        base_power: r.basePower,
        accuracy: r.accuracy,
        source: JSON.parse(r.sourceJson),
      },
      "moves",
      r.id,
    ),
});

/**
 * List every Champions move, sorted by canonical id.
 *
 * @param db — Open Drizzle DB handle.
 * @param format — `"RegM-A"` (forward-compat seam; moves aren't format-scoped).
 * @returns Array of `Move`. Never null.
 * @throws {RosterDbError} On SQLite I/O failure.
 * @throws {RosterDataError} If a stored row fails schema validation.
 *
 * @example
 *   list(db, "RegM-A").length; // ~496
 */
export function list(db: Db, format: "RegM-A"): Move[] {
  return repo.list(db, format);
}

/**
 * Look up a move by Showdown id or display name. Case-insensitive.
 *
 * Display names with hyphens (`"Will-O-Wisp"`) and canonical ids (`"willowisp"`)
 * both resolve via the standard normalization (lowercase, strip non-alphanumeric).
 *
 * @param db — Open Drizzle DB handle.
 * @param name — Showdown id or display name.
 * @param format — `"RegM-A"`.
 * @returns The full `Move` record, or `null` if no match.
 * @throws {RosterDbError} On SQLite I/O failure.
 * @throws {RosterDataError} If a stored row fails schema validation.
 *
 * @example
 *   get(db, "Earthquake", "RegM-A");      // { id:"earthquake", base_power:100, ... }
 *   get(db, "Will-O-Wisp", "RegM-A")?.id; // "willowisp"
 */
export function get(db: Db, name: string, format: "RegM-A"): Move | null {
  return repo.get(db, name, format);
}

/**
 * Boolean existence check.
 *
 * @param db — Open Drizzle DB handle.
 * @param name — Same lookup rules as `get()`.
 * @param format — `"RegM-A"`.
 * @returns `true` iff the move exists in the moves table.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function has(db: Db, name: string, format: "RegM-A"): boolean {
  return repo.has(db, name, format);
}
