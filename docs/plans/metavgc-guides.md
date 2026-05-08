# Tech Plan — MetaVGC Guides Ingest (Champions / Reg M-A)

**Slug:** `metavgc-guides`
**Stage:** Stage 3 — Tech plan (pending approval)
**Date:** 2026-05-08
**Author:** Tech Lead subagent
**Implements flow doc:** `docs/flows/metavgc-guides.md` (Stage 1 authored 2026-05-08; Stage 2 sign-off pending — this plan assumes the flow's success criteria are the contract).

**Memory citations:**
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/db_orm_drizzle.md` (Drizzle is the single source of truth; vec0 is the documented hand-authored exception)
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/single_db_non_destructive_build.md` (migration must be additive over existing rows; never unlink the file)
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/data_layer_two_tier_db.md` (vector tier already established by `vgc-knowledge-base`; this slice extends, does not duplicate)
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_no_tera.md` (defense-in-depth no-tera property test reused)
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_roster.md` (species index seeds the tagger from `roster_membership.format = 'RegM-A'`)
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/scope_discovery_via_site_signals.md` (every adapter exports `discoverScope(client)`; no hand-curated allowlists)
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/test_fixtures_no_invariant_blobs.md` (committed binaries don't diff in review — applies to species-index fixtures)
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/labmaus_pokepaste_deferred_todos.md` (greppable `// TODO(stage6-deferred):` discipline reused)

**Sibling precedents:**
- `docs/plans/vgc-knowledge-base.md` — closest precedent. Same data model, same vector tier, same `tools/<site>/{client,extract-article,discover-scope,section,tag-subtype}.ts` shape, same chunker + embed + repo reuse path. **This slice extends that infrastructure to a second site and adds species tagging.**
- `docs/plans/pikalytics.md` — second-closest. Same "ingest script that derives slugs from a site signal, fetches per slug, transforms, persists, body-hash skip-existing" shape. The species-index dependency-on-roster pattern mirrors pikalytics's `roster.get` injection.

**First-of-kind for this slice:**
- **Multi-site `knowledge_chunks` table.** The vgcguide-only CHECK is widened to a closed enum; future sites onboard via the same enum.
- **`species_tags` lightweight retrieval channel.** Per CLAUDE.md §6 the canonical primitive for "what is this about" is `Insight.subjects.pokemon`; we are NOT building Insights here. `species_tags` is a per-chunk filter index — explicitly scoped narrower than Insights.
- **Species tagger as a separate pipeline stage.** The chunker stays site-agnostic; tagging fires between `chunk()` and `embed()` in the ingest script. No site-coupled code reaches the tagger.

---

## 1. Goal recap

Ship a citation-first ingest of metavgc.com's ~54 Champions/Reg M-A guides into the existing `knowledge_chunks` table, alongside a lightweight per-chunk `species_tags` index. Concrete deliverables: a manual-cadence ingest at `scripts/data/ingest-metavgc.ts` walks the metavgc sitemap (excluding the `/pt/guias/` Portuguese mirror and the `/guides` hub root), extracts article bodies via cheerio against semantic HTML (`<h1>` `<h2>` `<h3>` `<p>` `<ul>` `<blockquote>`), reuses the same token-aware chunker and Voyage `voyage-3-lite` embed client as `vgc-knowledge-base`, builds an in-process index of Reg-M-A-legal species display names + aliases, tags each chunk with the canonical species ids it mentions (whole-word, case-insensitive, longest-form-wins on Garchomp vs Garchomp-Mega), and upserts both relational and vec0 sidecar rows under `source_site = 'metavgc'`. Skip-existing on `body_hash` keeps re-runs network-cheap and embedding-API-free. Done means: a SQLite migration `0008_knowledge_multi_site_and_tags.sql` widens the CHECK + unique index + adds nullable `species_tags`, leaving every existing vgcguide row readable; ≥4 fixtures (3 real + 1 synthetic) round-trip; ≥80% of metavgc articles produce ≥1 species_tag on real ingest; two consecutive ingests produce zero embedding API calls; existing vgcguide knowledge tests stay green; live retrieval demo answers "how do I counter Incineroar in Reg M-A?" with the metavgc Incineroar guide top-1; `species_tags` JSON-LIKE filter on `'incineroar'` returns the Incineroar guide chunks first independent of cosine. **Out of scope (deferred to Stage 6 TODO):** species detail pages (`/pokemon/<slug>`), Insight extraction, Portuguese mirror, featured-teams pages, backfill of `species_tags` over existing vgcguide rows.

---

## 2. Module boundaries

All paths absolute under `/Users/rodrigo/src/pokemon-ai-trainer/`. New files unless marked *(extend)*.

### 2.1 Schemas (`src/schemas/`)

#### `src/schemas/knowledge.ts` *(extend)*

- **What changes:** widen `source_site` to a closed enum; add `species_tags`.
- **Surface delta:**
  ```ts
  // Existing literal:
  //   source_site: z.literal("vgcguide")
  // Becomes:
  export const SourceSiteSchema = z.enum(["vgcguide", "metavgc"]);
  // Plus a new optional/nullable column:
  //   species_tags: z.array(SpeciesIdSchema).max(20).nullable()
  ```
- `SpeciesIdSchema` reuses `RosterIdSchema` from `src/schemas/pokemon.ts` (already a strict regex on canonical species ids — confirm in Stage 4; if not present, add it under `pokemon.ts`, NOT under `knowledge.ts`).
- **Persisted JSON contract for `species_tags`:** `null` means "not yet tagged" (existing vgcguide rows that pre-date this slice). `[]` means "tagged, no matches found". A non-empty array is the canonical case. The three states must be distinguishable at read time — both for analytics and for the future Stage 6 backfill of vgcguide rows.
- The `KnowledgeSearchHitSchema` gains `species_tags: z.array(SpeciesIdSchema).nullable()` so the agent can disambiguate hits.
- **Does NOT do:** any of the species-resolution work; that's a tool-layer concern.

#### `src/schemas/errors.ts` *(extend)*

Mirror the `VgcGuide*` family with a `MetaVgc*` family. **Recommendation: rename, do not parallel.** See §8 for the full discussion. Final exported set after rename:

- `KnowledgeArticleNotFoundError` (replaces `VgcGuideNotFoundError`) — HTTP 404 from sitemap or article fetch, carries `.source_site` ∈ `{"vgcguide","metavgc"}` + `.article_slug`. Article-class miss; ingest logs and continues.
- `KnowledgeArticleNetworkError` (replaces `VgcGuideNetworkError`) — non-2xx (other than 404) after retries; carries `.source_site` + `.status`.
- `KnowledgeArticleParseError` (replaces `VgcGuideParseError`) — extractor returned empty body; carries `.source_site`.
- `KnowledgeError` / `KnowledgeAuthError` / `KnowledgeEmbeddingError` / `KnowledgeStorageError` — unchanged.
- **New:** `SpeciesTaggerError` — programmer-class. Trigger: empty species index at ingest start. Fail loud per flow §8 ("species-tagging is a contract, not a nice-to-have").

If the rename is rejected at review, fall back to a parallel `MetaVgcNotFoundError` / `MetaVgcNetworkError` / `MetaVgcParseError` family — see §8 for the cost analysis.

### 2.2 Tool layer (`src/tools/metavgc/` and `src/tools/knowledge/`)

#### `src/tools/metavgc/SPEC.md` (new — written first per CLAUDE.md §8)

Mirrors `src/tools/vgcguide/SPEC.md`. Authored before any test or code. Sections:
1. Tools registered: none new — re-uses `knowledge_search` (already registered with day-one discipline by `vgc-knowledge-base`).
2. Endpoint contract: `https://metavgc.com/sitemap.xml` (sitemap is canonical; ~54 guides at `/guides/<slug>` plus the bilingual mirror at `/pt/guias/<slug>` which we exclude); `https://metavgc.com/guides/<slug>` (semantic HTML, no SquareSpace wrappers).
3. Inputs/outputs (zod verbatim) — same shapes; `source_site = 'metavgc'`.
4. Edge cases: sitemap returns ≠ 54 URLs (warn + continue); article HTML missing `<article>` AND `<main>` body container → `KnowledgeArticleParseError`; `/pt/guias/*` URLs in sitemap (must be filtered); `/guides` hub root (must be filtered); body that extracts but tokenizes to 0 chunks (log + skip).
5. Citation rules: every persisted chunk carries `article_url` (canonical `https://metavgc.com/guides/<slug>`) + `section_heading` + `source.author = "MetaVGC"` + `source.fetched_at`.
6. Reg M-A hygiene: zero Tera content expected (Champions content); defensive no-tera property test reused.
7. Cache + throttle: 2 RPS on `metavgc.com` (no published rate limit; politeness; robots.txt has no Crawl-delay); finite TTL 7 days mirroring vgcguide.
8. Out of scope: per-species `/pokemon/<slug>` pages, featured teams, Portuguese mirror.

#### `src/tools/metavgc/client.ts` (new)

- **Single responsibility:** thin HTTP client. Two methods: `fetchSitemap()` and `fetchArticleHtml(slug)`. **Same shape as `VgcGuideClient`.** Throttled at 2 RPS; exp-backoff 429/5xx retry; finite-TTL disk cache; 404 not cached.
- **Exported surface:**
  ```ts
  export interface MetaVgcClientOptions { /* identical to VgcGuideClientOptions */ }
  export interface MetaVgcArticleFetch {
    slug:        string;
    html:        string;
    article_url: string;          // canonical https://metavgc.com/guides/<slug>
    fetched_at:  string;
  }
  export interface MetaVgcClient {
    fetchSitemap(): Promise<string[]>;
    fetchArticleHtml(slug: string): Promise<MetaVgcArticleFetch>;
  }
  export function createMetaVgcClient(opts: MetaVgcClientOptions): MetaVgcClient;
  ```
- **TSDoc:** all six elements per CLAUDE.md §10.
- **Does NOT do:** parse, tag, persist. Throws `KnowledgeArticleNotFoundError` / `KnowledgeArticleNetworkError`.

#### Shared client interface — recommendation: **DEFER, keep parallel for now**.

Both `VgcGuideClient` and `MetaVgcClient` already satisfy structurally identical interfaces (`fetchSitemap` + `fetchArticleHtml` + identical option bag). Lifting to a shared `KnowledgeArticleClient` interface in `src/tools/_shared/knowledge-client.ts` would let `discoverScope` and the ingest script accept a single type.

**Cost of lifting now:** ~30 LOC of refactor across `src/tools/vgcguide/client.ts` (3 imports, 1 type rename), 1 SPEC.md edit, 1 test rewire (`tests/tools/vgcguide/client.test.ts` tests construct against the named type). Risk: breaks the `// TODO(stage6-deferred):` snapshot of `vgc-knowledge-base` review. **Cost of NOT lifting:** ingest script and any future site-agnostic helper carries a discriminated-union or generic. Both sites' clients are ~150 LOC each — duplication is cheap.

**Decision:** **defer the lift**. The structural typing already lets `discoverScope(client: { fetchSitemap; fetchArticleHtml })` accept either client. The named-interface refactor is a Stage 6 nicety, **flagged as a `// TODO(stage6-deferred): unify-client-interface` comment** at the top of `src/tools/metavgc/client.ts`. Reviewer can vote to escalate. If the reviewer prefers to lift now, the cost is bounded — see §17 Q1.

#### `src/tools/metavgc/extract-article.ts` (new)

- **Single responsibility:** pure-function HTML extractor. Mirrors `extractVgcGuideArticle` shape and walker logic but with metavgc-specific selectors.
- **Exported surface:**
  ```ts
  export function extractMetaVgcArticle(input: {
    slug: string;
    html: string;
  }): ExtractedArticle;   // re-uses ExtractedArticle from vgcguide/extract-article.ts? See decision below.
  ```
- **`ExtractedArticle` type sharing:** **recommendation — keep separate, identical-shaped type.** Lifting `ExtractedSection` + `ExtractedArticle` into `src/tools/knowledge/extracted.ts` (a site-agnostic intermediate) is the cleaner long-term move but is a Stage 6 refactor parallel to the client lift. Defer; the chunker already accepts the duck-typed shape. **`// TODO(stage6-deferred): lift-extracted-article-type`** at the top of the new file.
- **Body container strategy** (semantic HTML, NOT SquareSpace `.sqs-html-content`):
  1. Prefer `<article>` if present (one per page on metavgc per the live probe).
  2. Else `<main>` longest-text descendant by raw text length (defensive fallback mirroring vgcguide's pattern).
  3. Else throw `KnowledgeArticleParseError`.
- **Walker:** same recursive walker as `extract-article.ts`. Tags collected as paragraphs: `p`, `li`, `blockquote`, `h4`. Tags treated as section boundaries: `h2`, `h3`. Tags stripped: `script`, `style`, `figure`, `aside`, `nav`, `footer`, `noscript`. **Title:** `<h1>` first hit; fall back to `<title>`; fall back to slug.
- **`article_section`** is **always `"guides"`** (decision: extend the enum). metavgc has no editorial section structure parallel to vgcguide's intro/teambuilding/battling — the entire site is one tier of guides. Migration `0008` widens the `knowledge_section_value` CHECK to `IN ('intro','teambuilding','battling','guides')`. **No vgcguide backfill is needed** — existing vgcguide rows already satisfy the widened constraint (set membership is monotone). Pinning to `"intro"` was the alternative; rejected as semantically misleading data.
- **Does NOT do:** chunking, tagging, persistence.

#### `src/tools/metavgc/discover-scope.ts` (new)

Per memory `scope_discovery_via_site_signals.md`: every adapter exports `discoverScope(client): Promise<Set<string>>`.

- **Algorithm (sitemap-only — simpler than vgcguide's nav∩sitemap):**
  ```ts
  scope = { slug for url in sitemap.xml
                if url.path.startsWith("/guides/")
                and not url.path.startsWith("/pt/")
                and url.path != "/guides"               // exclude hub root
                and url.path != "/guides/" }
  ```
- The metavgc sitemap is canonical (per the live probe — author-curated, no junk). No nav crawl needed.
- **Exported surface:**
  ```ts
  export function extractMetaVgcSlugs(sitemapXml: string): Set<string>;   // pure, testable
  export async function discoverScope(client: MetaVgcClient): Promise<Set<string>>;
  ```
- **TSDoc** explicitly cites the memory file in the "When to use it" section.
- **Does NOT do:** rank, deduplicate beyond Set semantics, or hit `/pokemon/*`.

#### `src/tools/metavgc/section.ts` (new)

Mirror of `src/tools/vgcguide/section.ts` for symmetry, but trivially returns `"guides"`. Single function `inferMetaVgcSection(slug: string): ArticleSection` returning `"guides"`. **Justification for keeping the file:** the future Stage 6 lift of section inference into a shared module wants every adapter to export the same surface. ~10 LOC. **Does NOT do:** anything else.

#### `src/tools/metavgc/tag-subtype.ts` (new — placeholder)

Mirror of `src/tools/vgcguide/tag-subtype.ts`. metavgc has no battle-replay equivalent today, so the function returns `null` for every slug. **Why ship the file at all:** keeps the per-site adapter shape identical; future subtypes (e.g., a "team-walkthrough" subtype on metavgc) plug in here without touching the chunker. ~10 LOC. **Reviewer call:** if dead code violates Stage 6 review preference, drop the file and have the ingest script pass `null` literally — flagged in §17 Q3.

#### `src/tools/knowledge/species-tagger.ts` (new — site-agnostic)

- **Single responsibility:** given chunk text + a pre-built species index, return canonical species ids referenced.
- **Why under `tools/knowledge/`** (not `tools/metavgc/`): the tagger is **site-agnostic**. Per flow §3 it's a chunker-adjacent step in the pipeline. Future ingests (vgcguide retroactive backfill, transcript pipelines) reuse it as-is.
- **Exported surface:**
  ```ts
  /** Mapped at ingest start from species + roster_membership + alias rows. */
  export interface SpeciesIndex {
    /** Each entry: {pattern: regex with global+ignoreCase, speciesId: canonical id, lengthHint: chars}.
     *  `lengthHint` enables longest-form-wins when both a base species and a form match. */
    entries: ReadonlyArray<{
      pattern:   RegExp;
      speciesId: string;
      lengthHint: number;
    }>;
  }

  /**
   * Build the in-process species index from the DB. Filters to roster_membership.format='RegM-A'
   * AND is_legal=1. Empty result throws SpeciesTaggerError (contract, not optional).
   */
  export function buildSpeciesIndex(db: Db): SpeciesIndex;

  /**
   * Detect canonical species ids referenced by `chunkText`. Whole-word match,
   * case-insensitive. When a base form (Garchomp) AND a Mega form (Garchomp-Mega
   * / "Mega Garchomp") both match overlapping spans, prefer the longest-matching
   * form (Garchomp-Mega) and DROP the shorter base. Order of returned ids is
   * the order of first occurrence in the text.
   */
  export function detectSpeciesTags(chunkText: string, index: SpeciesIndex): string[];
  ```
- **Algorithm details:**
  1. **Index build.** Pull `species_id`, `display_name`, `aliases (JSON array)` for every Reg-M-A-legal row. For each species, compile patterns for (a) display_name, (b) each alias, (c) for Mega forms (`is_mega = 1`), prepend "Mega " variants if not already an alias (`"Mega Garchomp"` for `Garchomp-Mega`). Each pattern is `new RegExp("\\b" + escape(name) + "\\b", "gi")`.
  2. **Detection.** Run every pattern over the text. Collect `Array<{matchStart, matchEnd, speciesId, lengthHint}>`. Sort by `matchStart ASC, lengthHint DESC`. Walk: for any match whose span overlaps a previously-accepted longer match, drop. The result is a deduplicated, longest-form-wins, in-text-order list.
  3. **Word boundary matters.** `"\\bincineroar\\b"` must NOT match `"incineroarish"` (synthetic regression test included). Standard `\b` handles ASCII; the species names are ASCII-only.
- **Performance budget:** 286 species × ~1000 chunks ≈ 286k regex tests per ingest. Pre-compiling all 286 RegExp objects once at index build keeps this O(chunks × patterns) without per-call allocation. Per flow §6 — acceptable.
- **Empty-index contract:** `buildSpeciesIndex` throws `SpeciesTaggerError` if zero rows are returned. Fail loud — the species table not being built means we can't run this slice meaningfully.
- **Does NOT do:** persistence, HTTP, embed.

#### `src/tools/knowledge/embed.ts` *(reused as-is)*

No changes. The dim is 512, the model is `voyage-3-lite`, retry/auth/batching all stays.

#### `src/tools/knowledge/chunk.ts` *(reused as-is)*

The chunker is site-agnostic (it accepts a duck-typed `ExtractedArticle`-shaped input). No changes. The species tagger fires AFTER chunk, BEFORE embed — see §13 pseudocode.

### 2.3 DB layer (`src/db/`)

#### `src/db/drizzle-schema.ts` *(extend)*

Three changes to the `knowledgeChunks` declaration:
1. **CHECK widening:** `knowledge_source_site_value` becomes `${t.sourceSite} IN ('vgcguide','metavgc')`.
2. **Unique-index widening:** `uq_knowledge_article_chunk` becomes `(t.sourceSite, t.articleSlug, t.chunkIndex)`. The previous `(article_slug, chunk_index)` was tight to vgcguide-only and would collide if metavgc and vgcguide ever published a guide with the same slug.
3. **New nullable column:** `speciesTags: text("species_tags")` — JSON array of canonical species ids, or `NULL` for "not yet tagged" (vgcguide pre-existing rows). No CHECK on the JSON shape (the schema enforces it at write-time; SQLite-side over-engineering is out of scope).

Per `db_orm_drizzle.md`: the Drizzle schema is the single source of truth; we run `pnpm drizzle-kit generate` to produce the migration body. The CHECK change (and unique-index recreation) requires a SQLite table-rebuild because SQLite cannot ALTER CHECK in place — drizzle-kit handles this via the standard 12-step CREATE TABLE-new + INSERT-from-old + DROP-old + RENAME pattern. **We must verify the generated SQL preserves all existing rows** (see §5).

#### `src/db/migrations/0008_knowledge_multi_site_and_tags.sql` (new)

Generated by drizzle-kit. The expected pattern (drizzle-kit's standard table-rebuild):

```sql
-- Generated by drizzle-kit
PRAGMA foreign_keys=OFF;
CREATE TABLE __new_knowledge_chunks (
  /* same columns as 0006, plus species_tags TEXT (nullable) */
  /* CHECK on source_site widened to IN ('vgcguide','metavgc') */
);
INSERT INTO __new_knowledge_chunks
  (id, source_site, article_slug, ..., species_tags)
SELECT
  id, source_site, article_slug, ..., NULL
FROM knowledge_chunks;
DROP TABLE knowledge_chunks;
ALTER TABLE __new_knowledge_chunks RENAME TO knowledge_chunks;
-- Recreate indexes against the new table:
CREATE UNIQUE INDEX uq_knowledge_article_chunk
  ON knowledge_chunks (source_site, article_slug, chunk_index);
CREATE INDEX idx_knowledge_section ON knowledge_chunks (article_section);
CREATE INDEX idx_knowledge_subtype ON knowledge_chunks (subtype);
CREATE INDEX idx_knowledge_body_hash ON knowledge_chunks (article_slug, body_hash);
PRAGMA foreign_keys=ON;
```

**Verification step (mandatory before committing the migration):**
1. Snapshot row count + a sample row from a populated `knowledge_chunks` BEFORE running.
2. Apply the migration.
3. Assert row count unchanged; sample row reads back unchanged except `species_tags = NULL`.
4. Assert the new CHECK rejects an attempted insert with `source_site = 'pikalytics'`.
5. Assert the unique-index widening lets two rows with same `article_slug` + `chunk_index` co-exist if `source_site` differs (synthetic insert on a temp DB).

**Memory citations:**
- `single_db_non_destructive_build.md`: this migration **must not** unlink the file or rebuild from scratch. It runs additively against the existing `db.sqlite` containing tournaments + team_sets + pikalytics_snapshots + the vgcguide knowledge_chunks. The drizzle-kit-emitted table-rebuild pattern preserves rows by design.
- `db_orm_drizzle.md`: Drizzle is the source of truth — we do NOT hand-edit the generated SQL.

**vec0 sidecar untouched.** The `knowledge_chunk_embeddings` virtual table in `0007_knowledge_vec0.sql` is **not** part of this migration. Its schema (`embedding float[512] distance_metric=cosine`) is dim-pinned and site-agnostic; existing rows there continue to link via `embedding_ref` strings whose rowids point at the old or new `knowledge_chunks.id` indistinguishably. **We must NOT re-create or DROP the virtual table** — that would destroy embeddings and force a full re-ingest of vgcguide. The drizzle-kit table-rebuild on `knowledge_chunks` does not affect the virtual table; verified by a test (§10 META-T9).

#### `src/db/knowledge.ts` *(extend, additive)*

- **Surface delta:** `upsertArticleChunks` accepts an additional `source_site` argument. Existing call site (`scripts/data/ingest-vgcguide.ts`) updates to pass `'vgcguide'` literally.
  ```ts
  export function upsertArticleChunks(db: Db, input: {
    source_site:  "vgcguide" | "metavgc";          // NEW
    article_slug: string;
    body_hash:    string;
    chunks:       Omit<KnowledgeChunk, "embedding_ref">[];
    embeddings:   Float32Array[];
    species_tags_per_chunk: (string[] | null)[];   // NEW; aligned with chunks; null = "not tagged"
  }): { inserted: number; replaced: number; skipped_unchanged: boolean };
  ```
- **`articleBodyHash` widens** to take `source_site`:
  ```ts
  export function articleBodyHash(db: Db,
                                   source_site: "vgcguide" | "metavgc",
                                   article_slug: string): string | null;
  ```
- **`list` filter widens** to allow `source_site` filtering, defaulting to no filter (returns both sites). The existing `ChunkFilterSchema` gains an optional `source_site`.
- **`search` widens** to optionally filter by `source_site` AND optionally filter by a `species_tags_contains: string` (canonical id). The latter implements the lightweight retrieval channel from flow §2 — rows with NULL `species_tags` are NOT matched (they predate the slice).
- **SQL strategy for `species_tags_contains`:** post-filter on the JSON column via `EXISTS (SELECT 1 FROM json_each(species_tags) WHERE value = ?)`. Index: none — the corpus is small enough that the post-vec scan is cheap. **Stage 6 deferred TODO** (§19): consider a separate `knowledge_chunk_species_tags` link table if profiling shows the JSON_EACH scan dominates.
- **Why bespoke (still):** same multi-table transactional upsert as before, plus the new species-tags JSON write column. Per CLAUDE.md §10, `createSimpleRepo` deliberately doesn't generalize to multi-table assembly.

#### `src/db/tool-definitions.ts` *(extend, additive)*

- The `knowledge_search` tool definition gains an optional `source_site_filter: z.array(SourceSiteSchema).optional()` and `species_id_filter: z.string().optional()` on its input schema. The agent description gains one sentence: "Pass `species_id_filter` for per-species questions (e.g., 'how do I beat Incineroar') — Champions-specific guides from metavgc.com tag chunks with the canonical species mentioned."
- **No new tool registered.** The existing `knowledge_search` tool covers the new retrieval surface — adding a second tool would split the agent's mental model unnecessarily, and the multi-tool BLOCKER lesson from pokepaste argues for fewer wider tools, not more narrow ones.

### 2.4 Ingest script (`scripts/data/`)

#### `scripts/data/ingest-metavgc.ts` (new)

Mirrors `scripts/data/ingest-vgcguide.ts` with three notable additions: (a) `discoverScope` returns sitemap-derived slugs filtered against the `/pt/` and hub-root exclusions; (b) the species index is built ONCE at start and passed to a tagger pass between chunk and embed; (c) `source_site = 'metavgc'` propagates through every call. Pseudocode in §13.

#### `package.json` *(extend)*

Add one script: `"data:ingest:metavgc": "tsx scripts/data/ingest-metavgc.ts"`. No new dep.

### 2.5 Data + fixtures

#### `data/cache/metavgc/` (new, **gitignored**)

Disk cache for raw HTML responses. Mirrors `data/cache/vgcguide/`.

#### `fixtures/metavgc/` (new, committed, immutable)

See §11. Four fixtures (3 real guides + 1 synthetic).

#### `fixtures/knowledge/species-index/` (new, committed, immutable)

A small JSON fixture with ~20 representative species rows (display_name, aliases, is_mega) — used by tagger tests so they don't depend on the live DB build. **Per memory `test_fixtures_no_invariant_blobs.md`:** this is a JSON file, not a binary; correctness is reviewable by reading the JSON. No invariant blob.

### 2.6 Tests

```
tests/schemas/knowledge-multi-site.test.ts
tests/tools/metavgc/discover-scope.test.ts
tests/tools/metavgc/extract-article.test.ts
tests/tools/metavgc/client.test.ts
tests/tools/knowledge/species-tagger.test.ts
tests/db/migrations/0008-multi-site-and-tags.test.ts
tests/db/knowledge-multi-site.test.ts
tests/scripts/ingest-metavgc.test.ts
tests/scripts/ingest-metavgc-idempotency.test.ts
tests/contract/metavgc-live.test.ts                    (gated by RUN_CONTRACT_TESTS=1)
```

---

## 3. Data schemas (zod, sketch — final lands in Stage 5)

```ts
// src/schemas/knowledge.ts (delta)
export const SourceSiteSchema = z.enum(["vgcguide", "metavgc"]);
export type   SourceSite      = z.infer<typeof SourceSiteSchema>;

const SpeciesTagsSchema =
  z.array(SpeciesIdSchema).max(20).nullable();   // null = not yet tagged

export const KnowledgeChunkSchema = z.object({
  schema_version:    z.literal(1),
  id:                z.string().regex(/^(vgcguide|metavgc):[a-z0-9-]+:\d+$/),
  source_site:       SourceSiteSchema,
  article_slug:      SlugStr,
  article_title:     z.string().min(1).max(200),
  article_url:       z.string().url(),
  article_section:   ArticleSection,                // unchanged enum
  section_heading:   z.string().min(1).max(300),
  chunk_index:       z.number().int().nonnegative(),
  chunk_text:        z.string().min(1).max(4000),
  chunk_token_count: z.number().int().min(1).max(500),
  subtype:           Subtype,
  body_hash:         Sha256Hex,
  embedding_ref:     z.string().regex(/^knowledge_chunk_embeddings:\d+$/),
  species_tags:      SpeciesTagsSchema,             // NEW
  source:            KnowledgeSourceBlockSchema,    // .site widens to SourceSiteSchema
}).strict();
```

`KnowledgeSourceBlockSchema.site` becomes `SourceSiteSchema`. Strictness preserved: an upstream extractor surfacing a `tera_*` key still fails at the strict gate (defense-in-depth per memory `regulation_m_a_no_tera.md`).

`ChunkFilterSchema`, `KnowledgeSearchArgsSchema`, `KnowledgeSearchHitSchema` gain `source_site` filtering and `species_id_filter` / returned `species_tags` per §2.3. Bodies are mechanical — final lands in Stage 5.

---

## 4. Tool contracts

The single agent-facing tool (`knowledge_search`) is unchanged in registration; its input schema gains `source_site_filter` + `species_id_filter`. Anthropic SDK description text (sketch — final in Stage 5):

> `knowledge_search` — semantic search over the curated VGC tutorial corpora from vgcguide.com (general theory) and metavgc.com (Champions / Reg M-A specific). Returns top-k passages with cited URLs and section headings. Pass `source_site_filter: ["metavgc"]` for Champions-specific questions; pass `species_id_filter: "incineroar"` for per-species questions — metavgc chunks carry canonical species tags so the filter retrieves the Incineroar guide chunks even when the embedding similarity narrowly misses. For broad VGC theory, omit both filters.

Pre/post conditions and error matrix unchanged from `vgc-knowledge-base` plan §4.

---

## 5. Drizzle schema additions — see §2.3 + §2.4

The migration filename is **`0008_knowledge_multi_site_and_tags.sql`**. It is generated by `pnpm drizzle-kit generate` after the schema edits in `src/db/drizzle-schema.ts` land. We commit the generated body verbatim (no hand-edits) per `db_orm_drizzle.md`. The vec0 sidecar (`knowledge_chunk_embeddings` from `0007_knowledge_vec0.sql`) is NOT touched.

**Migration verification matrix** (executed once during fixture-creation, NOT during Stage 3):

| Check | How | Pass criterion |
|---|---|---|
| Existing rows preserved | populated DB → run migration → row count + sample row spot-check | unchanged except `species_tags = NULL` |
| CHECK widened correctly | attempt INSERT with `source_site='pikalytics'` | rejected |
| CHECK widened correctly | attempt INSERT with `source_site='metavgc'` | accepted |
| Unique index widened correctly | INSERT two rows with same `(article_slug, chunk_index)` but differing `source_site` | both succeed |
| Vec0 sidecar untouched | `SELECT count(*) FROM knowledge_chunk_embeddings` before/after | equal |
| Idempotent (Drizzle migration runner) | re-run migration on already-migrated DB | no-op (drizzle's `__drizzle_migrations` table prevents re-application) |

---

## 6. Repository design

`src/db/knowledge.ts` (bespoke) extends per §2.3. Pattern stays `WeakMap<Db, Prepared>` of pre-compiled statements; one bundle per logical query. Method-level changes:

| Method | Delta |
|---|---|
| `list(db, filter)` | adds `source_site` filter clause; adds `species_tags_contains` filter clause via `EXISTS (SELECT 1 FROM json_each(species_tags) WHERE value = ?)`; SELECT decodes the new column. |
| `get(db, id)` | unchanged shape; the row includes `species_tags`. |
| `search(db, args)` | post-filter on `source_site` + `species_id_filter` (same JSON_EACH EXISTS). Cosine ranking unchanged. |
| `upsertArticleChunks(db, input)` | takes `source_site` + `species_tags_per_chunk` arrays; INSERT writes `JSON.stringify(tags)` or `NULL`. Body-hash skip-existing check is `(source_site, article_slug)` keyed. |
| `articleBodyHash(db, source_site, article_slug)` | added `source_site` arg; otherwise same. |

All exported functions get full TSDoc per CLAUDE.md §10.

**Why still bespoke (not `createSimpleRepo`):** unchanged from `vgc-knowledge-base` §6.2 — multi-table transactional upsert + multi-column filters + JSON_EACH semantics + vec0 join. Per CLAUDE.md §10 the factory deliberately doesn't generalize that far.

**Reuse of upstream simple repos:** none. The species index is built **once** by reading directly from `species` + `roster_membership` + raw `aliases` JSON columns; we don't go through `roster.get` per-name (we'd be doing 286 lookups when one bulk SELECT suffices). The bulk fetch is implemented in `species-tagger.ts::buildSpeciesIndex` against the raw Drizzle schema.

---

## 7. Architecture patterns + the why

| Pattern | Where | Why this slice |
|---|---|---|
| **Repository pattern** | `src/db/knowledge.ts` (extended) | Same prepared-statement + zod-decode discipline; agent never sees raw SQL or vec0 internals. |
| **Ports-and-adapters** | `MetaVgcClient` mirrors `VgcGuideClient`'s structural shape; `discoverScope(client)` is duck-typed | Lets ingest accept either client without a discriminated union; keeps the lift-to-shared-interface as a deliberate Stage 6 nicety. |
| **Anti-corruption layer** | `extract-metavgc-article` between metavgc HTML and the chunker | Site-shape coupling stays in one file; downstream code never sees raw HTML. |
| **Pure pipeline stage** | `species-tagger.ts` runs between `chunk()` and `embed()` in the ingest script | The chunker stays site-agnostic. Tagging is a property of the chunk text + a global species index, not of the source site. |
| **Schema-first (zod)** | extended `src/schemas/knowledge.ts` is the contract | per CLAUDE.md §5. |
| **Closed-enum CHECK + zod enum** | DB and runtime both reject unknown `source_site` | belt + suspenders. The CHECK is a safety net for raw SQL escape hatches; the zod enum is the real gate. |
| **Defense-in-depth no-tera** | Schema `.strict()` + property test on persisted rows | per `regulation_m_a_no_tera.md`. Champions-specific corpus → empirically zero risk, but the test catches future regressions cheaply. |
| **Fail-loud species index** | `buildSpeciesIndex` throws on empty result | per flow §8. The tagger is a contract; partial success would silently degrade retrieval. |
| **Site-signal scope discovery** | `discoverScope` reads sitemap.xml only; excludes `/pt/` + hub root | per memory `scope_discovery_via_site_signals.md`. No hand-curated allowlist. |
| **Reject-and-log article failures, fail-loud system failures** | Network/parse/embedding errors aggregate into run summary; auth/storage propagate | per `vgc-knowledge-base` §8 — same shape. |

**Considered and rejected:**
- **Lift `VgcGuideClient` and `MetaVgcClient` into a shared `KnowledgeArticleClient` interface NOW.** Rejected — see §2.2. ~30 LOC refactor with bounded value at this point; revisit when a third site lands.
- **Lift `ExtractedArticle` into `src/tools/knowledge/extracted.ts`.** Rejected — same reason. Stage 6 nicety.
- **Add a separate `knowledge_chunk_species_tags` link table.** Rejected — at corpus scale (~1500 chunks across two sites) JSON_EACH EXISTS is cheap. Profile-driven; flagged as Stage 6 deferred.
- **Extract `species_tags` via an LLM extraction pass per Insight model in CLAUDE.md §6.** Rejected for THIS slice — Insights are atomic claims and require Haiku-driven extraction. The lightweight tagger here is a strict-substring filter index. Insights remain a separate future slice.
- **Tag chunks with item / move / ability mentions in addition to species.** Rejected — out of scope per flow §10 (Insights handle this later, with the right semantic model).

---

## 8. Error model

| Class | Trigger | Severity | Where thrown | Where caught |
|---|---|---|---|---|
| `KnowledgeArticleNotFoundError` | HTTP 404 | data | `metavgc/client.ts` | ingest logs into `not_found[]`, continues |
| `KnowledgeArticleNetworkError` | non-2xx after retries | infra | `metavgc/client.ts` | ingest logs into `network_failures[]`, continues |
| `KnowledgeArticleParseError` | extractor returned empty body / no body container | data | `metavgc/extract-article.ts` | ingest logs into `parse_failures[]`, continues |
| `KnowledgeEmbeddingError` | Voyage 429/5xx after retry exhaustion | infra (per-article) | `embed.ts` (reused) | ingest logs into `embedding_failures[]`, continues |
| `KnowledgeAuthError` | `VOYAGE_API_KEY` missing or Voyage 401/403 | **fail loud — operator** | `embed.ts` | propagates; ingest exits 1 |
| `KnowledgeStorageError` | sqlite-vec dim mismatch | **fail loud — programmer/operator** | `knowledge.ts` `upsertArticleChunks` | propagates; ingest exits 1 |
| **`SpeciesTaggerError`** *(new)* | empty species index at ingest start | **fail loud** | `species-tagger.ts::buildSpeciesIndex` | propagates; ingest exits 1 |
| `RosterDbError` | SQLite I/O | infra | `knowledge.ts` (reused) | ingest exits 1 |
| `RosterDataError` | persisted row fails schema on read | corruption | `knowledge.ts` (reused) | tests |

### 8.1 Rename vs parallel: cost analysis

**Recommendation: rename `VgcGuideNotFoundError → KnowledgeArticleNotFoundError`, `VgcGuideNetworkError → KnowledgeArticleNetworkError`, `VgcGuideParseError → KnowledgeArticleParseError`. Add a `.source_site` field to each.**

**Cost of rename:**
- 3 class definitions in `src/schemas/errors.ts` renamed.
- Call sites:
  - `src/tools/vgcguide/client.ts` — 4 `throw new ` lines updated.
  - `src/tools/vgcguide/extract-article.ts` — 1 `throw new ` line updated.
  - `scripts/data/ingest-vgcguide.ts` — 4 `instanceof` checks updated.
  - `tests/tools/vgcguide/{client,extract-article}.test.ts` + `tests/scripts/ingest-vgcguide.test.ts` — ~10 `expect().toThrow(VgcGuide…)` updates.
  - Reviewer-doc references in `docs/reviews/vgc-knowledge-base.md` / `docs/plans/vgc-knowledge-base.md` — search-and-replace.
- Total: ~30 mechanical edits, all caught by typecheck + test runs. Stage 4 red phase touches them naturally.

**Cost of parallel `MetaVgc*` family:**
- 3 new classes alongside 3 existing classes; both kept forever.
- The agent's mental model gets murkier: "is `KnowledgeArticleNotFoundError` for vgcguide or metavgc?" — answer becomes "neither, that's why we have parallel families." A future third site doubles the family count again.
- The ingest script has to maintain two parallel `instanceof` chains.
- Future Stage 6 lift to a shared client interface gets harder (interface methods would need site-tagged exception unions).

**Decision:** **rename**. The mechanical-edit cost is bounded; the long-term cost of parallel families compounds.

If reviewer rejects the rename, the parallel family is the fallback — flagged in §17 Q2.

---

## 9. Reuse audit

**Reused (do not duplicate):**
- **`src/tools/_shared/throttle.ts`** — `createTokenBucket({ refillPerSec: 2 })`. New 2-RPS instance for metavgc. ~20 LOC saved.
- **`src/tools/_shared/file-cache.ts`** — `createFileCache({ ttlMs: 7d })`. ~30 LOC saved.
- **`src/tools/knowledge/chunk.ts`** — site-agnostic chunker. ~120 LOC saved + already battle-tested across the vgcguide corpus.
- **`src/tools/knowledge/embed.ts`** — Voyage client. ~120 LOC saved + 1024-dim wired to vec0 (note: actually 512 per the live `embed.ts`; pinned in §3).
- **`src/db/knowledge.ts`** — repo extended additively. ~250 LOC saved (no new repo, just method-signature widenings).
- **`src/db/sqlite-vec.ts`** + **`open()` extension load path** — vec0 sidecar already wired. **~180 LOC saved + first-of-kind risk eliminated.** This is the single biggest reuse win — the entire vector tier infrastructure landed with `vgc-knowledge-base`.
- **`parseOrThrow`** from `src/db/simple-repo.ts` — for decoding rows with the new column.
- **`Db`, `open()`, `RosterDbError`, `RosterDataError`** — same.
- **`tool(...)` helper in `src/db/tool-definitions.ts`** — extended, not duplicated.
- **Run-summary shape pattern** — mirrored from `ingest-vgcguide.ts`.
- **Exp-backoff retry pattern** — mirrored from vgcguide client.

**`createSimpleRepo` does NOT apply:** same reasoning as `vgc-knowledge-base` §6.2. Multi-table transactional upsert.

**`roster.get` / `roster.has` do NOT apply:** the species tagger does a bulk read at ingest start, not per-name lookups.

**NEW dependencies:** **none.** cheerio, @anthropic-ai/tokenizer, sqlite-vec, drizzle-kit, zod, better-sqlite3 are all already pinned. The biggest architectural insight of this slice is that **adding a second knowledge site requires zero new deps** — the `vgc-knowledge-base` plan got the abstractions right.

---

## 10. Test strategy + ordering

User-pinned order (per §6 of the flow doc; mirrors vgc-knowledge-base): **schema → sitemap-parse → discover-scope → extractor → species-tagger → client → migration → repo (multi-site) → ingest end-to-end → idempotency → contract**. Tests numbered in writing order.

The §3 pure-data-definition exemption applies to schema-only tests **META-T1–META-T2**. Everything from META-T3 onward is strict per-test Red→Green; any vacuous-green slip must be flagged in the change report.

Numbering: `META-T<n>`. Avoids cross-slice number conflict with VGC-T*, PIKA-T*, POKE-T*, LAB-T*.

| # | Test file | Test name | Asserts | Min code to green |
|---|---|---|---|---|
| META-T1 | `tests/schemas/knowledge-multi-site.test.ts` | `KnowledgeChunkSchema accepts source_site: "metavgc"` | parses; `'pikalytics'` rejected | widen `SourceSiteSchema` |
| META-T2 | `tests/schemas/knowledge-multi-site.test.ts` | `KnowledgeChunkSchema accepts species_tags: null \| []  \| ["incineroar"]` | three-state contract; non-canonical id rejected by `SpeciesIdSchema` | add `species_tags` field |
| META-T3 | `tests/tools/metavgc/discover-scope.test.ts` | `extractMetaVgcSlugs returns /guides/<slug> set from real sitemap fixture` | fixture sitemap → ~54 slugs; spot-check 3 known slugs present | impl |
| META-T4 | `tests/tools/metavgc/discover-scope.test.ts` | `extractMetaVgcSlugs excludes /pt/guias/* (Portuguese mirror)` | inject 2 `/pt/guias/x` URLs into fixture; assert dropped | filter clause |
| META-T5 | `tests/tools/metavgc/discover-scope.test.ts` | `extractMetaVgcSlugs excludes /guides hub root` | bare `/guides` in fixture; assert dropped | exclusion clause |
| META-T6 | `tests/tools/metavgc/discover-scope.test.ts` | `extractMetaVgcSlugs excludes /pokemon/<slug>` (deferred scope guard) | inject `/pokemon/incineroar`; assert dropped | path-prefix filter |
| META-T7 | `tests/tools/metavgc/extract-article.test.ts` | `extractMetaVgcArticle pulls h2/h3/p tree from real Incineroar guide fixture` | fixture `incineroar-counters.html` → ExtractedArticle with N sections, M paragraphs | impl |
| META-T8 | `tests/tools/metavgc/extract-article.test.ts` | `extractMetaVgcArticle throws KnowledgeArticleParseError when no <article>/<main> body` | mutated fixture stripped of containers; throw | strict-on-container |
| META-T9 | `tests/tools/metavgc/extract-article.test.ts` | `extractMetaVgcArticle uses <article> when present` | fixture with `<article>`; assert that body is the source | branch |
| META-T10 | `tests/tools/metavgc/extract-article.test.ts` | `extractMetaVgcArticle falls back to longest <main> descendant` | synthetic without `<article>` but with multiple `<main>` candidates; assert longest chosen | fallback branch |
| META-T11 | `tests/tools/metavgc/extract-article.test.ts` | `extractMetaVgcArticle strips nav / aside / footer / script` | inject all four; assert text excludes them | sanitizer |
| META-T12 | `tests/tools/metavgc/extract-article.test.ts` | `extractMetaVgcArticle title from <h1>; section always "guides"` | fixture; assert `article_title === "<h1 text>"`; `article_section === "guides"` | title + section |
| META-T13 | `tests/tools/knowledge/species-tagger.test.ts` | `detectSpeciesTags returns ["incineroar"] for chunk mentioning Incineroar` | "...you must counter Incineroar carefully..." → `["incineroar"]` | basic regex |
| META-T14 | `tests/tools/knowledge/species-tagger.test.ts` | `detectSpeciesTags returns [] when no species mentioned` | "...speed control matters..." → `[]` | empty-result branch |
| META-T15 | `tests/tools/knowledge/species-tagger.test.ts` | `detectSpeciesTags handles multi-species chunk with deduplication` | "...Incineroar and Garchomp synergize. Incineroar..." → `["incineroar","garchomp"]` (deduped, in order of first occurrence) | dedup |
| META-T16 | `tests/tools/knowledge/species-tagger.test.ts` | `detectSpeciesTags longest-form-wins on Garchomp vs Garchomp-Mega` | "...Mega Garchomp shreds..." → `["garchomp-mega"]` ONLY (NOT both `garchomp` and `garchomp-mega`) | overlap-drop algorithm |
| META-T17 | `tests/tools/knowledge/species-tagger.test.ts` | `detectSpeciesTags is word-boundary-aware: "incineroarish" does NOT match "incineroar"` | synthetic chunk with "incineroarish" → `[]` | `\b...\b` boundary |
| META-T18 | `tests/tools/knowledge/species-tagger.test.ts` | `detectSpeciesTags is case-insensitive` | "...INCINEROAR..." → `["incineroar"]` | `gi` flags |
| META-T19 | `tests/tools/knowledge/species-tagger.test.ts` | `buildSpeciesIndex throws SpeciesTaggerError on empty species table` | empty in-memory DB; assert throw | empty-check |
| META-T20 | `tests/tools/knowledge/species-tagger.test.ts` | `buildSpeciesIndex includes "Mega <Species>" auto-alias for is_mega rows` | seed Garchomp-Mega row; assert "Mega Garchomp" matches it | alias generator |
| META-T21 | `tests/tools/metavgc/client.test.ts` | `fetchSitemap returns parsed article URLs` | mocked sitemap fixture → ≥3 URLs returned | XML parse |
| META-T22 | `tests/tools/metavgc/client.test.ts` | `fetchArticleHtml URL is correct` | mocked fetch sees `https://metavgc.com/guides/<slug>` | URL builder |
| META-T23 | `tests/tools/metavgc/client.test.ts` | `fetchArticleHtml throws KnowledgeArticleNotFoundError on 404` | mocked 404; one call; throw | 404 branch |
| META-T24 | `tests/tools/metavgc/client.test.ts` | `fetchArticleHtml retries 429/5xx with exp backoff` | 429,500,200; assert 3 attempts | retry |
| META-T25 | `tests/tools/metavgc/client.test.ts` | `client throttles to 2 RPS` | inject clock; fire 5; pacing assertion | bucket instance |
| META-T26 | `tests/tools/metavgc/client.test.ts` | `client reads from disk cache when present and not expired` | seed cache; fetchImpl unused | file-cache reuse |
| META-T27 | `tests/db/migrations/0008-multi-site-and-tags.test.ts` | `migration is idempotent` | run twice; second run no-op | drizzle migration runner contract |
| META-T28 | `tests/db/migrations/0008-multi-site-and-tags.test.ts` | `existing knowledge_chunks rows survive migration with species_tags = NULL` | seed a fixture row at 0007-state; apply 0008; assert row read-back equal except `species_tags = NULL` | drizzle-kit table-rebuild correctness |
| META-T29 | `tests/db/migrations/0008-multi-site-and-tags.test.ts` | `CHECK rejects source_site = 'pikalytics' but accepts 'vgcguide' and 'metavgc'` | three INSERTs; first throws | widened CHECK |
| META-T30 | `tests/db/migrations/0008-multi-site-and-tags.test.ts` | `widened unique index allows same article_slug+chunk_index across different source_site` | INSERT (vgcguide, foo, 0) + (metavgc, foo, 0); both succeed | (source_site, article_slug, chunk_index) index |
| META-T31 | `tests/db/migrations/0008-multi-site-and-tags.test.ts` | `vec0 sidecar untouched: knowledge_chunk_embeddings row count + a sample row preserved` | seed 5 vec rows; apply 0008; assert unchanged | drizzle migration scoping correctness |
| META-T32 | `tests/db/knowledge-multi-site.test.ts` | `upsertArticleChunks(source_site='metavgc', ...) writes rows with species_tags JSON` | write 3 chunks each with `["incineroar"]`; read back; tags equal | `species_tags_per_chunk` write path |
| META-T33 | `tests/db/knowledge-multi-site.test.ts` | `upsertArticleChunks skip-existing keyed on (source_site, article_slug)` | upsert vgcguide/foo and metavgc/foo with different body_hashes; both insert independently | composite skip key |
| META-T34 | `tests/db/knowledge-multi-site.test.ts` | `search with species_id_filter returns only chunks tagged with that species` | seed 5 chunks (3 with "incineroar", 2 without); filter "incineroar"; assert 3 hits | JSON_EACH EXISTS |
| META-T35 | `tests/db/knowledge-multi-site.test.ts` | `search with species_id_filter excludes chunks with NULL species_tags` | seed 1 vgcguide row (NULL tags) + 1 metavgc row (tagged "incineroar"); filter "incineroar"; assert only metavgc hit | NULL-skip in EXISTS clause |
| META-T36 | `tests/db/knowledge-multi-site.test.ts` | `search with source_site_filter restricts to that site` | mixed seed; filter `["metavgc"]`; all hits' `source_site === "metavgc"` | post-filter |
| META-T37 | `tests/scripts/ingest-metavgc.test.ts` | `ingest --no-network runs end-to-end on cached fixtures (3 articles)` | seed cache + species index + mocked embed; assert 3 articles persisted | orchestration |
| META-T38 | `tests/scripts/ingest-metavgc.test.ts` | `ingest excludes /pt/guias/* slugs` | fixture sitemap with PT mirror; assert PT slugs not fetched | discoverScope wiring |
| META-T39 | `tests/scripts/ingest-metavgc.test.ts` | `ingest tags chunks with detected species` | seed Incineroar guide; assert persisted rows have `species_tags` containing `"incineroar"` | tagger pipeline stage |
| META-T40 | `tests/scripts/ingest-metavgc.test.ts` | `ingest fails loud on empty species index` | seed empty species DB; assert throw + exit 1 | SpeciesTaggerError propagation |
| META-T41 | `tests/scripts/ingest-metavgc.test.ts` | `ingest logs not_found on 404 article` | mock 404 for one slug; assert `not_found[]` populated; exit 0 | catch-and-log |
| META-T42 | `tests/scripts/ingest-metavgc.test.ts` | `ingest logs parse_failures on bad HTML` | seed cache with non-semantic HTML; assert `parse_failures[]`; exit 0 | catch parse error |
| META-T43 | `tests/scripts/ingest-metavgc.test.ts` | `ingest logs embedding_failures on Voyage retry exhaustion (per article)` | mocked embed throws for one article; others persist; exit 0 | per-article catch |
| META-T44 | `tests/scripts/ingest-metavgc.test.ts` | `ingest fails loud on KnowledgeAuthError` | mocked embed throws auth; assert exit 1 | no auth catch |
| META-T45 | `tests/scripts/ingest-metavgc.test.ts` | `ingest fails loud on KnowledgeStorageError` | mocked repo throws storage; assert exit 1 | no storage catch |
| META-T46 | `tests/scripts/ingest-metavgc.test.ts` | `ingest skip-existing on body_hash: rerunning produces zero embedding API calls` | first run; second run; embed call count is 0 on second run | body_hash pre-check |
| META-T47 | `tests/scripts/ingest-metavgc-idempotency.test.ts` | `running ingest twice produces zero knowledge_chunks deltas` | hash DB before+after second run; equal | (no new code if META-T33 + META-T46 green) |
| META-T48 | `tests/contract/metavgc-live.test.ts` (gated) | `live metavgc HTML for /guides/<known-slug> extracts non-empty body` | real fetch; ≥1 section, ≥1 paragraph | (no new code) |

**Pure-data exemption flag:** META-T1–META-T2.

**Total numbered tests:** 48. Within the 25–40 target band's stretch zone but justified by: 6 discover-scope variants, 8 species-tagger variants (including critical word-boundary regression META-T17), 5 migration-correctness checks, 5 multi-site repo checks, 9 ingest branches.

**Reused fixtures from `vgc-knowledge-base`:** the seeded-vectors fixture is NOT reused (different corpus); the `:memory:` sqlite-vec bootstrap is reused as-is.

### 10.1 Per-test risk callouts

- **META-T28** is load-bearing: drizzle-kit's table-rebuild correctness is the critical migration property. Worth one extra assertion that scans every column of the sample row, not just `species_tags`.
- **META-T31** explicitly tests the **vec0 sidecar is untouched**. If drizzle-kit ever decides to "clean up" virtual tables it doesn't recognize, this catches it.
- **META-T17** is the word-boundary regression test for the species tagger. Without it, "incineroarish" gets tagged as Incineroar — silent retrieval poisoning.
- **META-T46** is the embedding-API skip-existing test, mirrors VGC-T61 — the single biggest cost-saver in the cron.

---

## 11. Fixtures plan

All fixtures committed and immutable; filenames carry capture date.

```
fixtures/metavgc/
  2026-05-08__sitemap.xml                            (real sitemap with ~54 guides + /pt/guias/* + /pokemon/* + /guides root)
  2026-05-08__guides-incineroar-counters.html        (real — heavy species mentions for tagger sanity)
  2026-05-08__guides-team-building-walkthrough.html  (real — long, heading-rich)
  2026-05-08__guides-format-breakdown.html           (real — short, intro-style)
  2026-05-08__synthetic-no-container.html            (hand-crafted: missing <article>+<main>; for META-T8)

fixtures/knowledge/species-index/
  2026-05-08__reg-m-a-sample.json                    (~20 representative species rows: display_name, aliases, is_mega)
                                                     (committed JSON, NOT a binary blob — per memory test_fixtures_no_invariant_blobs.md)
```

**Variety dimensions:**
- **Real vs synthetic.** 3 real (one heavy species, one heading-rich, one short) + 1 synthetic edge case.
- **Tagger coverage.** Incineroar fixture exercises positive matches; team-building fixture exercises multi-species; format-breakdown is the "few-or-no species" case.
- **Heading depth.** Team-building is h2-rich; format-breakdown is short.
- **Reg M-A hygiene.** None of the fixtures inject Tera content (matches Champions corpus reality); the no-tera property test is reused from vgc-knowledge-base and applies to both `source_site` values.

Capture procedure (one-shot, executed at fixture-creation time, NOT during Stage 3):

```bash
curl -sS 'https://metavgc.com/sitemap.xml' \
  -H 'User-Agent: pokemon-ai-trainer/0.1 (rodser4@gmail.com)' \
  > fixtures/metavgc/2026-05-08__sitemap.xml
curl -sS 'https://metavgc.com/guides/incineroar-counters' \
  -H 'User-Agent: pokemon-ai-trainer/0.1 (rodser4@gmail.com)' \
  > fixtures/metavgc/2026-05-08__guides-incineroar-counters.html
# repeat for the other two real guides
# hand-author the synthetic
# hand-author the species-index sample JSON
```

Cache path (`data/cache/metavgc/`) is gitignored; fixtures stay committed.

---

## 12. Cache + throttle implementation

Reuses `src/tools/_shared/throttle.ts` (token bucket, 2 RPS) and `src/tools/_shared/file-cache.ts` (finite-TTL disk cache, 7 days). No new code.

### 12.1 Throttle

```ts
const bucket = createTokenBucket({ refillPerSec: opts.throttleRps ?? 2, clock: opts.clock });
```
Verified by META-T25.

### 12.2 Cache

```ts
const cache = createFileCache({
  dir:    opts.cacheDir,                                  // data/cache/metavgc
  ttlMs:  opts.cacheTtlMs ?? 7 * 24 * 60 * 60 * 1000,
  clock:  opts.clock,
});
```

- **Cache key shape:** `<slug>` per CLAUDE.md §8 (the only input).
- **404 NOT cached** — same as vgcguide.
- Atomic writes (`tmp + rename`) via the shared file-cache module.

### 12.3 Retry

429/5xx exp-backoff up to `maxRetries=3`; 4xx other than 429 maps to `KnowledgeArticleNetworkError`; 404 maps to `KnowledgeArticleNotFoundError` (no retry); Voyage 401/403 maps to `KnowledgeAuthError` (no retry, fail loud).

### 12.4 Gitignore

Append to `.gitignore`:
```
data/cache/metavgc/
```

---

## 13. Ingest / build orchestration

`scripts/data/ingest-metavgc.ts` — pseudocode (final lands in Stage 5):

```ts
async function main(argv: string[], deps?: MainDeps): Promise<number> {
  const opts = parseArgs(argv);  // --db, --no-network, --slug

  const apiKey = process.env.VOYAGE_API_KEY ?? "";
  if (!apiKey && !opts.noNetwork && deps?.embedClient === undefined) {
    throw new KnowledgeAuthError("VOYAGE_API_KEY env var is required for ingest");
  }

  const db = deps?.db ?? open(opts.db);
  const ownsDb = deps?.db === undefined;

  const client = deps?.client ?? createMetaVgcClient({
    cacheDir:      process.env.METAVGC_CACHE_DIR ?? "data/cache/metavgc",
    throttleRps:   2,
    maxRetries:    3,
    backoffBaseMs: 1000,
    cacheTtlMs:    7 * 24 * 60 * 60 * 1000,
  });

  const embedClient = deps?.embedClient ?? createEmbedClient({
    apiKey, model: "voyage-3-lite", maxBatch: 64, maxRetries: 3, backoffBaseMs: 1000,
  });

  // Build species index ONCE — fail loud if empty.
  const speciesIndex = deps?.speciesIndex ?? buildSpeciesIndex(db);

  const summary = { /* same shape as ingest-vgcguide, plus: */
    ok: true,
    articles_fetched: 0,
    articles_skipped_unchanged: 0,
    chunks_inserted: 0,
    chunks_re_embedded: 0,
    chunks_with_species_tags: 0,                   // new: count of chunks where species_tags non-empty
    embedding_failures: [], network_failures: [],
    parse_failures: [], not_found: [],
  };

  try {
    let urls: string[];
    if (opts.slug) {
      urls = [`https://metavgc.com/guides/${opts.slug}`];
    } else {
      // Sitemap-only scope (per memory scope_discovery_via_site_signals).
      const scope = deps?.scope ?? (await discoverScope(client));
      const sitemapUrls = await client.fetchSitemap();
      urls = sitemapUrls.filter((u) => scope.has(slugFromUrl(u)));
    }

    for (const url of urls) {
      const slug = slugFromUrl(url);
      let resultKind: ResultKind = "skipped_unchanged";
      try {
        const fetched = await client.fetchArticleHtml(slug);
        summary.articles_fetched += 1;
        const body_hash = "sha256:" + sha256Hex(fetched.html);

        if (knowledge.articleBodyHash(db, "metavgc", slug) === body_hash) {
          summary.articles_skipped_unchanged += 1;
          resultKind = "skipped_unchanged";
          continue;
        }

        const extracted = extractMetaVgcArticle({ slug, html: fetched.html });
        const subtype = tagSubtype(slug);   // metavgc → always null today
        const { chunks } = chunkExtractedArticle({
          slug, article_url: fetched.article_url,
          article_title: extracted.article_title,
          article_section: "guides",               // pinned for metavgc
          extracted, body_hash, fetched_at: fetched.fetched_at,
          subtype, captured_via: `metavgc-ingest@${gitSha()}`,
        });

        if (chunks.length === 0) { /* parse_failure path */ continue; }

        // *** NEW PIPELINE STAGE: species tagging between chunk and embed ***
        const speciesTagsPerChunk: (string[] | null)[] =
          chunks.map((c) => detectSpeciesTags(c.chunk_text, speciesIndex));
        summary.chunks_with_species_tags +=
          speciesTagsPerChunk.filter((t) => t !== null && t.length > 0).length;

        const vectors = await embedClient.embed(chunks.map((c) => c.chunk_text), "document");

        const result = knowledge.upsertArticleChunks(db, {
          source_site: "metavgc",
          article_slug: slug,
          body_hash, chunks, embeddings: vectors,
          species_tags_per_chunk: speciesTagsPerChunk,
        });
        summary.chunks_inserted    += result.inserted;
        summary.chunks_re_embedded += result.replaced;
        resultKind = result.replaced > 0 ? "re_embedded" : "inserted";

      } catch (e) {
        // Same catch ladder as ingest-vgcguide.ts, but with the renamed
        // KnowledgeArticleNotFoundError / NetworkError / ParseError classes.
        if (e instanceof KnowledgeArticleNotFoundError) { ...continue; }
        if (e instanceof KnowledgeArticleParseError)    { ...continue; }
        if (e instanceof KnowledgeArticleNetworkError)  { ...continue; }
        if (e instanceof KnowledgeEmbeddingError)       { ...continue; }
        // KnowledgeAuthError + KnowledgeStorageError + SpeciesTaggerError + everything else: fail loud.
        throw e;
      } finally {
        process.stderr.write(`[ingest-metavgc] ${slug} ${resultKind}\n`);
      }
    }

    process.stdout.write(JSON.stringify(summary) + "\n");
    return 0;
  } finally {
    if (ownsDb) { try { db.$client.close(); } catch { /* ignore */ } }
  }
}
```

### 13.1 Argv

- `--db <path>`
- `--no-network` — cache-only
- `--slug <slug>` — debug single-article
- `VOYAGE_API_KEY` env var — required (unless `--no-network`)
- `METAVGC_CACHE_DIR` env var — overrides cache dir

### 13.2 Parallelism

Serial. 2 RPS × 54 articles ≈ 27s HTTP; embedding batches of 64 take a few seconds; total cold-start well under 5 min. No need for in-loop parallelism.

### 13.3 Exit codes

- `0` — clean (including bounded `not_found` / `parse_failures` / `network_failures` / `embedding_failures`).
- `1` — `KnowledgeAuthError`, `KnowledgeStorageError`, `SpeciesTaggerError`, DB error, uncaught.

### 13.4 Observability

Single JSON-line summary on stdout; per-article progress to stderr. New summary field `chunks_with_species_tags` makes the ≥80% sanity check (flow §9) directly observable in the cron output.

---

## 14. Definition of Done mapping (CLAUDE.md §11)

| Box | This slice |
|---|---|
| Flow doc reviewed | flow `docs/flows/metavgc-guides.md` Stage 1 authored 2026-05-08; Stage 2 sign-off **pending** before Stage 4. |
| Tech plan approved | THIS DOC — pending. |
| Failing test first | enforced by §10 Stage 4 ordering; commit `test: red — metavgc-guides`. |
| `pnpm test` passes | Stage 5 exit gate. |
| `pnpm typecheck` passes | strict TS, typed signatures everywhere per §2. |
| `pnpm lint` passes | Stage 5 exit gate. |
| New external data schema-validated and fixture-backed | `KnowledgeChunkSchema` widened + 4 metavgc fixtures + species-index sample. |
| User-facing claim cited | every persisted chunk carries `article_url` + `section_heading` + `source.author = "MetaVGC"` + `source.fetched_at`. The `knowledge_search` tool output exposes them. |
| Docs touched | `tools/metavgc/SPEC.md` written first; `.gitignore` extended; flow doc `docs/flows/metavgc-guides.md` already covers product behavior; CLAUDE.md untouched (no new convention introduced — the multi-site CHECK widening is a routine drizzle migration). |
| Reviewer subagent ran | Stage 6. |

**Uncovered by this slice (explicitly):**
- Species detail pages (`/pokemon/<slug>`) — separate future slice.
- Insight extraction (CLAUDE.md §6) — separate future Haiku-driven slice.
- Backfill of `species_tags` on existing vgcguide rows — Stage 6 deferred TODO.
- Portuguese mirror — out of scope.
- `ExtractedArticle` and `*Client` type unification — Stage 6 deferred refactors.

---

## 15. Rollout / feature-flag

- **Always-on, no flag.** The migration is additive over existing rows. The agent's `knowledge_search` tool gains two optional parameters; existing call shapes still work. Empty `metavgc` data → tool returns vgcguide-only hits.
- **Migration ordering.** `0008_knowledge_multi_site_and_tags.sql` lands after `0007_knowledge_vec0.sql`. The drizzle migration runner (already wired by `vgc-knowledge-base`) handles ordering via `__drizzle_migrations`.
- **Hard dependency on `VOYAGE_API_KEY`.** Same as vgcguide — fail loud at startup.
- **Hard dependency on a populated species table.** The species table is built by the existing Reg M-A roster build pipeline (separate slice, already shipped). The `buildSpeciesIndex` empty-check enforces the contract.
- **Cron cadence.** Manual for now (per flow §2). Future scheduled cron entry: weekly, mirroring vgcguide's cadence.
- **`SKIP_SQLITE_VEC=1` escape hatch** continues to apply (inherited from vgcguide).

---

## 16. Risks + mitigations

1. **Drizzle-kit table-rebuild silently drops a row or column.** Drizzle-kit's auto-generated table-rebuild is the standard SQLite pattern, but the failure mode is silent data loss. **Mitigation:** META-T28 + META-T31 explicitly assert pre/post row counts and column-by-column equality on a populated DB. The migration must be reviewed against the verification matrix in §5 before commit. If the generated SQL looks wrong, escalate to the reviewer; do NOT hand-edit (per `db_orm_drizzle.md`) without a documented reason.
2. **Species tagger over-matches via partial words despite `\b`.** Some species names are unusual (e.g. multi-word "Tauros-Paldea-Aqua"); the regex builder's escape-and-anchor logic must be carefully tested. **Mitigation:** META-T17 (word-boundary regression), META-T16 (longest-form-wins overlap), META-T20 ("Mega <X>" alias) + a property test scanning real fixture chunks to ensure no false positives in production data. Stage 6 deferred TODO: a fuzz harness over the species index.
3. **metavgc HTML changes shape (e.g. moves to a new CMS).** Site is hand-authored, so a redesign is plausible. **Mitigation:** META-T48 (live contract gated) re-fetches one guide weekly under cron; `parse_failures[]` run-summary field surfaces silent regressions. The defensive `<article>` → `<main>` longest-descendant fallback in the extractor handles minor shape drift.
4. **Species index drift between ingest runs.** If Reg M-A roster changes (a new species added mid-format), tags for already-ingested chunks become stale. **Mitigation:** body_hash skip-existing means chunks aren't re-tagged on unchanged content. Operator-side: re-ingest forces a re-tag run on changed articles. Full corpus re-tag is deferred (Stage 6 TODO — same backfill TODO that covers vgcguide rows getting their first tags).
5. **Voyage model retirement / silent quality drop.** Inherited risk from vgc-knowledge-base. **Mitigation:** model pin + dim-pin + live contract test, all already in place.

---

## 17. Open questions for plan review

1. **Lift `VgcGuideClient` + `MetaVgcClient` into shared `KnowledgeArticleClient` interface NOW vs Stage 6?** §2.2 recommends defer with a `// TODO(stage6-deferred): unify-client-interface` annotation. Cost of lifting now: ~30 LOC refactor across vgcguide + 2 SPEC.md edits. Reviewer's call before Stage 4.

2. **Rename `VgcGuideNotFoundError` → `KnowledgeArticleNotFoundError` (and siblings) NOW vs ship parallel `MetaVgc*` family?** §8.1 recommends rename. Cost is bounded (~30 mechanical edits, all caught by typecheck). Reviewer call. If reject, the parallel-family fallback adds ~80 LOC permanent duplication.

3. **Keep `src/tools/metavgc/tag-subtype.ts` as a no-op file or drop it?** §2.2 recommends keep-for-symmetry (~10 LOC, future-proof). Reviewer can vote dead-code-cleanup.

4. **`article_section` for metavgc — pin to `"intro"` or extend the enum to `"guides"`?** §2.2 recommends pin to `"intro"`. Extending the enum forces the `knowledge_section_value` CHECK widening AND backfilling vgcguide rows; the cost outweighs the semantic clarity. Reviewer's call.

5. **Should `species_tags_contains` filter scan `JSON_EACH(species_tags)` (current proposal) or do we add a separate `knowledge_chunk_species_tags` link table?** §6 / §10 deferred. Profile-driven. Stage 6 TODO if the JSON_EACH path slows down.

6. **Backfill of `species_tags` on existing vgcguide rows — Stage 6 deferred TODO?** Yes per §1 — flagged as `// TODO(stage6-deferred): backfill-vgcguide-species-tags`. Reviewer can pull forward into this slice if there's appetite, but the corpus is small (~750 chunks) and a one-shot script can run later without a schema change. Recommend defer.

**Flow-doc gap uncovered:** flow §6 mentions "alias table from `data/reg-m-a/aliases.json`" but that file isn't authoritative — aliases live in `species.aliases` (JSON column) per the existing roster build. The plan reads aliases directly from the DB (`buildSpeciesIndex`), avoiding a divergent fixture file. **Recommend updating the flow doc** to reference the `species.aliases` column rather than the JSON file.

**Flow-doc gap (minor):** flow §9 success criteria says "vector search filtered by `species_tags LIKE '%incineroar%'`" — this is illustrative, not a literal API. Per §6 the actual filter is `species_id_filter` on the `knowledge_search` tool (which compiles to `JSON_EACH EXISTS`). Recommend the flow be updated to match the agent-tool surface.

---

## 18. Stage 6 deferred TODOs (greppable later)

Per memory `labmaus_pokepaste_deferred_todos.md`, every deferral is annotated inline as `// TODO(stage6-deferred):` so a single grep surfaces them before the next slice starts.

| # | Item | Annotation site (planned) | Trigger to revisit |
|---|---|---|---|
| 1 | Lift `VgcGuideClient`+`MetaVgcClient` into shared `KnowledgeArticleClient` interface | top of `src/tools/metavgc/client.ts` | A third site lands. |
| 2 | Lift `ExtractedArticle` / `ExtractedSection` into `src/tools/knowledge/extracted.ts` | top of `src/tools/metavgc/extract-article.ts` | Same trigger as #1. |
| 3 | Backfill `species_tags` on existing vgcguide knowledge_chunks rows | top of `src/tools/knowledge/species-tagger.ts` | Stage 6 review or before first per-species retrieval demo. |
| 4 | Replace `JSON_EACH(species_tags)` filter with a `knowledge_chunk_species_tags` link table | `src/db/knowledge.ts` `search` body | Profile shows the JSON_EACH scan dominates (likely > 5K chunks). |
| 5 | Drop `src/tools/metavgc/tag-subtype.ts` if it stays a no-op | top of file | A second metavgc subtype is identified, OR review prefers no dead code. |
| 6 | Fuzz harness over the species index for false-positive scan | `src/tools/knowledge/species-tagger.ts` | If META-T13–T20 misses a regression in production. |
| 7 | Section enum extension (`"guides"`) — full migration once metavgc has > 1 section | `src/schemas/knowledge.ts` `ArticleSection` | When metavgc adds editorial sections. |
| 8 | Insight extraction over metavgc chunks (Haiku-driven, CLAUDE.md §6) | new module — see future plan | Once retrieval-only quality is baselined. |
| 9 | Species detail pages (`/pokemon/<slug>`) ingest | new slice — see future flow | Once retrieval quality from guides alone is measured. |
| 10 | Portuguese mirror ingest — out-of-scope today | n/a | If the user ever asks for it. |

Each will land as an inline `// TODO(stage6-deferred): <slug>` comment in the cited file at Stage 5; the Stage 6 reviewer is expected to confirm the comments are present and greppable.
