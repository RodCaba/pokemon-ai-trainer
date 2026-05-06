/**
 * Raw Showdown plaintext → `TeamSet[]`. Stage 4 stub — every export
 * throws "not implemented (Stage 5)".
 *
 * Stage 5 will:
 * 1. Call `Teams.importTeam(rawText)` from `@pkmn/sets`.
 * 2. Strip `teraType` from each parsed `PokemonSet` (Reg M-A).
 * 3. Rename `evs → sps` at this boundary.
 * 4. Validate species/item/ability/moves against the Champions ref tables.
 *    Reject-and-fail on any unknown value (per plan §8.1).
 * 5. Compute the `completeness` tag.
 */

import type { Db } from "../../db/open";
import type { PasteFetchResult } from "../../schemas/team-set";

/** Repository deps the transform needs to validate every parsed value. */
export interface TransformDeps {
  db: Db;
  rosterRepo: {
    has(db: Db, name: string, format: "RegM-A"): boolean;
    get(db: Db, name: string, format: "RegM-A"): { id: string } | null;
  };
  itemsRepo: {
    has(db: Db, name: string, format: "RegM-A"): boolean;
  };
  abilitiesRepo: {
    has(db: Db, name: string, format: "RegM-A"): boolean;
  };
  movesRepo: {
    has(db: Db, name: string, format: "RegM-A"): boolean;
  };
}

/** Inputs for {@link transformPaste}. */
export interface TransformInput {
  paste_id: string;
  raw_text: string;
  fetched_at: string;
  /** `"labmaus:<tournament_id>:<team_id>"` — used to mint `TeamSet.id`. */
  tournament_team_id: string;
}

/**
 * Parse a raw Showdown export into a `PasteFetchResult`. Stub — throws.
 *
 * **When to use it:** the only translation layer between `@pkmn/sets`'s
 * `PokemonSet` shape and our domain `TeamSet`. Strips Tera, renames
 * `evs → sps`, validates against the ref tables, computes completeness.
 *
 * @param input — Paste id, raw text, fetched_at, tournament_team_id.
 * @param deps — Roster + ref-table repos, all keyed `"RegM-A"`.
 * @returns A validated {@link PasteFetchResult}.
 * @throws {PokepasteParseError} On `@pkmn/sets` parse failure / empty team
 *   / completeness < `"minimal"`.
 * @throws {PokepasteRefValidationError} On unknown item/ability/move.
 * @throws {PokepasteUnknownSpeciesError} On unknown species roster id.
 */
export function transformPaste(_input: TransformInput, _deps: TransformDeps): PasteFetchResult {
  throw new Error("not implemented (Stage 5)");
}
