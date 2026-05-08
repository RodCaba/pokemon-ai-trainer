/**
 * Pure-function chunker. Given an {@link ExtractedArticle} + slug + section +
 * URL + body_hash, produces chunks ready for embedding. Targets ~400 tokens
 * per chunk, hard cap 500; respects h2/h3 boundaries; 50-token overlap on
 * splits within long sections.
 *
 * Stage 4 stub: throws `not implemented (Stage 5)`.
 */

import type { KnowledgeChunk } from "../../schemas/knowledge";
import type { ExtractedArticle } from "./extract-article";

/** Input bag for {@link chunkExtractedArticle}. */
export interface ChunkInput {
  slug: string;
  article_url: string;
  article_title: string;
  article_section: "intro" | "teambuilding" | "battling";
  extracted: ExtractedArticle;
  body_hash: string;
  fetched_at: string;
  subtype: null | "battle-replay";
  /** Stamp of the form `vgcguide-ingest@<git-sha>`. */
  captured_via: string;
  author?: string | null;
}

/** Output of {@link chunkExtractedArticle}. */
export interface ChunkOutput {
  /** Chunks pre-embedding (no `embedding_ref` yet). */
  chunks: Array<Omit<KnowledgeChunk, "embedding_ref">>;
  raw_warnings: string[];
}

/**
 * Chunk an extracted article on h2/h3 boundaries with size budgeting.
 *
 * **When to use it:** the bridge between the HTML extractor and the embedding
 * step in `scripts/data/ingest-vgcguide.ts`. Tests pin against fixtures.
 *
 * Algorithm (verbatim contract — locks the chunker for tests):
 * 1. Per `ExtractedSection`: concatenate paragraphs with `\n\n`; measure tokens.
 * 2. ≤ 500 tokens → single chunk; > 500 tokens → greedy split, ~400-token
 *    target, 50-token overlap (token boundaries — not characters).
 * 3. `chunk_index` is 0-based, contiguous across the whole article.
 * 4. Empty sections are skipped silently with a `raw_warnings` entry.
 *
 * @param input — see {@link ChunkInput}.
 * @returns Chunks (pre-embedding) + warnings.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function chunkExtractedArticle(input: ChunkInput): ChunkOutput {
  throw new Error("not implemented (Stage 5)");
}
