import type { Db } from "../../db/open";
import { LabmausUnknownSpeciesError } from "../../schemas/errors";

/**
 * The minimal entity shape returned by `species_alias_labmaus.get`.
 * Defined locally to avoid a circular import with the repo module.
 *
 * **Keep in sync with** `src/db/species-alias-labmaus.ts` — `SpeciesAliasSchema`.
 * Any field added/removed there must be mirrored here.
 */
export interface SpeciesAlias {
  schema_version: 1;
  labmaus_id: string;
  roster_id: string;
}

/**
 * The repo subset that {@link labmausIdToRosterId} needs. Matches
 * {@link createSimpleRepo}'s `SimpleRepo` shape but with `SpeciesAlias`.
 */
export interface SpeciesAliasRepo {
  list(db: Db, format: "RegM-A"): SpeciesAlias[];
  get(db: Db, labmausId: string, format: "RegM-A"): SpeciesAlias | null;
  has(db: Db, labmausId: string, format: "RegM-A"): boolean;
}

/**
 * Dependencies required by {@link labmausIdToRosterId} and
 * {@link labmausIdToRosterIdOrThrow}.
 */
export interface SpeciesMapDeps {
  aliasRepo: SpeciesAliasRepo;
  db: Db;
}

/**
 * Translate a labmaus dex-id into our roster's canonical Showdown-style id.
 *
 * **When to use it:** inside `transform.ts` while mapping each of a team's six
 * species. For a hard-fail variant that throws on unknown ids, use
 * {@link labmausIdToRosterIdOrThrow}.
 *
 * @param labmausId — A labmaus dex id like `"006"`, `"038-a"`, `"479-w"`.
 * @param displayName — Parallel display name from `team_names` if available.
 *   Used as a fallback when id-lookup misses (e.g. `"Basculegion ♂"` whose
 *   bare dex id `"902"` may not be in the alias seed).
 * @param deps — `aliasRepo` (a `species_alias_labmaus` repo) + `db`.
 * @returns The roster id (e.g. `"ninetalesalola"`) or `null` if no mapping.
 *
 * @example
 *   labmausIdToRosterId("038-a", "Ninetales-Alola", deps); // "ninetalesalola"
 */
export function labmausIdToRosterId(
  labmausId: string,
  displayName: string | null,
  deps: SpeciesMapDeps,
): string | null {
  const aliasRow = deps.aliasRepo.get(deps.db, labmausId, "RegM-A");
  if (aliasRow) return aliasRow.roster_id;
  if (displayName === null || displayName === "") return null;
  // Fallback: normalize the display name and try a direct species lookup. This
  // is the documented `"Basculegion ♂"` path from plan §2.4 — gender symbols
  // collapse to `m`/`f` and the species table is queried by display_name
  // (case-insensitive) AND id (after normalization). We use the underlying
  // species table directly rather than `roster.get` because the latter
  // requires `roster_membership`, which is a roster-population concern not a
  // species-mapping concern.
  const normalized = displayName.replace(/♂/g, "m").replace(/♀/g, "f").trim();
  const row = deps.db.$client
    .prepare(
      `SELECT id FROM species
        WHERE display_name = ? COLLATE NOCASE
           OR id = lower(replace(replace(?, ' ', ''), '-', ''))
        LIMIT 1`,
    )
    .get(normalized, normalized) as { id: string } | undefined;
  return row ? row.id : null;
}

/**
 * Translate a labmaus dex-id into a roster id and throw on miss.
 *
 * Wraps {@link labmausIdToRosterId} for the ingest path, where unmapped ids
 * are a hard fail (per flow §4 — "fails loud with the offending id").
 *
 * @param labmausId — A labmaus dex id.
 * @param displayName — Parallel display name (reserved for future use).
 * @param deps — Species-map dependencies.
 * @returns The roster id (never null).
 * @throws {LabmausUnknownSpeciesError} If no roster id is mapped. The error's
 *   message and `.query` both carry the offending labmaus id.
 */
export function labmausIdToRosterIdOrThrow(
  labmausId: string,
  displayName: string | null,
  deps: SpeciesMapDeps,
): string {
  const r = labmausIdToRosterId(labmausId, displayName, deps);
  if (r === null) {
    throw new LabmausUnknownSpeciesError(`unknown labmaus species id: ${labmausId}`, {
      query: labmausId,
    });
  }
  return r;
}
