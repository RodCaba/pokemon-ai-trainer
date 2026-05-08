# Tech Plan — VGC General-Knowledge Base (vgcguide.com)

**Slug:** `vgc-knowledge-base`
**Stage:** Stage 3 approved (2026-05-08). Stage 4 (red tests) pending.
**Approved-by:** Rodrigo Caballero (2026-05-08)
**Decision deltas vs the agent's proposal:** HTML parser is **`cheerio`** (not `node-html-parser`) — robustness over weight. Other proposals (anthropic tokenizer, separate `0007_knowledge_vec0.sql` migration sibling, explicit `embedding_ref` linkage, direct `fetch` for Voyage) confirmed.
**Date:** 2026-05-08
**Author:** Tech Lead subagent
**Implements flow doc:** `docs/flows/vgc-knowledge-base.md` (Stage 2 approved 2026-05-08 by Rodrigo Caballero)

**Memory citations:**
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/data_layer_two_tier_db.md` (vector tier — first consumer)
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/db_orm_drizzle.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/single_db_non_destructive_build.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_no_tera.md`
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/labmaus_pokepaste_deferred_todos.md`

**Sibling precedents:** `docs/plans/pikalytics.md` (HTTP source + parse + transform + bespoke repo + run-summary ingest with `_shared` reuse). `docs/plans/pokepaste-sets.md` (run-summary shape, day-one tool registration discipline, JSON-column repo). `docs/plans/labmaus-tournaments.md` (full-roster ingest loop, gated contract test, exp-backoff retry).

**First-of-kind for this slice:** the **vector tier**. The `sqlite-vec` extension lands here, embedding pipeline lands here, and the seeded-vector deterministic-retrieval test pattern lands here. Future vector consumers (Insight extraction, transcript ingest) reuse it.

---

## 1. Goal recap

Ship a citation-first, agent-callable semantic search over vgcguide.com's 53-article tutorial corpus. Concrete deliverables: a weekly cron-driven ingest at `scripts/data/ingest-vgcguide.ts` walks the sitemap, extracts article bodies, chunks on h2/h3 boundaries (~400 token target / 500 max / 50-token overlap on splits), tags 3 hard-coded battle-replay slugs with `subtype: "battle-replay"`, embeds via Voyage AI's `voyage-3-lite` (1024-dim), and upserts both the relational `knowledge_chunks` row and the `knowledge_chunk_embeddings` (sqlite-vec virtual table) sidecar inside one transaction. A single `knowledge.search` agent tool registers in `ROSTER_TOOL_DEFINITIONS` from day one with optional `exclude_subtypes` and `article_section_filter`. Skip-existing on `body_hash` keeps weekly re-runs network-cheap and embedding-API-free when the corpus hasn't changed. Done means: ≥6 fixtures round-trip; deterministic seeded-vector retrieval test asserts top-1 lands on the expected article for the 6 sanity-check queries; cold-start ingest of 53 articles + ~1000 chunks completes in under 10 min on a laptop with `VOYAGE_API_KEY` set; two consecutive ingests produce zero embedding API calls when nothing changed; live contract test gated by `RUN_CONTRACT_TESTS=1` re-asserts extractor correctness; demo script `scripts/vgc-knowledge-demo.ts` answers 4–5 conceptual questions end-to-end against the populated DB.

---

## 2. Module boundaries

All paths absolute under `/Users/rodrigo/src/pokemon-ai-trainer/`. New files only; files marked *(extend)* are additive edits to existing files.

### Schemas (`src/schemas/`)

#### `src/schemas/knowledge.ts` (new)

- **Single responsibility:** zod schemas + inferred types for the knowledge domain — `KnowledgeChunk`, `KnowledgeSourceBlock`, `KnowledgeSnapshot` (per-article aggregate produced by extract+chunk before embedding), `ChunkFilter`, `KnowledgeSearchArgs`, plus retrieval row type `KnowledgeSearchHit`. One file per slice (matches `pikalytics.ts` precedent).
- **Exported surface:**
  ```ts
  export const KnowledgeSourceBlockSchema:    z.ZodObject<…>;
  export const KnowledgeChunkSchema:          z.ZodObject<…>;     // strict; persisted shape
  export const KnowledgeSnapshotSchema:       z.ZodObject<…>;     // pre-embedding aggregate
  export const ChunkFilterSchema:             z.ZodObject<…>;     // for chunks.list
  export const KnowledgeSearchArgsSchema:     z.ZodObject<…>;     // tool input
  export const KnowledgeSearchHitSchema:      z.ZodObject<…>;     // tool output row
  export type KnowledgeSourceBlock = z.infer<typeof KnowledgeSourceBlockSchema>;
  export type KnowledgeChunk       = z.infer<typeof KnowledgeChunkSchema>;
  export type KnowledgeSnapshot    = z.infer<typeof KnowledgeSnapshotSchema>;
  export type ChunkFilter          = z.infer<typeof ChunkFilterSchema>;
  export type KnowledgeSearchArgs  = z.infer<typeof KnowledgeSearchArgsSchema>;
  export type KnowledgeSearchHit   = z.infer<typeof KnowledgeSearchHitSchema>;
  ```
- **TSDoc obligations (CLAUDE.md §10):** every export carries the six-element block. `@example` for `KnowledgeSearchArgs` and `KnowledgeChunk`.
- **Does NOT do:** any HTTP, embedding, DB I/O, chunking. The schema's `.strict()` rejects unknown keys (defense against an upstream extractor surfacing arbitrary attributes).

#### `src/schemas/errors.ts` (extend)

Add a `VgcGuide*` family + a `Knowledge*` family. Same constructor pattern as `PikalyticsError` family.

- `VgcGuideError` — base class for HTTP/extract failures. Carries `.cause`, `.article_slug`.
- `VgcGuideNetworkError` — HTTP non-2xx (other than 404) after retries. Carries `.status`.
- `VgcGuideNotFoundError` — HTTP 404 from sitemap or article fetch. Article-class miss; ingest logs and continues.
- `VgcGuideParseError` — extractor returned empty body (malformed Squarespace HTML, missing `.sqs-html-content`). Logged into run summary.
- `KnowledgeError` — base class for embedding / storage failures. Programmer/operator class — fail loud.
- `KnowledgeEmbeddingError` — Voyage 4xx/5xx after retry exhaustion. Article-level: aborts the article, logs into `embedding_failures[]`. (Distinct severity from `KnowledgeAuthError`.)
- `KnowledgeAuthError` — Voyage 401/403, or `VOYAGE_API_KEY` env var missing/empty. **Fail loud at startup or on first call.** Don't swallow.
- `KnowledgeStorageError` — sqlite-vec extension not loadable, vector dimension mismatch on insert, virtual-table corruption. **Fail loud.**

### Tool layer (`src/tools/vgcguide/` and `src/tools/knowledge/`)

#### `src/tools/vgcguide/SPEC.md` (new — written first per CLAUDE.md §8)

Documents:
1. Inputs/outputs for the four vgcguide modules (`client`, `extract-article`, `chunk`, `tag-subtype`).
2. The HTML extractor contract: locate `<div class="sqs-html-content">` inside the article container; preserve heading hierarchy; strip script/style/figure/aside.
3. Chunker contract: ~400 token target, 500 hard max, h2/h3 boundary respect, 50-token paragraph overlap on splits within long sections.
4. Subtype tagger: 3 hardcoded slugs → `"battle-replay"`, all others → `null`.
5. Throttle: 2 RPS for `vgcguide.com` (Squarespace; politeness; no observed rate limit).
6. Cache key shape: `<article-slug>__<body-hash-prefix-or-fresh>`; finite TTL (7 days) since Squarespace responses are content-stable per body_hash but we want re-fetch politeness on the cron.
7. Error matrix.

#### `src/tools/vgcguide/client.ts` (new)

- **Single responsibility:** thin HTTP client. Two methods: `fetchSitemap()` returns the 53 article URLs; `fetchArticleHtml(slug)` returns the raw HTML body. Enforces throttle, exp-backoff retry on transient failures, file cache with finite TTL.
- **Exported surface:**
  ```ts
  export interface VgcGuideClientOptions {
    cacheDir:      string;
    throttleRps:   number;                 // default 2
    maxRetries:    number;                 // default 3
    backoffBaseMs: number;                 // default 1000
    cacheTtlMs:    number;                 // default 7 days; POSITIVE_INFINITY also accepted
    fetchImpl?:    typeof fetch;
    clock?:        () => number;
  }
  export interface VgcGuideArticleFetch {
    slug:        string;
    html:        string;
    article_url: string;                   // canonical https://www.vgcguide.com/<slug>
    fetched_at:  string;                   // ISO-8601 UTC at fetch time
  }
  export interface VgcGuideClient {
    fetchSitemap(): Promise<string[]>;     // canonical absolute article URLs
    fetchArticleHtml(slug: string): Promise<VgcGuideArticleFetch>;
  }
  export function createVgcGuideClient(opts: VgcGuideClientOptions): VgcGuideClient;
  ```
- **TSDoc:** full block on `createVgcGuideClient`, both fetch methods.
- **Does NOT do:** parse, chunk, embed, or persist. Throws `VgcGuideNetworkError` / `VgcGuideNotFoundError`.

#### `src/tools/vgcguide/extract-article.ts` (new)

- **Single responsibility:** pure-function HTML extractor. Given raw HTML, return a heading-tree intermediate suitable for chunking:
  ```ts
  export interface ExtractedSection {
    heading_level:   2 | 3;                        // h2 or h3
    section_heading: string;                       // visible heading text
    paragraphs:      string[];                     // verbatim text per <p>; whitespace-collapsed
  }
  export interface ExtractedArticle {
    article_title:   string;                       // <h1> or <title> fallback
    article_section: "intro" | "teambuilding" | "battling";
    sections:        ExtractedSection[];
    raw_warnings:    string[];                     // e.g. "no h2/h3 found — single implicit section"
  }
  export function extractVgcGuideArticle(input: { slug: string; html: string }): ExtractedArticle;
  ```
- **Section discrimination** is by URL prefix (sitemap groups `/intro/*` vs `/teambuilding/*` vs `/battling/*`); the extractor accepts the URL or a pre-derived literal. (Final wiring lives in `transform`-equivalent; see `chunk.ts` orchestration.)
- **Contract:** strict on the body container (`<div class="sqs-html-content">` must exist; missing → throws `VgcGuideParseError`). Permissive on heading structure (no h2 → produce a single `ExtractedSection` with `heading_level: 2`, `section_heading: article_title`, all paragraphs collapsed).
- **HTML parsing library decision:** **`node-html-parser`** is the proposal — already a transitive of nothing in the repo today; lightweight (~50KB), no DOM emulation, fast enough at 53 articles. **Considered `cheerio`** (heavier; jQuery-like API we don't need) — rejected. **Considered `parse5`** (spec-compliant; verbose API) — rejected; over-engineered for our needs. **Considered hand-rolled regex** — rejected; the heading/paragraph extraction is exactly the case where a parser is justified (regexes on nested HTML are the canonical anti-pattern). New dep `node-html-parser@^6.x` flagged in §9.
- **Does NOT do:** chunk-size enforcement, tokenization, subtype tagging.

#### `src/tools/vgcguide/chunk.ts` (new)

- **Single responsibility:** pure-function chunker. Given `ExtractedArticle` + slug + section + URL + body_hash, produce `KnowledgeChunk[]` ready for embedding.
  ```ts
  export interface ChunkInput {
    slug:           string;
    article_url:    string;
    article_title:  string;
    article_section: "intro" | "teambuilding" | "battling";
    extracted:      ExtractedArticle;
    body_hash:      string;
    fetched_at:     string;
    subtype:        null | "battle-replay";
    captured_via:   string;                  // "vgcguide-ingest@<git-sha>"
    author?:        string | null;
  }
  export interface ChunkOutput {
    chunks: Omit<KnowledgeChunk, "embedding_ref">[];   // embedding_ref is filled at upsert
    raw_warnings: string[];
  }
  export function chunkExtractedArticle(input: ChunkInput): ChunkOutput;
  ```
- **Algorithm** (verbatim contract — locks the chunker for tests):
  1. For each `ExtractedSection`:
     - Concatenate paragraphs with `\n\n` separators; measure tokens.
     - If ≤ 500 tokens (one chunk): emit a single chunk with `section_heading` and full text.
     - If > 500 tokens: split on paragraph boundaries greedily so each window targets ~400 tokens (never exceeds 500); when a split lands inside the section, the next chunk starts with the **last 50 tokens** of the previous chunk's text as overlap (token boundaries — not character boundaries — using the same tokenizer).
  2. `chunk_index` is a 0-based counter across the whole article (not reset per section). `id = "vgcguide:" + slug + ":" + chunk_index`.
  3. `chunk_token_count` is the actual token count of the emitted chunk text (≤ 500 strict).
  4. Empty sections (zero paragraphs) are skipped silently with a `raw_warnings` entry.
- **Tokenizer choice:** **`@anthropic-ai/tokenizer`** (BPE-compatible-enough for size budgeting; the embedding model's true tokenizer is upstream and we don't have it locally — what we want is a stable, deterministic length signal, which any well-known BPE provides). **Considered `tiktoken`** — equally fine; pick whichever is lighter at install. Final selection in §9 (proposal: `@anthropic-ai/tokenizer` since it's already plausible for any future Anthropic-SDK adjacent tokenization). New dep flagged in §9.
- **Does NOT do:** embedding, persistence, HTML parsing.

#### `src/tools/vgcguide/tag-subtype.ts` (new)

- **Single responsibility:** map slug → `null | "battle-replay"`. Hardcoded list of 3 slugs per flow §6 Q4.
  ```ts
  export const BATTLE_REPLAY_SLUGS = [
    "battling-example-alister-sandover-vs-edoardo-giunipero-ferraris",
    "battling-examples-diana-bros-vs-paul-chua-naic-2019",
    "battling-example-will-tansley-vs-nils-dunlop-worlds-2017",
  ] as const;
  export function tagSubtype(slug: string): null | "battle-replay";
  ```
- **TSDoc:** the six-element block; `@example` showing both branches.
- **Does NOT do:** anything else. Pure function. ~10 LOC + tests.

#### `src/tools/knowledge/embed.ts` (new)

- **Single responsibility:** thin Voyage AI client. Batches up to 64 inputs per request; retries on 429/5xx with exp backoff; hard fails on 401/403.
  ```ts
  export interface EmbedClientOptions {
    apiKey:        string;                 // from VOYAGE_API_KEY env var
    model:         "voyage-3-lite";        // pinned literal
    maxBatch:      number;                 // default 64
    maxRetries:    number;                 // default 3
    backoffBaseMs: number;                 // default 1000
    fetchImpl?:    typeof fetch;
    clock?:        () => number;
  }
  export interface EmbedClient {
    embed(texts: string[]): Promise<Float32Array[]>;   // length === texts.length; each is 1024-dim
  }
  export function createEmbedClient(opts: EmbedClientOptions): EmbedClient;
  ```
- **HTTP shape:** `POST https://api.voyageai.com/v1/embeddings` body `{ input: string[], model: "voyage-3-lite", input_type: "document" }` (or `"query"` for tool-time queries — see §4). `Authorization: Bearer <key>`. The wrapper handles batching internally — callers always pass the full array; the embed client splits into batches of 64.
- **Library choice:** direct `fetch` rather than the `voyageai` npm SDK. The SDK adds ~80KB and a dependency chain for a single endpoint we'd hit twice (ingest + query). Direct fetch keeps the auth+retry+batch logic in one ~120 LOC file we already test. New dep policy honored.
- **Errors:** `KnowledgeAuthError` on 401/403 (no retry); `KnowledgeEmbeddingError` on retry exhaustion; `RangeError` on dimension mismatch (defensive).
- **Does NOT do:** chunking, persistence, query-vs-document discrimination beyond `input_type`.

#### `src/tools/knowledge/search.ts` (new)

- **Single responsibility:** thin agent-tool wrapper around `knowledge.search` repo method. Validates input via zod; handles the embed-the-query step (calls `embed.ts` with `input_type: "query"`); passes the query vector to the repo; returns `KnowledgeSearchHit[]`.
  ```ts
  export interface KnowledgeSearchDeps {
    db:          Db;
    embedClient: EmbedClient;
  }
  export async function knowledgeSearch(
    args: KnowledgeSearchArgs,
    deps: KnowledgeSearchDeps,
  ): Promise<KnowledgeSearchHit[]>;
  ```
- **TSDoc:** all six elements; `@example` showing both filtered and unfiltered queries.
- **Does NOT do:** ingest. Read-side only.

### DB layer (`src/db/`)

#### `src/db/drizzle-schema.ts` (extend, do NOT replace)

Add one `sqliteTable` declaration: `knowledgeChunks`. The `knowledge_chunk_embeddings` virtual table is **not** modeled in Drizzle (drizzle-kit doesn't understand `CREATE VIRTUAL TABLE`); it lives in a hand-augmented section of the migration file (§5.2).

#### `src/db/migrations/0006_knowledge_chunks.sql` (new — drizzle-kit generated, manually augmented)

- Filename `0006_*` per next free integer (latest committed is `0005_short_stryfe.sql` per `ls`).
- The relational table is generated by drizzle-kit. **Then we manually append** the `CREATE VIRTUAL TABLE knowledge_chunk_embeddings USING vec0(embedding float[1024])` statement at the end of the same migration file (per `db_orm_drizzle.md`: "never hand-edit generated SQL" — but vec0 is outside Drizzle's expressivity, so the appended block is documented as an exception with an inline `-- HAND-APPENDED:` comment block per the same memory's stated workaround).
- See §5 for full migration body sketch.

#### `src/db/open.ts` (extend — load sqlite-vec extension)

- **One additive call** inside the `open()` body, immediately after `new Database(...)` and before `pragma("foreign_keys = ON")`:
  ```ts
  loadSqliteVec(raw);   // imported from a new helper src/db/sqlite-vec.ts
  ```
- The helper `loadSqliteVec(raw: SqliteDatabase)` calls `raw.loadExtension(<path>)` where `<path>` is resolved via `sqlite-vec`'s npm package (which ships native `.dylib`/`.so`/`.dll` binaries). On failure (extension not bundled, OS not supported), throw `KnowledgeStorageError` with a clear "install sqlite-vec for your platform" message.
- **TSDoc** explicitly notes the new pre-migration step: `open()` now loads the vec0 extension before any migration runs, since `0006_knowledge_chunks.sql` references `vec0`.
- **Backward compat:** existing tests that construct `:memory:` DBs gain the extension load for free; if `sqlite-vec` isn't installable in CI for some platform, gate via env var `SKIP_SQLITE_VEC=1` that makes `loadSqliteVec` a no-op AND causes `open()` to skip the `0006_*` migration. Discussed in §15 / §16.

#### `src/db/sqlite-vec.ts` (new helper)

- **Single responsibility:** load the `sqlite-vec` extension into a raw `better-sqlite3` handle. Resolves the platform-specific `.dylib`/`.so`/`.dll` from the `sqlite-vec` npm package's published install path; throws `KnowledgeStorageError` with a clear message on failure.
  ```ts
  export function loadSqliteVec(raw: SqliteDatabase): void;
  ```
- **Library choice:** `sqlite-vec@^0.1.x` from npm — ships pre-compiled binaries for darwin (arm64/x64) and linux-x64. Per flow §6 Q2 the user already confirmed it works on their dev machine. New dep flagged in §9.

#### `src/db/knowledge.ts` (new — bespoke repo)

- **Single responsibility:** the bespoke knowledge-chunks repo. Implements `list`, `get`, `search`, `upsertArticleChunks`. Cannot use `createSimpleRepo`: (a) writes are multi-table (relational + virtual sidecar); (b) `search` is a vec-virtual-table query joined back to relational; (c) lookups are coarse-grained (by article_slug) and by id.
- **Exported surface (signatures only — bodies in Stage 5):**
  ```ts
  export function list(db: Db, filter: ChunkFilter): KnowledgeChunk[];
  export function get(db: Db, id: string): KnowledgeChunk | null;
  export function search(db: Db, args: {
    query_vector: Float32Array;
    k:            number;
    exclude_subtypes?:       Array<"battle-replay">;
    article_section_filter?: Array<"intro" | "teambuilding" | "battling">;
  }): KnowledgeSearchHit[];
  export function upsertArticleChunks(db: Db, input: {
    article_slug: string;
    body_hash:    string;
    chunks:       Omit<KnowledgeChunk, "embedding_ref">[];
    embeddings:   Float32Array[];                 // length matches chunks
  }): { inserted: number; replaced: number; skipped_unchanged: boolean };
  export function articleBodyHash(db: Db, article_slug: string): string | null;
  ```
- **TSDoc:** all six elements per export. Mirrors `pikalytics.ts`/`tournaments.ts`/`sets.ts`.
- **Why bespoke (per CLAUDE.md §10 justification):** multi-table assembly (relational + vec0 virtual). The factory generalizes single-table reference data; here every write touches two tables in one transaction and reads use vec-virtual-table SQL. Exactly the case the factory deliberately doesn't generalize.

#### `src/db/tool-definitions.ts` (extend)

- Append **one** tool definition to `ROSTER_TOOL_DEFINITIONS`: `knowledgeSearchTool`.
- Input schema generated via `tool(...)` helper from `KnowledgeSearchArgsSchema`.
- Description is verbatim the agent-facing text in §4.

### Ingest script (`scripts/data/`)

#### `scripts/data/ingest-vgcguide.ts` (new — top-level script)

- **Single responsibility:** the weekly ingest entry point. Walks `client.fetchSitemap()`, derives slugs, body-hash skip-existing per article, fetches HTML, extracts, chunks, embeds (batched), upserts. Pseudocode in §13.

#### `scripts/vgc-knowledge-demo.ts` (new — operator script per flow §6 Q8)

- **Single responsibility:** ad-hoc operator script that runs 4–5 hardcoded conceptual queries (e.g. "how should I think about speed control on a sun team?", "when should I switch?", "what makes a team consistent?"), pretty-prints the top-3 hits per query with article title, section, and a 2-line snippet. Mirrors `scripts/pikalytics-demo.ts` shape.

### Data + fixtures

#### `data/cache/vgcguide/` (new, **gitignored**)

Disk cache for raw HTML responses. One file per `<slug>` key; finite TTL.

#### `fixtures/vgcguide/` (new, committed, immutable)

See §11. Five fixtures (3 real articles per major section + 1 synthetic short + 1 synthetic battle-replay).

#### `fixtures/knowledge/seeded-vectors/` (new, committed, immutable)

The deterministic-retrieval test fixture: 6 query vectors + ~50 chunk vectors hand-tuned so the cosine-similarity ranking matches the expected article. Generated once via a one-shot script; committed verbatim. See §11.

### Tests

```
tests/schemas/knowledge.test.ts
tests/tools/vgcguide/extract-article.test.ts
tests/tools/vgcguide/chunk.test.ts
tests/tools/vgcguide/tag-subtype.test.ts
tests/tools/vgcguide/client.test.ts
tests/tools/knowledge/embed.test.ts
tests/tools/knowledge/search.test.ts
tests/db/knowledge.test.ts
tests/db/knowledge-no-tera.test.ts
tests/db/sqlite-vec-bootstrap.test.ts
tests/db/tool-definitions-knowledge.test.ts
tests/scripts/ingest-vgcguide.test.ts
tests/scripts/ingest-vgcguide-idempotency.test.ts
tests/contract/vgcguide-live.test.ts                    (gated by RUN_CONTRACT_TESTS=1)
tests/contract/voyage-live.test.ts                      (gated by RUN_CONTRACT_TESTS=1)
```

---

## 3. Data schemas (zod, full bodies — sketch; final lands in Stage 5)

```ts
// src/schemas/knowledge.ts
import { z } from "zod";

const ISODateTime = z.string().datetime({ offset: false });
const Sha256Hex   = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const SlugStr     = z.string().regex(/^[a-z0-9-]+$/);
const ArticleSection = z.enum(["intro", "teambuilding", "battling"]);
const Subtype        = z.enum(["battle-replay"]).nullable();   // null | "battle-replay"

export const KnowledgeSourceBlockSchema = z.object({
  site:         z.literal("vgcguide"),
  fetched_at:   ISODateTime,
  author:       z.string().min(1).nullable(),
  captured_via: z.string().min(1),         // "vgcguide-ingest@<git-sha>"
}).strict();

export const KnowledgeChunkSchema = z.object({
  schema_version:    z.literal(1),
  id:                z.string().regex(/^vgcguide:[a-z0-9-]+:\d+$/),
  source_site:       z.literal("vgcguide"),
  article_slug:      SlugStr,
  article_title:     z.string().min(1).max(200),
  article_url:       z.string().url(),
  article_section:   ArticleSection,
  section_heading:   z.string().min(1).max(300),
  chunk_index:       z.number().int().nonnegative(),
  chunk_text:        z.string().min(1).max(4000),     // ~500 tokens upper-bound w/ headroom
  chunk_token_count: z.number().int().min(1).max(500),
  subtype:           Subtype,
  body_hash:         Sha256Hex,
  embedding_ref:     z.string().regex(/^knowledge_chunk_embeddings:\d+$/),
  source:            KnowledgeSourceBlockSchema,
}).strict();

// Pre-embedding aggregate (extractor + chunker output, before upsert).
export const KnowledgeSnapshotSchema = z.object({
  article_slug:    SlugStr,
  article_title:   z.string().min(1).max(200),
  article_url:     z.string().url(),
  article_section: ArticleSection,
  body_hash:       Sha256Hex,
  subtype:         Subtype,
  chunks:          z.array(KnowledgeChunkSchema.omit({ embedding_ref: true })).max(200),
  fetched_at:      ISODateTime,
}).strict();

export const ChunkFilterSchema = z.object({
  article_slug:    SlugStr.optional(),
  article_section: ArticleSection.optional(),
  subtype:         Subtype.optional(),
  limit:           z.number().int().min(1).max(500).optional(),
}).strict();

export const KnowledgeSearchArgsSchema = z.object({
  query:                  z.string().min(3).max(500),
  k:                      z.number().int().min(1).max(20).optional(),       // default 5
  exclude_subtypes:       z.array(z.enum(["battle-replay"])).optional(),
  article_section_filter: z.array(ArticleSection).optional(),
}).strict();

export const KnowledgeSearchHitSchema = z.object({
  id:              z.string().regex(/^vgcguide:[a-z0-9-]+:\d+$/),
  article_slug:    SlugStr,
  article_title:   z.string(),
  article_url:     z.string().url(),
  article_section: ArticleSection,
  section_heading: z.string(),
  subtype:         Subtype,
  chunk_text:      z.string(),
  cosine_score:    z.number().min(-1).max(1),
}).strict();
```

**Why `.strict()`:** same reasoning as pikalytics §3 — silent strip-on-extra-keys is the wrong semantics for ingested content. If the extractor surfaces an unknown field (e.g. a `tera_*` smell), strict rejects rather than silently drops.

**`subtype` is `z.enum(["battle-replay"]).nullable()` not `z.string().nullable()`:** the closed enum is the contract per flow §6 Q4. Adding new subtypes is a deliberate schema change (and a new migration on the CHECK constraint in §5).

**`chunk_token_count` constraint is hard 500:** the chunker MUST emit chunks ≤500 tokens. If it doesn't, the schema rejects — second line of defense behind the chunker's own assertion.

---

## 4. Tool contracts

### 4.1 `knowledge.search` (single agent-callable tool — flow §6 Q9)

```ts
async function knowledgeSearch(
  args: KnowledgeSearchArgs,
  deps: KnowledgeSearchDeps,
): Promise<KnowledgeSearchHit[]>;
```

**Anthropic SDK tool description** (full text lands in Stage 5; sketch):

> `knowledge_search` — semantic search over the curated VGC tutorial corpus from vgcguide.com. Returns the top-k tutorial passages whose embeddings are most similar to your `query`, with each hit carrying the source article's title, URL, and the parent section heading so you can cite verbatim. Pass `exclude_subtypes: ["battle-replay"]` for principle-focused queries (the 3 historical battle-replay articles dominate by narrative density on broad searches). Pass `article_section_filter: ["intro"]` for new-player-onboarding queries. The returned `chunk_text` is verbatim — quote it directly with the `article_url` cited. Use this for conceptual VGC questions (speed control, switching, predictions, team preview, item theory). For meta usage data prefer `pikalytics_*`, for tournament results prefer `labmaus_*`, for set provenance prefer `pokepaste_*`.

**Pre-conditions:** zod passes; `VOYAGE_API_KEY` env var set (else fail-loud `KnowledgeAuthError` from `embedClient`).

**Post-conditions:** result length ≤ `args.k ?? 5`, ordered by `cosine_score DESC`. Each hit's `id` resolves through `knowledge.get`. If `exclude_subtypes` includes `"battle-replay"`, no hit has `subtype === "battle-replay"`. If `article_section_filter` is set, every hit's `article_section` is in the filter.

**Errors:** `KnowledgeAuthError` (env var missing / Voyage 401); `KnowledgeEmbeddingError` (Voyage retry exhaustion); `RosterDbError` (sqlite I/O); zod rejection wrapped per repo convention.

**Throttle/cache:** the embed call is **not** throttled per-host (Voyage is paid; we hit the rate limit only when batching the entire corpus, not on single-query runtime). The embed call is **not cached** at the file-cache layer either — query embeddings are diverse and short-lived. (Future optimization: an in-memory LRU keyed on the query string. Out of scope v1.)

### 4.2 `SPEC.md` outline (`src/tools/vgcguide/SPEC.md`)

Mandatory sections per CLAUDE.md §8:

1. **Tool registered:** `knowledge_search` only (per flow §6 Q9 — single-tool surface).
2. **Endpoint contract:** `https://www.vgcguide.com/sitemap.xml` (returns 53 article URLs); `https://www.vgcguide.com/<slug>` (returns Squarespace-rendered HTML; body in `.sqs-html-content`).
3. **Inputs / outputs (zod verbatim):** `KnowledgeSearchArgsSchema` + `KnowledgeSearchHitSchema`.
4. **Edge cases:**
   - Sitemap returns ≠ 53 URLs (warn + continue with whatever it returned).
   - Article HTML missing `.sqs-html-content` → `VgcGuideParseError`.
   - Article body has zero h2/h3 → single implicit section per the extractor's permissive branch.
   - Article body extracts but tokenizes to 0 chunks → log + skip article.
   - Voyage 429 → exp backoff per labmaus pattern; abort article after retries; log.
   - sqlite-vec virtual table dimension mismatch on insert → `KnowledgeStorageError` (programmer bug).
5. **Citation rules:** every persisted chunk carries `article_url` (cited verbatim by the agent) + `section_heading` + `source.author` (when discoverable) + `source.fetched_at`. The agent's `knowledge_search` output exposes `article_url` and `section_heading` per hit.
6. **Error matrix:** mirrors §8.
7. **Reg M-A hygiene:** zero Tera content in the corpus per the 2026-05-08 body scan; defensive no-tera property test in `tests/db/knowledge-no-tera.test.ts` catches future regressions.
8. **Cache + throttle:** 2 RPS on `vgcguide.com`; finite TTL 7 days on article HTML cache (re-fetch politeness — stable Squarespace responses don't drift, but the 7-day window catches Aaron's edits without being too aggressive).
9. **Out of scope:** per-species strategy notes, transcript ingest, comments, multi-language, retrieval re-ranking via cross-link graph.

---

## 5. Drizzle schema additions

Per memory `db_orm_drizzle.md`: declarations live in `src/db/drizzle-schema.ts`; relational migration generated by drizzle-kit; vec0 virtual table is appended manually with a clear `-- HAND-APPENDED:` block (drizzle-kit can't express virtual tables — documented exception per the memory's stated workaround).

### 5.1 Relational table — added to `src/db/drizzle-schema.ts`

```ts
// added to src/db/drizzle-schema.ts (after pikalyticsSnapshots)
export const knowledgeChunks = sqliteTable("knowledge_chunks", {
  id:               text("id").primaryKey(),
  sourceSite:       text("source_site").notNull(),       // 'vgcguide'
  articleSlug:      text("article_slug").notNull(),
  articleTitle:     text("article_title").notNull(),
  articleUrl:       text("article_url").notNull(),
  articleSection:   text("article_section").notNull(),   // 'intro' | 'teambuilding' | 'battling'
  sectionHeading:   text("section_heading").notNull(),
  chunkIndex:       integer("chunk_index").notNull(),
  chunkText:        text("chunk_text").notNull(),
  chunkTokenCount:  integer("chunk_token_count").notNull(),
  subtype:          text("subtype"),                     // NULL | 'battle-replay'
  bodyHash:         text("body_hash").notNull(),
  embeddingRef:     text("embedding_ref").notNull(),     // 'knowledge_chunk_embeddings:<rowid>'
  fetchedAt:        text("fetched_at").notNull(),
  author:           text("author"),                      // nullable
  capturedVia:      text("captured_via").notNull(),
}, (t) => [
  uniqueIndex("uq_knowledge_article_chunk").on(t.articleSlug, t.chunkIndex),
  index("idx_knowledge_section").on(t.articleSection),
  index("idx_knowledge_subtype").on(t.subtype),
  index("idx_knowledge_body_hash").on(t.articleSlug, t.bodyHash),
  check("knowledge_source_site_value", sql`${t.sourceSite} = 'vgcguide'`),
  check("knowledge_section_value",
        sql`${t.articleSection} IN ('intro','teambuilding','battling')`),
  check("knowledge_subtype_value",
        sql`${t.subtype} IS NULL OR ${t.subtype} = 'battle-replay'`),
  check("knowledge_token_count_range", sql`${t.chunkTokenCount} BETWEEN 1 AND 500`),
  check("knowledge_body_hash_format",  sql`${t.bodyHash} GLOB 'sha256:*'`),
]);
```

### 5.2 Migration `src/db/migrations/0006_knowledge_chunks.sql`

Generated by `pnpm drizzle-kit generate` for the relational portion, then **hand-appended** with the vec0 virtual table block at the end. The `-- HAND-APPENDED:` block is the documented workaround per `db_orm_drizzle.md`.

Sketch (final lands in Stage 5):

```sql
-- Generated by drizzle-kit
CREATE TABLE knowledge_chunks (
  id                 TEXT PRIMARY KEY NOT NULL,
  source_site        TEXT NOT NULL,
  article_slug       TEXT NOT NULL,
  article_title      TEXT NOT NULL,
  article_url        TEXT NOT NULL,
  article_section    TEXT NOT NULL,
  section_heading    TEXT NOT NULL,
  chunk_index        INTEGER NOT NULL,
  chunk_text         TEXT NOT NULL,
  chunk_token_count  INTEGER NOT NULL,
  subtype            TEXT,
  body_hash          TEXT NOT NULL,
  embedding_ref      TEXT NOT NULL,
  fetched_at         TEXT NOT NULL,
  author             TEXT,
  captured_via       TEXT NOT NULL,
  CONSTRAINT knowledge_source_site_value     CHECK (source_site = 'vgcguide'),
  CONSTRAINT knowledge_section_value         CHECK (article_section IN ('intro','teambuilding','battling')),
  CONSTRAINT knowledge_subtype_value         CHECK (subtype IS NULL OR subtype = 'battle-replay'),
  CONSTRAINT knowledge_token_count_range     CHECK (chunk_token_count BETWEEN 1 AND 500),
  CONSTRAINT knowledge_body_hash_format      CHECK (body_hash GLOB 'sha256:*')
);
CREATE UNIQUE INDEX uq_knowledge_article_chunk ON knowledge_chunks (article_slug, chunk_index);
CREATE INDEX idx_knowledge_section            ON knowledge_chunks (article_section);
CREATE INDEX idx_knowledge_subtype            ON knowledge_chunks (subtype);
CREATE INDEX idx_knowledge_body_hash          ON knowledge_chunks (article_slug, body_hash);

-- HAND-APPENDED: drizzle-kit cannot emit CREATE VIRTUAL TABLE.
-- Per db_orm_drizzle.md, virtual tables (FTS5, vec0, etc.) are the
-- documented exception to the "never hand-edit generated SQL" rule.
-- The vec0 module ships with the sqlite-vec extension loaded at open() time.
CREATE VIRTUAL TABLE knowledge_chunk_embeddings USING vec0(
  embedding float[1024] distance_metric=cosine
);
```

**Vec0 distance metric — pinned to cosine.** `distance_metric=cosine` is a required argument on the vec0 module — `knowledge.ts::search` maps `cosine_score = clamp(1 - distance, -1, 1)`, which only makes mathematical sense when `distance` is `1 - cos(θ)`. Under the vec0 default (squared Euclidean / L2), `1 - distance` is meaningless — VGC-T46 happens to pass under L2 only because the seeded vectors are unit-normalized. Pinning `cosine` makes the contract explicit and ports straight to non-normalized vectors when the corpus grows. (Stage 6 deviation §19.4 row a — the red migration shipped without the metric and was retroactively patched at green.)

### 5.3 Linking `knowledge_chunks` ↔ `knowledge_chunk_embeddings`

**Decision: explicit rowid via `embedding_ref`.** Each `knowledge_chunks.embedding_ref` stores the literal string `"knowledge_chunk_embeddings:<rowid>"` where `<rowid>` is the integer rowid the vec0 virtual table assigned on insert. Reads do the join in SQL:

```sql
SELECT kc.*, e.distance
FROM (
  SELECT rowid, distance
  FROM knowledge_chunk_embeddings
  WHERE embedding MATCH ?         -- query vector blob
  ORDER BY distance
  LIMIT ?
) AS e
JOIN knowledge_chunks kc
  ON kc.embedding_ref = ('knowledge_chunk_embeddings:' || CAST(e.rowid AS TEXT));
```

**Why explicit rowid string rather than parallel-rowid trick:**

- The "parallel rowid" approach (insert into both tables in lockstep so rowids match) is brittle: any transaction rollback or future migration that shuffles `knowledge_chunks` rowids breaks the link silently.
- The explicit `embedding_ref` is self-describing, survives any future re-clustering, and round-trips through the schema validation.
- The cost is one indirection on read (which the JOIN handles). Negligible at corpus scale (~1000 rows).

**Filter ordering in `knowledge.search` SQL:**

Apply `exclude_subtypes` and `article_section_filter` in the **outer** query (post-vec, post-JOIN). The vec0 module doesn't support arbitrary WHERE clauses on its virtual rows; pre-filtering would require either (a) a per-filter materialized table (overkill), or (b) over-fetching from vec0 and discarding (acceptable but wasteful at large k). At corpus scale (~1000 chunks, k≤20), post-filter the JOIN result is fine. **Pinned: post-filter** with rationale documented inline.

### 5.4 Migration ordering

- `0006_knowledge_chunks.sql` lands additively after `0005_short_stryfe.sql`.
- Pre-flight: `open()` calls `loadSqliteVec(raw)` BEFORE applying migrations, so the `vec0` module is available when `0006_*.sql` executes (§2 — extension to `src/db/open.ts`).
- If `SKIP_SQLITE_VEC=1` is set, `loadSqliteVec` is a no-op AND the migration runner skips `0006_*.sql`. CI without sqlite-vec installed can run the older test suite intact. (See §15.)

---

## 6. Repository design

### 6.1 `src/db/knowledge.ts` (bespoke)

Same pattern as `pikalytics.ts`/`tournaments.ts`/`sets.ts`: `WeakMap<Db, Prepared>` of pre-compiled statements; one bundle constructor per logical query. Errors wrap as `RosterDbError` (DB I/O — reused) and `RosterDataError` (corrupt-row decoding — reused via `parseOrThrow`); tool-layer errors stay in the `Knowledge*Error` family.

| Method | SQL strategy | Indexes used |
|---|---|---|
| `list(db, filter)` | `SELECT * FROM knowledge_chunks WHERE …` with optional `article_slug = ?`, `article_section = ?`, `subtype = ?` clauses; `ORDER BY article_slug, chunk_index`; `LIMIT ?`. Decode each row via `parseOrThrow(KnowledgeChunkSchema, …)` plus a `source` block reconstructed from `(fetched_at, author, captured_via)` columns. | `uq_knowledge_article_chunk` (covers slug+chunk_index sort), `idx_knowledge_section`, `idx_knowledge_subtype`. |
| `get(db, id)` | `SELECT * FROM knowledge_chunks WHERE id = ?`. `parseOrThrow(KnowledgeChunkSchema, …)` on the row. | PK lookup. |
| `search(db, args)` | The vec0 + JOIN SQL in §5.3, with `WHERE` clause additions for the optional filters at the outer level. `query_vector` passed as a `Float32Array` blob (vec0 accepts the BLOB form). Decode hits via `parseOrThrow(KnowledgeSearchHitSchema, …)`. | vec0 internal index; PK on `embedding_ref` lookup-by-string is non-indexed but cheap (~k rows after the LIMIT). If profiling reveals it matters, add a future index `idx_knowledge_embedding_ref` — flagged but not v1. |
| `upsertArticleChunks(db, input)` | **Single transaction:** (1) compare `articleBodyHash(db, slug)` to `input.body_hash` — if equal, return `{inserted:0, replaced:0, skipped_unchanged:true}`; (2) if not equal: `DELETE FROM knowledge_chunks WHERE article_slug = ?` (cascading via app code: also DELETE the corresponding vec rows by their `embedding_ref` rowids — see below); (3) insert each chunk; (4) for each chunk, insert into `knowledge_chunk_embeddings` and capture the new rowid; (5) UPDATE the chunk's `embedding_ref` to point at the new rowid. Returns `{inserted, replaced, skipped_unchanged: false}`. | All inserts are PK / virtual-table. The delete relies on `idx_knowledge_body_hash` for the per-slug scan. |
| `articleBodyHash(db, article_slug)` | `SELECT body_hash FROM knowledge_chunks WHERE article_slug = ? LIMIT 1`. Returns `null` if no row. | `idx_knowledge_body_hash`. |

**Replace-on-mismatch deletion of vec rows:** before deleting from `knowledge_chunks`, the repo first runs `SELECT embedding_ref FROM knowledge_chunks WHERE article_slug = ?`, parses the rowids, then `DELETE FROM knowledge_chunk_embeddings WHERE rowid IN (...)`. Done inside the same transaction. The vec0 virtual table supports `DELETE WHERE rowid IN (...)` natively.

**Why not a single FK with ON DELETE CASCADE?** vec0 virtual tables don't participate in SQL foreign-key cascades. The app-layer cascade is the standard pattern (sqlite-vec docs recommend it).

All exported functions get full TSDoc per CLAUDE.md §10.

### 6.2 Why `knowledge` cannot use `createSimpleRepo`

The factory generalizes (a) one table, (b) two indexes (id + display_name), (c) a `rowToEntity`. None of `knowledge`'s methods fit:
- `search` is a multi-table vec0 + JOIN.
- `upsertArticleChunks` is a multi-table transactional write.
- `list` has multi-column filters (slug + section + subtype).
- `get` is by id but the row reconstruction needs the `source` block synthesized from three columns.

Same reasoning that kept `pikalytics.ts` bespoke applies. Per CLAUDE.md §10 the factory deliberately doesn't generalize that far.

### 6.3 Reuse of upstream simple repos and bespoke repos

None applicable. `knowledge` doesn't reference `species` or any roster-tied data — vgcguide articles are species-agnostic principle content (per flow §2.10 scope-out: per-species strategy is a separate slice). No FK to `species.id`. No alias resolution. No `roster.get` calls.

---

## 7. Architecture patterns + the why

| Pattern | Where it lands | Why this slice |
|---|---|---|
| **Repository pattern** | `src/db/knowledge.ts` | Same reasoning as every prior data slice: prepared statements + zod parsing in one place; the agent never sees raw SQL or vec0 internals. |
| **Ports-and-adapters** | `VgcGuideClient` interface vs `createVgcGuideClient` impl; `EmbedClient` interface vs `createEmbedClient`; `knowledge.search` repo takes a query vector (no embed-client coupling); `knowledgeSearch` agent tool injects both deps | Lets us pass fakes (mocked `fetchImpl`, mocked Voyage) and a `:memory:` Db in tests. Enables the seeded-vector deterministic test in §10. |
| **Anti-corruption layer** | The `extract-article` + `chunk` + `tag-subtype` pipeline between Squarespace HTML and our domain | Keeps HTML-shape-coupling in one place; downstream code never sees raw HTML. |
| **Pure-extractor / pure-chunker separation** | `extract-article.ts` and `chunk.ts` are independent | Per the lesson from pikalytics's parser/transform split: pure functions tested against committed fixtures catch upstream drift early. |
| **Schema-first (zod)** | `src/schemas/knowledge.ts` is the contract; types derive via `z.infer` | Per CLAUDE.md §5. |
| **Command/query split inside the repo** | `list` / `get` / `search` are read-only (agent runtime); `upsertArticleChunks` + `articleBodyHash` are write/build-side | Read-only DB handles power the agent at runtime; the ingest script holds the write handle. |
| **Read-through, finite-TTL cache** | `client.ts` checks `data/cache/vgcguide/<slug>.json` before fetching; 7-day TTL | Per flow §2.7. Squarespace responses are stable but Aaron edits articles occasionally; 7-day window catches edits, body_hash check skips re-embedding when content's actually unchanged. |
| **Skip-existing on body_hash** | `upsertArticleChunks` returns `skipped_unchanged: true` if hash matches; ingest accumulates into run summary | Per `single_db_non_destructive_build.md`. The body_hash is the natural key. |
| **Defense-in-depth for Reg M-A** | Schema `.strict()` + property test scanning persisted rows for `/tera/i` | Per memory `regulation_m_a_no_tera.md`. Empirically a non-issue today (zero Tera matches in 53 articles per flow §2 baseline) but the test catches a future regression cheaply. |
| **Reject-and-log split per failure class** | Article-class failures (`VgcGuide*`, `KnowledgeEmbeddingError`) accumulate into run summary; programmer/operator class (`KnowledgeAuthError`, `KnowledgeStorageError`) propagate | Per pikalytics §7 / pokepaste §8. Auth and storage errors mean "we can't run at all" — fail loud. |
| **Two-tier DB (relational + vector sidecar)** | `knowledge_chunks` (relational) + `knowledge_chunk_embeddings` (vec0 virtual) joined via `embedding_ref` | Per `data_layer_two_tier_db.md`: one DB file, sqlite-vec extension. **First consumer of the vector tier — pattern lands here for future slices.** |

**Considered and rejected:**
- **Generic `documents` table reusable across vgcguide + future YouTube transcript ingest + Insight extraction.** Rejected: only vgcguide ships in this slice; the Insight model (CLAUDE.md §6) is a different shape (atomic claims, not chunks). Premature abstraction; cross-source semantic search lives in a future `knowledge-merger` slice.
- **LanceDB or Chroma instead of sqlite-vec.** Rejected per flow §6 Q2 (user confirmed sqlite-vec works fine on dev machine); separate-file vector store would force two-DB transactional semantics that we don't need at corpus scale.
- **In-process embedding (e.g. `@xenova/transformers`).** Rejected: native binary chains are heavier than a paid API call; quality is worse on tutorial content; ~310K tokens × Voyage's $0.02/1M ≈ $0.008 cold-start total is negligible.
- **Storing the raw HTML in DB.** Rejected: file cache holds it; no DB column needed.
- **Per-section child table (`vgcguide_sections`).** Rejected: section data is denormalized into each chunk row by design (cheap at ~1000 rows, lets `WHERE article_section = ?` use a single-table index).

---

## 8. Error model

| Class | Trigger | Severity | Where thrown | Where caught |
|---|---|---|---|---|
| `VgcGuideNotFoundError` | HTTP 404 on sitemap or article | data | `client.ts` | ingest logs into `not_found[]`, continues |
| `VgcGuideNetworkError` | non-2xx (other than 404) after retries | infra | `client.ts` | ingest logs into `network_failures[]`, continues |
| `VgcGuideParseError` | extractor returned empty body / no `.sqs-html-content` | data | `extract-article.ts` | ingest logs into `parse_failures[]`, continues |
| `KnowledgeEmbeddingError` | Voyage 429/5xx after retry exhaustion | infra (per-article) | `embed.ts` | ingest logs into `embedding_failures[]`, continues |
| `KnowledgeAuthError` | `VOYAGE_API_KEY` missing or Voyage returns 401/403 | **fail loud — operator** | `embed.ts` (constructor + first call) | nowhere — propagates; ingest exits 1 |
| `KnowledgeStorageError` | sqlite-vec extension not loadable; vec0 dimension mismatch on insert | **fail loud — programmer/operator** | `sqlite-vec.ts`, `knowledge.ts` `upsertArticleChunks` | nowhere — propagates; ingest exits 1 |
| `RosterDbError` (reused) | SQLite I/O on `knowledge_chunks` | infra | `knowledge.ts` | callers; ingest exits 1 |
| `RosterDataError` (reused) | Persisted row fails `KnowledgeChunkSchema` on read | corruption | `parseOrThrow` in `knowledge.ts` | tests; agent path crashes loud |

### 8.1 Reject-and-log contract

Per pikalytics §8.1 — same per-article failure semantics:

1. **Article 404** → `not_found[]` entry, no row written, continue.
2. **Parse error** (extractor returns empty) → `parse_failures[]` entry, no row written, continue.
3. **Network exhaustion** → `network_failures[]` entry, no row written, continue.
4. **Embedding retry exhaustion (per-article 429/5xx)** → `embedding_failures[]` entry, no row written for that article, continue. Other articles continue.
5. **`KnowledgeAuthError`** → propagate. **Fail loud.** Auth means we can't ingest anything; continuing is wasted work.
6. **`KnowledgeStorageError`** → propagate. **Fail loud.** Programmer/operator class.

---

## 9. Reuse audit

**Reused (do not duplicate):**
- **`src/tools/_shared/throttle.ts`** — `createTokenBucket({ refillPerSec: 2, clock })`. The hostless primitive labmaus (1 RPS), pokepaste (2 RPS), pikalytics (1 RPS) already use; vgcguide constructs its own 2-RPS instance. **Materially shrinks the plan: ~20 LOC saved + already-tested.** This is the third+ consumer per the task brief.
- **`src/tools/_shared/file-cache.ts`** — `createFileCache({ dir, ttlMs: 7 * 24 * 60 * 60 * 1000, clock })`. Already supports finite TTL. Vgcguide uses `<slug>` as cache key. **~30 LOC saved + already-tested.**
- **`parseOrThrow` from `src/db/simple-repo.ts`** — for decoding `knowledge_chunks` rows back into `KnowledgeChunk` in `knowledge.ts`. Same pattern as `pikalytics.ts`/`tournaments.ts`/`sets.ts`.
- **`Db`, `open()` from `src/db/open.ts`** — same DB file, additive migration. (Extended with `loadSqliteVec` call — see §2.)
- **`RosterDbError`, `RosterDataError`** from `src/schemas/errors.ts` — for storage I/O and corrupt-row decoding.
- **The `tool(...)` helper in `src/db/tool-definitions.ts`** — extended, not duplicated; the new tool shares the JSON-Schema generation pipeline.
- **`zod-to-json-schema`** (already a dep) — for tool input JSON schema.
- **`better-sqlite3`, `drizzle-orm`, `drizzle-kit`, `zod`** — already pinned in `package.json`.
- **Run-summary shape pattern** from pokepaste/pikalytics — mirrored in §13.
- **Exp-backoff retry pattern** from labmaus/pokepaste/pikalytics clients — mirrored in `client.ts` and `embed.ts`.
- **Day-one tool registration discipline** from pokepaste's BLOCKER lesson — preempted in `tool-definitions.ts`.

**`createSimpleRepo` does NOT apply to `knowledge_chunks`** — multi-table assembly with vec0 sidecar, transactional upsert, multi-column filters. Justified in §6.2 per CLAUDE.md §10. **`roster.get` / `roster.has` do NOT apply** — vgcguide doesn't reference roster species in any structured way per the task brief and flow §2.10.

**NEW dependencies introduced (each justified — per the contract: explicit subsection on "considered <existing dep>, here's why it doesn't fit"):**

1. **`sqlite-vec@^0.1.x`** (npm) — the vector store extension. Loaded at `open()` time. **Considered: not adding a vector store at all** — rejected because semantic search is the entire point of this slice (cosine similarity on ~310K-token corpus needs ANN-grade indexing). **Considered: LanceDB / Chroma** — rejected per flow §6 Q2 (separate file = two-DB transactions = complexity not warranted at corpus scale). **Considered: `sqlite-vss`** — rejected: deprecated by its author in favor of `sqlite-vec`; `sqlite-vec` is the active fork. **Considered: pgvector via local Postgres** — rejected: out of scope (we're SQLite-native per `data_layer_two_tier_db.md`).

2. **`node-html-parser@^6.x`** (npm) — HTML extractor in `extract-article.ts`. **Considered: `cheerio`** — rejected: ~10x heavier, jQuery-like API we don't need. **Considered: `parse5`** — rejected: spec-compliant but verbose API, overkill for "find `.sqs-html-content`, walk h2/h3/p". **Considered: regex** — rejected: nested HTML + regex is the canonical anti-pattern; the headings-vs-paragraphs walk is exactly the case where a parser is justified.

3. **`@anthropic-ai/tokenizer`** (npm) — token counting in `chunk.ts`. **Considered: `tiktoken`** — equally fine; both are deterministic BPE-style tokenizers. **Pinned: `@anthropic-ai/tokenizer`** because we already have `@anthropic-ai/sdk` as a dep, and consolidating to one Anthropic-published primitive minimizes dep-tree surface. **Considered: hand-rolled word-counting** — rejected: word counts are 10x noisier than BPE token counts; chunk size budgets would be unreliable.

4. **No `voyageai` SDK** — direct `fetch` is simpler and lighter; one endpoint, ~120 LOC of auth+retry+batch. Documented in §2.

**No other new deps.** No new test framework (vitest's `vi.fn()` covers `fetchImpl` injection). No new HTTP client (built-in `fetch`).

---

## 10. Test strategy + ordering

User-approved order from flow §6 Q10: **schema → extractor → chunker → subtype tagger → client (mocked HTTP) → embed (mocked Voyage) → repo (in-memory sqlite-vec) → ingest end-to-end → idempotency → contract**. Tests numbered in writing order.

The §3 pure-data-definition exemption applies to schema-only tests **VGC-T1–VGC-T6**. Everything from VGC-T7 onward is strict per-test Red→Green; any vacuous-green slip must be flagged in the change report.

Numbering: `VGC-T<n>`. Avoids cross-slice number conflict with PIKA-T*, POKE-T*, LAB-T*.

| # | Test file | Test name | Asserts | Min code to green |
|---|---|---|---|---|
| VGC-T1 | `tests/schemas/knowledge.test.ts` | `KnowledgeChunkSchema parses Speed Control fixture chunk` | a hand-built fixture chunk parses; `embedding_ref` matches the regex | `KnowledgeChunkSchema` |
| VGC-T2 | `tests/schemas/knowledge.test.ts` | `KnowledgeChunkSchema rejects unknown keys via .strict()` | injected `tera_type: "Fire"` extra key fails | `.strict()` |
| VGC-T3 | `tests/schemas/knowledge.test.ts` | `KnowledgeChunkSchema rejects chunk_token_count > 500` | input with 501 fails | `chunkTokenCount` range |
| VGC-T4 | `tests/schemas/knowledge.test.ts` | `KnowledgeChunkSchema accepts subtype: null and "battle-replay"` | both branches parse; `"foo"` fails | `Subtype` enum-nullable |
| VGC-T5 | `tests/schemas/knowledge.test.ts` | `KnowledgeSearchArgsSchema requires query length >= 3` | `query: "ab"` fails; `"abc"` passes | `min(3)` |
| VGC-T6 | `tests/schemas/knowledge.test.ts` | `ChunkFilterSchema accepts every-field-optional empty object` | `{}` parses | `.optional()` chain |
| VGC-T7 | `tests/tools/vgcguide/extract-article.test.ts` | `extractVgcGuideArticle pulls h2/h3/p tree from real Speed Control HTML` | fixture `speed-control.html` produces `ExtractedArticle` with N sections, M paragraphs, all text-only | `extract-article.ts` impl |
| VGC-T8 | `tests/tools/vgcguide/extract-article.test.ts` | `extractVgcGuideArticle throws VgcGuideParseError when .sqs-html-content missing` | mutated fixture without the container; assert throw | strict-on-container check |
| VGC-T9 | `tests/tools/vgcguide/extract-article.test.ts` | `extractVgcGuideArticle handles article with no h2/h3 (single implicit section)` | synthetic short fixture; one section, all paragraphs collapsed | permissive branch |
| VGC-T10 | `tests/tools/vgcguide/extract-article.test.ts` | `extractVgcGuideArticle strips script/style/figure/aside` | fixture with script tags injected; assert text excludes them | sanitizer |
| VGC-T11 | `tests/tools/vgcguide/extract-article.test.ts` | `extractVgcGuideArticle preserves heading-level discrimination (h2 vs h3)` | mixed-heading fixture; assert `heading_level: 2 \| 3` per section | walker logic |
| VGC-T12 | `tests/tools/vgcguide/chunk.test.ts` | `chunkExtractedArticle produces single chunk for short section` | one-section fixture < 200 tokens; assert one chunk; `chunk_index: 0` | base case |
| VGC-T13 | `tests/tools/vgcguide/chunk.test.ts` | `chunkExtractedArticle never crosses h2/h3 boundary` | multi-section fixture; assert each chunk's `section_heading` is unique to one section | boundary-respect logic |
| VGC-T14 | `tests/tools/vgcguide/chunk.test.ts` | `chunkExtractedArticle splits long section with 50-token overlap` | hand-constructed 1200-token section; assert ≥3 chunks; assert last 50 tokens of chunk N appear at start of chunk N+1 | overlap logic |
| VGC-T15 | `tests/tools/vgcguide/chunk.test.ts` | `chunkExtractedArticle never exceeds 500 tokens per chunk` | corpus-wide property: every emitted chunk has `chunk_token_count ≤ 500` | hard cap enforcement |
| VGC-T16 | `tests/tools/vgcguide/chunk.test.ts` | `chunkExtractedArticle assigns 0-based chunk_index across whole article` | multi-section fixture; assert `chunk_index` is `0..N-1` contiguously | counter |
| VGC-T17 | `tests/tools/vgcguide/chunk.test.ts` | `chunkExtractedArticle skips empty sections with raw_warning` | fixture with empty section; assert it doesn't appear in chunks; warning logged | empty-section branch |
| VGC-T18 | `tests/tools/vgcguide/chunk.test.ts` | `chunkExtractedArticle assigns ids of form vgcguide:<slug>:<i>` | fixture; assert id pattern | id constructor |
| VGC-T19 | `tests/tools/vgcguide/tag-subtype.test.ts` | `tagSubtype returns "battle-replay" for the 3 known slugs` | each of the 3 slugs → `"battle-replay"` | hardcoded list |
| VGC-T20 | `tests/tools/vgcguide/tag-subtype.test.ts` | `tagSubtype returns null for any other slug` | "speed-control", "team-preview", random strings → `null` | default branch |
| VGC-T21 | `tests/tools/vgcguide/client.test.ts` | `fetchSitemap returns parsed article URLs from sitemap.xml` | mocked fetch returns fixture sitemap.xml; assert ≥3 URLs returned, all canonical | XML parse + URL filter |
| VGC-T22 | `tests/tools/vgcguide/client.test.ts` | `fetchArticleHtml URL is correct` | mocked fetch sees `https://www.vgcguide.com/<slug>` | URL builder |
| VGC-T23 | `tests/tools/vgcguide/client.test.ts` | `fetchArticleHtml throws VgcGuideNotFoundError on 404 (no retry)` | mocked 404; one fetch call; throw | 404 branch |
| VGC-T24 | `tests/tools/vgcguide/client.test.ts` | `fetchArticleHtml retries 429/5xx with exp backoff` | mocked 429,500,200; assert 3 attempts | retry loop |
| VGC-T25 | `tests/tools/vgcguide/client.test.ts` | `fetchArticleHtml surrenders after maxRetries on 5xx` | throws `VgcGuideNetworkError` carrying `.status` | error wrap |
| VGC-T26 | `tests/tools/vgcguide/client.test.ts` | `client throttles to 2 RPS (independent bucket)` | inject clock; fire 5 calls; assert pacing matches 2 RPS | shared `createTokenBucket` instance |
| VGC-T27 | `tests/tools/vgcguide/client.test.ts` | `client reads from disk cache when present and not expired` | seed cache; assert `fetchImpl` unused | `_shared/file-cache.ts` finite-TTL mode |
| VGC-T28 | `tests/tools/vgcguide/client.test.ts` | `client respects 7-day TTL: stale entry triggers refetch` | seed cache with `fetchedAt: now - 8d`; assert `fetchImpl` called | finite-TTL path |
| VGC-T29 | `tests/tools/vgcguide/client.test.ts` | `client does NOT cache 404 responses` | first 404, no file; second call hits network again | conditional cache write |
| VGC-T30 | `tests/tools/knowledge/embed.test.ts` | `embed returns 1024-dim vectors per input` | mocked Voyage 200 returns 5 vectors; assert lengths and dim | impl + JSON parse |
| VGC-T31 | `tests/tools/knowledge/embed.test.ts` | `embed batches inputs of size > 64 into multiple calls` | feed 130 inputs; assert 3 fetch calls (64+64+2) | batching loop |
| VGC-T32 | `tests/tools/knowledge/embed.test.ts` | `embed retries on 429 with exp backoff` | 429,200; assert 2 calls | retry loop |
| VGC-T33 | `tests/tools/knowledge/embed.test.ts` | `embed throws KnowledgeAuthError on 401 (no retry)` | 401; assert one call, fail-loud throw | auth branch |
| VGC-T34 | `tests/tools/knowledge/embed.test.ts` | `embed throws KnowledgeAuthError when VOYAGE_API_KEY env unset` | construct client with `apiKey: ""`; first call throws | constructor / first-call check |
| VGC-T35 | `tests/tools/knowledge/embed.test.ts` | `embed throws KnowledgeEmbeddingError after retry exhaustion on 5xx` | 500,500,500,500; assert throws after 3 retries; `.cause` chain | exhaustion path |
| VGC-T36 | `tests/db/sqlite-vec-bootstrap.test.ts` | `open() loads sqlite-vec extension and creates vec0 virtual table` | open `:memory:`, `SELECT name FROM sqlite_master WHERE name='knowledge_chunk_embeddings'`; assert one row | `loadSqliteVec` + 0006 migration |
| VGC-T37 | `tests/db/sqlite-vec-bootstrap.test.ts` | `loadSqliteVec throws KnowledgeStorageError when extension load fails` | inject a fake `loadExtension` that throws; assert custom error message | error wrap |
| VGC-T38 | `tests/db/knowledge.test.ts` | `upsertArticleChunks inserts chunks + embeddings atomically` | seed 3 chunks + 3 vectors; assert 3 rows in both tables; `embedding_ref` resolves | upsert impl |
| VGC-T39 | `tests/db/knowledge.test.ts` | `upsertArticleChunks skip-existing returns skipped_unchanged when body_hash unchanged` | upsert twice with same body_hash; second call: `{inserted:0, replaced:0, skipped_unchanged:true}` | hash check |
| VGC-T40 | `tests/db/knowledge.test.ts` | `upsertArticleChunks replaces both relational and vec rows when body_hash differs` | upsert; mutate hash; upsert again; old vec rowids gone, new ones present | cascade delete |
| VGC-T41 | `tests/db/knowledge.test.ts` | `upsertArticleChunks throws KnowledgeStorageError on dimension mismatch` | feed a 512-dim vector; assert throw | dim guard |
| VGC-T42 | `tests/db/knowledge.test.ts` | `get(id) returns the chunk or null on miss` | seeded id → row; unseeded → null | PK lookup |
| VGC-T43 | `tests/db/knowledge.test.ts` | `list with article_section filter returns only matching rows` | seed 5 rows across sections; filter "intro"; assert subset | indexed scan |
| VGC-T44 | `tests/db/knowledge.test.ts` | `list with subtype filter returns only matching rows` | seed mixed; filter `"battle-replay"`; assert subset | filter branch |
| VGC-T45 | `tests/db/knowledge.test.ts` | `articleBodyHash returns latest hash for slug or null` | seeded slug → hash; unseeded → null | dedicated query |
| VGC-T46 | `tests/db/knowledge.test.ts` | `search returns top-k by cosine on seeded vectors (deterministic fixture)` | seed 50 chunks + their committed vectors from `fixtures/knowledge/seeded-vectors/`; run each of the 6 sanity queries with their committed query-vector; assert top-1 matches expected article | vec0 + JOIN SQL |
| VGC-T47 | `tests/db/knowledge.test.ts` | `search exclude_subtypes filters out battle-replay chunks` | seed mixed; query that would otherwise return a battle-replay top-1; pass `exclude_subtypes:["battle-replay"]`; assert top-1 is non-battle-replay | post-filter branch |
| VGC-T48 | `tests/db/knowledge.test.ts` | `search article_section_filter restricts to sections` | seed mixed; pass `article_section_filter:["intro"]`; assert all hits' section is intro | post-filter branch |
| VGC-T49 | `tests/db/knowledge.test.ts` | `search returns empty array when no chunks present` | empty DB; assert `[]` | empty-state |
| VGC-T50 | `tests/db/knowledge-no-tera.test.ts` | `no row in knowledge_chunks has any column or chunk_text matching /tera/i` | introspect cols + scan all `chunk_text`; assert no match | (vacuous green if §5 schema right + extractor doesn't surface tera in current corpus; explicit guard catches future regressions — flagged for §3 vacuous-green slip in change report) |
| VGC-T51 | `tests/db/tool-definitions-knowledge.test.ts` | `knowledge_search is registered in ROSTER_TOOL_DEFINITIONS` | assert `knowledge_search` present (preempts pokepaste's Stage 6 BLOCKER per flow §6 Q9) | append in `tool-definitions.ts` |
| VGC-T52 | `tests/db/tool-definitions-knowledge.test.ts` | `knowledge_search tool has stable JSON schema (no $ref)` | snapshot test | reuse `tool(...)` helper |
| VGC-T53 | `tests/tools/knowledge/search.test.ts` | `knowledgeSearch end-to-end: query → embed → repo.search → hits` | inject mocked embed client + seeded DB; assert hits ordered + filtered | wiring |
| VGC-T54 | `tests/tools/knowledge/search.test.ts` | `knowledgeSearch surfaces KnowledgeAuthError on bad API key` | inject embed client that throws auth; assert propagates | no swallow |
| VGC-T55 | `tests/scripts/ingest-vgcguide.test.ts` | `ingest --no-network runs end-to-end on cached fixtures (3 articles)` | seed cache with 3 fixtures + mocked embed client; assert 3 articles persisted; run summary populated | orchestration |
| VGC-T56 | `tests/scripts/ingest-vgcguide.test.ts` | `ingest logs not_found on 404 article` | `fetchImpl` returns 404 for one slug; assert summary `not_found` populated; exit 0 | catch-and-log |
| VGC-T57 | `tests/scripts/ingest-vgcguide.test.ts` | `ingest logs parse_failures on bad HTML` | seed cache with non-Squarespace HTML; assert `parse_failures` populated; exit 0 | catch `VgcGuideParseError` |
| VGC-T58 | `tests/scripts/ingest-vgcguide.test.ts` | `ingest logs embedding_failures on Voyage retry exhaustion (per article)` | mocked embed client throws `KnowledgeEmbeddingError` for one article; assert `embedding_failures` populated; other articles persist; exit 0 | per-article catch |
| VGC-T59 | `tests/scripts/ingest-vgcguide.test.ts` | `ingest fails loud on KnowledgeAuthError` | mocked embed client throws auth; assert script exits non-zero immediately | no catch for auth class |
| VGC-T60 | `tests/scripts/ingest-vgcguide.test.ts` | `ingest fails loud on KnowledgeStorageError` | mocked repo throws storage; assert non-zero exit | no catch for storage class |
| VGC-T61 | `tests/scripts/ingest-vgcguide.test.ts` | `ingest skip-existing on body_hash: rerunning produces zero embedding API calls` | first run; second run with same fixtures + mocked embed client whose `embed()` is a `vi.fn()`; assert second run's call count is 0 | body_hash pre-check |
| VGC-T62 | `tests/scripts/ingest-vgcguide-idempotency.test.ts` | `running ingest twice produces zero knowledge_chunks deltas` | snapshot DB hash before+after second run; equal | (no new code if VGC-T39 + VGC-T61 green) |
| VGC-T63 | `tests/contract/vgcguide-live.test.ts` (gated) | `live vgcguide HTML for /speed-control extracts non-empty body` | real fetch; `extractVgcGuideArticle` returns ≥1 section, ≥1 paragraph | (no new code) |
| VGC-T64 | `tests/contract/voyage-live.test.ts` (gated) | `live Voyage embed call returns 1024-dim vector for one query` | real `embed(["test"])`; assert `[0].length === 1024` | (no new code) |

**Pure-data exemption flag:** VGC-T1–VGC-T6 (schema-only). VGC-T50 qualifies for the §3 "vacuous green slip" flag — the implementor must call it out in the change report.

**Total numbered tests:** 64. Above the 25–40 target band, but the slice has unusually many surface areas: HTML parser, chunker (3 boundary modes), tag-subtype, throttled+cached client, batched embed client, vec0 sidecar, multi-table transactional upsert, deterministic seeded-vector retrieval (the load-bearing first-of-kind test for the vector tier), 6-way ingest branch coverage, 2 contract tests. Compression candidates if reviewer wants: merge VGC-T19/T20 (both subtype tagger), merge VGC-T22/T23 into VGC-T21 (sitemap+article fetch), drop VGC-T62 (implicit if T39+T61 green). Left split for Stage 4 clarity.

### 10.1 Seeded-vector deterministic retrieval (VGC-T46) — load-bearing detail

Real Voyage embeddings are non-deterministic across model versions (and Voyage may patch `voyage-3-lite` silently). A test that asserts top-1 retrieval correctness using **real** embeddings is a flake waiting to happen. Stage 4 ships `fixtures/knowledge/seeded-vectors/` containing:

- `chunks.json` — 50 hand-built chunk records (subset of the corpus, deterministic).
- `vectors.bin` — 50 1024-dim Float32Array vectors, persisted as a binary file. The vectors are crafted so that for each of the 6 sanity queries below, the cosine ranking lands the correct chunk top-1.
- `queries.json` — the 6 query strings with their committed query-vector and expected `top1.article_slug`.

The 6 queries (per flow §5 + §6 Q5):
1. "what is speed control" → expected `speed-control`
2. "when should I switch" → expected `switching`
3. "how do I read team preview" → expected `team-preview`
4. "predicting opponent moves" → expected `predictions`
5. "type chart logic for VGC" → expected an `intro` article on type matchups
6. "choosing items for my team" → expected `items`

**Generation procedure (one-shot, executed during Stage 4 fixture creation, NOT during Stage 3):** craft 50 vectors by starting from semi-random unit vectors, then nudging the 6 expected-top-1 vectors toward their respective query vectors until cosine ranking is correct and stable. Commit the resulting `vectors.bin` + `queries.json`. The test loads them verbatim. Stage 5 production code uses real Voyage embeddings (live ingest); the seeded fixture stays separate and tests the **retrieval path**, not the embedding quality.

**Stage 5 sanity-check on real embeddings:** the `scripts/vgc-knowledge-demo.ts` operator script (per flow §6 Q8) runs the same 6 queries against the real-Voyage-populated DB and prints results for human inspection. NOT a CI-gated test (because of the flake risk above), but the operator runs it after each ingest to catch quality regressions.

---

## 11. Fixtures plan

All fixtures committed and immutable; filenames carry capture date.

```
fixtures/vgcguide/
  2026-05-08__intro-rules-of-vgc.html              (real, fetched live — intro section, mid-length)
  2026-05-08__teambuilding-speed-control.html      (real — teambuilding section, long, h2-rich)
  2026-05-08__battling-predictions.html            (real — battling section, mid-length, h3-rich)
  2026-05-08__synthetic-short.html                 (hand-crafted: < 200 tokens, single implicit section)
  2026-05-08__synthetic-battle-replay.html         (hand-crafted: mimics battling-example slug; tests subtype tagger end-to-end)
  2026-05-08__synthetic-no-container.html          (hand-crafted: missing .sqs-html-content; for VGC-T8)
  2026-05-08__sitemap.xml                          (real sitemap with 53 article URLs)

fixtures/knowledge/seeded-vectors/
  chunks.json                                      (50 chunk records spanning the 6 sanity-query target articles)
  vectors.bin                                      (50 × 1024 × Float32 = 200KB; binary, committed)
  queries.json                                     (6 queries + their query-vector + expected top1)
```

Variety dimensions (per CLAUDE.md §11):
- **Real vs synthetic.** Three real (one per article section) for extractor realism; three synthetic for edge cases (short article, battle-replay, missing container).
- **Section-completeness.** Real fixtures span all three sections (intro / teambuilding / battling).
- **Heading depth.** Speed Control fixture is h2-rich; Predictions is h3-rich — exercises both heading_level branches in `chunk.ts`.
- **Token-density.** Speed Control is long (multiple split chunks expected); Synthetic Short is single-chunk; Battle Replay is medium narrative.
- **Reg M-A hygiene.** None of the fixtures inject Tera content (matches the corpus reality per flow §2 baseline). The defensive no-tera property test (VGC-T50) doesn't need a positive synthetic Tera fixture — adding one would lie about the corpus.

Capture procedure (one-shot, executed at fixture-creation time, NOT during Stage 3):

```bash
curl -sS 'https://www.vgcguide.com/sitemap.xml' \
  -H 'User-Agent: pokemon-ai-trainer/0.1 (rodser4@gmail.com)' \
  > fixtures/vgcguide/2026-05-08__sitemap.xml
curl -sS 'https://www.vgcguide.com/speed-control' \
  -H 'User-Agent: pokemon-ai-trainer/0.1 (rodser4@gmail.com)' \
  > fixtures/vgcguide/2026-05-08__teambuilding-speed-control.html
# repeat for the two other real articles
# hand-author the three synthetic fixtures
# generate the seeded-vectors fixture per §10.1
```

Cache path (`data/cache/vgcguide/`) is gitignored; fixtures stay committed.

---

## 12. Cache + throttle implementation

**Hand-rolled is already done — both primitives in `src/tools/_shared/`.** Vgcguide consumes the existing implementations.

### 12.1 Throttle — instance-owned bucket per client

Per flow §2.7: vgcguide at **2 RPS** (Squarespace; politeness; no observed rate limit).

```ts
// In createVgcGuideClient
import { createTokenBucket } from "../_shared/throttle";
const bucket = createTokenBucket({ refillPerSec: opts.throttleRps ?? 2, clock: opts.clock });
// every fetchSitemap / fetchArticleHtml call: await bucket.acquire(); then network.
```

Verified by VGC-T26.

### 12.2 Disk cache — finite TTL

```ts
// In createVgcGuideClient
import { createFileCache } from "../_shared/file-cache";
const cache = createFileCache({
  dir:    opts.cacheDir,                                  // e.g. data/cache/vgcguide
  ttlMs:  opts.cacheTtlMs ?? 7 * 24 * 60 * 60 * 1000,     // 7 days
  clock:  opts.clock,
});
```

- **Cache key shape:** `<slug>` (single-input). Per CLAUDE.md §8, the cache key includes all inputs.
- **Why 7 days, not infinity:** Aaron Traylor edits articles occasionally (per flow §2.5). 7 days catches edits within one cron cycle without re-fetching every cron run. The body_hash check in the upsert path then skips re-embedding if the content actually didn't drift after a re-fetch.
- **Why not infinity + force-refresh flag:** complicates the cron cadence. The 7-day TTL is the simpler model.
- **404 NOT cached** — same reasoning as pikalytics.
- Atomic writes (`tmp + rename`) — already in `_shared/file-cache.ts`.

### 12.3 Embed-side caching

**Not implemented v1.** Voyage rate limits and pricing make repeat-query caching valuable (an LRU on the query string), but the v1 query volume is the operator demo + agent runtime — both rare enough to skip. Flagged as a future optimization in §16. The embed client itself is cache-free.

### 12.4 Retry

On `429`/`5xx`: sleep `backoffBaseMs * 2^attempt` (jittered ±20%); up to `maxRetries=3`. `4xx` other than 429:
- 404 → `VgcGuideNotFoundError` (no retry)
- 401/403 from Voyage → `KnowledgeAuthError` (no retry, fail loud)
- other 4xx → `VgcGuideNetworkError` / `KnowledgeEmbeddingError`

Same shape as labmaus + pokepaste + pikalytics.

### 12.5 Gitignore additions

Append to `.gitignore`:
```
data/cache/vgcguide/
```

Fixture files under `fixtures/vgcguide/` and `fixtures/knowledge/seeded-vectors/` stay committed.

---

## 13. Ingest / build orchestration

`scripts/data/ingest-vgcguide.ts` — new top-level script. Pseudocode (final lands in Stage 5):

```ts
async function main(argv: string[], deps?: IngestDeps): Promise<number> {
  const opts = parseArgs(argv);  // --db, --no-network, --slug (single-article debug)
  const db = open(opts.db);

  const apiKey = process.env.VOYAGE_API_KEY ?? "";
  if (!apiKey && !opts.noNetwork) {
    throw new KnowledgeAuthError("VOYAGE_API_KEY env var is required for ingest");
  }

  const client = deps?.client ?? createVgcGuideClient({
    cacheDir:      process.env.VGCGUIDE_CACHE_DIR ?? "data/cache/vgcguide",
    throttleRps:   2,
    maxRetries:    3,
    backoffBaseMs: 1000,
    cacheTtlMs:    7 * 24 * 60 * 60 * 1000,
    fetchImpl:     opts.noNetwork ? cacheOnlyFetch : fetch,
  });

  const embedClient = deps?.embedClient ?? createEmbedClient({
    apiKey,
    model:         "voyage-3-lite",
    maxBatch:      64,
    maxRetries:    3,
    backoffBaseMs: 1000,
  });

  const summary = {
    articles_fetched:           0,
    articles_skipped_unchanged: 0,
    chunks_inserted:            0,
    chunks_re_embedded:         0,
    embedding_failures:         [] as Array<{ slug: string; message: string }>,
    network_failures:           [] as Array<{ slug: string; status?: number; message: string }>,
    parse_failures:             [] as Array<{ slug: string; message: string }>,
    not_found:                  [] as string[],
  };

  const urls = opts.slug
    ? [`https://www.vgcguide.com/${opts.slug}`]
    : await client.fetchSitemap();

  for (const url of urls) {                          // serial: 2 RPS bottleneck
    const slug = slugFromUrl(url);
    const section = sectionFromUrl(url);             // intro | teambuilding | battling
    try {
      const fetched = await client.fetchArticleHtml(slug);
      summary.articles_fetched += 1;
      const body_hash = "sha256:" + sha256Hex(fetched.html);

      const existing = knowledge.articleBodyHash(db, slug);
      if (existing === body_hash) {
        summary.articles_skipped_unchanged += 1;
        continue;
      }

      const extracted = extractVgcGuideArticle({ slug, html: fetched.html });
      const subtype = tagSubtype(slug);
      const { chunks } = chunkExtractedArticle({
        slug,
        article_url:    fetched.article_url,
        article_title:  extracted.article_title,
        article_section: section,
        extracted,
        body_hash,
        fetched_at:     fetched.fetched_at,
        subtype,
        captured_via:   `vgcguide-ingest@${gitSha()}`,
      });

      const vectors = await embedClient.embed(chunks.map((c) => c.chunk_text));
      const result = knowledge.upsertArticleChunks(db, {
        article_slug: slug,
        body_hash,
        chunks,
        embeddings: vectors,
      });
      summary.chunks_inserted    += result.inserted;
      summary.chunks_re_embedded += result.replaced;

    } catch (e) {
      if (e instanceof VgcGuideNotFoundError) {
        summary.not_found.push(slug);
        continue;
      }
      if (e instanceof VgcGuideParseError) {
        summary.parse_failures.push({ slug, message: e.message });
        continue;
      }
      if (e instanceof VgcGuideNetworkError) {
        summary.network_failures.push({ slug, status: e.status, message: e.message });
        continue;
      }
      if (e instanceof KnowledgeEmbeddingError) {
        summary.embedding_failures.push({ slug, message: e.message });
        continue;
      }
      // KnowledgeAuthError + KnowledgeStorageError + everything else: fail loud.
      console.error(`[ingest-vgcguide] FATAL for ${slug}:`, e);
      throw e;
    }
  }

  console.log(JSON.stringify({ ok: true, ...summary }));
  return 0;
}
```

### Argv handling

- `--db <path>` — DB file path.
- `--no-network` — forces cache-only; used by tests and dry runs. Pre-flight check (per pikalytics deviation): if cache dir is empty/missing, exit 1 with clear message.
- `--slug <article-slug>` — debug single-article mode; bypasses sitemap fetch.
- `VOYAGE_API_KEY` env var — required (unless `--no-network`).
- `VGCGUIDE_CACHE_DIR` env var — overrides cache dir.

### Parallelism

Serial. The 2 RPS throttle on the HTTP side is the natural bottleneck (53 articles ÷ 2 RPS ≈ 27s for the cold-start sitemap walk); embedding batches of 64 happen in-loop (~1000 chunks ÷ 64 = ~16 batches at <1s each). Total cold-start: ~27s HTTP + ~16s embed + DB writes ≈ well under the 10-min budget.

Per-article parallelism inside the loop wouldn't help (the bucket caps wall-clock anyway) and would complicate error attribution.

### Exit codes

- `0` — clean run, including bounded `not_found` / `parse_failures` / `network_failures` / `embedding_failures`.
- `1` — `KnowledgeAuthError`, `KnowledgeStorageError`, DB error, or any uncaught exception.
- `2` — escalation gate (post-MVP): if `network_failures.length + embedding_failures.length > 5%` of articles, exit 2 so cron alerting fires. v1 stays at `0/1` only.

### Observability

Single JSON-line summary on stdout at end; per-article progress to stderr. The run summary fields per flow §6 Q7:

```json
{
  "ok": true,
  "articles_fetched": 53,
  "articles_skipped_unchanged": 0,
  "chunks_inserted": 1023,
  "chunks_re_embedded": 0,
  "embedding_failures": [],
  "network_failures": [],
  "parse_failures": [],
  "not_found": []
}
```

---

## 14. Definition of Done mapping (CLAUDE.md §11)

| Box | This slice |
|---|---|
| Flow doc reviewed | YES — `docs/flows/vgc-knowledge-base.md` Stage 2 approved 2026-05-08. |
| Tech plan approved | THIS DOC — pending. |
| Failing test first (commit history visible) | enforced by Stage 4 ordering in §10; commit `test: red — vgc-knowledge-base`. |
| `pnpm test` passes | Stage 5 exit gate. |
| `pnpm typecheck` passes | Stage 5 exit gate; strict TS, typed signatures everywhere per §2 module specs. |
| `pnpm lint` passes | Stage 5 exit gate. |
| New external data schema-validated and fixture-backed | `KnowledgeChunkSchema` + 7 fixtures (3 real + 3 synthetic + sitemap) + seeded-vectors fixture. |
| User-facing claim cited | every persisted chunk carries `article_url` (cited verbatim) + `section_heading` + `source.author` (when discoverable) + `source.fetched_at`. The `knowledge_search` tool output exposes `article_url` and `section_heading` per hit. |
| Docs touched | `tools/vgcguide/SPEC.md` written first; `.gitignore` updated (`data/cache/vgcguide/`); CLAUDE.md untouched (no new convention introduced — sqlite-vec workaround documented in `db_orm_drizzle.md` already covers virtual tables as the exception). |
| Reviewer subagent ran | Stage 6. |

**Uncovered by this slice (explicitly):**
- **Per-species strategy notes ingestion** — separate future slice per flow §2.10.
- **Other VGC sources** (Smogon strategy dexes, JustinFlynn / Aaron Zheng video transcripts) — separate flows.
- **Cross-link-graph re-ranking** — speculative; deferred per flow §2.10.

---

## 15. Rollout / feature-flag

- **Always-on, no flag.** New tool and new tables don't affect existing surfaces; the agent's tool catalog gains one tool (`knowledge_search`), inert until invoked. Empty `knowledge_chunks` → tool returns empty array, which is the correct empty-state.
- **Migration ordering.** `0006_knowledge_chunks.sql` lands after `0005_short_stryfe.sql`. No FK to `species` or any other existing table — vgcguide is independent of all prior slices.
- **`SKIP_SQLITE_VEC=1` escape hatch.** If sqlite-vec isn't installable on a CI image (rare; the npm package ships pre-compiled binaries for darwin arm64/x64 and linux x64 per their releases), `SKIP_SQLITE_VEC=1` makes `loadSqliteVec` a no-op AND tells the migration runner to skip `0006_*.sql`. Existing tests stay green; knowledge tests (VGC-T36+) skip cleanly. This is a **build-time** flag, NOT a runtime feature flag — production always loads the extension. Documented in `src/db/sqlite-vec.ts` TSDoc + a one-line note in CLAUDE.md §1's environment section if reviewer wants (out of scope for v1 per CLAUDE.md untouched goal above).
- **Cron cadence.** Weekly per flow §6 Q6. Recommended `pnpm ingest:vgcguide` cron entry; `package.json` `scripts` block extended (Stage 5).
- **Hard dependency on `VOYAGE_API_KEY`.** The ingest script fails loud at startup if missing. The runtime `knowledge_search` tool also fails loud (via `embed.ts`'s constructor check) if the env var is missing — graceful-degradation isn't appropriate for an "every recommendation cited" north star. CLAUDE.md §10 secrets policy already covers `.env.local` discipline.
- **No hard dependency on labmaus / pokepaste / pikalytics.** Vgcguide is independent.
- **Backfill cadence.** vgcguide doesn't expose historical versions of articles. We capture forward in time only; the body_hash check is the natural mechanism.

---

## 16. Risks + mitigations

1. **sqlite-vec native binary not loadable on operator's platform.** Per flow §6 Q2 the user has confirmed it works on their dev machine, but a future reinstall (Apple Silicon → Intel laptop, NixOS, etc.) might break. **Mitigation:** `loadSqliteVec` throws `KnowledgeStorageError` with a clear "install sqlite-vec for your platform" message including the npm install command. The `SKIP_SQLITE_VEC=1` escape hatch lets non-knowledge tests run on broken environments. CI-side, we document the install in the test-fixture procedure (§11). If we hit a platform we can't install on, fall back to LanceDB per the flow's deferred alternative.
2. **HTML extractor regresses on Squarespace template change.** Aaron's site is Squarespace-rendered; if Squarespace ships a template update that moves `.sqs-html-content` to `.sqs-block-content` or similar, our extractor breaks silently on every article. **Mitigation:** VGC-T63 (live contract test, gated by `RUN_CONTRACT_TESTS=1`) re-fetches one article weekly under cron and asserts non-empty extraction. Drift surfaces loudly. The `parse_failures[]` run-summary field also makes silent regression visible in the cron output. SPEC.md documents the container-class contract verbatim.
3. **Voyage API model retirement / silent quality drop.** Voyage could deprecate `voyage-3-lite` or silently swap weights. **Mitigation:** the model is pinned literal in `embed.ts`; a model swap requires a code change (and a re-embedding run since dim could change). The 1024-dim is hard-coded in the migration's `vec0` declaration — a model that returns a different dim fails loud at insert (VGC-T41). VGC-T64 (live contract gated) catches an "API still returns 1024" regression. Operator demo (`scripts/vgc-knowledge-demo.ts`) catches quality drift human-in-the-loop.
4. **Aaron edits an article in a way that breaks deterministic-vector test if we ever switch to real-embedding-baked fixtures.** **Mitigation:** the seeded-vectors fixture is deliberately decoupled from real Voyage output (per §10.1). Real-embedding quality regressions surface via the operator demo, not CI. If the corpus changes, we regenerate seeded vectors (one-shot script).
5. **Battle-replay slug list drifts (Aaron renames a battle-replay article).** **Mitigation:** the hardcoded list is a 3-element array (per flow §6 Q4); any new battle-replay article goes through a deliberate code review. The cost of a missed tag is small (a battle-replay chunk shows up in principle queries — the agent learns to filter via `exclude_subtypes` empirically). Worst-case operator catches via the demo. If maintenance burden grows, we revisit a regex-based tagger or a frontmatter-driven one.

---

## 17. Open questions for plan review

1. **Tokenizer choice: `@anthropic-ai/tokenizer` vs `tiktoken`.** §2 / §9 propose `@anthropic-ai/tokenizer` for dep-tree consolidation (we already have `@anthropic-ai/sdk`). `tiktoken` is the OpenAI ecosystem default — heavier WASM but slightly more stable across versions. **Proposal:** `@anthropic-ai/tokenizer`. Reviewer's call before Stage 4 imports it.
Answer: anthropic tokenizer it is.

2. **HTML parser: `node-html-parser` vs `cheerio`.** §2 / §9 propose `node-html-parser` (lighter). `cheerio` is the more battle-tested option (jQuery-like API, large user base) but ~10x heavier and we don't need its features. **Proposal:** `node-html-parser`. Reviewer's call.
Answer: I will go with cheerio for its robustness and familiarity, even if it's heavier. The HTML parsing is a critical part of the pipeline and I want to minimize the risk of edge cases breaking it.

3. **Migration filename convention for hand-augmented vec0 block.** §5.2 proposes appending `-- HAND-APPENDED:` block to the drizzle-kit-generated `0006_*.sql`. `db_orm_drizzle.md` says "never hand-edit generated SQL" but documents virtual tables as the exception. The plan honors the memory but the workaround is genuinely new in this repo. **Alternative:** put the vec0 statement in a separate `0007_knowledge_vec0.sql` purely-hand-authored migration (cleaner separation; the relational migration stays drizzle-pure). **Proposal:** alternative — `0007_knowledge_vec0.sql` as a hand-authored sibling. Reviewer to confirm before Stage 4 commits the migrations.
Answer: I agree that a separate `0007_knowledge_vec0.sql` is cleaner and keeps the hand-authored code separate from the generated code. I'll go with that approach.

**Flow-doc gap uncovered:** flow §2.6 says "the `embedding_ref` is opaque — the vector store rows are managed separately" but doesn't explicitly resolve **how the relational and virtual rows are linked**. Two options exist (parallel rowids vs explicit `embedding_ref` string) and they have different failure modes. The plan picks explicit-string (§5.3) with documented rationale, but the flow doc should record the decision so future maintainers don't undo it. Calling out for Stage 2.5 review before Stage 5 lands.
Answer: The explicit `embedding_ref` string is indeed the safer choice for ensuring the relational and virtual rows are linked correctly, especially in the face of potential future schema changes. Make sure to update the flow doc to reflect this decision and the rationale behind it.

**Flow-doc gap (minor):** flow §2.5 notes the `voyageai` SDK "OpenAI-API-compatible request shape" but doesn't pin direct-fetch vs SDK. The plan picks direct fetch (§2 — `embed.ts`) for dep-tree minimization. Calling out so the flow can be updated alongside the plan approval.
Answer: Direct fetch is a good choice for minimizing dependencies and keeping the implementation straightforward. Make sure to update the flow doc to clarify that we're using direct fetch for the embed client, and note the rationale for that choice.

---

## 19. Stage 6 outcomes

### 19.1 Review summary

Full review at [`docs/reviews/vgc-knowledge-base.md`](../reviews/vgc-knowledge-base.md). Verdict: ship-after-blockers. One BLOCKER (`SPEC.md` placeholder), six MAJORs, three MINORs, four NITs. All 11 items in §8 (Suggested refactor batch) applied at the `refactor: apply review — vgc-knowledge-base` commit. Six items deferred per §9 (tabulated in §19.3).

### 19.2 Applied fixes

1. `src/tools/vgcguide/SPEC.md` rewritten — seven sections per §4.2 + verbatim `.sqs-html-content` container-class invariant.
2. VGC-T55–T58 strengthened to capture stdout, parse the JSON-line summary, and assert the expected failure-array contains the offending slug. (Previously asserted only `exit === 0`.)
3. CHECK constraints on `knowledge_chunks.id` (`GLOB 'vgcguide:*'`) and `embedding_ref` (`GLOB 'knowledge_chunk_embeddings:*'`) added to `0006_knowledge_chunks.sql`.
4. Process-level `ingestHashCache` + `lastMainUpserted` deleted from `scripts/data/ingest-vgcguide.ts`. VGC-T61 rewritten to share a temp file DB across two `main()` calls (matches VGC-T62's pattern). Net production code: -30 LOC.
5. Plan §19 added (this section). §5.2 patched to pin `distance_metric=cosine` with rationale.
6. Slug-keyword `inferSectionFromSlug` consolidated into `src/tools/vgcguide/section.ts`; both `extract-article.ts` and `ingest-vgcguide.ts` import from it.
7. Cheerio walker types — `as unknown as never` casts replaced. `domhandler@^5.0.3` added as a direct dep so the `Element` type can be imported by name; the recursive walker now passes `DomElement` references straight to `$()` without coercion.
8. `scripts/vgc-knowledge-demo.ts` short-circuits when `knowledge.list(db, { limit: 1 })` returns empty (avoids burning Voyage embeds on a fresh DB).
9. `src/tools/knowledge/embed.ts` non-retryable 4xx path captures `await res.text()`, prefers Voyage's `{ detail }` field, truncates at 200 chars, and embeds in the `KnowledgeEmbeddingError` message.
10. Per-article stderr progress logging in `ingest-vgcguide.ts` — `[ingest-vgcguide] <slug> <result_kind>`. Plan §13.5 promised this.
11. Flow §2.6 backports the linkage decision: explicit `embedding_ref` string + rationale + cosine-metric note.

### 19.3 Deferrals

Per review §9; revisit when each precondition fires.

| # | Item | Annotation site | Trigger to revisit |
|---|---|---|---|
| 1 | Larger over-fetch multiplier | `src/db/knowledge.ts:225-237` | Corpus > 5K chunks (currently ~750). |
| 2 | `Buffer.from` byteOffset / slice ownership TSDoc | `src/db/knowledge.ts:106-113` | Cosmetic; revisit on next knowledge-repo refactor. |
| 3 | `chunk.ts` token-count re-encode | `src/tools/vgcguide/chunk.ts:117-119` | Profile-driven; ingest hot-path turns CPU-bound. |
| 4 | `sqlite-vec` named import | `src/db/sqlite-vec.ts:13` | Cosmetic; tied to upstream package style. |
| 5 | Sitemap regex CDATA hardening | `src/tools/vgcguide/sitemap.ts:6` | vgcguide sitemap shape ever drifts (CDATA / comments). |
| 6 | Reg M-A `format` literal in `KnowledgeSearchToolInput` | `src/schemas/knowledge.ts:113-114` | Multi-format (non-vgcguide) corpus ever lands. |

Each annotation is an inline `// TODO(stage6-deferred):` comment at the cited line.

### 19.4 Stage 4 / Stage 5 deviations now documented

Mirror of review §7. These are decisions or oversights from the red and green commits that the plan did not previously record; they are now auditable.

| # | Deviation | Where it lives | Resolution |
|---|---|---|---|
| a | `distance_metric=cosine` retroactively added at green; red migration shipped with vec0 L2 default | `src/db/migrations/0007_knowledge_vec0.sql:7` | §5.2 pinned to cosine; rationale recorded above. |
| b | Process-level `ingestHashCache` + `lastMainUpserted` to bridge VGC-T61 vs VGC-T59/T60 | (deleted from `scripts/data/ingest-vgcguide.ts`) | Item 4 above — VGC-T61 rewritten against a file DB; cache deleted. |
| c | `article_section` is inferred from slug keywords, not URL prefix as plan §2.2 originally claimed | `src/tools/vgcguide/section.ts` | Heuristic consolidated; plan §2.2 reading should treat URL-prefix as an aspirational note (the sitemap is flat). |
| d | DB-level CHECK constraints on `id` + `embedding_ref` formats not in plan §5.1 | `src/db/migrations/0006_knowledge_chunks.sql:23-24` | Item 3 above — constraints landed; §5.1 implicitly covered. |
| e | VGC-T36 (sqlite-vec wired in `open()`) Stage 4 deviation | de0e8b1 commit body | Disclosed in the red-commit message. |
| f | VGC-T46 metric-coincidence vacuous green | (no longer vacuous post-pin) | Pinning cosine in §5.2 closes the coincidence; no per-test rewrite required. |
| g | VGC-T50 no-tera vacuous-green disclosure | de0e8b1 commit body | Acceptable per CLAUDE.md §3 last paragraph (regression guard); recorded permanently here. |
| h | VGC-T55–T58 weak assertions | (rewritten — Item 2) | Tests now read the run-summary JSON. |
| i | SPEC.md placeholder | `src/tools/vgcguide/SPEC.md` | Item 1 above — full SPEC written. |
