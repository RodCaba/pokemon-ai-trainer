/**
 * Central validator for `UserTeam` — pure logic over ref-table reads.
 *
 * Stage-4 stub. Stage 5 lands the per-code matrix per
 * `docs/plans/user-teams.md` §4.
 */

import type { Db } from "../db/open";
import type { UserTeam, ValidationResult } from "../schemas/user-teams";

/** Repository deps the validator needs. */
export interface ValidateDeps {
  db: Db;
  speciesRepo: {
    has(db: Db, name: string, format: "RegM-A"): boolean;
    get(db: Db, name: string, format: "RegM-A"): { id: string } | null;
  };
  itemsRepo: { has(db: Db, name: string, format: "RegM-A"): boolean };
  abilitiesRepo: { has(db: Db, name: string, format: "RegM-A"): boolean };
  movesRepo: { has(db: Db, name: string, format: "RegM-A"): boolean };
  /** Reads `roster_membership.is_legal` for the species. */
  rosterRepo: {
    isLegalForFormat(
      db: Db,
      speciesId: string,
      format: "RegM-A",
    ): { in_membership: boolean; is_legal: boolean };
  };
  /** Reads `species_abilities` (legal abilities per species). */
  speciesAbilities: {
    legalFor(db: Db, speciesId: string): string[];
  };
  /** Reads species movepool (Champions movepool from `species.movepool`). */
  speciesMovepool: {
    legalFor(db: Db, speciesId: string): string[];
  };
}

/** Optional opts. `target_status` controls promotion of warnings → errors. */
export interface ValidateOpts {
  /** Default `'draft'`. When `'saved'`, `species_not_legal_warning` promotes
   *  to `species_not_legal` error and `slot_empty` is emitted. */
  target_status?: "draft" | "saved";
}

/**
 * Validate a `UserTeam` against the Champions ref tables and Reg M-A
 * invariants. Returns a structured result with errors and warnings split.
 *
 * **When to use it:** every save (`upsertSet`, `update`) and as the gate
 * inside `setStatus('saved')`. Also exposed via the CLI and as an
 * Anthropic tool (Stage-2 Q3).
 *
 * @param team — A fully-shaped `UserTeam`.
 * @param deps — Ref-table repos.
 * @param opts — `target_status` defaults to `'draft'`.
 * @returns `{ errors, warnings }`. Empty arrays mean fully valid for
 *   `target_status`.
 * @throws {RosterDataError} If `team` itself fails its own schema (programmer bug).
 *
 * @example
 *   const result = validateTeam(team, deps, { target_status: "saved" });
 *   if (result.errors.length === 0) saveIt();
 */
export function validateTeam(
  _team: UserTeam,
  _deps: ValidateDeps,
  _opts?: ValidateOpts,
): ValidationResult {
  throw new Error("not implemented (Stage 5): src/data/team-validate.ts::validateTeam");
}
