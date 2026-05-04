import { z } from "zod";

/**
 * Provenance block for any record sourced from `@smogon/calc` or `SETDEX_CHAMPIONS`.
 *
 * **When to use it:** embed as `source` in any `Item`, `Ability`, or `Move` record. Use the
 * entity-specific `*SourceSchema` (e.g., `PokemonSourceSchema`, `SampleSetSourceSchema`)
 * when more granular per-field provenance is needed.
 */
export const RecordSourceSchema = z
  .object({
    origin: z.enum([
      "@smogon/calc",
      "calc.pokemonshowdown.com/js/data/sets/champions.js",
    ]),
    engine_sha: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .nullable(),
    source_url: z.string().url(),
    fetched_at: z.string().datetime({ offset: false }),
  })
  .strict();

export type RecordSource = z.infer<typeof RecordSourceSchema>;
