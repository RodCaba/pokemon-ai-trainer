# Tech Plan — YouTube Insights Ingest (Champions / Reg M-A)

**Slug:** `youtube-insights`
**Stage:** Stage 3 — Tech plan (pending approval)
**Date:** 2026-05-09
**Author:** Tech Lead subagent
**Implements flow doc:** `docs/flows/youtube-insights.md` (Stage 1 authored 2026-05-09; Stage 2 sign-off recorded by Rodrigo Caballero with all nine §11 answers binding).

**Memory citations:**
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/db_orm_drizzle.md` — Drizzle is the single source of truth; vec0 sidecars are the documented hand-authored exception. We extend Drizzle for `insights` + `insight_subjects`; we hand-author the vec0 sidecar for `insight_embeddings`.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/single_db_non_destructive_build.md` — migration 0010 is additive over a populated `db.sqlite` (vgcguide + metavgc + tournaments + team_sets); the table-rebuild for `knowledge_chunks` must preserve every existing row.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/data_layer_two_tier_db.md` — relational tier owns `insights` + `insight_subjects`; semantic tier owns `insight_embeddings` (vec0). No JSON queryable runtime store.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_no_tera.md` — defense-in-depth no-tera property tests reused; transcript chunks that mention Tera are persisted (the speaker may discuss old formats) but extracted Insights with `tera_*` keys are rejected at the strict zod gate.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_roster.md` — the species substring guard (Q6 hallucination check) and `subjects.pokemon` validation both resolve canonical species ids from the same `species` + `roster_membership` rows the metavgc tagger uses.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/scope_discovery_via_site_signals.md` — manual single-URL ingest is a deliberate exemption (one user, one URL); channel-level discovery is Stage 6 deferred.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/test_fixtures_no_invariant_blobs.md` — committed transcript fixtures are JSON, not binary; the synthetic chunk-window edge cases are generator-comment-documented.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/labmaus_pokepaste_deferred_todos.md` — every deferral lands as inline `// TODO(stage6-deferred):` for greppability.

**Sibling precedents:**
- `docs/plans/metavgc-guides.md` — closest precedent. Same `tools/<source>/{client,…}.ts` shape, same chunker/embed reuse path, same migration table-rebuild pattern, same §19 amendments structure. **This slice extends the same `knowledge_chunks` substrate to a third source (`source_site = 'youtube'`) AND adds the canonical `Insight` primitive.**
- `docs/plans/vgc-knowledge-base.md` — second-closest. Established `knowledge_chunks` + vec0 sidecar pattern; this plan re-uses every infrastructure abstraction and adds a parallel insights/insight_embeddings pair.

**First-of-kind for this slice:**
- **Insight as a persisted primitive.** CLAUDE.md §6 designs the shape; v1 of the roster DB shipped `src/schemas/insight.ts` + `src/db/insights.ts` stub. This slice ships the full repo + tables + extraction pipeline.
- **Haiku-driven structured extraction.** First use of Anthropic SDK `tool_use` to coerce JSON-schema'd output (per CLAUDE.md §9 Haiku-for-ingest). Establishes prompt-versioning convention.
- **Multi-modal source_site.** Both `youtube` (transcripts) AND `metavgc`/`vgcguide` (articles) coexist on `knowledge_chunks`. The `subtype = 'youtube-transcript'` + new metadata column (`metadata.timestamp_start_seconds`) is the discriminator.
- **vec0 second sidecar.** First time we ship two parallel virtual tables (`knowledge_chunk_embeddings` + `insight_embeddings`); both 512-dim cosine; embedding-ref string scheme generalizes to `<table>:<rowid>`.

---

## 1. Goal recap

Ship a citation-first, manually-triggered ingest of single YouTube videos into the existing `knowledge_chunks` substrate AND a new `insights` relational table backed by an `insight_embeddings` vec0 sidecar. Concrete deliverables:

- A CLI at `scripts/data/ingest-youtube.ts` invoked as `pnpm data:ingest:youtube --url https://www.youtube.com/watch?v=<id>` that fetches the video's English auto-captions via the `youtube-transcript` npm package, normalizes them into `TranscriptSegment[]`, chunks them into 90-second windows with 15-second overlap, persists each chunk into `knowledge_chunks` with `source_site = 'youtube'` + `subtype = 'youtube-transcript'` + `metadata.timestamp_start_seconds`, and embeds each chunk into the existing `knowledge_chunk_embeddings` vec0 sidecar (transparent reuse — agent's existing `knowledge_search` surfaces YouTube hits with no other code change per flow §7.1).
- A Haiku-driven extraction pass (`extracted_by_prompt_version = "v1.0"`) that takes each persisted chunk and produces 0..5 atomic `Insight` rows (CLAUDE.md §6), each persisted with one row in `insights` + N rows in `insight_subjects` + one vector in `insight_embeddings`. The extraction enforces a **species-substring hallucination guard** (Q6): any insight whose `subjects.pokemon` includes a species id whose canonical display name (or any roster alias) does not appear as a substring in the chunk text — case-insensitive — is rejected and logged.
- A new agent-callable Anthropic tool `insights_search({ query, claim_type?, species_id_filter?, limit? })` returning `InsightSearchHit[]` with `score` (cosine) and the full `Insight` record (flow §7.2).
- An additive `cite.ts` extension that surfaces relevant Insights as a distinct `insights: InsightCitation[]` field on `ScenarioOverview` (Q5; non-breaking schema add — existing `knowledge_chunk_citations` field unchanged).
- Idempotency: re-running the ingest on the same video produces zero NEW knowledge_chunks rows AND zero NEW insights rows. Skip-existing on `(source_url, chunk_index)` for chunks (Q7); skip-existing on `(chunk_id, claim)` for insights.
- Migration `0010_insights_and_youtube.sql` widens `knowledge_chunks.source_site` CHECK from `IN ('vgcguide','metavgc')` (post-0008) to `IN ('vgcguide','metavgc','youtube')`; widens `knowledge_chunks.subtype` CHECK from `IS NULL OR = 'battle-replay'` to `IS NULL OR IN ('battle-replay','youtube-transcript')`; widens the `id` GLOB from `'vgcguide:*' OR 'metavgc:*'` to also allow `'youtube:*'`; creates `insights`, `insight_subjects`, `insight_embeddings` (vec0). Per memory `single_db_non_destructive_build.md` the migration is additive — every existing `knowledge_chunks` row survives unchanged, every existing `knowledge_chunk_embeddings` row survives unchanged.

