/**
 * Stage 4 stub for the Haiku-driven Insight extractor.
 * Real implementation lands in Stage 5; see `docs/plans/youtube-insights.md` §2.2.
 */

import { InsightExtractionError } from "../../schemas/errors";
import type { Insight } from "../../schemas/insight";
import type { SpeciesIndex } from "../knowledge/species-tagger";
import type { YoutubeVideoMetadata } from "../youtube/client";

/** Minimal duck-typed seam for the Anthropic SDK client used by extract. */
export interface AnthropicClientLike {
  messages: {
    create(args: unknown): Promise<unknown>;
  };
}

/** Minimal shape required from a `knowledge_chunks` row by extraction. */
export interface KnowledgeChunkRowMinimal {
  id: string;
  chunk_text: string;
  article_url: string;
  /** Carrier of `timestamp_start_seconds` etc. for transcript chunks. */
  metadata?: Record<string, unknown> | null;
}

/** Fixed inputs for one extraction call. */
export interface ExtractInsightsInput {
  chunk: KnowledgeChunkRowMinimal;
  video_meta: YoutubeVideoMetadata;
  species_index: SpeciesIndex;
}

/** Injection slots for {@link extractInsights}. */
export interface ExtractInsightsDeps {
  anthropic: AnthropicClientLike;
  /** Pinned at ship time per Q4 binding. */
  prompt_version: "v1.0";
  clock: () => Date;
  ulid: () => string;
}

/** One rejected raw extraction with the reason discriminator. */
export interface ExtractInsightsRejection {
  reason: "hallucinated_species" | "non_regma_format" | "schema_violation";
  raw: unknown;
}

/** Result of one extraction call. */
export interface ExtractInsightsResult {
  /** ≤5 schema-validated, hallucination-guard-passed insights, ranked by salience. */
  insights: Insight[];
  /** Raw model outputs that failed a guard or schema, with reason discriminator. */
  rejected: ExtractInsightsRejection[];
}

/**
 * Run the Haiku-driven extractor over one chunk.
 *
 * **When to use it:** the per-chunk extraction call inside the YouTube ingest
 * loop. Returns up to 5 schema-validated insights + a rejection summary; never
 * throws on per-row schema failure (counted into `rejected[]`).
 *
 * @param _input — Chunk + video metadata + species lookup index.
 * @param _deps — Anthropic client + prompt version + clock + ulid factory.
 * @returns `{ insights, rejected }` — empty `insights` is a valid result
 *          (a chunk may have no salient claims).
 * @throws {InsightExtractionError} Only on `rate_limit` after retry exhaustion
 *         or `anthropic_error` (e.g. 401/403). Per-row schema violations are
 *         counted in `rejected`, not thrown.
 *
 * @example
 *   const r = await extractInsights({ chunk, video_meta, species_index }, deps);
 *   for (const ins of r.insights) await store.add(ins, await embed(ins));
 */
export async function extractInsights(
  _input: ExtractInsightsInput,
  _deps: ExtractInsightsDeps,
): Promise<ExtractInsightsResult> {
  throw new InsightExtractionError({
    chunk_id: _input?.chunk?.id ?? "<unknown>",
    kind: "anthropic_error",
    message: "extractInsights: not implemented (Stage 5)",
  });
}
