import type { Db } from "../../db/open";
import { LabmausUnknownSpeciesError } from "../../schemas/errors";

/**
 * The minimal entity shape returned by `species_alias_labmaus.get`.
 * Defined locally to avoid a circular import with the repo module.
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
 * @param labmausId — A labmaus dex id like `"006"`, `"038-a"`, `"479-w"`, or
 *   the literal `"902"` (Basculegion-M) whose display name is `"Basculegion ♂"`.
 * @param displayName — Parallel display name from `team_names` if available.
 *   Reserved for future heuristic resolution; the v1 implementation just looks
 *   up by id.
 * @param deps — `aliasRepo` (a `species_alias_labmaus` repo) + `db`.
 * @returns The roster id (e.g. `"ninetales-alola"`) or `null` if no mapping.
 *
 * @example
 *   labmausIdToRosterId("038-a", "Ninetales-Alola", deps); // "ninetalesalola"
 */
export function labmausIdToRosterId(
  labmausId: string,
  displayName: string | null,
  deps: SpeciesMapDeps,
): string | null {
  void labmausId;
  void displayName;
  void deps;
  throw new Error("not implemented (Stage 5)");
}

/**
 * Same as {@link labmausIdToRosterId} but throws on miss.
 *
 * @throws {LabmausUnknownSpeciesError} If no roster id is mapped. The error's
 *   message and `.query` both carry the offending labmaus id.
 */
export function labmausIdToRosterIdOrThrow(
  labmausId: string,
  displayName: string | null,
  deps: SpeciesMapDeps,
): string {
  void labmausId;
  void displayName;
  void deps;
  // Match the documented contract so the type-check passes; behavior body is Stage 5.
  throw new LabmausUnknownSpeciesError("not implemented (Stage 5)", { query: labmausId });
}
