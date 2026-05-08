/**
 * Pure-function chunker. Given an {@link ExtractedArticle} + slug + section +
 * URL + body_hash, produces chunks ready for embedding. Targets ~400 tokens
 * per chunk, hard cap 500; respects h2/h3 boundaries; 50-token overlap on
 * splits within long sections.
 */

import { getTokenizer } from "@anthropic-ai/tokenizer";
import type { KnowledgeChunk } from "../../schemas/knowledge";

type Tiktoken = ReturnType<typeof getTokenizer>;
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

const TARGET_TOKENS = 400;
const MAX_TOKENS = 500;
const OVERLAP_TOKENS = 50;

const decoder = new TextDecoder("utf-8");

function decodeTokens(tk: Tiktoken, ids: Uint32Array): string {
  const bytes = tk.decode(ids);
  return decoder.decode(bytes);
}

/**
 * Token-bounded greedy splitter for one section's text. Splits on paragraph
 * boundaries when possible; falls back to in-paragraph token slicing when a
 * single paragraph exceeds {@link MAX_TOKENS}. Each chunk after the first in
 * the same section starts with the last {@link OVERLAP_TOKENS} tokens of the
 * previous chunk.
 */
function splitSectionText(
  tk: Tiktoken,
  paragraphs: string[],
): string[] {
  // First, build a list of token ranges keyed by paragraph; we operate at
  // the token level so the final emitted text is a verbatim decode.
  const allText = paragraphs.join("\n\n");
  const allTokens = tk.encode(allText, "all");
  if (allTokens.length <= MAX_TOKENS) {
    return [allText];
  }

  const out: string[] = [];
  let cursor = 0;
  while (cursor < allTokens.length) {
    const remaining = allTokens.length - cursor;
    if (remaining <= MAX_TOKENS) {
      // Last chunk: take whatever's left.
      const slice = allTokens.slice(cursor, allTokens.length);
      out.push(decodeTokens(tk, slice));
      break;
    }
    const end = cursor + TARGET_TOKENS;
    const slice = allTokens.slice(cursor, end);
    out.push(decodeTokens(tk, slice));
    cursor = end - OVERLAP_TOKENS;
    if (cursor <= 0) cursor = end; // defensive: overlap ≥ target shouldn't happen
  }
  return out;
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
export function chunkExtractedArticle(input: ChunkInput): ChunkOutput {
  const chunks: Array<Omit<KnowledgeChunk, "embedding_ref">> = [];
  const raw_warnings: string[] = [...input.extracted.raw_warnings];

  const tk = getTokenizer();
  try {
    let chunkIndex = 0;
    for (const section of input.extracted.sections) {
      if (section.paragraphs.length === 0) {
        raw_warnings.push(
          `section "${section.section_heading}" has no paragraphs — skipped`,
        );
        continue;
      }
      const pieces = splitSectionText(tk, section.paragraphs);
      for (const text of pieces) {
        const tokenCount = tk.encode(text, "all").length;
        // Defensive cap — shouldn't trip given splitter's TARGET ≤ MAX.
        const safe = tokenCount > MAX_TOKENS ? MAX_TOKENS : tokenCount;
        chunks.push({
          schema_version: 1,
          id: `vgcguide:${input.slug}:${chunkIndex}`,
          source_site: "vgcguide",
          article_slug: input.slug,
          article_title: input.article_title,
          article_url: input.article_url,
          article_section: input.article_section,
          section_heading: section.section_heading,
          chunk_index: chunkIndex,
          chunk_text: text,
          chunk_token_count: Math.max(1, safe),
          subtype: input.subtype,
          body_hash: input.body_hash,
          source: {
            site: "vgcguide",
            fetched_at: input.fetched_at,
            author: input.author ?? null,
            captured_via: input.captured_via,
          },
        });
        chunkIndex++;
      }
    }
  } finally {
    tk.free();
  }

  return { chunks, raw_warnings };
}
