import { z } from "zod";
import { RecordSourceSchema } from "./common-source";

/**
 * A single Champions ability record (e.g., Sand Stream, Levitate, Rough Skin).
 *
 * **When to use it:** parse a row from the `abilities` table, or any payload claiming to
 * describe an ability available in Reg M-A. Returned by `abilities.get(...)`.
 *
 * Per flow doc Q4: ability `display_name` is opaque from this layer's perspective —
 * the integrity test (in `tests/data/integrity.test.ts`) verifies every recorded
 * ability is engine-known via `Generations.get(0).abilities.get(...)`. New Champions
 * abilities (Mega, Piercing Drill, Dragonize, etc.) get accepted automatically.
 */
export const AbilitySchema = z
  .object({
    schema_version: z.literal(1),
    id: z.string().regex(/^[a-z0-9]+$/),
    display_name: z.string().min(1),
    source: RecordSourceSchema,
  })
  .strict();

export type Ability = z.infer<typeof AbilitySchema>;
