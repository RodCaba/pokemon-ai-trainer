/**
 * Read accessor over `fixtures/speed/top50.json`. Per Stage-3 §16.2
 * (Q5 binding amendment): each entry carries a `nature_variants` list
 * so the speed scorer can weight Jolly vs Adamant Garchomp distinctly.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

export const SpeedTableNatureVariantSchema = z
  .object({
    nature: z.string(),
    share: z.number().min(0).max(1),
    weighted_speed: z.number(),
  })
  .strict();

export const SpeedTableEntrySchema = z
  .object({
    species_id: z.string().regex(/^[a-z0-9-]+$/),
    base_spe: z.number().int().nonnegative(),
    usage_pct: z.number().min(0).max(1),
    nature_variants: z.array(SpeedTableNatureVariantSchema).min(1),
    primary_weighted_speed: z.number(),
  })
  .strict();

export const SpeedTableSchema = z
  .object({
    schema_version: z.literal(1),
    as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    entries: z.array(SpeedTableEntrySchema),
  })
  .strict();

export type SpeedTableEntry = z.infer<typeof SpeedTableEntrySchema>;
export type SpeedTable = z.infer<typeof SpeedTableSchema>;

const DEFAULT_PATH = resolve(process.cwd(), "fixtures/speed/top50.json");

/**
 * Reads + zod-validates a speed-table fixture.
 *
 * @param path - Optional override path; defaults to fixtures/speed/top50.json.
 * @returns A validated {@link SpeedTable}.
 * @throws zod.ZodError when the file content fails validation.
 */
export function loadSpeedTable(path?: string): SpeedTable {
  const p = path ?? DEFAULT_PATH;
  const raw = JSON.parse(readFileSync(p, "utf-8")) as unknown;
  return SpeedTableSchema.parse(raw);
}
