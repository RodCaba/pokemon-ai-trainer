import type { Db } from "./open";
import { abilities as abilitiesTable } from "./drizzle-schema";
import { AbilitySchema, type Ability } from "../schemas/ability";
import { createSimpleRepo, parseOrThrow } from "./simple-repo";

interface Row {
  id: string;
  displayName: string;
  sourceJson: string;
  priorityGrantsJson: string | null;
}

const repo = createSimpleRepo<Row, Ability>({
  name: "abilities",
  table: abilitiesTable,
  idColumn: abilitiesTable.id,
  displayNameColumn: abilitiesTable.displayName,
  rowToEntity: (r) =>
    parseOrThrow(
      AbilitySchema,
      {
        schema_version: 1,
        id: r.id,
        display_name: r.displayName,
        source: JSON.parse(r.sourceJson),
        ...(r.priorityGrantsJson
          ? { priority_grants: JSON.parse(r.priorityGrantsJson) }
          : {}),
      },
      "abilities",
      r.id,
    ),
});

/**
 * List every Champions ability, sorted by canonical id.
 *
 * @param db — Open Drizzle DB handle.
 * @param format — `"RegM-A"` (forward-compat seam; abilities aren't format-scoped).
 * @returns Array of `Ability`. Never null.
 * @throws {RosterDbError} On SQLite I/O failure.
 * @throws {RosterDataError} If a stored row fails schema validation.
 *
 * @example
 *   list(db, "RegM-A").length; // ~211
 */
export function list(db: Db, format: "RegM-A"): Ability[] {
  return repo.list(db, format);
}

/**
 * Look up an ability by Showdown id or display name. Case-insensitive.
 *
 * @param db — Open Drizzle DB handle.
 * @param name — Showdown id ("roughskin") or display name ("Rough Skin").
 * @param format — `"RegM-A"`.
 * @returns The full `Ability` record, or `null` if no match.
 * @throws {RosterDbError} On SQLite I/O failure.
 * @throws {RosterDataError} If a stored row fails schema validation.
 *
 * @example
 *   get(db, "Rough Skin", "RegM-A")?.id; // "roughskin"
 */
export function get(db: Db, name: string, format: "RegM-A"): Ability | null {
  return repo.get(db, name, format);
}

/**
 * Boolean existence check.
 *
 * @param db — Open Drizzle DB handle.
 * @param name — Same lookup rules as `get()`.
 * @param format — `"RegM-A"`.
 * @returns `true` iff the ability exists in the abilities table.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function has(db: Db, name: string, format: "RegM-A"): boolean {
  return repo.has(db, name, format);
}
