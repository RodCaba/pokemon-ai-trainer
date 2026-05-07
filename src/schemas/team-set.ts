/**
 * Zod schemas + inferred types for the `pokepaste-sets` slice domain.
 *
 * Pure-data module per CLAUDE.md §3 — landed as a single batch under the
 * pure-data exemption. Tests in `tests/schemas/team-set.test.ts` lock in
 * the externally visible behavior (parsing fixtures, refusing tera_*,
 * SPS caps).
 *
 * Reg M-A invariants: SPS total ≤ 66 / per-stat ≤ 32; no `tera_*` field
 * exists on `TeamSetSchema` and `.strict()` rejects anything that leaks
 * through. See `docs/plans/pokepaste-sets.md` §3.
 */

import { z } from "zod";

const ISODateTime = z.string().datetime({ offset: false });
const PasteId = z.string().regex(/^[a-f0-9]{12,32}$/);
const RosterId = z.string().regex(/^[a-z0-9-]+$/);
const SlotIndex = z.number().int().min(0).max(5);

/**
 * A six-stat SPS spread (Champions Stat Points). Each stat ≤ 32, total ≤ 66.
 *
 * **When to use it:** the `sps` field on a parsed `TeamSet`. SPS is the
 * Champions-domain name for what the engine and Showdown call "EVs"; the
 * transform layer renames `evs → sps` at the parser boundary.
 */
export const SpsSchema = z
  .object({
    hp: z.number().int().min(0).max(32),
    atk: z.number().int().min(0).max(32),
    def: z.number().int().min(0).max(32),
    spa: z.number().int().min(0).max(32),
    spd: z.number().int().min(0).max(32),
    spe: z.number().int().min(0).max(32),
  })
  .strict()
  .refine((s) => s.hp + s.atk + s.def + s.spa + s.spd + s.spe <= 66, {
    message: "SPS total exceeds 66 (Reg M-A cap)",
  });

/**
 * A six-stat IV spread (0..31 per stat).
 *
 * **When to use it:** the `ivs` field on a parsed `TeamSet`. Per Reg M-A
 * stat rules, the calc layer always passes 31s downstream; this field is
 * preserved verbatim for provenance only.
 */
export const IvsSchema = z
  .object({
    hp: z.number().int().min(0).max(31),
    atk: z.number().int().min(0).max(31),
    def: z.number().int().min(0).max(31),
    spa: z.number().int().min(0).max(31),
    spd: z.number().int().min(0).max(31),
    spe: z.number().int().min(0).max(31),
  })
  .strict();

/**
 * Source provenance block for a pokepaste-derived set.
 *
 * **When to use it:** the `source` field on every persisted `TeamSet`.
 * `paste_id` is the hex hash; `source_url` is the human-facing
 * `https://pokepast.es/<paste_id>`; `fetched_at` is ISO-8601 UTC.
 */
export const PokepasteSourceSchema = z
  .object({
    site: z.literal("pokepaste"),
    paste_id: PasteId,
    source_url: z.string().url(),
    fetched_at: ISODateTime,
  })
  .strict();

/**
 * Coarse data-quality tag for a parsed set.
 *
 * **When to use it:** the lead planner sorts citations by `completeness`
 * so full sets win when available; minimal sets still cite when full
 * ones are absent. Mapping (per flow §2.5):
 * - `minimal`: species + item + ability + ≥1 move
 * - `partial`: minimal + (sps OR nature)
 * - `full`: minimal + sps + nature
 */
export const CompletenessSchema = z.enum(["minimal", "partial", "full"]);

/**
 * One Pokemon's parsed Showdown export, normalized to our domain shape.
 *
 * **When to use it:** the canonical entity persisted into `team_sets`
 * and consumed by the lead planner / `tournaments.usage(kind="item"|...)`.
 * Composite key is `(tournament_team_id, slot)`; the `id` field encodes
 * both for stable cross-references.
 *
 * The schema is `.strict()` and has no `tera_*` field by design — Reg M-A
 * has no Terastallization (memory `regulation_m_a_no_tera.md`). Anything
 * that slips through the transform's strip is rejected here.
 */
