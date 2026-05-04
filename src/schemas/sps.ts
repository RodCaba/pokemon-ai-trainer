import { z } from "zod";

// Reg M-A stat rules (see CLAUDE.md §4 + memory: regulation_m_a_stat_rules.md):
//   - 66 SPS (Stat Points) total across all six stats
//   - 32 SPS cap per stat
//   - integer step size 1 (1 SPS = 1 stat point at L50)
// Champions calls these SPS (Stat Points). SV/VGC formats call them EVs. Our domain
// uses SPS to match the source-of-truth (Smogon Champions data / SETDEX_CHAMPIONS).
// The mapping layer in src/tools/damage-calc/mapping.ts translates SPS → engine `evs`
// when calling @smogon/calc's Pokemon constructor (its API still uses `evs`).
const SPS_TOTAL_CAP = 66;
const SPS_PER_STAT_CAP = 32;

const SingleSps = z
  .number()
  .int("SPS must be integers (Reg M-A step size = 1)")
  .nonnegative("SPS must be non-negative")
  .max(SPS_PER_STAT_CAP, `Per-stat SPS cap is ${SPS_PER_STAT_CAP} in Reg M-A`);

/**
 * Reg M-A SPS (Stat Points) spread validator.
 *
 * **When to use it:** validate any 6-stat spread at a data boundary (importer, set parser,
 * UI form). For full `CalcInput` validation use `CalcInputSchema` instead — it composes
 * this schema for both attacker and defender.
 *
 * Rejects: total > 66 across all six stats; per-stat > 32; negative; non-integer.
 *
 * Champions terminology note: SV/VGC formats call these EVs. Champions renamed them to
 * SPS (Stat Points). Our domain uses SPS to match the source-of-truth (Smogon Champions
 * data); the mapping layer translates SPS → engine `evs` at the `@smogon/calc` boundary.
 */
export const SpsSpreadSchema = z
  .object({
    hp: SingleSps,
    atk: SingleSps,
    def: SingleSps,
    spa: SingleSps,
    spd: SingleSps,
    spe: SingleSps,
  })
  .strict()
  .refine(
    (s) => s.hp + s.atk + s.def + s.spa + s.spd + s.spe <= SPS_TOTAL_CAP,
    { message: `SPS total exceeds Reg M-A ${SPS_TOTAL_CAP}-point cap` },
  );

export type SpsSpread = z.infer<typeof SpsSpreadSchema>;
