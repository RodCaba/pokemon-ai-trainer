import { z } from "zod";
import { SpsSpreadSchema } from "./sps";
import { NatureSchema } from "./calc";

// Locally guard the SPS-vs-EV terminology + IV ban. We construct the guard inline
// (rather than re-using calc.ts's `forbidIllegalKeys` helper) because coupling the
// two trust boundaries together is the point — every entrypoint that takes a stat
// spread enforces the same Champions terminology rule.
const FORBIDDEN = ["evs", "ev", "ivs", "iv"] as const;

const SampleSetSourceSchema = z
  .object({
    set_source: z.string().url(),
    fetched_at: z.string().datetime({ offset: false }),
  })
  .strict();

/**
 * A canonical set (build) for a Pokemon, sourced from `SETDEX_CHAMPIONS`.
 *
 * **When to use it:** parse any persisted sample set (loaded from SQLite, fetched from
 * Smogon's `champions.js`, or hand-authored). Returned by `roster.sets(species)`.
 *
 * Asserts: `moves` exactly 4; `sps` is a Reg M-A SPS spread (≤66 total / ≤32 per stat);
 * `evs`/`ivs` keys are rejected with Champions-specific error messages (the `evs` →
 * `sps` rename is enforced here just like in `CalcInputSchema`).
 */
export const SampleSetSchema = z
  .object({
    schema_version: z.literal(1),
    set_name: z.string().min(1),
    ability: z.string().min(1),
    item: z.string().min(1).nullable(),
    nature: NatureSchema,
    moves: z.array(z.string().min(1)).length(4),
    sps: SpsSpreadSchema,
    source: SampleSetSourceSchema,
  })
  .passthrough()
  .superRefine((v, ctx) => {
    const obj = v as Record<string, unknown>;
    for (const k of FORBIDDEN) {
      if (k in obj) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [k],
          message: k.startsWith("ev")
            ? "EVs are renamed to SPS (Stat Points) in Champions Reg M-A — use 'sps' instead"
            : "IVs are not configurable in Reg M-A",
        });
      }
    }
    const allowed = new Set([
      "schema_version",
      "set_name",
      "ability",
      "item",
      "nature",
      "moves",
      "sps",
      "source",
    ]);
    const forbiddenSet = new Set<string>(FORBIDDEN);
    for (const k of Object.keys(obj)) {
      if (!allowed.has(k) && !forbiddenSet.has(k)) {
        ctx.addIssue({
          code: z.ZodIssueCode.unrecognized_keys,
          keys: [k],
          message: `Unrecognized key '${k}'`,
        });
      }
    }
  });

export type SampleSet = z.infer<typeof SampleSetSchema>;
