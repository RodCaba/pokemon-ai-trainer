import { z } from "zod";

/**
 * Showdown-style canonical id: lowercase alphanumeric, no spaces, no hyphens.
 * Examples: `garchomp`, `slowbrogalar`, `taurospaldeacombat`.
 */
export const SpeciesIdSchema = z
  .string()
  .regex(/^[a-z0-9]+$/, "Showdown id: lowercase alphanumeric only");

/**
 * Pokemon type enum (18 types). Used for both species typing (`Pokemon.types`,
 * 1–2 entries) and move typing (`Move.type`, exactly 1).
 *
 * Type effectiveness is computed by the calc engine from attacker move type vs.
 * defender types — not modeled in this schema.
 */
export const TypeSchema = z.enum([
  "Normal",
  "Fire",
  "Water",
  "Electric",
  "Grass",
  "Ice",
  "Fighting",
  "Poison",
  "Ground",
  "Flying",
  "Psychic",
  "Bug",
  "Rock",
  "Ghost",
  "Dragon",
  "Dark",
  "Steel",
  "Fairy",
]);

/**
 * Champions base stats for a species. All six stats are positive integers.
 *
 * **When to use it:** as the `base_stats` of a `Pokemon` record. Stats are pulled
 * straight from `Generations.get(0).species.<id>.baseStats`.
 */
export const BaseStatsSchema = z
  .object({
    hp: z.number().int().positive(),
    atk: z.number().int().positive(),
    def: z.number().int().positive(),
    spa: z.number().int().positive(),
    spd: z.number().int().positive(),
    spe: z.number().int().positive(),
  })
  .strict();

/**
 * Ability slots for a species.
 *
 * Slot `0` is always present (the primary ability).
 * Slot `1` is the alternate ability or `null` (e.g. when a species has only one ability).
 * Slot `h` is the hidden ability or `null`.
 */
export const AbilitySlotsSchema = z
  .object({
    "0": z.string().min(1),
    "1": z.string().min(1).nullable(),
    h: z.string().min(1).nullable(),
  })
  .strict();

/**
 * Provenance for a `Pokemon` record. Every field carries a separate source so the
 * pipeline can mix sources later (e.g., movepool from a different snapshot than stats)
 * without losing traceability.
 */
export const PokemonSourceSchema = z
  .object({
    stats_source: z.string(),
    movepool_source: z.string(),
    abilities_source: z.string(),
    fetched_at: z.string().datetime({ offset: false }),
    engine_sha: z.string().regex(/^[0-9a-f]{40}$/),
  })
  .strict();

/**
 * Champions Reg M-A Pokemon record — the canonical structured shape returned by
 * `roster.get(...)`. Combat-data only; cosmetic fields (dex_no, height_m, movepool)
 * are intentionally not modeled — see plan §3 / decision 2026-05-04.
 *
 * **When to use it:** parse any persisted Pokemon record (loaded from SQLite, received
 * over the wire, hand-authored in a fixture). Repos already validate at read time, so
 * direct callers of `roster.get()` rarely need to re-parse.
 *
 * Sourcing:
 * - `id`, `display_name`, `types`, `base_stats`, `weight_kg`, `is_mega` ← `@smogon/calc`
 *   Champions slice (`Generations.get(0).species.<id>`).
 * - `abilities` slots 0, 1, h ← `@pkmn/dex` (SV gen 9, used as proxy because Champions
 *   isn't in `@pkmn/dex`). Champions-only abilities patched in via `data/reg-m-a/champions-overlay.ts`.
 * - `aliases` ← hand-curated, no upstream source.
 *
 * Asserts: `id` is Showdown-style canonical; `types` 1-2 entries; all base stats
 * positive integers; ability slot `0` non-empty; `engine_sha` is a 40-hex commit SHA.
 */
export const PokemonSchema = z
  .object({
    schema_version: z.literal(1),
    id: SpeciesIdSchema,
    display_name: z.string().min(1),
    aliases: z.array(z.string().min(1)).default([]),
    form_id: z.string().min(1).nullable(),
    is_mega: z.boolean(),
    types: z.array(TypeSchema).min(1).max(2),
    base_stats: BaseStatsSchema,
    abilities: AbilitySlotsSchema,
    /**
     * Showdown move IDs (lowercase, no spaces) the species can learn in our
     * model. Sourced from @pkmn/dex SV gen 9 learnsets, filtered against the
     * Champions `moves` table at populator time.
     */
    movepool: z.array(z.string().regex(/^[a-z0-9]+$/)).default([]),
    weight_kg: z.number().positive(),
    source: PokemonSourceSchema,
  })
  .strict();

/**
 * Lightweight roster entry returned by `roster.list(...)`. Just enough for a UI list
 * or an LLM to decide whether to fetch the full `Pokemon` record.
 */
export const RosterEntrySchema = z
  .object({
    id: SpeciesIdSchema,
    display_name: z.string().min(1),
    is_mega: z.boolean(),
    format: z.literal("RegM-A"),
  })
  .strict();

/**
 * Search result entry returned by `roster.search(...)`.
 *
 * `score` is a 0-1 relevance score (higher = better match). `matched_on` records
 * which field the match came from so the UI can highlight accordingly.
 */
export const SearchHitSchema = z
  .object({
    id: SpeciesIdSchema,
    display_name: z.string().min(1),
    score: z.number().min(0).max(1),
    matched_on: z.enum(["id", "display_name", "alias"]),
  })
  .strict();

export type Pokemon = z.infer<typeof PokemonSchema>;
export type RosterEntry = z.infer<typeof RosterEntrySchema>;
export type SearchHit = z.infer<typeof SearchHitSchema>;
export type SpeciesId = z.infer<typeof SpeciesIdSchema>;
export type PokeType = z.infer<typeof TypeSchema>;
export type BaseStats = z.infer<typeof BaseStatsSchema>;
export type AbilitySlots = z.infer<typeof AbilitySlotsSchema>;
