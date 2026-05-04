import type { Insight } from "../schemas/insight";
import { NotImplementedError } from "../schemas/errors";

/**
 * One ranked search result. The future implementation computes `score` as a
 * cosine similarity (0–1, higher = more similar) between the query embedding
 * and the stored insight embedding. v1 freezes the shape so consumers can
 * compile against it; the score field is `0` from the stub.
 */
export interface InsightSearchHit {
  insight: Insight;
  score: number;
}

/**
 * Options for `InsightStore.search`. Both fields are optional.
 *
 * `filter` scopes the search to a structured subset (intersected with the
 * semantic ranker by the future implementation). `limit` caps result count.
 */
export interface InsightSearchOptions {
  filter?: InsightSearchFilter;
  limit?: number;
}

/**
 * Structured predicates for narrowing an Insight search.
 *
 * When the vector tier lands (sqlite-vec or alternative), the implementation will
 * intersect semantic similarity over the embedding column with these predicates.
 */
export interface InsightSearchFilter {
  /** Restrict to Insights whose `subjects.pokemon` includes any of these Showdown ids. */
  pokemon?: string[];
  /** Restrict to specific claim types (matchup / set / lead / ...). */
  claim_type?: Insight["claim_type"][];
  /** Restrict to specific source types (youtube / article / tournament / ...). */
  source_type?: Insight["source"]["type"][];
  /** Minimum confidence ("low" | "medium" | "high"). */
  min_confidence?: Insight["confidence"];
}

/**
 * The vector-tier repository contract. v1 is interface-only — both methods throw
 * `NotImplementedError`. The shape is frozen so the future ingest tool, lead planner,
 * and YouTube extractor can compile against it today.
 *
 * Implementation lands when the first feature (lead planner or YouTube ingest) needs
 * real semantic retrieval. Default backing store proposal: `sqlite-vec` extension
 * inside the same SQLite file (see flow doc `pokemon-roster-db.md` Q11). LanceDB and
 * Chroma are fallbacks.
 */
export interface InsightStore {
  /**
   * Persist an insight (claim + embedding) so future `search` calls can surface it.
   *
   * @param insight — A schema-validated `Insight` (one atomic claim per record).
   * @throws {NotImplementedError} In v1 — always.
   */
  add(insight: Insight): Promise<void>;

  /**
   * Semantic-similarity search over stored insights, optionally narrowed by
   * structured predicates.
   *
   * @param query — Natural-language query (e.g., `"how do I lead Garchomp into Trick Room"`).
   * @param options — Optional `{ filter, limit }`. `filter` is intersected with
   *   the semantic ranker; `limit` caps the result count.
   * @returns Hits ranked by similarity score (descending). Empty array if the
   *   store is empty or no candidate matches the filter.
   * @throws {NotImplementedError} In v1 — always.
   */
  search(query: string, options?: InsightSearchOptions): Promise<InsightSearchHit[]>;
}

/**
 * Create the v1 stub `InsightStore`. Both methods throw `NotImplementedError`.
 *
 * **When to use it:** anywhere a feature needs the `InsightStore` shape to compile
 * but isn't ready to write or query embeddings yet (lead planner scaffolding, YouTube
 * extractor scaffolding, integration tests against a future ingest API).
 *
 * @returns An `InsightStore` whose methods unconditionally throw `NotImplementedError`.
 *
 * @example
 *   const store = createInsightStore();
 *   await store.add(myInsight);     // throws NotImplementedError
 *   await store.search("query");     // throws NotImplementedError
 */
export function createInsightStore(): InsightStore {
  return {
    async add(_insight: Insight): Promise<void> {
      throw new NotImplementedError("InsightStore.add");
    },
    async search(
      _query: string,
      _options?: InsightSearchOptions,
    ): Promise<InsightSearchHit[]> {
      throw new NotImplementedError("InsightStore.search");
    },
  };
}
