/**
 * Stage 4 stub for the Insight-claim embedding wrapper.
 * Real implementation lands in Stage 5; see `docs/plans/youtube-insights.md` §2.2.
 */

import type { Insight } from "../../schemas/insight";
import type { EmbedClient } from "../knowledge/embed";

/** Deps for {@link embedInsights}. */
export interface EmbedInsightsDeps {
  embedClient: EmbedClient;
}

/**
 * Embed each `Insight.claim` (NOT the source excerpt) via the shared Voyage
 * client. The claim is the queryable unit per CLAUDE.md §6.
 *
 * **When to use it:** between `extractInsights(...)` and
 * `insightStore.upsertMany(...)` in the ingest loop.
 *
 * @param _insights — Insights to embed.
 * @param _deps — Voyage embed client.
 * @returns One Float32Array per insight, aligned with input order.
 * @throws {KnowledgeAuthError} Propagated from the embed client.
 * @throws {KnowledgeEmbeddingError} Propagated from the embed client on retry exhaustion.
 *
 * @example
 *   const vecs = await embedInsights(result.insights, { embedClient });
 */
export async function embedInsights(
  _insights: Insight[],
  _deps: EmbedInsightsDeps,
): Promise<Float32Array[]> {
  throw new Error("embedInsights: not implemented (Stage 5)");
}
