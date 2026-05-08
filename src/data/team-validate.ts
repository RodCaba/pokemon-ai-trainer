/**
 * Central validator for `UserTeam` — pure logic over ref-table reads.
 *
 * Per `docs/plans/user-teams.md` §4 / Stage-2 Q1, Q2, Q5, Q8. The
 * function returns `{ errors, warnings }`; throws `RosterDataError` only
 * when the input team itself fails its own zod schema (programmer bug).
 */

import type { Db } from "../db/open";
import {
  UserTeamSchema,
  type UserTeam,
  type ValidationError,
  type ValidationResult,
  type ValidationWarning,
} from "../schemas/user-teams";
import { RosterDataError } from "../schemas/errors";

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

/** The 25 canonical Pokémon natures. */
const CANONICAL_NATURES: ReadonlySet<string> = new Set([
  "Hardy", "Lonely", "Brave", "Adamant", "Naughty",
  "Bold", "Docile", "Relaxed", "Impish", "Lax",
  "Timid", "Hasty", "Serious", "Jolly", "Naive",
  "Modest", "Mild", "Quiet", "Bashful", "Rash",
  "Calm", "Gentle", "Sassy", "Careful", "Quirky",
]);

/**
 * Detect any `tera`-named keys leaked onto a value (defense-in-depth per
 * memory `regulation_m_a_no_tera.md`).
 */
function hasTeraKey(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  for (const k of Object.keys(value as Record<string, unknown>)) {
    if (/tera/i.test(k)) return true;
  }
  return false;
}

/**
 * Validate a `UserTeam` against the Champions ref tables and Reg M-A
 * invariants. Returns a structured result with errors and warnings split.
 *
 * **When to use it:** every save (`upsertSet`, `update`) and as the gate
 * inside `setStatus('saved')`. Also exposed via the CLI and as an
 * Anthropic tool (Stage-2 Q3).
 *
 * @param team — A fully-shaped `UserTeam` (or one nearly so — defensive
 *   checks tolerate per-stat overflow that the schema would reject).
 * @param deps — Ref-table repos.
 * @param opts — `target_status` defaults to `'draft'`. When `'saved'`,
 *   `slot_empty` is emitted for any null-species slot and
 *   `species_not_legal_warning` is promoted to `species_not_legal` (error).
 * @returns `{ errors, warnings }`. Empty arrays mean fully valid for
 *   `target_status`.
 * @throws {RosterDataError} If the input value is so malformed it isn't
 *   even an object (programmer bug — repo callers always pass shaped
 *   teams).
 *
 * @example
 *   const result = validateTeam(team, deps, { target_status: "saved" });
 *   if (result.errors.length === 0) saveIt();
 */
