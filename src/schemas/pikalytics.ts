/**
 * Zod schemas + inferred types for the pikalytics domain.
 *
 * Per `docs/plans/pikalytics.md` §3. CLAUDE.md §3 pure-data-definition exemption
 * applies — schemas land as a single batch since per-test red-first on zod fields
 * is vacuous; the implementation is largely known up-front and locked in by the
 * happy-path test (PIKA-T1).
 *
 * Reg M-A hygiene: every object schema is `.strict()` and no field is named
 * `tera_*`, so any leak fails validation rather than being silently dropped.
 */

import { z } from "zod";

const ISODateTime = z.string().datetime({ offset: true });
const ISODate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const RosterId = z.string().regex(/^[a-z0-9-]+$/);
const FormatLit = z.literal("RegM-A");
const FormatSlug = z.literal("gen9championsvgc2026regma");
const Percent = z.number().min(0).max(100);

/**
 * One teammate entry on a `PikalyticsSnapshot` — the canonical roster id of the
 * partner species and the co-occurrence percentage on Pikalytics's ladder data.
 *
 * **When to use it:** as the element type of `PikalyticsSnapshot.teammates` and
 * the return type of `pikalytics.teammates(...)`.
 */
// TODO(stage6-deferred): meta-merger slice should enforce or validate cross-source roster_id integrity
export const TeammateEntrySchema = z
  .object({
    roster_id: RosterId,
    percent: Percent,
  })
  .strict();

/**
 * One frequency entry for items / abilities / moves — display name as Pikalytics
 * emits it (e.g. "Choice Scarf", "Rough Skin", "Earthquake") and the usage %.
 *
 * **When to use it:** as the element type of `PikalyticsSnapshot.{items,abilities,moves}`.
 */
export const FrequencyEntrySchema = z
  .object({
    name: z.string().min(1),
    percent: Percent,
  })
  .strict();

/**
 * Provenance block on every persisted `PikalyticsSnapshot`.
 *
 * **When to use it:** the agent cites `source_url` (the human-facing page) when
 * surfacing pikalytics evidence; `ai_url` is the machine endpoint we re-fetch
 * from; `fetched_at` is OUR fetch time (the row also carries `as_of`, which is
 * Pikalytics's own publication date).
 */
export const PikalyticsSourceBlockSchema = z
  .object({
    site: z.literal("pikalytics"),
    source_url: z.string().url(),
    ai_url: z.string().url(),
    fetched_at: ISODateTime,
  })
  .strict();

/**
 * One pikalytics snapshot row — `(species, as_of)` unique. No `tera_*` fields by
 * design; `.strict()` rejects any leak.
 *
 * **When to use it:** the canonical persisted shape under `pikalytics_snapshots`,
 * the return type of `pikalytics.fetchSpecies(...)` and `pikalytics.get(...)`.
 */
export const PikalyticsSnapshotSchema = z
  .object({
    schema_version: z.literal(1),
    id: z
      .string()
      .regex(/^pikalytics:gen9championsvgc2026regma:[a-z0-9-]+:\d{4}-\d{2}-\d{2}$/),
    format: FormatLit,
    format_slug: FormatSlug,
    species_roster_id: RosterId,
    as_of: ISODate,
    // Plan §3 sketches a non-null `usage_percent`. The live AI-markdown endpoint
    // (verified 2026-05-07) doesn't expose an overall species usage percentage —
    // only per-item / per-move / per-teammate breakdowns. v1 stores `null` when
    // absent; the parser returns null and the schema admits null. Documented in
    // fixtures/pikalytics/README.md.
    usage_percent: Percent.nullable(),
    teammates: z.array(TeammateEntrySchema).max(50),
    items: z.array(FrequencyEntrySchema).max(50),
    abilities: z.array(FrequencyEntrySchema).max(20),
    moves: z.array(FrequencyEntrySchema).max(50),
    sample_size: z.number().int().nonnegative().nullable(),
    source: PikalyticsSourceBlockSchema,
  })
  .strict();

/**
 * Tool input for `pikalytics.fetchSpecies`.
 *
 * @example
 * ```ts
 * fetchSpecies({ format: "RegM-A", species_roster_id: "garchomp" }, deps);
 * ```
 */
export const PikalyticsFetchSpeciesArgsSchema = z
  .object({
    format: FormatLit,
    species_roster_id: RosterId,
  })
  .strict();

/**
 * Tool input for `pikalytics.teammates`.
 *
 * @example
 * ```ts
 * pikalytics.teammates(db, { format: "RegM-A", species: "garchomp", limit: 5 });
 * ```
 */
export const PikalyticsTeammatesArgsSchema = z
  .object({
    format: FormatLit,
    species: RosterId,
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

/**
 * Tool input for `pikalytics.usage`. Cross-field rule: when `dimension` is not
 * `"species"`, `species` is required.
 *
 * @example
 * ```ts
 * pikalytics.usage(db, { format: "RegM-A", dimension: "item", species: "garchomp" });
 * ```
 */
export const PikalyticsUsageArgsSchema = z
  .object({
    format: FormatLit,
    dimension: z.enum(["species", "item", "ability", "move", "teammate"]),
    species: RosterId.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((args, ctx) => {
    if (args.dimension !== "species" && args.species === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "`species` is required when dimension is item|ability|move|teammate",
        path: ["species"],
      });
    }
  });

/**
 * One row of `pikalytics.usage` output — citation-bearing.
 */
export const PikalyticsUsageRowSchema = z
  .object({
    dimension: z.enum(["species", "item", "ability", "move", "teammate"]),
    key: z.string(),
    display_label: z.string(),
    usage_percent: Percent,
    source_url: z.string().url(),
    as_of: ISODate,
  })
  .strict();

export type TeammateEntry = z.infer<typeof TeammateEntrySchema>;
export type FrequencyEntry = z.infer<typeof FrequencyEntrySchema>;
export type PikalyticsSourceBlock = z.infer<typeof PikalyticsSourceBlockSchema>;
export type PikalyticsSnapshot = z.infer<typeof PikalyticsSnapshotSchema>;
export type PikalyticsFetchSpeciesArgs = z.infer<typeof PikalyticsFetchSpeciesArgsSchema>;
export type PikalyticsTeammatesArgs = z.infer<typeof PikalyticsTeammatesArgsSchema>;
export type PikalyticsUsageArgs = z.infer<typeof PikalyticsUsageArgsSchema>;
export type PikalyticsUsageRow = z.infer<typeof PikalyticsUsageRowSchema>;
