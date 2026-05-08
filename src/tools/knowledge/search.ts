/**
 * Agent-tool wrapper around the `knowledge.search` repo. Validates input via
 * zod, embeds the query (`input_type: "query"`), and returns ranked hits.
 *
 * Stage 4 stub: throws `not implemented (Stage 5)`.
 */

import type { Db } from "../../db/open";
import type {
  KnowledgeSearchArgs,
  KnowledgeSearchHit,
} from "../../schemas/knowledge";
import type { EmbedClient } from "./embed";

/** Deps for {@link knowledgeSearch}. */
export interface KnowledgeSearchDeps {
  db: Db;
  embedClient: EmbedClient;
}

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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function knowledgeSearch(
  args: KnowledgeSearchArgs,
  deps: KnowledgeSearchDeps,
): Promise<KnowledgeSearchHit[]> {
  throw new Error("not implemented (Stage 5)");
}
