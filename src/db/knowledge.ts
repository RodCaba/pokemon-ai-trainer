/**
 * Bespoke `knowledge_chunks` repo. Per `docs/plans/vgc-knowledge-base.md` §6
 * the factory pattern (`createSimpleRepo`) doesn't fit:
 *   - writes are multi-table (relational + virtual sidecar);
 *   - `search` is a vec-virtual-table query joined back to relational;
 *   - `list` has multi-column filters (slug + section + subtype).
 *
 * Stage 4 stub: every method throws `not implemented (Stage 5)`. Tests live
 * in `tests/db/knowledge.test.ts` and `tests/db/knowledge-no-tera.test.ts`.
 */

import type { Db } from "./open";
import type {
  ChunkFilter,
  KnowledgeChunk,
  KnowledgeSearchHit,
} from "../schemas/knowledge";

/** Args for {@link search}. */
export interface KnowledgeSearchRepoArgs {
  /** 1024-dim query vector. */
  query_vector: Float32Array;
  /** Top-k. Plan default 5. */
  k: number;
  exclude_subtypes?: Array<"battle-replay">;
  article_section_filter?: Array<"intro" | "teambuilding" | "battling">;
}

/** Args for {@link upsertArticleChunks}. */
export interface UpsertArticleChunksArgs {
  article_slug: string;
  body_hash: string;
  chunks: Array<Omit<KnowledgeChunk, "embedding_ref">>;
  /** One vector per chunk. Length must match `chunks.length`. */
  embeddings: Float32Array[];
}

/** Result of {@link upsertArticleChunks}. */
export interface UpsertArticleChunksResult {
  inserted: number;
  replaced: number;
  /** True if `body_hash` matched the persisted hash and no work was done. */
  skipped_unchanged: boolean;
}

/**
 * List persisted chunks matching a filter.
 *
 * **When to use it:** debugging / `knowledge.search` boundary tests / the
 * operator demo. For semantic queries use {@link search}.
 *
 * @param db — Open Drizzle DB handle.
 * @param filter — Optional `article_slug` / `article_section` / `subtype` /
 *   `limit`. Empty filter returns all chunks (subject to `limit`).
 * @returns Chunks ordered by `(article_slug, chunk_index)`.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function list(db: Db, filter: ChunkFilter): KnowledgeChunk[] {
  throw new Error("not implemented (Stage 5)");
}

/**
 * Look up a single chunk by `id`.
 *
 * **When to use it:** the agent runtime uses `id` to re-fetch the canonical
 * row when a tool result needs to be re-read. Returns `null` on miss.
 *
 * @param db — Open Drizzle DB handle.
 * @param id — Canonical chunk id of the form `vgcguide:&lt;slug&gt;:&lt;index&gt;`.
 * @returns The chunk row, or `null` if no match.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function get(db: Db, id: string): KnowledgeChunk | null {
  throw new Error("not implemented (Stage 5)");
}

/**
 * Top-k semantic search via the vec0 sidecar. Filters are post-applied
 * (per plan §5.3 — vec0 doesn't accept WHERE clauses on virtual rows).
 *
 * **When to use it:** the agent's `knowledge_search` runtime. Inputs are a
 * pre-embedded query vector (the embed step lives in `tools/knowledge/search.ts`).
 *
 * @param db — Open Drizzle DB handle.
 * @param args — Query vector + k + optional filters.
 * @returns Hits ordered by `cosine_score DESC`, length ≤ `k` after post-filter.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function search(
  db: Db,
  args: KnowledgeSearchRepoArgs,
): KnowledgeSearchHit[] {
  throw new Error("not implemented (Stage 5)");
}

/**
 * Skip-existing-aware upsert of one article's chunks. Single transaction:
 * (1) compare body_hash; (2) on mismatch, cascade-delete relational + vec0
 * rows; (3) insert chunks; (4) insert embeddings; (5) update `embedding_ref`.
 *
 * **When to use it:** the vgcguide ingest pipeline.
 *
 * @param db — Writable Drizzle DB handle.
 * @param input — `{ article_slug, body_hash, chunks, embeddings }`.
 * @returns `{ inserted, replaced, skipped_unchanged }` — `skipped_unchanged`
 *   true iff the persisted body_hash matched and no work was done.
 * @throws {KnowledgeStorageError} On vec0 dimension mismatch (defensive).
 * @throws {RosterDbError} On SQLite I/O failure.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function upsertArticleChunks(
  db: Db,
  input: UpsertArticleChunksArgs,
): UpsertArticleChunksResult {
  throw new Error("not implemented (Stage 5)");
}

/**
 * Cheap probe: latest persisted body_hash for `article_slug`, or `null`.
 *
 * **When to use it:** the ingest's skip-existing pre-check.
 *
 * @param db — Open Drizzle DB handle.
 * @param article_slug — Canonical vgcguide slug.
 * @returns The body_hash string or `null` if no row exists.
 * @throws {RosterDbError} On SQLite I/O failure.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function articleBodyHash(
  db: Db,
  article_slug: string,
): string | null {
  throw new Error("not implemented (Stage 5)");
}
