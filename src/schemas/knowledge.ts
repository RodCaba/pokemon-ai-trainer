/**
 * Zod schemas + inferred types for the VGC knowledge-base domain.
 *
 * Per `docs/plans/vgc-knowledge-base.md` §3. CLAUDE.md §3 pure-data-definition
 * exemption applies — schemas land as a single batch since per-test red-first
 * on zod fields is vacuous; the implementation is largely known up-front and
 * locked in by happy-path tests (VGC-T1).
 *
 * Reg M-A hygiene: every object schema is `.strict()` so any `tera_*`-shaped
 * key fails validation rather than being silently dropped.
 */

import { z } from "zod";

const ISODateTime = z.string().datetime({ offset: true });
const Sha256Hex = z.string().regex(/^sha256:[0-9a-f]{64}$/);
// Article slug: lowercase + hyphens for vgcguide/metavgc; case-sensitive
// alphanumeric + `_`/`-` for YouTube video ids.
const SlugStr = z.string().regex(/^[A-Za-z0-9_-]+$/);
// YouTube video ids are case-sensitive (mixed alphanumeric + `_`/`-`); legacy
// vgcguide/metavgc ids are lowercase-with-hyphens. Regex unions both.
const ChunkId = z.string().regex(/^(vgcguide|metavgc):[a-z0-9-]+:\d+$|^youtube:[A-Za-z0-9_-]+:\d+$/);
const ArticleSection = z.enum(["intro", "teambuilding", "battling"]);
const Subtype = z.enum(["battle-replay", "youtube-transcript"]).nullable();
const EmbeddingRef = z.string().regex(/^knowledge_chunk_embeddings:\d+$/);

/**
 * Per-chunk site-specific metadata bag. Stored on `knowledge_chunks.metadata`
 * as JSON TEXT (or NULL). YouTube transcript chunks carry
 * `{ timestamp_start_seconds, timestamp_end_seconds }`. Future sources may
 * add their own fields. Optional + nullable for backwards compat with
 * pre-0010 rows.
 */
export const KnowledgeChunkMetadataSchema = z
  .record(z.union([z.string(), z.number(), z.null()]))
  .nullable()
  .optional();
export type KnowledgeChunkMetadata = z.infer<typeof KnowledgeChunkMetadataSchema>;

/** Multi-site discriminator. Plan §19 widened from `"vgcguide"` literal. */
export const SourceSiteSchema = z.enum(["vgcguide", "metavgc", "youtube"]);
export type SourceSite = z.infer<typeof SourceSiteSchema>;

/**
 * Provenance block on every persisted `KnowledgeChunk`.
 *
 * **When to use it:** the agent cites `site` + `fetched_at` when surfacing
 * vgcguide evidence; `captured_via` is the ingest stamp ("vgcguide-ingest@&lt;sha&gt;");
 * `author` is filled when the article exposes a byline (e.g. Aaron Traylor).
 */
export const KnowledgeSourceBlockSchema = z
  .object({
    site: SourceSiteSchema,
    fetched_at: ISODateTime,
    author: z.string().min(1).nullable(),
    captured_via: z.string().min(1),
  })
  .strict();

/**
 * One persisted knowledge chunk — one paragraph-cluster of one vgcguide article.
 *
 * **When to use it:** the canonical persisted shape under `knowledge_chunks`.
 * Returned by `knowledge.list` / `knowledge.get` / consumed by
 * `knowledge.upsertArticleChunks`.
 *
 * @example
 * ```ts
 * const chunk: KnowledgeChunk = {
 *   schema_version: 1,
 *   id: "vgcguide:speed-control:0",
 *   source_site: "vgcguide",
 *   article_slug: "speed-control",
 *   ...
 * };
 * ```
 */
export const KnowledgeChunkSchema = z
  .object({
    schema_version: z.literal(1),
    id: ChunkId,
    source_site: SourceSiteSchema,
    article_slug: SlugStr,
    article_title: z.string().min(1).max(200),
    article_url: z.string().url(),
    article_section: ArticleSection,
    section_heading: z.string().min(1).max(300),
    chunk_index: z.number().int().nonnegative(),
    chunk_text: z.string().min(1).max(4000),
    chunk_token_count: z.number().int().min(1).max(500),
    subtype: Subtype,
    body_hash: Sha256Hex,
    embedding_ref: EmbeddingRef,
    source: KnowledgeSourceBlockSchema,
    metadata: KnowledgeChunkMetadataSchema,
  })
  .strict();

/**
 * Pre-embedding aggregate emitted by extract+chunk before upsert.
 *
 * **When to use it:** the contract between `chunkExtractedArticle` and
 * `knowledge.upsertArticleChunks` (the latter fills `embedding_ref` after
 * the vec0 insert returns rowids).
 */
export const KnowledgeSnapshotSchema = z
  .object({
    article_slug: SlugStr,
    article_title: z.string().min(1).max(200),
    article_url: z.string().url(),
    article_section: ArticleSection,
    body_hash: Sha256Hex,
    subtype: Subtype,
    chunks: z
      .array(KnowledgeChunkSchema.omit({ embedding_ref: true }))
      .max(200),
    fetched_at: ISODateTime,
  })
  .strict();

/**
 * Filter for `knowledge.list`. Every field optional — empty filter returns
 * all chunks (subject to `limit`).
 */
export const ChunkFilterSchema = z
  .object({
    article_slug: SlugStr.optional(),
    article_section: ArticleSection.optional(),
    subtype: Subtype.optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

// TODO(stage6-deferred): add format: literal('RegM-A') seam if multi-format ever lands; deliberately omitted today since vgcguide is format-agnostic
/**
 * Tool input for `knowledge_search`. Reg M-A literal not required because the
 * vgcguide corpus is format-agnostic principle content.
 *
 * @example
 * ```ts
 * knowledgeSearch(
 *   { query: "how should I think about speed control on a sun team", k: 5 },
 *   deps,
 * );
 * ```
 */
export const KnowledgeSearchArgsSchema = z
  .object({
    query: z.string().min(3).max(500),
    k: z.number().int().min(1).max(20).optional(),
    exclude_subtypes: z.array(z.enum(["battle-replay"])).optional(),
    article_section_filter: z.array(ArticleSection).optional(),
  })
  .strict();

/**
 * One `knowledge_search` result row — `chunk_text` is verbatim and citation-bearing.
 */
export const KnowledgeSearchHitSchema = z
  .object({
    id: ChunkId,
    article_slug: SlugStr,
    article_title: z.string(),
    article_url: z.string().url(),
    article_section: ArticleSection,
    section_heading: z.string(),
    subtype: Subtype,
    chunk_text: z.string(),
    cosine_score: z.number().min(-1).max(1),
  })
  .strict();

export type KnowledgeSourceBlock = z.infer<typeof KnowledgeSourceBlockSchema>;
export type KnowledgeChunk = z.infer<typeof KnowledgeChunkSchema>;
export type KnowledgeSnapshot = z.infer<typeof KnowledgeSnapshotSchema>;
export type ChunkFilter = z.infer<typeof ChunkFilterSchema>;
export type KnowledgeSearchArgs = z.infer<typeof KnowledgeSearchArgsSchema>;
export type KnowledgeSearchHit = z.infer<typeof KnowledgeSearchHitSchema>;
