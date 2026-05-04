import { z } from "zod";
import { RecordSourceSchema } from "./common-source";

/**
 * Champions item category enum.
 *
 * Champions has 117 items including Mega Stones (first-class evolutions) and a
 * heavy lean on type-resist berries. SV-VGC items like Choice Band/Specs and
 * Life Orb are NOT present and never appear in this DB.
 *
 * **Single-membership categories in Reg M-A:** the `"choice"` category contains
 * exactly one item — `Choice Scarf`. Choice Band and Choice Specs do not exist
 * in Champions; consumers should not assume "choice" implies multiple options.
 */
export const ItemCategorySchema = z.enum([
  "berry",
  "mega-stone",
  "held",
  "choice",
  "plate",
  "memory",
  "seed",
  "gem",
  "weather-rock",
  "terrain-extender",
  "other",
]);

/**
 * A single Champions item record.
 *
 * **When to use it:** parse a row from the `items` table, or any payload claiming to
 * describe an item available in Reg M-A. Returned by `items.get(...)`.
 */
export const ItemSchema = z
  .object({
    schema_version: z.literal(1),
    id: z.string().regex(/^[a-z0-9]+$/),
    display_name: z.string().min(1),
    category: ItemCategorySchema,
    source: RecordSourceSchema,
  })
  .strict();

export type Item = z.infer<typeof ItemSchema>;
export type ItemCategory = z.infer<typeof ItemCategorySchema>;
