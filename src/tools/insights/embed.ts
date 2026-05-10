/**
 * Embed an Insight's `claim` (NOT the source excerpt) via the shared Voyage
 * client. The claim is the queryable unit per CLAUDE.md §6.
 */

import type { Insight } from "../../schemas/insight";
import type { EmbedClient } from "../knowledge/embed";

/** Deps for {@link embedInsights}. */
export interface EmbedInsightsDeps {
  embedClient: EmbedClient;
}

/**
 * Embed each insight's `claim` text via Voyage `voyage-3-lite`.
 *
 * **When to use it:** between {@link extractInsights} and
 * `insightStore.upsertMany` in the YouTube ingest loop.
 *
 * @param insights - Insights to embed.
 * @param deps - Voyage embed client.
 * @returns One Float32Array per insight, aligned with input order.
 *   Empty array when input is empty (no API call made).
 * @throws {KnowledgeAuthError} Propagated from the embed client.
 * @throws {KnowledgeEmbeddingError} On retry exhaustion.
 *
 * @example
 *   const vecs = await embedInsights(result.insights, { embedClient });
 */
export async function embedInsights(
  insights: Insight[],
  deps: EmbedInsightsDeps,
): Promise<Float32Array[]> {
  if (insights.length === 0) return [];
  return deps.embedClient.embed(
    insights.map((i) => i.claim),
    "document",
  );
}
