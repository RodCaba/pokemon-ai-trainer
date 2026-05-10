/**
 * Stage 4 stub for the `insights_search` Anthropic tool.
 * Real implementation lands in Stage 5; see `docs/plans/youtube-insights.md` §6.2.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  InsightSearchArgsSchema,
  InsightSearchHitSchema,
  type InsightSearchHit_v2,
} from "../schemas/insight";
import type { Db } from "../db/open";
import type { EmbedClient } from "../tools/knowledge/embed";
import { createInsightStore } from "../db/insights";

/**
 * Anthropic tool definition for `insights_search`. The Anthropic SDK
 * expects a JSON Schema object on `input_schema` (not a zod instance) —
 * we run `zodToJsonSchema` once and surface the JSON Schema verbatim.
 */
export const insightsSearchTool = {
  name: "insights_search" as const,
  description:
    "Semantic search over atomic VGC claims extracted from team-author YouTube " +
    "video deep-dives (and future article corpora). Returns top-k claims with the " +
    "source URL + timestamp + author. Use when the user asks 'why does the author " +
    "run X?', 'what's the lead plan against Y?', or 'what does the team's creator " +
    "say about matchup Z?'.",
  input_schema: zodToJsonSchema(InsightSearchArgsSchema, {
    target: "openApi3",
  }) as Record<string, unknown>,
  output_schema: z.array(InsightSearchHitSchema),
};

/** Deps for {@link invokeInsightsSearch}. */
export interface InsightsSearchToolDeps {
  db: Db;
  embedClient: EmbedClient;
}

/**
 * Invoke the `insights_search` tool — the agent-side handler.
 *
 * **When to use it:** wired into the agent loop alongside `knowledge_search`.
 * Tests inject a fake store via `deps`.
 *
 * @param _rawArgs — Args passed by the model; validated against `InsightSearchArgsSchema`.
 * @param _deps — DB + embed client.
 * @returns Ranked hits (cosine score 0–1).
 * @throws {z.ZodError} On malformed args.
 */
export async function invokeInsightsSearch(
  _rawArgs: unknown,
  _deps: InsightsSearchToolDeps,
): Promise<InsightSearchHit_v2[]> {
  const args = InsightSearchArgsSchema.parse(_rawArgs);
  const store = createInsightStore(_deps.db, { embedClient: _deps.embedClient });
  return store.search(args.query, {
    filter: {
      pokemon: args.species_id_filter ? [args.species_id_filter] : undefined,
      claim_type: args.claim_type ? [args.claim_type] : undefined,
    },
    limit: args.limit,
  });
}
