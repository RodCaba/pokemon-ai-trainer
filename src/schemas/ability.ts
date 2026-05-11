import { z } from "zod";
import { RecordSourceSchema } from "./common-source";

/** Stage C (turn-weighted-phase-scoring): semantic flag on a subset of
 *  abilities that grant +priority to specific move classes (Prankster
 *  → status, Gale Wings → flying, Triage → healing). The classifier
 *  reads this from the DB to emit `setter_priority_via_ability` on
 *  matching team sets. Backfill data lives at
 *  `data/reg-m-a/abilities-priority.json`. */
export const PriorityGrantsSchema = z
  .object({
    kind: z.enum(["status", "flying", "healing"]),
    bonus: z.number().int().min(1).max(5),
    /** v1 models only `full_hp` (Gale Wings). Absent ⇒ unconditional. */
    condition: z.enum(["full_hp"]).optional(),
  })
  .strict();
export type PriorityGrants = z.infer<typeof PriorityGrantsSchema>;

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
    /** Stage C: optional priority-granting metadata. Absent for ~99% of
     *  abilities; populated for Prankster / Gale Wings / Triage (and
     *  future similar abilities) from the curated backfill JSON. */
    priority_grants: PriorityGrantsSchema.optional(),
  })
  .strict();

export type Ability = z.infer<typeof AbilitySchema>;
