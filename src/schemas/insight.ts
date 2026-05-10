import { z } from "zod";

// Per CLAUDE.md §6 — atomic claim shape used by the vector tier (strategy notes,
// matchup write-ups, lead patterns, YouTube/article extracts). v1 of the roster DB
// ships only the schema + a stub vector store interface; full ingest lands later.

/**
 * Atomic claim category for an `Insight`. Used by retrieval to filter by claim shape
 * (e.g., return only `lead` claims when planning a lead) and by the extractor to
 * tag what kind of assertion the source is making.
 */
export const ClaimTypeSchema = z.enum([
  "matchup",
  "set",
  "lead",
  "meta_trend",
  "tech",
  "counter",
]);

/**
 * How strongly the source backs the claim. `low` = casual mention, `medium` =
 * argued, `high` = backed by tournament data or replay analysis.
 */
export const ConfidenceSchema = z.enum(["low", "medium", "high"]);

/**
 * Whether the source agrees with, refutes, or is neutral about the claim.
 * Used at retrieval time to surface counter-evidence.
 */
export const StanceSchema = z.enum(["supports", "refutes", "neutral"]);

export const InsightSourceSchema = z
  .object({
    type: z.enum(["youtube", "article", "tournament", "replay", "user_note"]),
    url: z.string().url(),
    author: z.string().min(1).optional(),
    published_at: z.string().datetime({ offset: false }).optional(),
    excerpt: z.string().max(500),
    timestamp_seconds: z.number().int().nonnegative().optional(),
  })
  .strict();

/**
 * An atomic competitive-Pokemon claim, embedded for semantic retrieval.
 *
 * **When to use it:** parse any payload representing one extracted insight (e.g., from
 * a YouTube transcript chunker, a Smogon article scraper, or a manual note). Per
 * CLAUDE.md §6, **one claim per Insight** — multi-claim paragraphs get split.
 *
 * Asserts: `id` is a ULID (Crockford base32, 26 chars); `claim` ≤ 280 chars and
 * standalone (readable without surrounding context); `subjects.pokemon` non-empty
 * and uses canonical Showdown ids; `formats` is exactly `["RegM-A"]` (single-format
 * project for now); `excerpt` ≤ 500 chars verbatim from the source.
 */
export const InsightSchema = z
  .object({
    id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "ulid"),
    schema_version: z.literal(1),
    claim: z.string().min(1).max(280),
    claim_type: ClaimTypeSchema,
    subjects: z
      .object({
        pokemon: z.array(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)).min(1),
        moves: z.array(z.string()).optional(),
        items: z.array(z.string()).optional(),
        archetypes: z.array(z.string()).optional(),
        formats: z.tuple([z.literal("RegM-A")]),
      })
      .strict(),
    confidence: ConfidenceSchema,
    stance: StanceSchema,
    source: InsightSourceSchema,
    extracted_by: z
      .object({
        model: z.string(),
        prompt_version: z.string(),
        extracted_at: z.string().datetime({ offset: false }),
      })
      .strict(),
    embedding_ref: z.string().min(1),
    /**
     * FK to `knowledge_chunks.id` for transcript-extracted Insights. `null`
     * for Insights produced from non-chunked sources (manual notes, future
     * tournament-result extraction). Optional in v1 for backwards compat with
     * the v1 stub-store tests; new ingest paths always emit explicit `null`
     * if absent.
     */
    chunk_id: z.string().min(1).nullable(),
  })
  .strict();

/** Subject-row kinds tracked by the `insight_subjects` link table. */
export const InsightSubjectKindSchema = z.enum([
  "pokemon",
  "move",
  "item",
  "archetype",
  "format",
]);
export type InsightSubjectKind = z.infer<typeof InsightSubjectKindSchema>;

/**
 * One row of the `insight_subjects` link table — flat shape so
 * `upsertMany` can take it directly.
 */
export const InsightSubjectRowSchema = z
  .object({
    insight_id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "ulid"),
    subject_kind: InsightSubjectKindSchema,
    subject_value: z.string().min(1).max(100),
  })
  .strict();
export type InsightSubjectRow = z.infer<typeof InsightSubjectRowSchema>;

/** One ranked `insights_search` hit. */
export const InsightSearchHitSchema = z
  .object({
    insight: InsightSchema,
    score: z.number().min(0).max(1),
  })
  .strict();

/** Input args for the `insights_search` Anthropic tool. */
export const InsightSearchArgsSchema = z
  .object({
    query: z.string().min(1).max(500),
    claim_type: ClaimTypeSchema.optional(),
    species_id_filter: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).optional(),
    limit: z.number().int().min(1).max(20).default(5),
  })
  .strict();

export type Insight = z.infer<typeof InsightSchema>;
export type ClaimType = z.infer<typeof ClaimTypeSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type Stance = z.infer<typeof StanceSchema>;
export type InsightSource = z.infer<typeof InsightSourceSchema>;
export type InsightSearchHit_v2 = z.infer<typeof InsightSearchHitSchema>;
export type InsightSearchArgs = z.infer<typeof InsightSearchArgsSchema>;
