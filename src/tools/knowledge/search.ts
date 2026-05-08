/**
 * Agent-tool wrapper around the `knowledge.search` repo. Validates input via
 * zod, embeds the query (`input_type: "query"`), and returns ranked hits.
 */

import type { Db } from "../../db/open";
import {
  KnowledgeSearchArgsSchema,
  type KnowledgeSearchArgs,
  type KnowledgeSearchHit,
} from "../../schemas/knowledge";
import * as knowledge from "../../db/knowledge";
import type { EmbedClient } from "./embed";

/** Deps for {@link knowledgeSearch}. */
export interface KnowledgeSearchDeps {
  db: Db;
  embedClient: EmbedClient;
}

const DEFAULT_K = 5;

/**
 * Run a semantic search over the vgcguide corpus.
 *
 * **When to use it:** the agent-callable entry point. Validates input, embeds
 * the query string, hands the vector to the repo, returns ranked hits.
 *
 * @param args — Tool input (validated against `KnowledgeSearchArgsSchema`).
 * @param deps — DB handle + embed client.
 * @returns Top-k hits ordered by `cosine_score DESC`. Empty array when the
 *   DB has no chunks.
 * @throws {KnowledgeAuthError} If `VOYAGE_API_KEY` is missing or Voyage 401s.
 * @throws {KnowledgeEmbeddingError} On Voyage retry exhaustion.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
export async function knowledgeSearch(
  args: KnowledgeSearchArgs,
  deps: KnowledgeSearchDeps,
): Promise<KnowledgeSearchHit[]> {
  const parsed = KnowledgeSearchArgsSchema.parse(args);
  const k = parsed.k ?? DEFAULT_K;
  const vecs = await deps.embedClient.embed([parsed.query], "query");
  const queryVec = vecs[0];
  if (queryVec === undefined) return [];
  return knowledge.search(deps.db, {
    query_vector: queryVec,
    k,
    exclude_subtypes: parsed.exclude_subtypes,
    article_section_filter: parsed.article_section_filter,
  });
}