**Done means:**
1. Ingest of `https://www.youtube.com/watch?v=J0eVKJyJ_DQ` (the user's example team-deep-dive) completes in < 5 minutes and produces ≥ 10 chunks + ≥ 5 insights with `subjects.pokemon` covering ≥ 4 of the team's 6 species.
2. Re-running the ingest produces zero embedding-API calls, zero new chunks, zero new insights, zero new vec0 rows.
3. `insights_search({ query: "solar power charizard", species_id_filter: "charizard" })` returns the matching Insight with `source.url` + `source.timestamp_seconds` set.
4. The tactical-overview `cite.ts` returns ≥ 1 `InsightCitation` for a saved team whose species overlap the ingested video's subjects.
5. Existing vgcguide + metavgc tests stay green.
6. All Reg M-A defenses hold: insights with `subjects.formats` other than `["RegM-A"]` are rejected; insights with any `tera_*` field in source/excerpt strict-mode-fail (per `regulation_m_a_no_tera.md`).

**Out of scope (deferred to Stage 6 §12 below):** comments ingest, Whisper for caption-less videos, channel-level subscription auto-pull, Spanish/Japanese transcripts, retroactive Insight extraction over the existing vgcguide/metavgc chunks, payload-filter pre-cosine for the insights vector search (Q8 — not yet needed; revisit at ~10K corpus size).

## 2. Module boundaries

All paths absolute under `/Users/rodrigo/src/pokemon-ai-trainer/`. New files unless marked *(extend)*.

### 2.1 Schemas (`src/schemas/`)

#### `src/schemas/insight.ts` *(extend, additive)*
- **What changes:** add `chunk_id: z.string().min(1).nullable()` to `InsightSchema` so Insights extracted from a `knowledge_chunks` row carry their provenance to the chunk (used for cascade-delete + idempotency dedup). Existing fields (`id`, `claim`, `claim_type`, `subjects`, `confidence`, `stance`, `source`, `extracted_by`, `embedding_ref`) unchanged. Non-breaking: existing callers that don't set `chunk_id` get `null`.
- **Adds:** `InsightSearchHitSchema = z.object({ insight: InsightSchema, score: z.number().min(0).max(1) }).strict()` — wraps the existing `InsightSearchHit` interface with a runtime contract for the agent tool layer.
- **Adds:** `InsightSearchArgsSchema = z.object({ query: z.string().min(1).max(500), claim_type: ClaimTypeSchema.optional(), species_id_filter: z.string().regex(/^[a-z0-9-]+$/).optional(), limit: z.number().int().min(1).max(20).default(5) }).strict()` — input contract for the new Anthropic tool.
- **Does NOT touch** `subjects.pokemon` regex (already canonical) or `subjects.formats` tuple (already pinned to `["RegM-A"]`).

#### `src/schemas/knowledge.ts` *(extend, additive)*
- Widen `SourceSiteSchema` from `z.enum(["vgcguide","metavgc"])` to `z.enum(["vgcguide","metavgc","youtube"])`.
- Widen `Subtype` enum from `z.union([z.null(), z.literal("battle-replay")])` (or current shape) to `z.union([z.null(), z.literal("battle-replay"), z.literal("youtube-transcript")])`.
- Add an optional `metadata: z.record(z.union([z.string(), z.number(), z.null()])).optional()` field on `KnowledgeChunkSchema` for the `timestamp_start_seconds` carrier (and any future per-chunk site-specific metadata). **Stored as a JSON TEXT column** on `knowledge_chunks`. Existing rows have `metadata = NULL`; the schema treats null and missing identically.
- Adjust the `id` regex from `/^(vgcguide|metavgc):[a-z0-9-]+:\d+$/` to `/^(vgcguide|metavgc|youtube):[a-z0-9_-]+:\d+$/` — note the additional `_` to accept YouTube video ids (which use `_` and `-`).
- `KnowledgeSearchHitSchema` gains optional `metadata` carry-through (used by `cite.ts` to link to a timestamped video URL).

#### `src/schemas/errors.ts` *(extend, additive)*
- **`YoutubeFetchError`** — wraps every failure mode of the `youtube-transcript` package (`TranscriptDisabled`, `VideoUnavailable`, network 4xx/5xx, captions-not-English). Carries `.video_id`, `.cause` (string discriminator), and a normalized `.kind: "no_captions" | "disabled" | "private" | "network" | "non_english"`. Article-class miss; ingest logs and exits 0 with a non-empty `failures[]` summary.
- **`InsightExtractionError`** — wraps Haiku/Anthropic SDK failures (rate limit after retry exhaustion, response-not-tool-call, malformed JSON output that survives zod). Carries `.chunk_id`, `.kind: "rate_limit" | "schema_violation" | "anthropic_error"`. Article-class miss for `rate_limit` + `schema_violation` (retry surface, then skip and continue). `anthropic_error` with status 401/403 fails loud (auth class).
- **Reused (no rename, no parallel family):** `KnowledgeAuthError`, `KnowledgeStorageError`, `KnowledgeArticleNotFoundError`, `KnowledgeArticleNetworkError`, `KnowledgeArticleParseError` (the last three only for parity with the metavgc rename in `metavgc-guides.md` §19.2 — none thrown directly by youtube ingest, but the catch ladder uses the same class hierarchy where shared embedding code throws them).

### 2.2 Tool layer

#### `src/tools/youtube/SPEC.md` (new — written first per CLAUDE.md §8)
Mirrors `src/tools/metavgc/SPEC.md`. Authored before any test or code. Sections: tools registered (none new — registers `insights_search` from `src/db/tool-definitions.ts` extension), endpoint contract (the `youtube-transcript` npm package — wraps YouTube's internal timedtext endpoint, no API key needed; calls out the upstream-instability risk in §14), inputs/outputs (zod verbatim), edge cases (no captions / disabled / age-gate / region-block / private / non-English), citation rules (every chunk persists `article_url = canonical youtube watch URL`, every insight persists `source.url = same` + `source.timestamp_seconds = chunk.metadata.timestamp_start_seconds`), Reg M-A hygiene (the speaker may briefly mention non-Champions formats — chunks persist verbatim; insights extracted from those passages are rejected at the strict zod gate when `subjects.formats !== ["RegM-A"]` or when `subjects.pokemon` references a species not in the Reg-M-A roster), cache + throttle (the `youtube-transcript` package has no documented rate limit; we self-throttle to 1 RPS per video; finite-TTL 7-day disk cache on the parsed transcript JSON), out of scope (comments, Whisper, channel-pull, multi-language).

#### `src/tools/youtube/client.ts` (new)
- **Single responsibility:** thin wrapper over `youtube-transcript`'s `YoutubeTranscript.fetchTranscript(videoUrl)` returning the package's native segment array, plus a side-channel video metadata fetch via the watch-page HTML (cheap; no API key). Both methods exposed through one duck-typed client interface so tests can mock the seam.
- **Exported surface:**
  ```ts
  export interface YoutubeTranscriptSegment {
    text:        string;   // already HTML-entity-decoded by youtube-transcript
    start_s:     number;   // float seconds (the package returns offset; we rename for consistency)
    duration_s:  number;
  }
  export interface YoutubeVideoMetadata {
    video_id:      string;
    title:         string;
    channel:       string;          // best-effort from watch-page HTML
    published_at:  string | null;   // ISO-8601 UTC; null if not parseable
    duration_s:    number | null;
    canonical_url: string;          // https://www.youtube.com/watch?v=<id>
    fetched_at:    string;          // ISO-8601 UTC
    language:      string | null;   // BCP-47 from caption track; null if undetectable
  }
  export interface YoutubeClient {
    fetchTranscript(videoId: string): Promise<YoutubeTranscriptSegment[]>;
    fetchMetadata(videoId: string):   Promise<YoutubeVideoMetadata>;
  }
  export interface YoutubeClientOptions {
    fetchImpl?:    typeof fetch;     // for the watch-page HTML metadata fetch
    transcriptImpl?: { fetchTranscript: (videoIdOrUrl: string) => Promise<unknown> };
                                     // injectable seam for the youtube-transcript package
    cacheDir?:     string;
    cacheTtlMs?:   number;
    throttleRps?:  number;           // default 1
    clock?:        () => number;
  }
  export function createYoutubeClient(opts?: YoutubeClientOptions): YoutubeClient;
  ```
- **TSDoc:** all six elements per CLAUDE.md §10. The `fetchTranscript` block's "When to use it" disambiguates against the (non-existent) Whisper fallback: "Use when the video has user-uploaded subtitles or YouTube auto-captions in English. For caption-less videos, defer to Stage 6 (Whisper)."
- **Throws:** `YoutubeFetchError` for every failure mode of the wrapped package; never propagates raw package errors. The `kind` discriminator lets the ingest catch ladder log + skip with the right summary bucket.
- **Does NOT do:** chunking, extraction, persistence.
- **Stage 6 deferred TODO #1** (`// TODO(stage6-deferred): unify-knowledge-source-client`): the `KnowledgeArticleClient` interface from metavgc §19.1 doesn't quite fit (no `fetchSitemap`); a future `KnowledgeSourceClient` superinterface might subsume both. Out of scope here.

#### `src/tools/youtube/parse-transcript.ts` (new)
- **Single responsibility:** convert `YoutubeTranscriptSegment[]` (from the package) into the canonical `TranscriptSegment[]` shape used by the chunker. Pure function. **The pkg's segment shape is already close to ours; this normalizer mostly handles HTML-entity edge cases (&amp;#39; → ' that the pkg may miss) and timestamp coercion (offset_ms → start_s).**
- **Exported surface:**
  ```ts
  export interface TranscriptSegment { text: string; start_s: number; duration_s: number; }
  export function parseTranscript(raw: YoutubeTranscriptSegment[]): TranscriptSegment[];
  ```

#### `src/tools/youtube/chunk-transcript.ts` (new — site-specific time-windowed chunker)
- **Single responsibility:** group `TranscriptSegment[]` into 90-second windows with 15-second overlap. Preserves the wall-clock `start_s` of the **first segment in each window** (the `metadata.timestamp_start_seconds` carrier).
- **Why a sibling chunker (NOT a reuse of `src/tools/knowledge/chunk.ts`):** the existing chunker is heading-and-token-driven (`<h2>`/`<h3>` boundaries, ≤500 tokens per chunk); transcripts have neither headings nor reliable token-density. We need a **time-windowed** chunker. Both chunkers emit the SAME downstream `KnowledgeChunk`-shaped output to keep `upsertArticleChunks` polymorphic. **Stage 6 deferred TODO #5** (`// TODO(stage6-deferred): unify-chunker-strategy-pattern`): factor a `ChunkStrategy` interface (`(input) => ChunkOutput[]`) and have both heading-based and time-windowed implementations conform.
- **Exported surface:**
  ```ts
  export interface TranscriptChunkOptions {
    window_s:  number;   // default 90
    overlap_s: number;   // default 15; must satisfy 0 ≤ overlap < window
  }
  export interface TranscriptChunk {
    chunk_index:              number;
    chunk_text:               string;        // joined segment.text with single space
    chunk_token_count:        number;        // pre-counted via @anthropic-ai/tokenizer (same dep as article chunker)
    timestamp_start_seconds:  number;        // floor of first segment.start_s
    timestamp_end_seconds:    number;        // floor of last segment.start_s + duration
  }
  export function chunkTranscript(
    segments: TranscriptSegment[],
    opts?:    Partial<TranscriptChunkOptions>,
  ): TranscriptChunk[];
  ```
- **Algorithm:**
  1. Sort segments by `start_s` ascending (defensive — the package returns sorted, but we cannot rely on it).
  2. Iterate segments; maintain a sliding window `[anchor_s, anchor_s + window_s)`. Emit a chunk when the window is full or no segment fits before `anchor_s + window_s`.
  3. Advance the anchor by `window_s - overlap_s` (75s for the v1 defaults).
  4. **Edge cases:**
     - Video shorter than `window_s` → emit one chunk covering the full transcript with `timestamp_start_seconds = 0`.
     - Empty transcript → return `[]` (caller logs + skips video).
     - A single segment longer than `window_s` (rare; e.g. a 4-minute monologue with no caption breakpoint) → it goes in one chunk anyway; chunk's `timestamp_end_seconds` reflects the full extent. The downstream tokenizer's 500-token cap may still split it; we simply call the chunker again with halved `window_s` (single-pass, no recursion needed for current data).
- **Determinism:** identical input → identical output. **Token count uses `@anthropic-ai/tokenizer`** (already pinned via `vgc-knowledge-base`).
- **Does NOT do:** species tagging, embedding, persistence.

#### `src/tools/insights/extract.ts` (new — Haiku-driven structured extraction)
- **Single responsibility:** given one transcript chunk + a video metadata block + a species index (for the hallucination guard) + an injectable Anthropic SDK client, return up to 5 schema-validated `Insight` rows. Per CLAUDE.md §9 we use **Haiku 4.5** (`claude-haiku-4-5-20251001`) and rely on `tool_use` JSON-schema-coerced output.
- **Exported surface:**
  ```ts
  export interface ExtractInsightsInput {
    chunk:        KnowledgeChunkRow;        // already persisted; we need its id for the FK
    video_meta:   YoutubeVideoMetadata;
    species_index: SpeciesIndex;             // reused from src/tools/knowledge/species-tagger.ts
  }
  export interface ExtractInsightsDeps {
    anthropic:        AnthropicClientLike;   // duck-typed; tests inject a fake
    prompt_version:   "v1.0";                // pinned at ship time per Q4
    clock:            () => Date;            // for extracted_by.extracted_at
    ulid:             () => string;          // for insight.id
  }
  export interface ExtractInsightsResult {
    insights: Insight[];        // 0..5 rows, all schema-validated, all hallucination-guard-passed
    rejected: Array<{ reason: "hallucinated_species" | "non_regma_format" | "schema_violation"; raw: unknown }>;
  }
  export async function extractInsights(
    input: ExtractInsightsInput,
    deps:  ExtractInsightsDeps,
  ): Promise<ExtractInsightsResult>;
  ```
- **Prompt structure (v1.0 — pinned, semver-bumped on structural changes per Q4):**
  - **System prompt** (cacheable per CLAUDE.md §9):
    1. Role — "You are a Pokemon VGC Insight Extractor. You read 90-second transcript chunks from competitive-Pokemon YouTube videos and emit atomic claims."
    2. Definitions of the six `claim_type`s (matchup / set / lead / meta_trend / tech / counter) with one example each.
    3. Hard rules: ≤ 5 insights per chunk, prioritize salience, 0 insights is fine, each `claim` ≤ 280 chars, each `claim` standalone (no pronouns), `subjects.pokemon` MUST use canonical Showdown ids and MUST appear (substring, case-insensitive) in the chunk text, `subjects.formats` is always exactly `["RegM-A"]`.
    4. The species index display-name table (compressed list, top-50 Reg-M-A species) — token-budget cost ~1500 tokens, paid once per session via prompt cache.
  - **User prompt** (NOT cacheable — varies per chunk):
    - Video title + channel + published_at + canonical_url + chunk timestamp range.
    - Verbatim chunk text.
  - **Tool definition** (Anthropic `tool_use`): one tool `emit_insights({ insights: Insight[] })`. Inputs validated against `InsightExtractionToolInputSchema` (zod) before persistence.
- **Hallucination guard** (Q6, the load-bearing post-extraction filter):
  ```ts
  function passesSpeciesGuard(insight: Insight, chunkText: string, idx: SpeciesIndex): boolean {
    const haystack = chunkText.toLowerCase();
    for (const speciesId of insight.subjects.pokemon) {
      const display = idx.displayNameById.get(speciesId);     // O(1) reverse lookup
      const aliases = idx.aliasesById.get(speciesId) ?? [];   // includes auto-generated "Mega <X>"
      const found = [display, ...aliases].some((n) => n != null && haystack.includes(n.toLowerCase()));
      if (!found) return false;     // hallucinated — Haiku named a species not in the chunk
    }
    return true;
  }
  ```
  Insights that fail are pushed into `rejected[]` and counted in the run summary (`hallucinations_rejected`).
- **Format guard:** if `subjects.formats !== ["RegM-A"]`, reject (`rejected[].reason = "non_regma_format"`). The strict-mode zod schema already enforces this; the explicit catch lets us count rejections rather than crash the chunk.
- **Cap enforcement:** if the model returns > 5 insights for a chunk (rare; the prompt instructs ≤ 5 explicitly), keep the first 5 in declaration order — the model is asked to emit in salience order. Log `cap_truncated += (n - 5)`.
- **Empty-chunk contract:** 0 insights is a valid result (per Q3); `extractInsights` returns `{ insights: [], rejected: [] }` without error.
- **Throws:** `InsightExtractionError` only on rate-limit-after-retry-exhaustion or non-tool-use response after retry exhaustion. **A schema-violating tool input** is rejected and counted, NOT thrown — extraction degrading is recoverable; we don't want one bad chunk to abort the whole video.
- **TSDoc** all six elements; the "When to use it" disambiguates against any future `extractInsightsFromArticle` (deferred Stage 6 per §12).

#### `src/tools/insights/embed.ts` (new — thin wrapper around `src/tools/knowledge/embed.ts`)
- **Single responsibility:** embed each `Insight.claim` (NOT the source excerpt; the claim is the queryable unit) using the existing Voyage `voyage-3-lite` 512-dim client.
- **Why a separate module (not a direct call):** the embed input here is `Insight[]` and the output ties to a different vec0 sidecar (`insight_embeddings`). Keeping the wrapper lets the ingest loop stay readable: `embedInsights(insights, deps) → Float32Array[]`.
- **Exported surface:**
  ```ts
  export async function embedInsights(
    insights: Insight[],
    deps:     { embedClient: EmbedClient },
  ): Promise<Float32Array[]>;     // aligned with insights[]
  ```
- **Reuses:** `createEmbedClient` from `src/tools/knowledge/embed.ts` verbatim. No new dep, no new auth, no new retry policy.
- **Does NOT do:** persistence; the caller writes vectors via `insights.upsert`.

#### `src/tools/knowledge/species-tagger.ts` *(reused)*
The site-agnostic species tagger from metavgc §2.2 is reused as-is (the metavgc plan §19.4 backfills vgcguide via the same module). The hallucination guard above uses the **same `SpeciesIndex`** built by `buildSpeciesIndex(db)` at ingest start. Species tagging is also applied to YouTube transcript chunks before persistence so that `knowledge_search` with `species_id_filter` retrieves them transparently (flow §7.1). `// TODO(stage6-deferred): retroactive-extract-vgcguide-metavgc` (per §12) — the same code path will let us later run extraction on the existing chunks.

### 2.3 DB layer (`src/db/`)

#### `src/db/drizzle-schema.ts` *(extend)*
1. **Widen `knowledge_source_site_value` CHECK** to `${t.sourceSite} IN ('vgcguide','metavgc','youtube')`.
2. **Widen `knowledge_subtype_value` CHECK** to `${t.subtype} IS NULL OR ${t.subtype} IN ('battle-replay','youtube-transcript')`.
3. **Widen `knowledge_id_format` CHECK** GLOB to allow `'youtube:*'`. (The existing format already accepts `'metavgc:*'` from migration 0008.)
4. **Add `metadata: text("metadata")` column** (nullable JSON TEXT) on `knowledgeChunks`. Existing rows get `metadata = NULL`.
5. **New table `insights`** (Drizzle) with columns mirroring `InsightSchema` flat-shape per §3:
   - `id text primary key` (ulid; CHECK regex)
   - `schema_version integer not null` (= 1 CHECK)
   - `claim text not null` (length CHECK ≤ 280)
   - `claim_type text not null` (CHECK IN the 6-enum)
   - `confidence text not null` (CHECK IN low/medium/high)
   - `stance text not null` (CHECK IN supports/refutes/neutral)
   - `source_type text not null` (CHECK IN youtube/article/tournament/replay/user_note)
   - `source_url text not null`
   - `source_author text` (nullable)
   - `source_published_at text` (nullable; ISO-8601)
   - `source_excerpt text not null` (length CHECK ≤ 500)
   - `source_timestamp_seconds integer` (nullable)
   - `extracted_by_model text not null`
   - `extracted_by_prompt_version text not null`
   - `extracted_at text not null` (ISO-8601 CHECK)
   - `embedding_ref text not null` (CHECK GLOB `'insight_embeddings:*'`)
   - `chunk_id text` (nullable; FK → `knowledge_chunks.id` ON DELETE CASCADE)
   - **Unique index** `uq_insights_chunk_claim` on `(chunk_id, claim)` — Q7 idempotency key.
   - **Index** `idx_insights_chunk` on `chunk_id` (cascade delete + cite.ts lookup).
6. **New table `insight_subjects`** with composite PK `(insight_id, subject_kind, subject_value)`:
   - `insight_id text not null` FK `insights.id` ON DELETE CASCADE
   - `subject_kind text not null` (CHECK IN pokemon/move/item/archetype/format)
   - `subject_value text not null`
   - **Index** `idx_insight_subjects_value` on `(subject_kind, subject_value)` — used by the `species_id_filter` join on `insights_search`.
7. `insight_embeddings` is a vec0 virtual table — drizzle does NOT model it; hand-authored in migration 0010 (per `db_orm_drizzle.md` documented exception, identical pattern to `knowledge_chunk_embeddings`).

Per `db_orm_drizzle.md`: schema is the single source of truth for the relational tables; we run `pnpm drizzle-kit generate` and **hand-merge the vec0 CREATE statements + the embedding-ref CHECK + INSERT-from-old block for the `knowledge_chunks` table-rebuild** into the generated SQL (same hand-merge pattern as 0008). The merge is documented at the top of the migration file (Stage 5 deviation note style).

#### `src/db/migrations/0010_insights_and_youtube.sql` (new)
See §4 — full SQL sketch.

#### `src/db/insights.ts` *(extend — full impl, replacing the v1 stub)*
The existing stub (`createInsightStore`) returns `NotImplementedError` from `add` + `search`. We **keep the public interface** (`InsightStore` / `InsightSearchHit` / `InsightSearchOptions` / `InsightSearchFilter`) intact and ship a real implementation behind `createInsightStore(db: Db, deps?: { embedClient: EmbedClient })`. **Surface delta:**
```ts
export interface InsightStore {
  // Existing — both throw NotImplementedError today, real impl in this slice.
  add(insight: Insight, embedding: Float32Array): Promise<void>;     // signature widened: takes the pre-computed vector
  search(query: string, options?: InsightSearchOptions): Promise<InsightSearchHit[]>;

  // New in this slice:
  upsertMany(rows: Array<{ insight: Insight; embedding: Float32Array; subjects: InsightSubjectRow[] }>): Promise<{ inserted: number; skipped_duplicate: number }>;
  listByChunkId(chunkId: string): Promise<Insight[]>;
  listByVideoId(videoId: string): Promise<Insight[]>;        // resolves video_id → source_url SQL filter
  listBySpecies(speciesId: string, opts?: { limit?: number }): Promise<Insight[]>;
}
```
- `upsertMany` is a **single transaction**: INSERT into `insights` (or skip on UNIQUE conflict against `(chunk_id, claim)`) + INSERT into `insight_subjects` (composite PK dedup) + INSERT into `insight_embeddings`. Returns `{ inserted, skipped_duplicate }`.
- `search(query, options)` embeds the query via `deps.embedClient.embed([query], "query")`, runs `SELECT … FROM insight_embeddings WHERE embedding MATCH ? AND k = ?` (sqlite-vec syntax mirroring `knowledge_chunk_embeddings` consumer code), then JOINs on `insights.embedding_ref` to materialize the rows. `options.filter.pokemon` adds `INNER JOIN insight_subjects … WHERE subject_kind = 'pokemon' AND subject_value IN (?)`. `options.filter.claim_type` adds `WHERE insights.claim_type IN (?)`. `options.filter.source_type` adds the same against `source_type`. `options.filter.min_confidence` materializes via a 3-tier ordinal compare (`CASE WHEN low THEN 1 ELSE …`).
- **Why bespoke (not `createSimpleRepo` per CLAUDE.md §10):** multi-table transactional upsert (insights + insight_subjects + insight_embeddings vec0) + multi-column filter with vec MATCH JOIN. The factory deliberately does not generalize that far. Same reasoning as `src/db/knowledge.ts`.

#### `src/db/knowledge.ts` *(extend, additive)*
- `upsertArticleChunks` (already widened by metavgc §19.3 to accept `source_site`) adds an optional `metadata?: (Record<string, unknown> | null)[]` aligned with `chunks[]`. Existing call sites pass `undefined` → all-nulls. The youtube ingest passes per-chunk `{ timestamp_start_seconds, timestamp_end_seconds }`.
- `articleBodyHash(db, source_site, article_slug)` unchanged.
- `search` (already widened by metavgc §19.3 with `species_id_filter`) gains optional `subtype_filter?: ("battle-replay" | "youtube-transcript")[]` for callers that want to restrict to transcripts. The agent tool surface does NOT expose this in v1 (we want unified retrieval); test-only.
- The repo continues to support the link-table `knowledge_chunk_species_tags` introduced in metavgc §19.3; YouTube transcript chunks tag identically.

#### `src/db/tool-definitions.ts` *(extend)*
- New tool: `insights_search` with description "Semantic search over atomic VGC claims extracted from team-author YouTube videos and (future) tournament write-ups. Use when the user asks 'why does the author run X?' or 'what's the plan against Y?'. Returns top-k claims with the source URL + timestamp + author. Pass `species_id_filter` for per-species questions; pass `claim_type` to narrow to lead plans / matchup notes / set choices."
- Input schema: `InsightSearchArgsSchema` (§2.1).
- Output schema: `InsightSearchHitSchema[]`.
- Backed by `createInsightStore(db, { embedClient }).search(query, options)`.
- The existing `knowledge_search` tool definition is **untouched**; YouTube chunks land in `knowledge_chunks` and are returned transparently (flow §7.1).

#### `src/data/tactical/cite.ts` *(extend, additive)*
- Adds a new field `insights: InsightCitation[]` to `ScenarioOverview` (Q5 — distinct from `knowledge_chunk_citations`).
- `InsightCitation` shape: `{ insight_id, claim, claim_type, source_url, source_timestamp_seconds, source_author, score }` — flat, agent-ready.
- Implementation: for each scenario, after the existing knowledge-chunk citation pass, call `insightStore.search(scenario.query, { filter: { pokemon: scenario.species_ids, ...narrow } })` and surface the top-3 hits as `InsightCitation`. Threshold: `score ≥ 0.6` (mirrors the existing knowledge_chunk threshold; tunable via `cite.ts` constants).
- Non-breaking: `insights` defaults to `[]` when `insightStore` is the v1 stub (graceful fallback if the slice is feature-flag-disabled, though we ship without a flag — see §9).

### 2.4 Ingest script (`scripts/data/`)

#### `scripts/data/ingest-youtube.ts` (new)
Mirrors `scripts/data/ingest-metavgc.ts` shape. Argv: `--url <youtube_url>` (required, single video; channel-pull deferred), `--db <path>`, `--no-network` (cache-only mode for testing), `--no-extract` (chunk-only mode — bypass Haiku; useful when `ANTHROPIC_API_KEY` is missing per §9 fallback). Pseudocode in §5 below.

#### `package.json` *(extend)*
- Add script: `"data:ingest:youtube": "tsx scripts/data/ingest-youtube.ts"`.
- Add dep: `"youtube-transcript": "^1.2.x"` (Q1 binding answer; pinned to most recent 1.x at landing time). **No `@anthropic-ai/sdk` dep added — already pinned via the existing roster build / agent loop.**

### 2.5 Data + fixtures

```
data/cache/youtube/                                      (NEW, gitignored)
fixtures/youtube/
  2026-05-09__J0eVKJyJ_DQ__transcript.json               (real captured transcript JSON from the user's example)
  2026-05-09__J0eVKJyJ_DQ__metadata.json                 (real watch-page metadata)
  2026-05-09__synthetic-no-captions__transcript.json     (empty; for the no-captions edge case test)
  2026-05-09__synthetic-short__transcript.json           (45s total; for the < window_s edge case)
  2026-05-09__synthetic-long-monologue__transcript.json  (one 4-min segment; for the > window_s edge case)
  2026-05-09__synthetic-non-english__metadata.json       (metadata.language = "ja"; for Q9 v1 English-only filter)
fixtures/insights/
  2026-05-09__haiku-extraction__J0eVKJyJ_DQ-chunk-3__response.json  (recorded Anthropic tool_use response for one chunk; Stage 4 mock)
  2026-05-09__haiku-extraction__hallucinated__response.json         (synthetic: response includes a species not in the chunk; tests the guard)
  2026-05-09__haiku-extraction__non-regma-format__response.json     (synthetic: subjects.formats = ["VGC2024Reg G"]; tests the format guard)
  2026-05-09__haiku-extraction__cap-overflow__response.json         (synthetic: 7 insights returned; tests the ≤5 truncation)
```

Per memory `test_fixtures_no_invariant_blobs.md` — all fixtures are JSON, reviewable diff. The Haiku response fixtures are committed as **the verbatim Anthropic SDK response shape** (no proprietary schema invariants); the generator harness is a one-shot script noted at the top of the fixture file as a comment field.

### 2.6 Tests

```
tests/schemas/insight-extended.test.ts
tests/schemas/knowledge-youtube.test.ts
tests/tools/youtube/parse-transcript.test.ts
tests/tools/youtube/chunk-transcript.test.ts
tests/tools/youtube/client.test.ts
tests/tools/insights/extract.test.ts
tests/tools/insights/embed.test.ts
tests/db/migrations/0010-insights-and-youtube.test.ts
tests/db/insights.test.ts
tests/db/knowledge-youtube.test.ts
tests/db/tool-definitions/insights-search.test.ts
tests/data/tactical/cite-insights.test.ts
tests/scripts/ingest-youtube.test.ts
tests/scripts/ingest-youtube-idempotency.test.ts
tests/contract/youtube-live.test.ts                       (gated by RUN_CONTRACT_TESTS=1)
```

See §7 for the per-test ordering + assertion table.

## 3. Schemas (zod) + drizzle additions

```ts
// src/schemas/insight.ts (additive delta)
export const InsightSchema = z
  .object({
    // … existing fields unchanged …
    chunk_id: z.string().min(1).nullable(),     // NEW — FK to knowledge_chunks.id
  })
  .strict();

export const InsightSubjectKindSchema = z.enum(["pokemon","move","item","archetype","format"]);
export type InsightSubjectKind = z.infer<typeof InsightSubjectKindSchema>;

export const InsightSubjectRowSchema = z.object({
  insight_id:    z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  subject_kind:  InsightSubjectKindSchema,
  subject_value: z.string().min(1).max(100),
}).strict();

export const InsightSearchHitSchema = z.object({
  insight: InsightSchema,
  score:   z.number().min(0).max(1),
}).strict();

export const InsightSearchArgsSchema = z.object({
  query:             z.string().min(1).max(500),
  claim_type:        ClaimTypeSchema.optional(),
  species_id_filter: z.string().regex(/^[a-z0-9-]+$/).optional(),
  limit:             z.number().int().min(1).max(20).default(5),
}).strict();
```

```ts
// src/schemas/knowledge.ts (additive delta — relative to metavgc §19 state)
export const SourceSiteSchema = z.enum(["vgcguide","metavgc","youtube"]);     // widened
export const SubtypeSchema    = z.enum(["battle-replay","youtube-transcript"]).nullable(); // widened
export const KnowledgeChunkMetadataSchema = z.record(z.union([z.string(), z.number(), z.null()])).optional();
// id regex: /^(vgcguide|metavgc|youtube):[a-z0-9_-]+:\d+$/
```

```ts
// Drizzle delta (sketch — final lands at Stage 5)
export const insights = sqliteTable("insights", {
  id:                          text("id").primaryKey(),
  schemaVersion:               integer("schema_version").notNull(),
  claim:                       text("claim").notNull(),
  claimType:                   text("claim_type").notNull(),
  confidence:                  text("confidence").notNull(),
  stance:                      text("stance").notNull(),
  sourceType:                  text("source_type").notNull(),
  sourceUrl:                   text("source_url").notNull(),
  sourceAuthor:                text("source_author"),
  sourcePublishedAt:           text("source_published_at"),
  sourceExcerpt:               text("source_excerpt").notNull(),
  sourceTimestampSeconds:      integer("source_timestamp_seconds"),
  extractedByModel:            text("extracted_by_model").notNull(),
  extractedByPromptVersion:    text("extracted_by_prompt_version").notNull(),
  extractedAt:                 text("extracted_at").notNull(),
  embeddingRef:                text("embedding_ref").notNull(),
  chunkId:                     text("chunk_id").references(() => knowledgeChunks.id, { onDelete: "cascade" }),
}, (t) => ({
  uqChunkClaim:        uniqueIndex("uq_insights_chunk_claim").on(t.chunkId, t.claim),
  idxChunk:            index("idx_insights_chunk").on(t.chunkId),
  idFormat:            check("insights_id_format",            sql`${t.id} GLOB '????????????????????????????'`),  // ulid 26 chars
  schemaV:             check("insights_schema_version",       sql`${t.schemaVersion} = 1`),
  claimLen:            check("insights_claim_len",            sql`length(${t.claim}) BETWEEN 1 AND 280`),
  claimTypeIn:         check("insights_claim_type",           sql`${t.claimType} IN ('matchup','set','lead','meta_trend','tech','counter')`),
  confidenceIn:        check("insights_confidence",           sql`${t.confidence} IN ('low','medium','high')`),
  stanceIn:            check("insights_stance",               sql`${t.stance} IN ('supports','refutes','neutral')`),
  sourceTypeIn:        check("insights_source_type",          sql`${t.sourceType} IN ('youtube','article','tournament','replay','user_note')`),
  excerptLen:          check("insights_excerpt_len",          sql`length(${t.sourceExcerpt}) BETWEEN 0 AND 500`),
  embeddingRefFormat:  check("insights_embedding_ref_format", sql`${t.embeddingRef} GLOB 'insight_embeddings:*'`),
  extractedAtIso:      check("insights_extracted_at_iso",     sql`${t.extractedAt} GLOB '????-??-??T??:??:??*'`),
}));

export const insightSubjects = sqliteTable("insight_subjects", {
  insightId:    text("insight_id").notNull().references(() => insights.id, { onDelete: "cascade" }),
  subjectKind:  text("subject_kind").notNull(),
  subjectValue: text("subject_value").notNull(),
}, (t) => ({
  pk:           primaryKey({ columns: [t.insightId, t.subjectKind, t.subjectValue] }),
  idxValue:     index("idx_insight_subjects_value").on(t.subjectKind, t.subjectValue),
  kindIn:       check("insight_subjects_kind", sql`${t.subjectKind} IN ('pokemon','move','item','archetype','format')`),
}));

// knowledgeChunks (additive)
export const knowledgeChunks = sqliteTable("knowledge_chunks", {
  // … existing 0008 columns …
  metadata:  text("metadata"),     // NEW — JSON TEXT or NULL
}, (t) => ({
  // … existing CHECKs …
  sourceSiteValue: check("knowledge_source_site_value", sql`${t.sourceSite} IN ('vgcguide','metavgc','youtube')`),  // widened
  subtypeValue:    check("knowledge_subtype_value",     sql`${t.subtype} IS NULL OR ${t.subtype} IN ('battle-replay','youtube-transcript')`),  // widened
  idFormat:        check("knowledge_id_format",         sql`${t.id} GLOB 'vgcguide:*' OR ${t.id} GLOB 'metavgc:*' OR ${t.id} GLOB 'youtube:*'`),  // widened
}));
```

The vec0 sidecar (`insight_embeddings`) is hand-authored in migration 0010 — drizzle does not model virtual tables; the `db_orm_drizzle.md` documented escape hatch applies (same as `knowledge_chunk_embeddings` in `0007`).

## 4. Migration `0010_insights_and_youtube.sql`

Hand-merged (drizzle-kit-generated for the relational tables + hand-authored vec0 block, same pattern as `0008`). The migration has **four logical phases**, applied in one transaction-equivalent block per drizzle's migration runner:

```sql
-- Hand-authored: drizzle-kit can express CHECK constraint additions and column
-- additions via the standard SQLite table-rebuild, but the vec0 virtual table
-- and the cross-table FK timing must be manually merged.
--
-- Plan: docs/plans/youtube-insights.md §4. Widens `knowledge_chunks`:
--   1. CHECK on source_site widened from `IN ('vgcguide','metavgc')` to
--      `IN ('vgcguide','metavgc','youtube')`.
--   2. CHECK on subtype widened from `IS NULL OR = 'battle-replay'` to
--      `IS NULL OR IN ('battle-replay','youtube-transcript')`.
--   3. CHECK on id GLOB extended to allow `'youtube:*'`.
--   4. Adds nullable `metadata text` column (JSON or NULL).
--
-- Adds:
--   - `insights` table (relational metadata + provenance + FK to knowledge_chunks).
--   - `insight_subjects` link table (composite PK; index on (subject_kind, subject_value)).
--   - `insight_embeddings` vec0 virtual table (512-dim cosine; same dim as knowledge_chunk_embeddings).
--
-- Vec0 sidecar `knowledge_chunk_embeddings` is intentionally untouched. Per
-- memory single_db_non_destructive_build.md, every existing row in
-- knowledge_chunks AND knowledge_chunk_embeddings survives this migration.

-- ============================================================
-- Phase 1 — knowledge_chunks table-rebuild (CHECK widening + metadata column)
-- ============================================================
PRAGMA foreign_keys=OFF;

CREATE TABLE `__new_knowledge_chunks` (
  `id`                  text NOT NULL PRIMARY KEY,
  `source_site`         text NOT NULL,
  `article_slug`        text NOT NULL,
  `article_title`       text NOT NULL,
  `article_url`         text NOT NULL,
  `article_section`     text NOT NULL,
  `section_heading`     text NOT NULL,
  `chunk_index`         integer NOT NULL,
  `chunk_text`          text NOT NULL,
  `chunk_token_count`   integer NOT NULL,
  `subtype`             text,
  `body_hash`           text NOT NULL,
  `embedding_ref`       text NOT NULL,
  `metadata`            text,                                 -- NEW
  CONSTRAINT "knowledge_source_site_value"   CHECK("__new_knowledge_chunks"."source_site" IN ('vgcguide','metavgc','youtube')),
  CONSTRAINT "knowledge_section_value"       CHECK("__new_knowledge_chunks"."article_section" IN ('intro','teambuilding','battling')),
  CONSTRAINT "knowledge_subtype_value"       CHECK("__new_knowledge_chunks"."subtype" IS NULL OR "__new_knowledge_chunks"."subtype" IN ('battle-replay','youtube-transcript')),
  CONSTRAINT "knowledge_token_count_range"   CHECK("__new_knowledge_chunks"."chunk_token_count" BETWEEN 1 AND 500),
  CONSTRAINT "knowledge_body_hash_format"    CHECK("__new_knowledge_chunks"."body_hash" GLOB 'sha256:*'),
  CONSTRAINT "knowledge_id_format"           CHECK("__new_knowledge_chunks"."id" GLOB 'vgcguide:*' OR "__new_knowledge_chunks"."id" GLOB 'metavgc:*' OR "__new_knowledge_chunks"."id" GLOB 'youtube:*'),
  CONSTRAINT "knowledge_embedding_ref_format" CHECK("__new_knowledge_chunks"."embedding_ref" GLOB 'knowledge_chunk_embeddings:*')
);

INSERT INTO `__new_knowledge_chunks`
  (id, source_site, article_slug, article_title, article_url,
   article_section, section_heading, chunk_index, chunk_text,
   chunk_token_count, subtype, body_hash, embedding_ref, metadata)
SELECT
   id, source_site, article_slug, article_title, article_url,
   article_section, section_heading, chunk_index, chunk_text,
   chunk_token_count, subtype, body_hash, embedding_ref, NULL
FROM `knowledge_chunks`;

DROP TABLE `knowledge_chunks`;
ALTER TABLE `__new_knowledge_chunks` RENAME TO `knowledge_chunks`;

-- Recreate indexes (must be re-issued after table-rebuild — drizzle-kit's standard pattern).
CREATE UNIQUE INDEX `uq_knowledge_article_chunk` ON `knowledge_chunks` (`source_site`,`article_slug`,`chunk_index`);
CREATE INDEX        `idx_knowledge_section`      ON `knowledge_chunks` (`article_section`);
CREATE INDEX        `idx_knowledge_subtype`      ON `knowledge_chunks` (`subtype`);
CREATE INDEX        `idx_knowledge_body_hash`    ON `knowledge_chunks` (`article_slug`,`body_hash`);

PRAGMA foreign_keys=ON;

-- ============================================================
-- Phase 2 — insights relational table
-- ============================================================
CREATE TABLE `insights` (
  `id`                          text NOT NULL PRIMARY KEY,
  `schema_version`              integer NOT NULL,
  `claim`                       text NOT NULL,
  `claim_type`                  text NOT NULL,
  `confidence`                  text NOT NULL,
  `stance`                      text NOT NULL,
  `source_type`                 text NOT NULL,
  `source_url`                  text NOT NULL,
  `source_author`               text,
  `source_published_at`         text,
  `source_excerpt`              text NOT NULL,
  `source_timestamp_seconds`    integer,
  `extracted_by_model`          text NOT NULL,
  `extracted_by_prompt_version` text NOT NULL,
  `extracted_at`                text NOT NULL,
  `embedding_ref`               text NOT NULL,
  `chunk_id`                    text REFERENCES `knowledge_chunks`(`id`) ON DELETE CASCADE,
  CONSTRAINT "insights_schema_version"        CHECK(`schema_version` = 1),
  CONSTRAINT "insights_claim_len"             CHECK(length(`claim`) BETWEEN 1 AND 280),
  CONSTRAINT "insights_claim_type"            CHECK(`claim_type` IN ('matchup','set','lead','meta_trend','tech','counter')),
  CONSTRAINT "insights_confidence"            CHECK(`confidence` IN ('low','medium','high')),
  CONSTRAINT "insights_stance"                CHECK(`stance` IN ('supports','refutes','neutral')),
  CONSTRAINT "insights_source_type"           CHECK(`source_type` IN ('youtube','article','tournament','replay','user_note')),
  CONSTRAINT "insights_excerpt_len"           CHECK(length(`source_excerpt`) BETWEEN 0 AND 500),
  CONSTRAINT "insights_embedding_ref_format"  CHECK(`embedding_ref` GLOB 'insight_embeddings:*'),
  CONSTRAINT "insights_extracted_at_iso"      CHECK(`extracted_at` GLOB '????-??-??T??:??:??*')
);
CREATE UNIQUE INDEX `uq_insights_chunk_claim` ON `insights` (`chunk_id`, `claim`);
CREATE INDEX        `idx_insights_chunk`     ON `insights` (`chunk_id`);

-- ============================================================
-- Phase 3 — insight_subjects link table
-- ============================================================
CREATE TABLE `insight_subjects` (
  `insight_id`     text NOT NULL,
  `subject_kind`   text NOT NULL,
  `subject_value`  text NOT NULL,
  PRIMARY KEY (`insight_id`, `subject_kind`, `subject_value`),
  FOREIGN KEY (`insight_id`) REFERENCES `insights`(`id`) ON DELETE CASCADE,
  CONSTRAINT "insight_subjects_kind" CHECK(`subject_kind` IN ('pokemon','move','item','archetype','format'))
);
CREATE INDEX `idx_insight_subjects_value` ON `insight_subjects` (`subject_kind`, `subject_value`);

-- ============================================================
-- Phase 4 — insight_embeddings vec0 sidecar
-- ============================================================
CREATE VIRTUAL TABLE `insight_embeddings` USING vec0(
  embedding float[512] distance_metric=cosine
);
```

**Verification matrix** (executed during fixture-creation, NOT during Stage 3):

| Check | How | Pass criterion |
|---|---|---|
| Existing knowledge_chunks rows preserved | row count + sample row pre/post | unchanged except `metadata = NULL` |
| Existing knowledge_chunk_embeddings rows preserved | `SELECT COUNT(*)` pre/post | equal |
| CHECK widening accepts youtube | INSERT `source_site='youtube'`, `subtype='youtube-transcript'`, `id='youtube:abc:0'` | accepted |
| CHECK widening rejects unknowns | INSERT `source_site='discord'` | rejected |
| FK cascade — chunk delete | INSERT chunk + insight + subject + embedding; DELETE chunk; assert insight + subject rows gone; assert embedding row remains (we DO NOT cascade across the vec0 boundary — see §10) | as specified |
| Composite uniqueness | INSERT 2× `(chunk_id, claim)` identical | second rejected |
| Idempotent migration runner | re-run on already-migrated DB | no-op |

## 5. Tool contracts

Every export carries TSDoc with all six elements per CLAUDE.md §10.

### 5.1 `youtubeTranscriptClient.fetch(videoId)`
Already specified in §2.2 (`createYoutubeClient`). Reproduced here for the contract surface:
- **Inputs:** `videoId: string` (11-char YouTube id; the script accepts a full URL via `--url` and parses out the id before calling the client).
- **Outputs:** `YoutubeTranscriptSegment[]` (text + start_s + duration_s) and `YoutubeVideoMetadata` (title + channel + published_at + canonical_url + fetched_at + language).
- **Throws:** `YoutubeFetchError` with `.kind ∈ {"no_captions","disabled","private","network","non_english"}`.
- **Cache:** keyed on `videoId`; 7d TTL; the parsed transcript JSON + the parsed metadata JSON are stored as two cache entries.
- **Throttle:** 1 RPS (single-video ingest is the v1 surface; channel-pull deferred per §12).

### 5.2 `chunkTranscript(segments, opts)`
Already specified in §2.2. Contract recap:
- **Inputs:** `TranscriptSegment[]`, `{ window_s = 90, overlap_s = 15 }`.
- **Outputs:** `TranscriptChunk[]` with `chunk_index`, `chunk_text`, `chunk_token_count`, `timestamp_start_seconds`, `timestamp_end_seconds`.
- **Determinism:** identical input → identical output.
- **Edge cases enumerated:** empty input → `[]`; single-segment-longer-than-window → emit one chunk anyway; total-duration-shorter-than-window → emit one chunk covering full extent.
- **Token budget:** chunk_token_count ≤ 500 (chunker's hard cap; in practice 90s of speech ≈ 250–350 tokens).

### 5.3 `extractInsights(input, deps)`
Already specified in §2.2. Contract recap:
- **Inputs:** `{ chunk: KnowledgeChunkRow, video_meta, species_index }`.
- **Deps:** `{ anthropic: AnthropicClientLike, prompt_version: "v1.0", clock, ulid }`.
- **Outputs:** `{ insights: Insight[] (≤5, all guard-passed), rejected: { reason, raw }[] }`.
- **Throws:** `InsightExtractionError` only on `rate_limit` (after retry exhaustion) or `anthropic_error` (e.g., 401/403).
- **Hallucination guard:** species-substring against `chunk.chunk_text` per §2.2 pseudocode.
- **Format guard:** `subjects.formats === ["RegM-A"]` enforced.
- **Cap:** ≤ 5 (post-truncation if model over-emits).
- **Prompt cache placement** (CLAUDE.md §9): system prompt + species table → cacheable block; user prompt → ephemeral. First chunk pays the cache build; chunks 2..N hit a warm cache.

### 5.4 `embedInsights(insights, { embedClient })`
- **Inputs:** `Insight[]`.
- **Outputs:** `Float32Array[]` (512-dim, aligned with input).
- **Reuses:** `EmbedClient` from `src/tools/knowledge/embed.ts` verbatim.
- **Embeds:** `insight.claim` (NOT `source.excerpt`) — the claim is the queryable unit.

### 5.5 `insights` repo
Public methods on `InsightStore` (after §2.3 widening):
- `add(insight, embedding) → Promise<void>` — single-row insert; subjects derived from `insight.subjects.{pokemon,moves,items,archetypes,formats}`.
- `upsertMany(rows) → Promise<{ inserted, skipped_duplicate }>` — bulk transactional path; the ingest-loop call.
- `search(query, options?) → Promise<InsightSearchHit[]>` — embed query + cosine MATCH + JOIN insight_subjects on filter.
- `listByChunkId(chunkId) → Promise<Insight[]>` — for cite.ts.
- `listByVideoId(videoId) → Promise<Insight[]>` — resolves `videoId` to `source_url LIKE '%v=' || videoId || '%'`. Stage 6 deferred TODO #7: maintain a denormalized `video_id` column once we have > 1 video.
- `listBySpecies(speciesId, opts?) → Promise<Insight[]>` — JOIN `insight_subjects` WHERE `subject_kind='pokemon' AND subject_value = ?`.

All return JSON-deserialized `Insight` objects validated against `InsightSchema` via `parseOrThrow` from `src/db/simple-repo.ts` (CLAUDE.md §10 reuse).

### 5.6 Ingest orchestration

`scripts/data/ingest-youtube.ts` pseudocode:

```ts
async function main(argv: string[], deps?: MainDeps): Promise<number> {
  const opts = parseArgs(argv);  // --url <youtube_url>, --db, --no-network, --no-extract

  const videoId = parseVideoIdFromUrl(opts.url);
  if (!videoId) throw new YoutubeFetchError({ kind: "network", video_id: "<unparseable>", cause: "url-parse-failed" });

  const apiKeyVoyage    = process.env.VOYAGE_API_KEY ?? "";
  const apiKeyAnthropic = process.env.ANTHROPIC_API_KEY ?? "";
  const skipExtract     = opts.noExtract || apiKeyAnthropic === "";

  const db          = deps?.db ?? open(opts.db);
  const ownsDb      = deps?.db === undefined;

  const ytClient    = deps?.ytClient    ?? createYoutubeClient({ cacheDir: process.env.YOUTUBE_CACHE_DIR ?? "data/cache/youtube" });
  const embedClient = deps?.embedClient ?? createEmbedClient({ apiKey: apiKeyVoyage, model: "voyage-3-lite", maxBatch: 64 });
  const anthropic   = deps?.anthropic   ?? createAnthropicClient({ apiKey: apiKeyAnthropic });
  const speciesIndex = deps?.speciesIndex ?? buildSpeciesIndex(db);    // shared with metavgc tagger

  const summary = {
    ok: true,
    video_id: videoId,
    chunks_inserted: 0,
    chunks_skipped_unchanged: 0,
    chunks_with_species_tags: 0,
    insights_inserted: 0,
    insights_skipped_duplicate: 0,
    hallucinations_rejected: 0,
    cap_truncated: 0,
    extraction_skipped: skipExtract,
    failures: [] as { stage: string; cause: string }[],
  };

  try {
    // 1. Fetch transcript + metadata.
    const meta     = await ytClient.fetchMetadata(videoId);
    if (meta.language && !meta.language.startsWith("en")) {
      summary.failures.push({ stage: "language", cause: `non-english: ${meta.language}` });
      return 0;     // Q9: English-only in v1; soft-skip non-English videos
    }
    const segments = await ytClient.fetchTranscript(videoId);
    const parsed   = parseTranscript(segments);
    if (parsed.length === 0) {
      summary.failures.push({ stage: "transcript", cause: "empty" });
      return 0;
    }

    // 2. Chunk.
    const chunks = chunkTranscript(parsed, { window_s: 90, overlap_s: 15 });

    // 3. Persist chunks (idempotent on (source_url, chunk_index)).
    const knowledgeChunkRows = chunks.map((c) => ({
      id: `youtube:${videoId}:${c.chunk_index}`,
      source_site:    "youtube" as const,
      article_slug:   videoId,           // slug = video id
      article_title:  meta.title,
      article_url:    meta.canonical_url,
      article_section:"intro" as const,  // pinned for transcript chunks; same convention as metavgc
      section_heading: `t=${c.timestamp_start_seconds}s`,
      chunk_index:    c.chunk_index,
      chunk_text:     c.chunk_text,
      chunk_token_count: c.chunk_token_count,
      subtype:        "youtube-transcript" as const,
      body_hash:      "sha256:" + sha256Hex(parsed.map((s) => s.text).join("|")),  // hash of whole transcript
      metadata:       { timestamp_start_seconds: c.timestamp_start_seconds, timestamp_end_seconds: c.timestamp_end_seconds },
    }));
    const speciesTagsPerChunk = chunks.map((c) => detectSpeciesTags(c.chunk_text, speciesIndex));

    // body_hash skip-existing.
    const existingHash = knowledge.articleBodyHash(db, "youtube", videoId);
    if (existingHash === knowledgeChunkRows[0]?.body_hash) {
      summary.chunks_skipped_unchanged = chunks.length;
      // Continue to extraction step ONLY if there are no existing insights for any of the chunks
      // (handles partial-failure recovery — first run persisted chunks but crashed before extraction).
    } else {
      const vectors = await embedClient.embed(chunks.map((c) => c.chunk_text), "document");
      const result  = knowledge.upsertArticleChunks(db, {
        source_site:  "youtube",
        article_slug: videoId,
        body_hash:    knowledgeChunkRows[0].body_hash,
        chunks:       knowledgeChunkRows,
        embeddings:   vectors,
        metadata:     knowledgeChunkRows.map((r) => r.metadata),
        species_tags_per_chunk: speciesTagsPerChunk,
      });
      summary.chunks_inserted = result.inserted;
      summary.chunks_with_species_tags = speciesTagsPerChunk.filter((t) => t.length > 0).length;
    }

    if (skipExtract) {
      process.stdout.write(JSON.stringify(summary) + "\n");
      return 0;
    }

    // 4. Extract insights from each chunk.
    const persistedChunks = knowledge.list(db, { source_site: "youtube", article_slug: videoId });
    for (const chunk of persistedChunks) {
      try {
        const result = await extractInsights(
          { chunk, video_meta: meta, species_index: speciesIndex },
          { anthropic, prompt_version: "v1.0", clock: () => new Date(), ulid: makeUlid },
        );
        summary.hallucinations_rejected += result.rejected.filter((r) => r.reason === "hallucinated_species").length;
        summary.cap_truncated           += Math.max(0, result.insights.length - 5);

        if (result.insights.length === 0) continue;

        // Embed the claims, build subject rows, single-tx upsert.
        const claimVectors = await embedInsights(result.insights, { embedClient });
        const upsertRows = result.insights.map((ins, i) => ({
          insight: ins,
          embedding: claimVectors[i],
          subjects: subjectRowsFromInsight(ins),
        }));
        const ur = await insightStore.upsertMany(upsertRows);
        summary.insights_inserted          += ur.inserted;
        summary.insights_skipped_duplicate += ur.skipped_duplicate;
      } catch (e) {
        if (e instanceof InsightExtractionError && (e.kind === "rate_limit" || e.kind === "schema_violation")) {
          summary.failures.push({ stage: "extract", cause: `${e.kind}@chunk:${chunk.id}` });
          continue;
        }
        throw e;     // KnowledgeAuthError + KnowledgeStorageError + auth-class InsightExtractionError fail loud
      }
    }

    process.stdout.write(JSON.stringify(summary) + "\n");
    return 0;
  } catch (e) {
    if (e instanceof YoutubeFetchError && (e.kind === "no_captions" || e.kind === "disabled" || e.kind === "private")) {
      summary.failures.push({ stage: "fetch", cause: e.kind });
      process.stdout.write(JSON.stringify(summary) + "\n");
      return 0;
    }
    summary.ok = false;
    process.stderr.write(`[ingest-youtube] FATAL: ${e}\n`);
    return 1;
  } finally {
    if (ownsDb) { try { db.$client.close(); } catch { /* ignore */ } }
  }
}
```

**Exit codes:** `0` for clean (including all article-class failures); `1` for `KnowledgeAuthError`, `KnowledgeStorageError`, programmer-class `InsightExtractionError(anthropic_error)` with status 401/403, DB error, uncaught.

## 6. Anthropic agent tool surface

Two surfaces, per flow §7:

### 6.1 `knowledge_search` — extends transparently
The existing `knowledge_search` tool definition (last touched in metavgc §19.3 — gained `species_id_filter`) is **untouched in v1**. YouTube transcript chunks land in `knowledge_chunks` with `source_site = 'youtube'` + `subtype = 'youtube-transcript'`. The vec0 cosine search returns them ranked alongside vgcguide + metavgc hits. The tool description text gains one sentence by Stage 5 reviewer call: "Pass `source_site_filter: ['youtube']` to restrict to team-author transcript chunks; useful when the user asks 'where did the author say…'." The `source_site_filter` parameter already exists from `vgc-knowledge-base`; the description merely adds a worked example.

**Call site impact:** none. The agent's existing `knowledge_search` calls work unchanged. A single line added to the tool description prose.

### 6.2 `insights_search` — NEW tool

```ts
// src/db/tool-definitions.ts (additive)
export const insightsSearchTool = tool({
  name:        "insights_search",
  description:
    "Semantic search over atomic VGC claims extracted from team-author YouTube " +
    "video deep-dives (and future article corpora). Returns top-k claims with " +
    "the source URL + timestamp + author. Use when the user asks 'why does the " +
    "author run X?', 'what's the lead plan against Y?', or 'what does the team's " +
    "creator say about matchup Z?'. Each result is one atomic claim with a verbatim " +
    "excerpt linkable to a precise video moment. Pair with `knowledge_search` " +
    "(which returns broader context paragraphs) when both surface and substance " +
    "matter.",
  input_schema: zodToJsonSchema(InsightSearchArgsSchema),
  output_schema: zodToJsonSchema(z.array(InsightSearchHitSchema)),
  invoke: async (rawArgs, { db, embedClient }): Promise<InsightSearchHit[]> => {
    const args = InsightSearchArgsSchema.parse(rawArgs);
    const store = createInsightStore(db, { embedClient });
    return store.search(args.query, {
      filter: {
        pokemon: args.species_id_filter ? [args.species_id_filter] : undefined,
        claim_type: args.claim_type ? [args.claim_type] : undefined,
      },
      limit: args.limit,
    });
  },
});
```

- **Why two tools, not one** (departing from the metavgc precedent of "fewer wider tools"): the multi-tool BLOCKER lesson from pokepaste argues against narrow tools that confuse selection — but here the **return shape differs** (`KnowledgeSearchHit` is a passage; `InsightSearchHit` is a structured atomic claim with stance + confidence). Forcing both into one tool either widens the response shape (bad — the agent has to disambiguate at use time) or hides the structured-claim affordance (worse — the model reaches for `knowledge_search` and gets a paragraph when it could have gotten a one-line citable claim).
- **Prompt-cache placement** (CLAUDE.md §9): the tool definition + the agent's system prompt are in the cacheable block. The query embedding is computed client-side per call (Voyage retrieval-tuned `query` mode); not cached.
- **Output budget:** `limit ≤ 20`, default 5. At ~150 tokens per `Insight` (claim + source.excerpt), top-5 fits comfortably under 1k tokens.

### 6.3 Tool selection guidance for the system prompt
A short paragraph added to the agent's system prompt (Stage 5):
> When the user asks "what's the plan / why this choice / what does the author say", prefer `insights_search` — it returns atomic claims with author + timestamp citations. When the user asks for VGC theory or general principles, prefer `knowledge_search` — it returns curated guide passages from vgcguide / metavgc / video transcripts. When the user wants a per-species deep dive, call BOTH with `species_id_filter` set; merge the results in your reasoning.

## 7. Test strategy + ordering (YT-T1..YT-Tn)

User-pinned order (mirrors metavgc): **schema → parse-transcript → chunk-transcript → client → migration → repo (insights) → repo (knowledge_chunks youtube extension) → extract-insights → embed-insights → tool surface (insights_search) → cite extension → ingest end-to-end → idempotency → contract**. Tests numbered in writing order, prefix `YT-T`. Avoids cross-slice number conflict with VGC-T*, META-T*, PIKA-T*, POKE-T*, LAB-T*.

The §3 pure-data-definition exemption (CLAUDE.md §3) applies to schema-only tests **YT-T1–YT-T3**. Everything from YT-T4 onward is strict per-test Red→Green; any vacuous-green slip must be flagged in the change report.

| # | Test file | Test name | Asserts | Min code to green |
|---|---|---|---|---|
| YT-T1 | `tests/schemas/insight-extended.test.ts` | `InsightSchema accepts chunk_id: string \| null` | parse with each variant; strict-mode rejects `chunk_id: undefined` (must be explicit null) | add `chunk_id` field |
| YT-T2 | `tests/schemas/insight-extended.test.ts` | `InsightSearchArgsSchema enforces limit default 5, max 20` | three invocations | impl |
| YT-T3 | `tests/schemas/knowledge-youtube.test.ts` | `KnowledgeChunkSchema accepts source_site:"youtube" + subtype:"youtube-transcript"` + `metadata.timestamp_start_seconds` round-trip | parse + serialize | widen enums + add metadata field |
| YT-T4 | `tests/tools/youtube/parse-transcript.test.ts` | `parseTranscript decodes &amp;#39; → '` | synthetic input with HTML-entity-encoded apostrophe; assert decoded | impl |
| YT-T5 | `tests/tools/youtube/parse-transcript.test.ts` | `parseTranscript renames offset_ms → start_s` | input shape from the npm package; assert numeric coercion | mapping |
| YT-T6 | `tests/tools/youtube/chunk-transcript.test.ts` | `chunkTranscript with default opts produces 90s windows + 15s overlap` | synthetic 360s of 5s segments → 5 chunks; assert anchors at 0, 75, 150, 225, 300 | impl |
| YT-T7 | `tests/tools/youtube/chunk-transcript.test.ts` | `chunkTranscript on empty input returns []` | empty array → `[]` | empty branch |
| YT-T8 | `tests/tools/youtube/chunk-transcript.test.ts` | `chunkTranscript on 45s total returns one chunk covering full extent` | < window edge case | full-extent branch |
| YT-T9 | `tests/tools/youtube/chunk-transcript.test.ts` | `chunkTranscript with single 240s segment returns one chunk` | > window single-segment edge case | single-segment branch |
| YT-T10 | `tests/tools/youtube/chunk-transcript.test.ts` | `chunkTranscript preserves timestamp_start_seconds at first segment of window` | assert `chunk[2].timestamp_start_seconds === 150` exactly | anchor preservation |
| YT-T11 | `tests/tools/youtube/chunk-transcript.test.ts` | `chunkTranscript chunk_token_count ≤ 500` | dense synthetic input; assert per-chunk cap | tokenizer integration |
| YT-T12 | `tests/tools/youtube/chunk-transcript.test.ts` | `chunkTranscript determinism — same input → same output` | run twice; deepEqual | (no new code — assertion only) |
| YT-T13 | `tests/tools/youtube/client.test.ts` | `fetchTranscript happy-path returns segments` | mocked `transcriptImpl` returns 3 segments; assert mapped to `YoutubeTranscriptSegment[]` | wrapper |
| YT-T14 | `tests/tools/youtube/client.test.ts` | `fetchTranscript throws YoutubeFetchError(no_captions) on TranscriptDisabled` | mock raises pkg's TranscriptDisabled; assert `kind === "no_captions"` | error map |
| YT-T15 | `tests/tools/youtube/client.test.ts` | `fetchTranscript throws YoutubeFetchError(disabled) on captions-disabled` | distinct pkg error variant | error map |
| YT-T16 | `tests/tools/youtube/client.test.ts` | `fetchTranscript throws YoutubeFetchError(network) on fetch failure` | mock pkg throws `Error("Network")` | catch-all map |
| YT-T17 | `tests/tools/youtube/client.test.ts` | `fetchMetadata parses watch-page HTML for title + channel + published_at + language` | fixture HTML; assert all four fields | scraper |
| YT-T18 | `tests/tools/youtube/client.test.ts` | `fetchMetadata returns language="ja" for Japanese watch page` | fixture; assert `language === "ja"` | language detection |
| YT-T19 | `tests/tools/youtube/client.test.ts` | `client throttles to 1 RPS` | inject clock; fire 3 calls; assert pacing ≥ 1000ms apart | bucket |
| YT-T20 | `tests/tools/youtube/client.test.ts` | `client reads parsed transcript from disk cache when present and not expired` | seed cache; assert pkg not invoked | file-cache reuse |
| YT-T21 | `tests/db/migrations/0010-insights-and-youtube.test.ts` | `migration is idempotent — re-running is a no-op` | run twice; second run no-op | drizzle migration runner contract |
| YT-T22 | `tests/db/migrations/0010-insights-and-youtube.test.ts` | `existing knowledge_chunks rows survive with metadata=NULL` | seed populated DB at 0008-state; apply 0010; assert row read-back equal except `metadata = NULL` | drizzle-kit table-rebuild correctness |
| YT-T23 | `tests/db/migrations/0010-insights-and-youtube.test.ts` | `existing knowledge_chunk_embeddings rows survive untouched` | seed 5 vec rows; apply 0010; assert COUNT unchanged | vec0 sidecar isolation |
| YT-T24 | `tests/db/migrations/0010-insights-and-youtube.test.ts` | `widened CHECK accepts source_site='youtube' + subtype='youtube-transcript' + id GLOB 'youtube:*'` | three INSERTs; all succeed | widened CHECKs |
| YT-T25 | `tests/db/migrations/0010-insights-and-youtube.test.ts` | `insights table CHECK rejects claim length > 280` | INSERT with 281-char claim; rejected | length CHECK |
| YT-T26 | `tests/db/migrations/0010-insights-and-youtube.test.ts` | `insights table UNIQUE rejects duplicate (chunk_id, claim)` | INSERT 2 identical; second rejected | unique index |
| YT-T27 | `tests/db/migrations/0010-insights-and-youtube.test.ts` | `insight_subjects CASCADE on insight delete` | seed 1 insight + 3 subjects; DELETE insight; assert subjects gone | FK cascade |
| YT-T28 | `tests/db/migrations/0010-insights-and-youtube.test.ts` | `insights CASCADE on knowledge_chunks delete` | seed chunk + insight; DELETE chunk; assert insight gone | FK cascade |
| YT-T29 | `tests/db/migrations/0010-insights-and-youtube.test.ts` | `insight_embeddings vec0 dim is 512` | INSERT a 256-len vector; rejected by sqlite-vec | dim pin |
| YT-T30 | `tests/db/insights.test.ts` | `upsertMany inserts insight + subjects + embedding atomically` | seed + read back; verify insights, subjects, embeddings rows | impl |
| YT-T31 | `tests/db/insights.test.ts` | `upsertMany skip-duplicate on (chunk_id, claim) — second run zero new rows` | run twice; second `inserted=0, skipped_duplicate=N` | INSERT OR IGNORE |
| YT-T32 | `tests/db/insights.test.ts` | `search returns hits ranked by cosine; respects limit` | seed 5 insights with synthetic embeddings; query with biased vector; top-3 ranking matches expected | vec MATCH + JOIN |
| YT-T33 | `tests/db/insights.test.ts` | `search filter.pokemon=["incineroar"] excludes non-matching subjects` | mixed seed; filter; assert subset | INNER JOIN insight_subjects |
| YT-T34 | `tests/db/insights.test.ts` | `search filter.claim_type=["lead"] excludes non-lead claims` | mixed seed; filter; assert subset | WHERE claim_type IN |
| YT-T35 | `tests/db/insights.test.ts` | `search filter.min_confidence="medium" excludes low` | seed 3 confidences; filter; assert |result|=2 | ordinal compare |
| YT-T36 | `tests/db/insights.test.ts` | `listByChunkId returns insights for that chunk in claim order` | seed 3 insights for one chunk; assert | repo method |
| YT-T37 | `tests/db/insights.test.ts` | `listByVideoId resolves source_url match` | seed 2 videos × 2 insights; assert filter | LIKE filter |
| YT-T38 | `tests/db/insights.test.ts` | `listBySpecies returns insights whose subjects.pokemon contains id` | mixed seed; assert | JOIN insight_subjects |
| YT-T39 | `tests/db/knowledge-youtube.test.ts` | `upsertArticleChunks(source_site='youtube', metadata=...) writes JSON metadata` | seed; read back; metadata JSON equal | metadata write |
| YT-T40 | `tests/db/knowledge-youtube.test.ts` | `upsertArticleChunks skip-existing on (source_site='youtube', article_slug=videoId, body_hash)` | upsert twice with same body_hash; second skipped | composite skip key |
| YT-T41 | `tests/tools/insights/extract.test.ts` | `extractInsights happy-path returns ≤5 schema-valid insights` | mocked Anthropic returns 3 insights; assert all valid | impl |
| YT-T42 | `tests/tools/insights/extract.test.ts` | `extractInsights hallucination guard rejects insight whose subjects.pokemon not in chunk text` | mocked response with `subjects.pokemon=["zacian"]` but chunk doesn't mention Zacian; assert `rejected[].reason === "hallucinated_species"` and the insight is NOT in `insights[]` | post-extraction filter |
| YT-T43 | `tests/tools/insights/extract.test.ts` | `extractInsights format guard rejects subjects.formats !== ["RegM-A"]` | mocked response with formats=["VGC2024"]; assert rejected | format guard |
| YT-T44 | `tests/tools/insights/extract.test.ts` | `extractInsights cap-truncates to 5` | mocked response with 7; assert `insights.length === 5` and `cap_truncated=2` accountable in caller (test asserts via the dropped pair not present) | slice(0,5) |
| YT-T45 | `tests/tools/insights/extract.test.ts` | `extractInsights returns {insights:[], rejected:[]} on 0-result chunk` | mocked response is `{ insights: [] }`; assert no error | empty branch |
| YT-T46 | `tests/tools/insights/extract.test.ts` | `extractInsights throws InsightExtractionError(rate_limit) after retry exhaustion` | mocked rate-limit 3x; assert throw | retry policy |
| YT-T47 | `tests/tools/insights/extract.test.ts` | `extractInsights pins extracted_by.prompt_version="v1.0"` | inspect output | const propagation |
| YT-T48 | `tests/tools/insights/extract.test.ts` | `extractInsights species index includes Mega <X> alias for guard` | mocked response cites "Garchomp-Mega"; chunk mentions "Mega Garchomp"; guard PASSES | alias-aware guard |
| YT-T49 | `tests/tools/insights/embed.test.ts` | `embedInsights embeds claim, NOT excerpt` | mock embed client; assert input strings === claims | wrapper correctness |
| YT-T50 | `tests/db/tool-definitions/insights-search.test.ts` | `insights_search tool invokes store.search and returns hits` | inject fake store; assert tool returns hits | tool wiring |
| YT-T51 | `tests/db/tool-definitions/insights-search.test.ts` | `insights_search tool input_schema rejects malformed claim_type` | invalid arg → ZodError | schema validation |
| YT-T52 | `tests/data/tactical/cite-insights.test.ts` | `cite.ts surfaces InsightCitation when scenario species overlap insight subjects` | seed scenario+insight; assert `insights[0].insight_id === ...` | extension |
| YT-T53 | `tests/data/tactical/cite-insights.test.ts` | `cite.ts respects score threshold (≥0.6); below threshold dropped` | seed two; one below threshold; assert filtered | threshold const |
| YT-T54 | `tests/data/tactical/cite-insights.test.ts` | `cite.ts non-breaking — existing knowledge_chunk_citations field unchanged when no insights match` | scenario with no overlapping species; `insights: []`, knowledge_chunk_citations unchanged | additive only |
| YT-T55 | `tests/scripts/ingest-youtube.test.ts` | `ingest --no-network --no-extract: end-to-end on cached fixture J0eVKJyJ_DQ` | fixture transcript+metadata cache; assert N chunks persisted | orchestration |
| YT-T56 | `tests/scripts/ingest-youtube.test.ts` | `ingest with mocked Anthropic: persists insights from chunks` | end-to-end; assert ≥1 insight row | extraction wiring |
| YT-T57 | `tests/scripts/ingest-youtube.test.ts` | `ingest soft-skips non-English video, exits 0` | metadata.language="ja"; assert exit 0; no chunks persisted | language gate |
| YT-T58 | `tests/scripts/ingest-youtube.test.ts` | `ingest soft-skips no-captions video, exits 0` | YoutubeFetchError(no_captions); summary.failures populated; exit 0 | catch-and-log |
| YT-T59 | `tests/scripts/ingest-youtube.test.ts` | `ingest fails loud on KnowledgeAuthError (Voyage 401)` | mocked embed throws auth; assert exit 1 | auth-fail-loud |
| YT-T60 | `tests/scripts/ingest-youtube.test.ts` | `ingest --no-extract bypasses Haiku when ANTHROPIC_API_KEY missing` | env unset; chunks persist; insights_inserted=0; exit 0 | fallback path |
| YT-T61 | `tests/scripts/ingest-youtube.test.ts` | `ingest counts hallucinations_rejected and cap_truncated in summary` | mocked extraction with 7 (cap) + 1 hallucination; assert summary | counter wiring |
| YT-T62 | `tests/scripts/ingest-youtube-idempotency.test.ts` | `running ingest twice produces zero new chunks AND zero new insights AND zero embedding API calls` | first run; second run; assert all three counts equal pre-run | (covered by T31, T40 + new embed-call counter assertion) |
| YT-T63 | `tests/contract/youtube-live.test.ts` (gated) | `live youtube-transcript fetch for J0eVKJyJ_DQ returns ≥10 segments` | real call; gated by RUN_CONTRACT_TESTS=1 | (no new code) |

**Pure-data exemption flag:** YT-T1–YT-T3.

**Total numbered tests:** 63. Above the metavgc count (49) but justified by:
- Two new tables (insights + insight_subjects) needing CHECK + cascade + idempotency tests (~10).
- Hallucination guard + format guard + cap + retry → 4 distinct extraction-correctness tests.
- Two new agent tool surfaces (`insights_search` + cite.ts extension) → 5 wiring tests.
- Time-windowed chunker has 7 edge cases (empty, short, long single segment, overlap, anchor preservation, token cap, determinism).

### 7.1 Per-test risk callouts
- **YT-T22 / T23** are load-bearing: the table-rebuild on `knowledge_chunks` must preserve every existing vgcguide + metavgc row. The vec0 sidecar is also load-bearing (T23). Both should run on a fully populated fixture DB (re-use the metavgc end-to-end fixture as the seed).
- **YT-T42** is the hallucination-guard regression test. Without it, Haiku's occasional fabrications poison retrieval. Must pass against synthetic responses for at least 3 distinct hallucination patterns: (a) species not in chunk, (b) species in chunk but mis-id'd to a different ulid, (c) species in chunk but only via an alias the index doesn't know — the last case is the false-positive risk highlighted in §14.
- **YT-T28** verifies the chunk → insight cascade. Operationally, we never delete a chunk in v1, but the FK semantics future-proof corpus rebuilds.
- **YT-T62** is THE idempotency gate — biggest cost-saver and biggest correctness risk. Mirrors META-T46/META-T47.

## 8. Error model

| Class | Trigger | Severity | Where thrown | Where caught |
|---|---|---|---|---|
| `YoutubeFetchError(no_captions)` | `youtube-transcript` raises `TranscriptDisabled` or returns `[]` | data | `youtube/client.ts::fetchTranscript` | ingest catch-and-log; exit 0 |
| `YoutubeFetchError(disabled)` | distinct pkg variant for owner-disabled captions | data | `youtube/client.ts` | ingest catch-and-log; exit 0 |
| `YoutubeFetchError(private)` | watch page returns 401/410 / pkg `VideoUnavailable` | data | `youtube/client.ts` | ingest catch-and-log; exit 0 |
| `YoutubeFetchError(non_english)` | metadata.language detected non-English | data (Q9 v1) | `youtube/client.ts::fetchMetadata` (or ingest pre-check) | ingest catch-and-log; exit 0 |
| `YoutubeFetchError(network)` | non-2xx after retry exhaustion | infra | `youtube/client.ts` | ingest catch-and-log; exit 0 |
| `InsightExtractionError(rate_limit)` | Anthropic 429 after retry exhaustion | infra (per-chunk) | `tools/insights/extract.ts` | ingest per-chunk catch; continue |
| `InsightExtractionError(schema_violation)` | Haiku tool_use response fails zod after retry | data (per-chunk) | `tools/insights/extract.ts` | ingest per-chunk catch; continue |
| `InsightExtractionError(anthropic_error)` 401/403 | `ANTHROPIC_API_KEY` missing/invalid | **fail loud — operator** | `tools/insights/extract.ts` | propagates; ingest exits 1 |
| `KnowledgeAuthError` | `VOYAGE_API_KEY` missing or Voyage 401/403 | **fail loud — operator** | `embed.ts` (reused) | propagates; ingest exits 1 |
| `KnowledgeStorageError` | sqlite-vec dim mismatch / schema-version mismatch | **fail loud — programmer/operator** | `db/insights.ts` + `db/knowledge.ts` | propagates; ingest exits 1 |
| `RosterDbError` | SQLite I/O | infra | reused | ingest exits 1 |
| `RosterDataError` | persisted row fails schema on read | corruption | reused | tests |
| `SpeciesTaggerError` | empty species index at ingest start | **fail loud** | `species-tagger.ts` (reused) | propagates; ingest exits 1 |

### 8.1 Why no parallel `Youtube*` family for the existing knowledge errors
The metavgc plan §19.2 settled the rename: `KnowledgeArticle*Error` is the canonical hierarchy for shared HTTP/parse failures. YouTube does NOT throw any of those — captions fetch is structurally different from article fetch (no slug-based 404; the pkg surfaces typed errors). So we add `YoutubeFetchError` as a new sibling, NOT a subclass. The catch ladder in the ingest script handles each independently.

### 8.2 Article-class vs operator-class
**Article-class** (per-video / per-chunk failures that should not abort the whole ingest run): `YoutubeFetchError(no_captions|disabled|private|non_english|network)`, `InsightExtractionError(rate_limit|schema_violation)`, `KnowledgeArticleNotFoundError` (not thrown by youtube but caught defensively if a future shared embed path raises it). All log into `summary.failures[]` and the script exits 0.

**Operator-class** (ingest cannot continue): `KnowledgeAuthError`, `KnowledgeStorageError`, `SpeciesTaggerError`, `InsightExtractionError(anthropic_error)` with status 401/403, any unhandled exception. Script exits 1.

## 9. Rollout / feature-flag

- **Always-on, no flag.** The migration is additive; existing `knowledge_chunks` rows survive with `metadata = NULL`. The new `insights` + `insight_subjects` + `insight_embeddings` tables start empty; the agent's `knowledge_search` tool gains nothing observable until the first ingest runs. The new `insights_search` tool returns `[]` until the first insight is persisted (validated by YT-T32 via empty-store branch — Stage 5 reviewer call).
- **No backfill in this slice.** Retroactive Insight extraction over the existing vgcguide + metavgc chunks is Stage 6 deferred (per flow §10 + §12 of this plan). Ship the slice, observe quality, then propose a backfill slice.
- **Manual cadence.** `pnpm data:ingest:youtube --url <url>`. No cron in v1 (channel-pull deferred — see §12).
- **Voyage + Anthropic API keys required at runtime.**
  - `VOYAGE_API_KEY`: required for chunk + claim embedding. Missing → `KnowledgeAuthError` at startup; fail loud.
  - `ANTHROPIC_API_KEY`: required for insight extraction. Missing → `summary.extraction_skipped = true`; chunks still persist; insights are NOT extracted; exit 0. The `--no-extract` argv flag is the explicit version of the same path. **Rationale:** the user might want to ingest chunks for `knowledge_search` retrieval without paying Haiku cost; or might want to back-extract later when the prompt version bumps.
  - `YOUTUBE_API_KEY`: NOT required (per Q1 binding answer — `youtube-transcript` package uses YouTube's internal endpoint, no API key needed). Listed in CLAUDE.md §10 as a future env var; this slice does NOT add a hard dependency on it.
- **Migration ordering.** `0010_insights_and_youtube.sql` lands after `0009_user_teams.sql`. The drizzle migration runner's `__drizzle_migrations` table handles ordering and idempotency.
- **Hard dependency on a populated species table.** Same as metavgc — `buildSpeciesIndex(db)` empty-check fails loud (`SpeciesTaggerError`). The species table is built by the existing roster-build pipeline.
- **`SKIP_SQLITE_VEC=1` escape hatch** continues to apply (inherited from `vgc-knowledge-base`). With it set, both vec0 sidecars are no-op'd and `search` returns `[]`. Useful for local migration testing before the sqlite-vec extension is loaded.

## 10. Architecture patterns + the why

| Pattern | Where | Why this slice |
|---|---|---|
| **Repository pattern** | `src/db/insights.ts` (full impl, replacing v1 stub); `src/db/knowledge.ts` (extended) | Same prepared-statement + zod-decode + `WeakMap<Db, Prepared>` discipline as every other repo. Agent never sees raw SQL or vec0 internals. |
| **Insight as canonical extracted primitive** | `src/schemas/insight.ts` + `src/db/insights.ts` | Per CLAUDE.md §6, "We do not dump raw text into the KB. We extract atomic Insights." Transcripts are the noisiest source we ingest; extracting them as Insights is the prescribed shape. The schema was authored explicitly for this v1; we now flesh out the persistence + retrieval. |
| **Insight ≠ flag on knowledge_chunks** (1:N table) | New `insights` table FK → `knowledge_chunks.id` | One chunk yields up-to-5 insights; collapsing them onto the chunk row would force a JSON column with no easy filtering and no per-insight embedding. The 1:N relationship is the natural shape: chunks for breadth retrieval, insights for precision. |
| **Two parallel vec0 sidecars** | `knowledge_chunk_embeddings` (existing) + `insight_embeddings` (new) | Different query semantics. A chunk embedding represents 90s of context (paragraph-level). An insight embedding represents one atomic claim (sentence-level). Mixing them in one vec0 table would force the cosine ranker to compare paragraphs vs sentences — embeddings of those have systematically different magnitudes. Keep them separate; use the right one per query intent. |
| **Haiku for ingest, Opus for reasoning** | `extractInsights` uses `claude-haiku-4-5-20251001` | Per CLAUDE.md §9. Haiku 4.5 is cheap, fast, and good enough for structured extraction with a tight tool schema. Opus is reserved for team building, replay analysis, lead planning. Per-video Haiku cost ~$0.09 (flow §6); 100 videos = $9. Operator-affordable. |
| **Prompt cache placement** | System prompt + species index → cacheable; user prompt (chunk text) → ephemeral | Per CLAUDE.md §9 prompt caching is required for system prompts and tool definitions. The species index alone is ~1500 tokens; without caching, 30 chunks × 1500 = 45k tokens of waste per video. With caching, paid once per session. Tested in Stage 5 by inspecting the SDK's cache-hit metric. |
| **Hallucination guard as post-filter, not in prompt** | `passesSpeciesGuard` runs after the SDK call | Prompt-based guards ("only mention species in the chunk!") fail probabilistically. A deterministic post-filter is cheap (substring match), counts rejections in the run summary, and lets us iterate the extraction prompt without changing safety semantics. Mirrors the pokepaste validator-after-LLM pattern. |
| **Schema-first (zod)** | Every persisted row decoded via `parseOrThrow` | Per CLAUDE.md §5. Three layers: Anthropic `tool_use` schema (LLM output), `InsightSchema` strict zod (in-process validation), SQLite CHECK constraints (storage-tier safety net). Belt + suspenders + suspenders. |
| **Closed-enum CHECK + zod enum** | DB and runtime both reject unknown `source_site`, `subtype`, `claim_type`, `confidence`, etc. | belt + suspenders. The CHECK is a safety net for raw SQL escape hatches; the zod enum is the real gate. Same pattern as metavgc §7. |
| **Defense-in-depth no-tera** | Strict zod on `Insight` (no `tera_*` keys); Reg-M-A-only `subjects.formats` tuple | Per `regulation_m_a_no_tera.md`. Champions content is empirically clean, but a transcript discussing old formats could leak. Strict mode + format guard catches both. |
| **Time-windowed chunker (sibling, not replacement)** | `src/tools/youtube/chunk-transcript.ts` alongside `src/tools/knowledge/chunk.ts` | Heading-driven chunker doesn't apply (no headings in transcripts); time windows are the natural unit. Both emit downstream-compatible `KnowledgeChunk`-shaped output so the persistence layer is polymorphic. The Strategy unification is Stage 6 deferred (§12). |
| **Idempotency via natural keys** | `(source_site, article_slug, chunk_index)` for chunks; `(chunk_id, claim)` for insights | Per Q7 binding answer. No surrogate-key churn; re-runs are network-cheap and embedding-API-free. The composite uniques are enforced at the DB layer, not in app code — defense in depth. |
| **English-only language gate** | `fetchMetadata.language` checked before transcript fetch | Per Q9. Soft-skip non-English; the alternative (extracting from machine-translated captions) introduces hallucination risk we don't have signal to validate. Multi-language is a separate slice (§12). |
| **Two-tool agent surface** | `knowledge_search` (extends transparently) + `insights_search` (new) | Different return shapes (passage vs atomic claim) justify separate tools. Description text disambiguates. Counter-argument (multi-tool BLOCKER from pokepaste) doesn't apply because the shapes are genuinely different. |
| **No payload pre-filter on insights vec search** (Q8) | `search` runs cosine first, then JOINs subjects | Decision: defer optimization. At v1 corpus (~100 insights / 10 videos) the JOIN cost is negligible. Re-evaluate at ~10K insights — at that scale, switching to "pre-filter `insight_subjects` for candidate ids, then cosine over candidates" makes sense. Stage 6 deferred (§12). |
| **Ingest summary as observability** | Single JSON-line stdout summary | Same pattern as metavgc + vgcguide. Operator-readable. New counters: `chunks_with_species_tags`, `insights_inserted`, `insights_skipped_duplicate`, `hallucinations_rejected`, `cap_truncated`, `extraction_skipped`. Each one corresponds to a flow §9 success criterion or a §14 risk we want to monitor. |

### 10.1 Considered and rejected

- **Insights as a flag/column on `knowledge_chunks`.** Rejected — see "Insight ≠ flag" row above. 1:N relationship is the natural shape.
- **Single shared vec0 sidecar for chunks + insights.** Rejected — see "Two parallel vec0 sidecars" row above. Embedding magnitudes diverge by content length; mixing degrades cosine ranking.
- **Prompt-only hallucination guard.** Rejected — see "Hallucination guard as post-filter" row.
- **Single agent tool returning union(chunk, insight).** Rejected — return-shape divergence forces the model to disambiguate at use time, hurting tool-selection quality. Two tools with crisp descriptions is the correct primitive.
- **Recursive descent into the existing chunker.** Rejected — see "Time-windowed chunker" row.
- **Channel-level scope discovery (per memory `scope_discovery_via_site_signals.md`).** Rejected for v1 — single-video manual ingest is one user with one URL. The memory rule applies when systematic ingest is required; a one-shot manual import is exempt. Channel-pull is the correct next step (Stage 6).
- **Storing the transcript verbatim as one BLOB instead of chunked.** Rejected — defeats the purpose of `knowledge_search` (chunks are the retrieval unit).
- **Running insight extraction on the raw transcript instead of per-chunk.** Rejected — token budget for a 20-minute video (~3000 words → ~4000 tokens) plus the species table doesn't fit a single Haiku call comfortably; the cap-of-5 contract becomes unworkable; per-chunk hallucination guards are simpler. Per-chunk also gives the Insight a precise `timestamp_seconds`.

## 11. Reuse audit

**Reused (do not duplicate):**
- **`src/schemas/insight.ts`** — already defines `InsightSchema` per CLAUDE.md §6. We add `chunk_id` + adjacent helper schemas; the canonical shape is unchanged.
- **`src/db/insights.ts` v1 stub interface** — `InsightStore` / `InsightSearchHit` / `InsightSearchOptions` / `InsightSearchFilter` shapes are kept as the public contract; only the implementation goes from "throws NotImplementedError" to real. Zero call-site churn.
- **`src/tools/knowledge/embed.ts`** — Voyage `voyage-3-lite` 512-dim client. Reused for both chunk embeddings (existing path) and insight claim embeddings (`embedInsights` wrapper). ~120 LOC saved.
- **`src/tools/knowledge/species-tagger.ts`** — `buildSpeciesIndex` + `detectSpeciesTags` from metavgc §19. Reused for (a) species tags on transcript chunks (so `knowledge_search` `species_id_filter` works transparently per flow §7.1), (b) the hallucination guard's species-name lookup. The same `SpeciesIndex` object is built once per ingest run and threaded everywhere.
- **`src/db/knowledge.ts`** — repo extended additively; `upsertArticleChunks` gains optional `metadata`, no signature breakage.
- **`src/db/sqlite-vec.ts`** + the existing extension-load path — vec0 wiring is identical. Zero new code for the second sidecar; only a new CREATE VIRTUAL TABLE stanza in the migration.
- **`src/tools/_shared/throttle.ts`** + **`src/tools/_shared/file-cache.ts`** — token bucket + finite-TTL disk cache, same pattern as vgcguide / metavgc clients. ~50 LOC saved.
- **`@anthropic-ai/tokenizer`** — already pinned via `vgc-knowledge-base`. Used by `chunkTranscript` for the per-chunk token count.
- **`@anthropic-ai/sdk`** — already pinned. New use for `tool_use` with structured output. No new dep.
- **`parseOrThrow`** from `src/db/simple-repo.ts` — for decoding rows of the new `insights` table.
- **`Db`, `open()`, `RosterDbError`, `RosterDataError`** — same.
- **Run-summary shape pattern** — mirrored from `ingest-metavgc.ts` + `ingest-vgcguide.ts`.
- **Drizzle migration runner + `__drizzle_migrations` table** — handles ordering and idempotency.
- **`tool(...)` helper in `src/db/tool-definitions.ts`** — extended (new `insights_search` registration), not duplicated.

**`createSimpleRepo` does NOT apply:** insights is a multi-table transactional repo (insights + insight_subjects + insight_embeddings vec0) with multi-column filter and vec MATCH JOIN — the factory deliberately doesn't generalize that far per CLAUDE.md §10. Same reasoning as `src/db/knowledge.ts`.

**`roster.get` / `roster.has` do NOT apply:** the species index is a bulk read at ingest start; per-name lookups would do 286 round trips when one bulk SELECT suffices. Same pattern as the metavgc tagger.

**NEW dependencies:**
- **`youtube-transcript`** — npm package, ~1.2.x. No API key. Pinned to a specific version at landing time (NOT a `^` range — supply-chain hygiene per `vgc-knowledge-base` §17). `// TODO(stage6-deferred): pkg-stability-monitor` — drop if it breaks.

**No new deps:**
- The Anthropic SDK is already pinned.
- Voyage embedding client is already pinned.
- sqlite-vec is already loaded.
- ulid generator is already pinned.
- cheerio (used briefly by `fetchMetadata` to scrape watch-page HTML for title/channel) is already pinned via metavgc / vgcguide.

**Architectural insight:** the slice depends on three reusable abstractions that landed in earlier slices — vec0 sidecar pattern (`vgc-knowledge-base`), species tagger (`metavgc-guides`), Drizzle migration runner (`vgc-knowledge-base`). **Insight extraction adds one new abstraction (Haiku-driven structured extraction); everything else is reuse.** Same pattern the metavgc plan observed: a well-built first slice pays for itself in the third slice's reuse audit.

## 12. Stage 6 deferred TODOs

Per memory `labmaus_pokepaste_deferred_todos.md`, every deferral lands as inline `// TODO(stage6-deferred):` for greppability.

| # | Item | Annotation site (planned) | Trigger to revisit |
|---|---|---|---|
| 1 | Comments ingest — extract Insights from YouTube comments that include verifiable claims or tournament results (per CLAUDE.md §6 extraction rules) | top of `src/tools/youtube/client.ts` (`// TODO(stage6-deferred): comments-ingest`) | After v1 retrieval quality is baselined; only if comments add measurable signal beyond the video author's own claims. |
| 2 | Whisper transcription for caption-less videos (paid OpenAI API or local model) | `tools/youtube/client.ts` `YoutubeFetchError(no_captions)` path (`// TODO(stage6-deferred): whisper-fallback`) | When the user encounters a high-value video without captions. |
| 3 | Channel-level subscription auto-pull (per memory `scope_discovery_via_site_signals.md`) | new module `src/tools/youtube/discover-scope.ts` (`// TODO(stage6-deferred): channel-discovery`) | When the user maintains a list of trusted channels; manual ingest gets tedious past ~10 videos. |
| 4 | Spanish / Japanese caption extraction + extraction prompt variants | `tools/insights/extract.ts` language switch (`// TODO(stage6-deferred): multi-language`) | When the user requests it (likely never, given the user's profile). |
| 5 | Unify `chunkTranscript` + heading-based chunker behind a `ChunkStrategy` interface | `src/tools/knowledge/chunk-strategy.ts` (new) (`// TODO(stage6-deferred): unify-chunker-strategy-pattern`) | When a fourth chunking strategy lands (e.g., replay-turn-based for showdown logs). |
| 6 | Retroactive Insight extraction over existing vgcguide + metavgc chunks | `scripts/data/backfill-insights.ts` (new) (`// TODO(stage6-deferred): retroactive-extract-vgcguide-metavgc`) | After v1 retrieval is observed and the prompt is stable. ~1500 vgcguide + ~150 metavgc chunks → ~$5 Haiku spend (per the cost model in flow §6). |
| 7 | Payload-filter pre-cosine for insights vec search (Q8) | `src/db/insights.ts` `search` body (`// TODO(stage6-deferred): payload-prefilter`) | When the corpus crosses ~10K insights AND profiling shows the vec MATCH dominates. Switch to "filter `insight_subjects` for candidate ids, then cosine over candidates". |
| 8 | Add denormalized `video_id` column on `insights` (avoids `LIKE` in `listByVideoId`) | `insights` table | When `listByVideoId` traffic increases (e.g., a UI surface lists videos). v1 traffic is debug-only. |
| 9 | Dedicated `insights-ui` slice — browser for stored insights with claim_type filters | new flow + plan | Per flow §10. |
| 10 | YouTube Data API v3 fallback (richer metadata, official rate-limit, requires `YOUTUBE_API_KEY`) | `tools/youtube/client.ts` (`// TODO(stage6-deferred): yt-data-api-fallback`) | When `youtube-transcript` package becomes unmaintained or rate-limited. |
| 11 | Lift `KnowledgeArticleClient` interface (metavgc §19.1) to a `KnowledgeSourceClient` superinterface that subsumes the YouTube client | `src/tools/knowledge/source-client.ts` (`// TODO(stage6-deferred): unify-knowledge-source-client`) | When a fourth source lands and the structural commonality is undeniable. |
| 12 | Fuzz harness over the hallucination guard — false-positive scan for misspelled species names in transcripts | new test file | If YT-T42 misses a regression in production. |
| 13 | Prompt cache hit-rate assertion in CI | a Stage 5 integration test using the SDK's `usage.cache_creation_input_tokens` / `cache_read_input_tokens` | When the SDK metric is exposed by the Anthropic library version we pin. CLAUDE.md §9 requires verifying cache hits in tests. |
| 14 | Embedding model upgrade path (Voyage releases a higher-dim model) | `src/tools/knowledge/embed.ts` + migration | Out of scope; tracks the same TODO as `vgc-knowledge-base`. |

Each will land as an inline `// TODO(stage6-deferred): <slug>` comment in the cited file at Stage 5; the Stage 6 reviewer is expected to confirm the comments are present and greppable.

## 13. Definition of Done mapping (CLAUDE.md §11)

| Box | This slice |
|---|---|
| Flow doc reviewed | `docs/flows/youtube-insights.md` Stage 1 authored 2026-05-09; Stage 2 sign-off recorded by Rodrigo (`Reviewed-by: Rodrigo Caballero`). |
| Tech plan approved | THIS DOC — pending. |
| Failing test first | enforced by §7 Stage 4 ordering; commit `test: red — youtube-insights`. Per CLAUDE.md §3 the pure-data exemption applies to YT-T1–YT-T3 only; YT-T4 onward is strict per-test Red→Green. |
| `pnpm test` passes | Stage 5 exit gate. |
| `pnpm typecheck` passes | strict TS, typed signatures everywhere per §2. |
| `pnpm lint` passes | Stage 5 exit gate. |
| New external data schema-validated and fixture-backed | `InsightSchema` + `KnowledgeChunkSchema` extended, fixture-backed by 7 transcript / metadata / extraction-response fixtures. |
| User-facing claim cited | every persisted Insight carries `source.url` + `source.timestamp_seconds` + `source.author`; `cite.ts` surfaces them on `ScenarioOverview`. The `insights_search` tool output exposes them. |
| Docs touched | `tools/youtube/SPEC.md` written first; `.gitignore` extended with `data/cache/youtube/`; flow doc covers product behavior; CLAUDE.md untouched (no new convention introduced — the multi-source widening is a routine drizzle migration; the Insight primitive is already canonical in §6). |
| Reviewer subagent ran | Stage 6. |

**Uncovered by this slice (explicitly):**
- Comments / Whisper / channel-pull / multi-language (per §12).
- Retroactive Insight extraction over vgcguide + metavgc — Stage 6 deferred.
- UI for browsing insights — Stage 6 (`insights-ui` slice).
- Payload-prefilter for vec search — profile-driven, deferred.

## 14. Risks + mitigations

1. **`youtube-transcript` package API instability.** The package wraps an undocumented internal YouTube endpoint; YouTube has historically broken third-party scrapers without warning. **Mitigation:** (a) pin to an exact version, not `^1.x`. (b) The `YoutubeFetchError(network)` catch in the ingest script surfaces breakage immediately as a soft-skip (exit 0, summary populated) rather than a crash. (c) Stage 6 deferred TODO #10 — fall back to YouTube Data API v3 (`YOUTUBE_API_KEY` required) when the package becomes unreliable. (d) The contract test YT-T63 runs gated weekly to detect breakage early.
2. **Haiku extraction quality drift over prompt versions.** A `v1.0` prompt that produces good insights today may regress if Anthropic ships a new Haiku checkpoint that interprets the system prompt subtly differently. **Mitigation:** (a) `extracted_by_prompt_version` is persisted on every insight — we can A/B retrieval quality across versions. (b) The prompt is committed as a versioned constant; bumping forces a code change with a test diff. (c) The Haiku response fixtures (`fixtures/insights/haiku-extraction__*.json`) act as regression baselines; the extraction unit tests (YT-T41–YT-T48) run against them deterministically. (d) Stage 6 TODO #6 — backfill / re-extract over a prompt bump is a one-shot script.
3. **Hallucination guard false positives — rejecting valid insights when the species name is misspelled in the transcript.** YouTube auto-captions sometimes mistranscribe species names ("Garchomp" → "Garchump"); the substring guard would then reject a perfectly valid claim because the canonical name doesn't appear literally. **Mitigation:** (a) the guard checks against `display_name` AND every alias in the species index, including auto-generated "Mega <X>" variants. (b) YT-T48 explicitly tests the alias path. (c) Operationally, the run summary's `hallucinations_rejected` count surfaces drift — if it spikes on a video, we manually inspect and may add an alias. (d) Stage 6 TODO #12 — a fuzz harness scans real transcripts for missed-by-guard valid mentions. **(e) Conservative fallback:** false negatives (rejecting a valid insight) are strictly safer than false positives (accepting a hallucinated one) for the agent's citation discipline.
4. **English-only language detection accuracy.** The watch-page HTML's `language` attribute may be missing or stale (e.g., a video flagged "en" but actually Spanish). **Mitigation:** (a) we log + skip on detected non-English (YT-T57). (b) If the language attribute is `null`, we attempt extraction anyway (best-effort); the hallucination guard's English-only species names will catch any extraction over Japanese / Spanish text (the transcripts won't contain English species names verbatim). (c) Stage 6 TODO #4 — proper multi-language support with prompt variants.
5. **Cost explosion if the user ingests 100+ videos.** ~$0.09 per video × 100 = $9 in Haiku tokens. Plus Voyage embedding cost (~$0.01 per video). **Mitigation:** (a) v1 is single-video manual ingest — the user pays per `pnpm` invocation. (b) The `--no-extract` flag lets the user persist chunks (cheap — embeddings only) and defer extraction. (c) Stage 6 TODO #6 — backfill is a one-shot, not a recurring cost. (d) The summary line surfaces cost-relevant counters (`chunks_inserted`, `insights_inserted`); the operator can budget per video.
6. **vec0 sidecar dim mismatch on dual sidecars.** Both `knowledge_chunk_embeddings` and `insight_embeddings` are 512-dim; if a future Voyage model upgrade bumps one and not the other, queries silently degrade. **Mitigation:** (a) both sidecars import the same dim constant from `src/tools/knowledge/embed.ts`. (b) Migration verification matrix asserts dim. (c) `KnowledgeStorageError` is thrown at insert if the array length mismatches.
7. **Drizzle table-rebuild silently drops a column on `knowledge_chunks`.** Same risk as metavgc §16 #1 — drizzle-kit's migration generator could omit a column on the rebuild. **Mitigation:** YT-T22 + YT-T23 explicitly assert pre/post row equality on a populated DB; YT-T22 must be a column-by-column scan, not just a row count.
8. **Prompt cache miss on first chunk of every video.** The system prompt + species table is ~1500 tokens; if cache placement is wrong, every video's first chunk pays full cost. **Mitigation:** Stage 5 includes a cache-hit assertion test (TODO #13) using the SDK's `usage.cache_read_input_tokens` field.
9. **Insight extraction returns a paragraph-long claim that violates the 280-char cap.** The strict zod schema rejects; the extractor logs `schema_violation` and the chunk yields 0 insights. **Mitigation:** the prompt explicitly instructs ≤ 280 chars per claim with examples; YT-T41 verifies the happy path; the rejected count in the summary surfaces drift. If the rate is high in production, prompt v1.1 tightens the instruction.
10. **Stage 6 retroactive extraction over vgcguide + metavgc bumps the corpus past the 10K threshold prematurely.** ~1500 + ~150 chunks × 5 insights = ~8250 insights — close to the threshold. **Mitigation:** Stage 6 backfill plan (separate slice) profiles the search latency before deciding whether to bundle the payload-prefilter optimization.

## 15. Open questions for plan review

The flow doc's nine §11 questions are all bound (Q1–Q9 answered by the user). The plan itself surfaces a handful of additional design decisions where Stage 4 will benefit from explicit reviewer sign-off:

1. **Two parallel vec0 sidecars (knowledge_chunk_embeddings + insight_embeddings) vs one shared sidecar.** §10 argues for two on the basis of embedding-magnitude divergence between paragraph-length chunks and sentence-length claims. Reviewer can vote to consolidate (single sidecar with a `kind` discriminator), but the ranker quality argument is the load-bearing concern. Recommend keep two.

2. **Insight extraction failure mode for `schema_violation` — retry once or skip immediately?** §2.2 says "skip and count". An alternative: retry with a "your previous response failed validation; please retry with a strictly conformant Insight tool call" follow-up turn. Cost: one extra Haiku call per malformed response (~$0.003). Benefit: rescues borderline outputs. Recommend skip-and-count for v1; reconsider after observing drift rate. Reviewer call.

3. **`cite.ts` insight threshold (0.6 cosine).** §2.3 pins the threshold to mirror the existing `knowledge_chunk` threshold. Reviewer may want a different value for insights given the shorter embedding inputs (claims tend to score higher on relevant queries than passages do, all else equal). Recommend pin at 0.6 for v1; revisit when we observe live retrieval.

4. **`metadata` column on `knowledge_chunks` as JSON TEXT vs typed columns.** §3 / §4 model `metadata` as a JSON TEXT field carrying `{ timestamp_start_seconds, timestamp_end_seconds }`. An alternative: hoist these to typed `timestamp_start_seconds INTEGER` + `timestamp_end_seconds INTEGER` columns directly on `knowledge_chunks`. Trade-off: typed columns are easier to filter/index but force schema churn for every future per-source metadata field; JSON is flexible but inert in SQL. Recommend JSON for v1 since the only consumer is `cite.ts` reading the column verbatim. Reviewer call. (Note: search filters never touch metadata in v1.)

5. **`insights_search` second tool registration vs widening `knowledge_search`.** §6 argues for two tools. The metavgc precedent (one widened tool with `species_id_filter`) suggests caution. Reviewer may push back. The differentiator is the return-shape divergence (passage vs atomic claim with stance + confidence + claim_type) — these are not interchangeable in agent reasoning. Recommend two.

6. **English-only soft-skip vs hard-fail for non-English videos.** §9 + Q9 binding answer is "soft-skip, exit 0, log a failure". Reviewer can vote to hard-fail (exit 1) for non-English to surface mistakes loudly. Recommend soft-skip — the user can mistakenly paste a non-English URL; a hard-fail forces script reruns for an obvious diagnosable case.

7. **`youtube-transcript` package version pin.** §11 says "exact version, not `^1.x`". This is supply-chain hygiene aligned with `vgc-knowledge-base`. Confirm pin discipline with the reviewer; auto-bumping minor versions could break the wrapper without notice.

8. **Should the `chunk-transcript` token cap (500) re-window down on overflow?** §5.2 mentions "single-pass, no recursion needed for current data". A monologue chunk that genuinely needs to be 700 tokens would currently fail the schema CHECK (`chunk_token_count BETWEEN 1 AND 500`). Recommend: if the chunker produces a chunk > 500 tokens, recursively re-window with `window_s / 2`. Add as YT-T11 stretch — alert reviewer.

**Flow-doc gaps surfaced** (recommend updating before Stage 4):
- Flow §3 mentions "Voyage embedding for transcript chunks"; flow §6 mentions only Haiku cost. The flow should mention that **insights are also embedded via Voyage** (the slice doubles the embedding API surface). Add a one-line note.
- Flow §4.4 says "extend `metadata` JSON column with `timestamp_start_seconds` field" — but the existing `knowledge_chunks` schema has no `metadata` column today. The plan adds it (§3 + §4). Recommend the flow note this is a schema add, not an extension.
- Flow §11 Q5 answer says "distinct field `insights: InsightCitation[]` on `ScenarioOverview`" — the plan adopts this verbatim (§2.3). No gap; documenting for completeness.
- Flow §11 Q1 cites `youtube-transcript` as "no API key needed". Worth noting in the flow that the package has no documented rate limit and we self-throttle to 1 RPS. Plan §5.1 / §14 #1 documents this; would be useful in the flow's risk section too.
- Flow §10 lists "Backfill of existing 0 YouTube videos — there are none today; no backfill needed." Plan §12 #6 covers the **retroactive backfill of vgcguide + metavgc** as Stage 6 deferred. The flow could mention this neighboring deferral for completeness.

---

**Reviewed-by:** _pending_
