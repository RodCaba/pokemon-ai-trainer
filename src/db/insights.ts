import type { Insight, InsightSubjectRow } from "../schemas/insight";
import { NotImplementedError } from "../schemas/errors";
import type { Db } from "./open";
import type { EmbedClient } from "../tools/knowledge/embed";

/**
 * One ranked search result. The future implementation computes `score` as a
 * cosine similarity (0–1, higher = more similar) between the query embedding
 * and the stored insight embedding.
 */
export interface InsightSearchHit {
  insight: Insight;
  score: number;
}

/** Options for `InsightStore.search`. */
export interface InsightSearchOptions {
  filter?: InsightSearchFilter;
  limit?: number;
}

/** Structured predicates for narrowing an Insight search. */
export interface InsightSearchFilter {
  pokemon?: string[];
  claim_type?: Insight["claim_type"][];
  source_type?: Insight["source"]["type"][];
  min_confidence?: Insight["confidence"];
}

/** Bulk-upsert input row — one insight + its embedding + its subject rows. */
export interface InsightUpsertRow {
  insight: Insight;
  embedding: Float32Array;
  subjects: InsightSubjectRow[];
}

/** `upsertMany` summary — counts inserted vs skipped on `(chunk_id, claim)` collision. */
export interface InsightUpsertSummary {
  inserted: number;
  skipped_duplicate: number;
}

/**
 * The vector-tier repository contract.
 *
 * v1 stub (no-arg factory) — both `add` and `search` throw `NotImplementedError`.
 * v2 (db-bound factory, Stage 5) — full impl backed by `insights`,
 * `insight_subjects`, and the `insight_embeddings` vec0 sidecar.
 */
export interface InsightStore {
  /**
   * Persist an insight. The v1 stub takes only the insight; the v2 (Stage-5)
   * impl takes the precomputed embedding too. The optional second param keeps
   * the v1 callers compiling.
   */
  add(insight: Insight, embedding?: Float32Array): Promise<void>;
  /** Semantic-similarity search. */
  search(query: string, options?: InsightSearchOptions): Promise<InsightSearchHit[]>;
  /** Bulk transactional upsert (Stage 5). */
  upsertMany(rows: InsightUpsertRow[]): Promise<InsightUpsertSummary>;
  /** Insights for a given `knowledge_chunks.id`, in claim order. */
  listByChunkId(chunkId: string): Promise<Insight[]>;
  /** Insights whose `source.url` matches a `?v=<videoId>` LIKE filter. */
  listByVideoId(videoId: string): Promise<Insight[]>;
  /**
   * Insights whose `subjects.pokemon` contains the given canonical species id.
   *
   * @param speciesId — canonical Showdown id (e.g. `"incineroar"`).
   * @param opts — optional `{ limit }`; default 50.
   */
  listBySpecies(speciesId: string, opts?: { limit?: number }): Promise<Insight[]>;
}

/** Deps for the db-bound `InsightStore`. */
export interface InsightStoreDeps {
  embedClient: EmbedClient;
}

/**
 * Create the v1 stub `InsightStore` — every method throws `NotImplementedError`.
 *
 * **When to use it:** call sites that need the shape to compile but aren't
 * ready to query embeddings yet.
 *
 * @returns A stub `InsightStore`.
 */
export function createInsightStore(): InsightStore;
/**
 * Create the db-bound `InsightStore` (Stage 5). v1 stage-4 stub: every method
 * throws `Error("not implemented (Stage 5)")` so tests fail for the right reason.
 *
 * **When to use it:** the real ingest + agent tool surface; pass the open DB
 * handle and a Voyage embed client.
 *
 * @param db — Open Drizzle DB handle.
 * @param deps — Voyage embed client (required for `search`).
 */
export function createInsightStore(db: Db, deps: InsightStoreDeps): InsightStore;
export function createInsightStore(
  db?: Db,
  _deps?: InsightStoreDeps,
): InsightStore {
  if (db === undefined) {
    // v1 stub — kept for back-compat with the existing v1 tests that call
    // `createInsightStore()` and expect NotImplementedError on `add`/`search`.
    return {
      async add(_insight: Insight, _embedding?: Float32Array): Promise<void> {
        throw new NotImplementedError("InsightStore.add");
      },
      async search(
        _query: string,
        _options?: InsightSearchOptions,
      ): Promise<InsightSearchHit[]> {
        throw new NotImplementedError("InsightStore.search");
      },
      async upsertMany(_rows: InsightUpsertRow[]): Promise<InsightUpsertSummary> {
        throw new NotImplementedError("InsightStore.upsertMany");
      },
      async listByChunkId(_chunkId: string): Promise<Insight[]> {
        throw new NotImplementedError("InsightStore.listByChunkId");
      },
      async listByVideoId(_videoId: string): Promise<Insight[]> {
        throw new NotImplementedError("InsightStore.listByVideoId");
      },
      async listBySpecies(
        _speciesId: string,
        _opts?: { limit?: number },
      ): Promise<Insight[]> {
        throw new NotImplementedError("InsightStore.listBySpecies");
      },
    };
  }
  // v2 (Stage 5) — db-bound real impl. Stage 4 stub: throw distinctly so tests
  // fail because BEHAVIOR is missing, not because of import errors.
  const NI = (method: string): Error =>
    new Error(`InsightStore.${method}: not implemented (Stage 5)`);
  return {
    async add(_insight: Insight, _embedding?: Float32Array): Promise<void> {
      throw NI("add");
    },
    async search(
      _query: string,
      _options?: InsightSearchOptions,
    ): Promise<InsightSearchHit[]> {
      throw NI("search");
    },
    async upsertMany(_rows: InsightUpsertRow[]): Promise<InsightUpsertSummary> {
      throw NI("upsertMany");
    },
    async listByChunkId(_chunkId: string): Promise<Insight[]> {
      throw NI("listByChunkId");
    },
    async listByVideoId(_videoId: string): Promise<Insight[]> {
      throw NI("listByVideoId");
    },
    async listBySpecies(
      _speciesId: string,
      _opts?: { limit?: number },
    ): Promise<Insight[]> {
      throw NI("listBySpecies");
    },
  };
}
