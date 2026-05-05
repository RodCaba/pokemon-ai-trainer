import type { Db } from "./open";
import { speciesAliasLabmaus as table } from "./drizzle-schema";
import { createSimpleRepo, parseOrThrow } from "./simple-repo";
import { z } from "zod";

interface Row {
  id: string;
  rosterId: string;
  sourceJson: string;
}

/**
 * Domain shape of one labmaus → roster alias row.
 *
 * Per CLAUDE.md §10 ref-table convention this entity is intentionally tiny.
 */
export const SpeciesAliasSchema = z
  .object({
    schema_version: z.literal(1),
    labmaus_id: z.string().min(1),
    roster_id: z.string().regex(/^[a-z0-9-]+$/),
  })
  .strict();
export type SpeciesAlias = z.infer<typeof SpeciesAliasSchema>;

const repo = createSimpleRepo<Row, SpeciesAlias>({
  name: "species_alias_labmaus",
  table,
  idColumn: table.id,
  // No display-name column on this ref table — labmaus_id is the only key.
  // Per plan §6.2 we pass the same column for both branches; the byDisplayName
  // path is harmless dead code on miss (factory returns null).
  displayNameColumn: table.id,
  rowToEntity: (r): SpeciesAlias =>
    parseOrThrow(
      SpeciesAliasSchema,
      {
        schema_version: 1 as const,
        labmaus_id: r.id,
        roster_id: r.rosterId,
      },
      "species_alias_labmaus",
      r.id,
    ),
});

/**
 * List every labmaus → roster alias, sorted by labmaus id.
 *
 * **When to use it:** during ingest, to walk every known mapping (e.g. to
 * build an in-memory dex-id → roster-id map for one batch).
 *
 * @param db — Open Drizzle DB handle.
 * @param format — `"RegM-A"` (forward-compat seam).
 * @returns Array of {@link SpeciesAlias}.
 * @throws {RosterDbError} On SQLite I/O failure.
 * @throws {RosterDataError} If a stored row fails schema validation.
 */
export function list(db: Db, format: "RegM-A"): SpeciesAlias[] {
  return repo.list(db, format);
}

/**
 * Look up one alias by labmaus id (e.g. `"038-a"`).
 *
 * @param db — Open Drizzle DB handle.
 * @param labmausId — labmaus dex id (case-insensitive lookup; labmaus ids are
 *   already lowercase but `toCanonicalId` trims/normalizes anyway).
 * @param format — `"RegM-A"`.
 * @returns The {@link SpeciesAlias} or `null` if no mapping.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function get(db: Db, labmausId: string, format: "RegM-A"): SpeciesAlias | null {
  return repo.get(db, labmausId, format);
}

/**
 * Boolean: does a mapping exist for this labmaus id?
 *
 * @param db — Open Drizzle DB handle.
 * @param labmausId — labmaus dex id.
 * @param format — `"RegM-A"`.
 * @returns `true` iff an alias row exists.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export function has(db: Db, labmausId: string, format: "RegM-A"): boolean {
  return repo.has(db, labmausId, format);
}