export const TeamSetSchema = z
  .object({
    schema_version: z.literal(1),
    id: z.string().regex(/^labmaus:\d+:\d+:[0-5]$/),
    tournament_team_id: z.string().regex(/^labmaus:\d+:\d+$/),
    slot: SlotIndex,
    species_roster_id: RosterId,
    item: z.string().min(1).nullable(),
    ability: z.string().min(1).nullable(),
    level: z.number().int().min(1).max(100).nullable(),
    moves: z.array(z.string().min(1)).max(4),
    sps: SpsSchema.nullable(),
    ivs: IvsSchema.nullable(),
    nature: z.string().min(1).nullable(),
    completeness: CompletenessSchema,
    source: PokepasteSourceSchema,
  })
  .strict();

/**
 * Output of `pokepaste.fetchPaste` — raw paste body + parsed sets +
 * per-paste warnings (e.g. an unknown move flagged but not yet enforced).
 *
 * **When to use it:** the agent-callable tool's response shape; also
 * what the ingest hook hands to `sets.upsertTeamSets`.
 */
export const PasteFetchResultSchema = z
  .object({
    paste_id: PasteId,
    raw_text: z.string().min(1),
    sets: z.array(TeamSetSchema).min(1).max(6),
    warnings: z.array(z.string()).default([]),
    fetched_at: ISODateTime,
  })
  .strict();

/**
 * Input shape for `pokepaste.fetchPaste`. Only `paste_id` is the
 * caller-provided identifier; the `tournament_team_id` is supplied as a
 * dep, not an arg, so the JSON-Schema-described agent surface stays
 * minimal.
 */
export const PokepastePasteArgsSchema = z
  .object({
    paste_id: PasteId,
  })
  .strict();

/** Filter input for `sets.list`. At least one filter must be non-empty. */
export const SetsListFilterSchema = z
  .object({
    tournament_id: z.string().regex(/^labmaus:\d+$/).optional(),
    tournament_team_id: z.string().regex(/^labmaus:\d+:\d+$/).optional(),
    species_roster_id: RosterId.optional(),
  })
  .strict()
  .refine(
    (f) => !!(f.tournament_id || f.tournament_team_id || f.species_roster_id),
    { message: "at least one filter must be provided" },
  );

/** Input for `sets.usage` — species-scoped item/ability/move/nature ranking. */
export const SetsUsageArgsSchema = z
  .object({
    species: RosterId,
    format: z.literal("RegM-A"),
    lookback_days: z.number().int().positive(),
    dimension: z.enum(["item", "ability", "move", "nature"]),
  })
  .strict();

/** One ranked usage row from `sets.usage`. */
export const SetsUsageRowSchema = z
  .object({
    dimension: z.enum(["item", "ability", "move", "nature"]),
    key: z.string(),
    display_label: z.string(),
    appearances: z.number().int().nonnegative(),
    total_sets: z.number().int().nonnegative(),
    usage_percent: z.number().min(0).max(100),
    citations: z.array(z.string()).default([]),
  })
  .strict();

export type Sps = z.infer<typeof SpsSchema>;
export type Ivs = z.infer<typeof IvsSchema>;
export type Completeness = z.infer<typeof CompletenessSchema>;
export type PokepasteSource = z.infer<typeof PokepasteSourceSchema>;
export type TeamSet = z.infer<typeof TeamSetSchema>;
export type PasteFetchResult = z.infer<typeof PasteFetchResultSchema>;
export type PokepastePasteArgs = z.infer<typeof PokepastePasteArgsSchema>;
export type SetsListFilter = z.infer<typeof SetsListFilterSchema>;
export type SetsUsageArgs = z.infer<typeof SetsUsageArgsSchema>;
export type SetsUsageRow = z.infer<typeof SetsUsageRowSchema>;
