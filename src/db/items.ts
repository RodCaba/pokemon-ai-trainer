import type { Db } from "./open";
import { items as itemsTable } from "./drizzle-schema";
import { ItemSchema, type Item } from "../schemas/item";
import { createSimpleRepo, parseOrThrow } from "./simple-repo";

interface Row {
  id: string;
  displayName: string;
  category: string;
  sourceJson: string;
}

const repo = createSimpleRepo<Row, Item>({
  name: "items",
  table: itemsTable,
  idColumn: itemsTable.id,
  displayNameColumn: itemsTable.displayName,
  rowToEntity: (r) =>
    parseOrThrow(
      ItemSchema,
      {
        schema_version: 1,
        id: r.id,
        display_name: r.displayName,
        category: r.category,
        source: JSON.parse(r.sourceJson),
      },
      "items",
      r.id,
    ),
});

/**
 * List every Champions item, sorted by canonical id.
 *
 * **When to use it:** populate an item dropdown; iterate the full item table for
 * batch validation. For "is this item legal?" use `has()`.
 *
 * @param db — Open Drizzle DB handle.
 * @param format — `"RegM-A"` (forward-compat seam; items aren't format-scoped today).
 * @returns Array of `Item`. Never null.
 * @throws {RosterDbError} On SQLite I/O failure.
 * @throws {RosterDataError} If a stored row fails schema validation.
 *
 * @example
 *   const all = list(db, "RegM-A"); // ~117 items
 */
export function list(db: Db, format: "RegM-A"): Item[] {
  return repo.list(db, format);
}

/**
 * Look up an item by Showdown id or display name. Case-insensitive.
 *
 * **When to use it:** resolve user input or stored references to a canonical Item.
 * For boolean checks use `has()`.
 *
 * @param db — Open Drizzle DB handle.
 * @param name — Showdown id ("choicescarf") or display name ("Choice Scarf").
 *   Whitespace trimmed; case ignored.
 * @param format — `"RegM-A"`.
 * @returns The full `Item` record, or `null` if no match.
 * @throws {RosterDbError} On SQLite I/O failure.
 * @throws {RosterDataError} If a stored row fails schema validation.
 *
 * @example
 *   get(db, "Choice Scarf", "RegM-A")?.category; // "choice"
 */
export function get(db: Db, name: string, format: "RegM-A"): Item | null {
  return repo.get(db, name, format);
}

/**
 * Boolean existence check.
 *
 * @param db — Open Drizzle DB handle.
 * @param name — Same lookup rules as `get()`.
 * @param format — `"RegM-A"`.
 * @returns `true` iff the item exists in the items table.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function has(db: Db, name: string, format: "RegM-A"): boolean {
  return repo.has(db, name, format);
}
