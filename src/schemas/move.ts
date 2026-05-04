import { z } from "zod";
import { RecordSourceSchema } from "./common-source";
import { TypeSchema } from "./pokemon";

/**
 * Move category enum.
 *
 * `Physical` and `Special` deal damage (using attacker's Atk vs. defender's Def,
 * or SpA vs. SpD respectively). `Status` moves are non-damaging (e.g., Spore,
 * Will-O-Wisp, Tailwind); the damage-calc tool rejects them as inputs.
 */
export const MoveCategorySchema = z.enum(["Physical", "Special", "Status"]);

/**
 * A single Champions move record.
 *
 * **When to use it:** parse a row from the `moves` table, or any payload claiming to
 * describe a move available in Reg M-A. Returned by `moves.get(...)`.
 *
 * Asserts: `base_power >= 0` (status moves are 0); `accuracy` ∈ [0, 100] OR `null`
 * (always-hit moves like Aerial Ace).
 */
export const MoveSchema = z
  .object({
    schema_version: z.literal(1),
    id: z.string().regex(/^[a-z0-9]+$/),
    display_name: z.string().min(1),
    type: TypeSchema,
    category: MoveCategorySchema,
    base_power: z.number().int().nonnegative(),
    accuracy: z.number().int().min(0).max(100).nullable(),
    source: RecordSourceSchema,
  })
  .strict();

export type Move = z.infer<typeof MoveSchema>;
export type MoveCategory = z.infer<typeof MoveCategorySchema>;