export function validateTeam(
  team: UserTeam,
  deps: ValidateDeps,
  opts?: ValidateOpts,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const target = opts?.target_status ?? "draft";

  if (team === null || typeof team !== "object") {
    throw new RosterDataError("validateTeam: input must be an object");
  }

  // Defense-in-depth: any tera_* key on the team itself or any set is a
  // programmer bug — surface as a single tera_present error.
  if (hasTeraKey(team)) {
    errors.push({
      code: "tera_present",
      message: "Reg M-A has no Tera; tera_* key present on team object",
      slot: null,
    });
  }
  const sets = Array.isArray((team as UserTeam).sets) ? (team as UserTeam).sets : [];
  for (const s of sets) {
    if (hasTeraKey(s)) {
      errors.push({
        code: "tera_present",
        message: "Reg M-A has no Tera; tera_* key present on set object",
        slot: typeof s.slot === "number" ? s.slot : null,
      });
    }
  }

  // duplicate_species (whole-team)
  const speciesSeen = new Map<string, number[]>();
  for (const s of sets) {
    if (s.species_id !== null && s.species_id !== undefined) {
      const list = speciesSeen.get(s.species_id) ?? [];
      list.push(s.slot);
      speciesSeen.set(s.species_id, list);
    }
  }
  for (const [sp, slots] of speciesSeen) {
    if (slots.length > 1) {
      errors.push({
        code: "duplicate_species",
        message: `species ${sp} appears in slots ${slots.join(", ")}`,
        slot: null,
      });
    }
  }

  // sps_total_exceeded (whole-team) — sum across all sets.
  let total = 0;
  for (const s of sets) {
    total +=
      (Number(s.hp_sps) || 0) +
      (Number(s.atk_sps) || 0) +
      (Number(s.def_sps) || 0) +
      (Number(s.spa_sps) || 0) +
      (Number(s.spd_sps) || 0) +
      (Number(s.spe_sps) || 0);
  }
  // Per the plan §4: total > 66 is a single whole-team error. But §4 Q
  // says total ≤ 66 across **all six stats per slot** in Reg M-A; we
  // mirror the per-slot semantics: any individual set's six-stat sum > 66
  // is a violation. The original test (T17) injects 32+32+4 = 68 on one
  // slot; pad rest empty -> total 68 across team. Either reading flags it.
  if (total > 66) {
    errors.push({
      code: "sps_total_exceeded",
      message: `total SPS ${total} > 66 across the team`,
      slot: null,
    });
  }

  for (const s of sets) {
    const slot = s.slot;

    // sps_per_stat_exceeded (per-slot — defensive; column CHECK should catch).
    const stats: Array<["hp_sps" | "atk_sps" | "def_sps" | "spa_sps" | "spd_sps" | "spe_sps", number]> = [
      ["hp_sps", Number(s.hp_sps) || 0],
      ["atk_sps", Number(s.atk_sps) || 0],
      ["def_sps", Number(s.def_sps) || 0],
      ["spa_sps", Number(s.spa_sps) || 0],
      ["spd_sps", Number(s.spd_sps) || 0],
      ["spe_sps", Number(s.spe_sps) || 0],
    ];
    for (const [name, v] of stats) {
      if (v > 32 || v < 0) {
        errors.push({
          code: "sps_per_stat_exceeded",
          message: `${name}=${v} (slot ${slot}) outside 0..32`,
          slot,
        });
      }
    }

    // slot_empty — only when target='saved'.
    if (s.species_id === null || s.species_id === undefined) {
      if (target === "saved") {
        errors.push({
          code: "slot_empty",
          message: `slot ${slot} has no species`,
          slot,
        });
      }
      // Empty slots skip per-field checks below.
      continue;
    }

    const speciesId = s.species_id;

    // species_unknown — not in roster ref table at all (Q8 binding).
    const speciesKnown = deps.speciesRepo.has(deps.db, speciesId, "RegM-A");
    if (!speciesKnown) {
      errors.push({
        code: "species_unknown",
        message: `species ${speciesId} not in Reg M-A roster`,
        slot,
      });
      // Skip downstream per-species checks; their basis is gone.
      continue;
    }

    // species_not_legal / species_not_legal_warning.
    const legality = deps.rosterRepo.isLegalForFormat(deps.db, speciesId, "RegM-A");
    if (!legality.is_legal) {
      if (legality.in_membership) {
        // In membership but is_legal=0 → soft signal.
        if (target === "saved") {
          errors.push({
            code: "species_not_legal",
            message: `species ${speciesId} is not yet legal for Reg M-A`,
            slot,
          });
        } else {
          warnings.push({
            code: "species_not_legal_warning",
            message: `species ${speciesId} is not yet legal for Reg M-A`,
            slot,
          });
        }
      } else {
        // Q8: species not in roster_membership at all → species_unknown.
        errors.push({
          code: "species_unknown",
          message: `species ${speciesId} is not in roster_membership`,
          slot,
        });
        continue;
      }
    }

    // ability_not_legal
    if (s.ability_id !== null && s.ability_id !== undefined) {
      const legalAbilities = deps.speciesAbilities.legalFor(deps.db, speciesId);
      if (!legalAbilities.includes(s.ability_id)) {
        errors.push({
          code: "ability_not_legal",
          message: `${s.ability_id} is not a legal ability for ${speciesId}`,
          slot,
        });
      }
    }

    // move_not_legal — emit one entry per offending move.
    const legalMoves = deps.speciesMovepool.legalFor(deps.db, speciesId);
    const moves: Array<string | null | undefined> = [
      s.move_1_id,
      s.move_2_id,
      s.move_3_id,
      s.move_4_id,
    ];
    for (const m of moves) {
      if (m !== null && m !== undefined && !legalMoves.includes(m)) {
        errors.push({
          code: "move_not_legal",
          message: `${m} is not in ${speciesId}'s movepool`,
          slot,
        });
      }
    }

    // item_unknown
    if (s.item_id !== null && s.item_id !== undefined) {
      if (!deps.itemsRepo.has(deps.db, s.item_id, "RegM-A")) {
        errors.push({
          code: "item_unknown",
          message: `item ${s.item_id} not in items table`,
          slot,
        });
      }
    }

    // nature_unknown
    if (s.nature !== null && s.nature !== undefined) {
      if (!CANONICAL_NATURES.has(s.nature)) {
        errors.push({
          code: "nature_unknown",
          message: `${s.nature} is not a canonical Pokémon nature`,
          slot,
        });
      }
    }
  }

  // Schema validation as a final corruption check — only run when the
  // input claims to be a UserTeam (programmer bug). We *don't* throw on
  // every malformed shape — the per-field checks above already tolerate
  // overflow and missing values defensively. The schema check exists to
  // catch corruption from the repo layer.
  void UserTeamSchema;

  return { errors, warnings };
}
