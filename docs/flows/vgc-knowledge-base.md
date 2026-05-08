# Flow — VGC General-Knowledge Base (vgcguide.com)

**Slug:** `vgc-knowledge-base`
**Stage:** Stage 2 approved (2026-05-08). Tech plan (Stage 3) pending.
**Approved-by:** Rodrigo Caballero (2026-05-08)
**Author:** Claude (main agent)
**Date:** 2026-05-06

The agent's three existing data sources (labmaus, pokepaste, pikalytics) all answer **structured** questions: "what's the usage % of X?", "which teams ran Y?", "what items did the winning Garchomp use?". Players also ask **conceptual** questions: "how do I think about speed control?", "when should I switch?", "what makes a team consistent?". Today the agent has nothing to cite for those — it reasons from training data alone, which is exactly the failure mode CLAUDE.md §1 ("every recommendation explainable, cited, reproducible") was written to prevent.

This slice ingests **vgcguide.com** — a curated SV-era VGC guide by Aaron Traylor + Aaron Zheng — into a semantic-search store so the agent can ground its conceptual answers in cited tutorial passages. It's the first consumer of the **vector tier** (Tier B per `data_layer_two_tier_db.md` memory; sqlite-vec already chosen in `pokemon-roster-db` §6 Q11 as the candidate).

> **Empirical content baseline (re-grounding 2026-05-08):** the site's footer disclaimer says "Information here will pertain to Scarlet and Violet," but a body-only scan of all 53 articles found **47 with zero format-specific signals** (no Tera, no SV-only species, no regulation-letter references, no Gen 9 mentions). The 6 articles that do reference specific formats are dominated by **2 battle-replay articles citing pre-SV tournaments** (Worlds 2017, NAIC 2019). The corpus is overwhelmingly principle-focused tutorial content: teambuilding intent, predictions, switching, pressure, team preview. The "SV-era" framing is a single footer line, not pervasive content.

> **Reg M-A hygiene:** zero Tera mentions in any of 53 article bodies (the only `tera` regex match in the corpus is a CSS class artifact `terAverage`). The defensive `mentions_tera` flag the original draft proposed is moot. The schema therefore drops both `mentions_tera` and `format_caveat` fields — there's nothing to caveat. Per memory `regulation_m_a_no_tera.md`, the agent still must not carry Tera-mechanics advice into Reg M-A responses, but that's a prompt-engineering concern, not a data-layer one.

> **Scope boundary:** general VGC knowledge only. **Per-species strategy** (e.g. "how should I play Sneasler?") gets a separate future slice — that data has different shape (per-species, opinionated, more like the Insight model per CLAUDE.md §6). This slice ingests the three top-level sections vgcguide.com publishes (`/intro`, `/teambuilding`, `/battling`) — 53 articles total, ~310K words.

---

## 1. User flow

The knowledge base is **agent-callable, citation-first**. Users experience it through three product surfaces.

### 1.1 Surface A — Conceptual question answering (primary)
1. Player asks "how should I think about speed control on a sun team?" or "when should I bring Pokemon B over Pokemon A?"
2. The agent calls `knowledge.search(query, k=4)` → returns 4 ranked tutorial passages with article title + URL + the section heading they came from.
3. The agent synthesizes an answer **citing the retrieved passages**: "Per *Speed Control* (vgcguide.com/speed-control): 'Tailwind is the most flexible speed-control move because…' Combined with the *Cores and Modes* article's claim that…"
4. Without this slice, the agent's conceptual answers are uncited and the player has no audit trail.

### 1.2 Surface B — Teambuilder rationale
1. The agent recommends a build choice ("run Choice Scarf Garchomp here").
2. It cites both the meta evidence (Pikalytics + Labmaus, already shipped) AND the principle ("per *Items*: 'Choice items trade flexibility for raw power; consider whether your team can absorb the predictability'").
3. The principle citation grounds the *why* behind the meta evidence — strengthens the recommendation's pedagogy.

### 1.3 Surface C — New-player onboarding
1. Player who's new to VGC says "I'm coming from singles, where do I start?"
2. The agent retrieves the targeted intro articles (`/coming-from-single-battles`, `/what-are-the-rules-of-a-vgc-battle`) and surfaces them directly.
3. This is more of a "guided reading" mode than synthesis — the value is the curated path, not the agent's words.

### Acceptance (user-perceived)
- Every retrieved chunk carries `article_title`, `article_url`, `section_heading`, and (for the 3 battle-replay articles) `subtype: "battle-replay"`.
- For any reasonable VGC concept query, top-1 retrieval is from the right article more than half the time on a sanity-check fixture set.
- No tera-mechanics-specific advice ever surfaces verbatim in a Reg M-A response (validated by a property test).
- Cold-start ingest of all 53 articles + embedding finishes in under 10 minutes; weekly refresh re-embeds only articles whose body hash changed.

---

## 2. Tech flow

### 2.1 Module surface (final shape lands in tech plan)

```ts
// Tool layer — agent-callable per CLAUDE.md §8
knowledge.search(args: {
  query: string,
  k?: number,                    // default 5; max 20
  format_filter?: "regm-a-only" | "sv-era-ok" | "all",  // default "sv-era-ok"
}): Promise<KnowledgeChunk[]>

// Repository layer
chunks.list(filter: ChunkFilter): KnowledgeChunk[]
chunks.get(id: string): KnowledgeChunk | null
chunks.search(args: {
  query: string,
  k: number,
  format_filter?: "regm-a-only" | "sv-era-ok" | "all",
}): KnowledgeChunk[]            // top-k by cosine similarity, with metadata
```

The tool layer is a thin wrapper around `chunks.search`. The repository runs `sqlite-vec`'s `vss_search` against the embedded chunks.

### 2.2 Discovered access surface

Per the recon at `https://www.vgcguide.com/`:

```
GET https://www.vgcguide.com/<article-slug>
  → 200 text/html (Squarespace-rendered, server-side)
  → article body in <div class="sqs-html-content">
```

- **No JSON endpoint, no Markdown export, no `llms.txt`.** HTML scrape is the only path.
- **`robots.txt` permits AI crawlers** (ClaudeBot, GPTBot, etc.); blocks `?json` query params and `/api/`.
- **No Cloudflare, no auth, no rate-limit headers** observed.
- **Sitemap at `/sitemap.xml`** lists all 53 article URLs.
- **53 articles total** (12 intro / 23 teambuilding / 18 battling), ~5.7K words avg, ~310K words total.
- **No video / image / calculator embeds** in article bodies (good — pure text, easy to extract).
- **Single curated authorship** (Aaron Traylor + Aaron Zheng); no wiki-style editing.

### 2.3 Domain shape (sketch — final lands in tech plan)

```jsonc
// KnowledgeChunk — one row per (article, chunk_index)
{
  "schema_version": 1,
  "id": "vgcguide:speed-control:3",                  // <site>:<slug>:<chunk_index>
  "source_site": "vgcguide",
  "article_slug": "speed-control",
  "article_title": "Speed Control",
  "article_url": "https://www.vgcguide.com/speed-control",
  "article_section": "teambuilding",                 // intro | teambuilding | battling
  "section_heading": "Tailwind",                     // h2/h3 of the chunk's parent section
  "chunk_index": 3,                                  // 0-based ordinal within the article
  "chunk_text": "Tailwind is the most flexible speed-control move because the user retains item flexibility...",
  "chunk_token_count": 287,
  "subtype": null,                                   // null | "battle-replay" (3 historical-match articles)
  "embedding_ref": "vec0:42",                        // explicit string ref into the vec0 sidecar table (Stage 3 §5.3)
  "body_hash": "sha256:...",                         // for skip-existing on re-ingest
  "source": {
    "fetched_at": "2026-05-06T19:32:11Z",
    "author": "Aaron Traylor",                       // when discoverable; nullable
    "captured_via": "vgcguide-ingest@<git-sha>"
  }
}
```

Provenance per CLAUDE.md §5. Each chunk is independently retrievable AND traceable back to the article + section. The `embedding_ref` is an **explicit string** pointing into the vec0 sidecar virtual table (Stage 3 §5.3 — chosen over parallel-rowid coupling so out-of-order deletes can never desynchronize the relational and vector rows).

### 2.4 Chunking strategy

**Sliding-window over h2/h3 boundaries.**

- Articles are 5–7K words. Embedding quality degrades on chunks > ~1K tokens.
- Strategy: parse the HTML into a tree of `(section_heading, paragraphs)` per h2/h3; collapse paragraphs into chunks of ~400 tokens (target) / 500 max; never cross h2/h3 boundaries (so retrievals always have a clean section_heading).
- For very short sections (< 200 tokens), keep as a single chunk; for very long sections, split on paragraph boundaries with a 50-token overlap to preserve cross-paragraph context.
- Estimate: ~310K words / ~400 tokens per chunk × ~1.3 token/word ≈ **~1000 chunks total** across the corpus.

The tech plan locks the exact tokenizer (`@anthropic-ai/tokenizer`? `tiktoken`?) — both are reasonable; pick what's already in the repo (none yet — recon shows nothing) or choose `tiktoken` as the standard.

### 2.5 Embedding model

**`voyage-3-lite` via Voyage AI's API**, called via direct `fetch` (no `voyageai` SDK dep — keeps `package.json` slim; the API shape is straightforward POST JSON). Stage 3 §17 Q5.
- Anthropic-recommended embedding partner.
- 1024 dimensions, ~$0.02/1M tokens.
- ~310K words ≈ 400K tokens cold-start cost ≈ **$0.008** total. Re-embeds on edits are cheaper.
- Well-supported, OpenAI-API-compatible request shape.

Alternative: `text-embedding-3-small` (OpenAI). Cheaper, larger ecosystem, but Voyage's retrieval quality benchmarks higher on tutorial-style content.

The flow doc doesn't pin the exact model; tech plan does. The schema is dimension-agnostic — `embedding_ref` is opaque.

**Required env var:** `VOYAGE_API_KEY` (or OpenAI equivalent). Documented in `.env.local` and CLAUDE.md §10 secrets policy.

### 2.6 Storage — sqlite-vec extension on the existing DB

Per memory `data_layer_two_tier_db.md` and `single_db_non_destructive_build.md`: one DB file. Adds the `sqlite-vec` extension (loaded at `open()` time when present), one new relational table `knowledge_chunks` (the metadata + body), one virtual table `knowledge_chunk_embeddings` (the vec0 index over `embedding` BLOB columns).

```
knowledge_chunks
  id                  TEXT PK              -- "vgcguide:<slug>:<chunk_index>"
  source_site         TEXT NOT NULL CHECK = 'vgcguide'  -- expand later
  article_slug        TEXT NOT NULL
  article_title       TEXT NOT NULL
  article_url         TEXT NOT NULL
  article_section     TEXT NOT NULL CHECK IN ('intro','teambuilding','battling')
  section_heading     TEXT NOT NULL
  chunk_index         INTEGER NOT NULL
  chunk_text          TEXT NOT NULL
  chunk_token_count   INTEGER NOT NULL
  subtype             TEXT NULL CHECK (subtype IS NULL OR subtype IN ('battle-replay'))
  body_hash           TEXT NOT NULL
  fetched_at          TEXT NOT NULL
  author              TEXT NULL
  captured_via        TEXT NOT NULL
  UNIQUE (source_site, article_slug, chunk_index)

knowledge_chunk_embeddings  (sqlite-vec virtual table)
  rowid               INTEGER PK            -- maps to knowledge_chunks.rowid
  embedding           FLOAT[1024]           -- voyage-3-lite default
```

Indexes: `knowledge_chunks(article_slug, chunk_index)`, `knowledge_chunks(article_section)`, `knowledge_chunks(body_hash)` (for re-ingest dedup).

This is **production state** (per `single_db_non_destructive_build.md`) — never wiped by the build. Captured-as-of-first-sight semantics; re-ingest only re-embeds when `body_hash` changes for a given article.

### 2.7 Ingest pipeline

```
                      scripts/data/ingest-vgcguide.ts
                      (cron weekly, manual once)
                                  │
                                  ▼
                      fetch sitemap.xml → 53 article URLs
                                  │
                                  ▼
            for each URL: GET article HTML (throttled, cached)
                                  │
                                  ▼
                   readability extract → article body
                                  │
                                  ▼
                  body_hash check: skip-existing if unchanged
                                  │
                                  ▼
                   parse h2/h3 tree → sliding-window chunks
                                  │
                                  ▼
                  tag battle-replay subtype if slug matches /^battling-example/
                                  │
                                  ▼
                   batch-embed chunks via Voyage API
                                  │
                                  ▼
                upsert knowledge_chunks + knowledge_chunk_embeddings
```

- **Throttle.** Reuse `_shared/throttle.ts`. 2 RPS for vgcguide.com (Squarespace, no rate limit observed; politeness default).
- **Cache.** Reuse `_shared/file-cache.ts`. Article HTML cached on `<slug>__<sha-of-body>` with `Number.POSITIVE_INFINITY` TTL — content-addressed once we've seen the body. Re-fetches are HTTP-cheap; re-embeds are the cost we want to skip.
- **Skip-existing.** If `body_hash` matches the latest `knowledge_chunks` row for the same article slug, skip the chunking + embedding pass entirely. Otherwise re-chunk + re-embed (delete old chunks for that slug + insert new).
- **Embedding batching.** Voyage's API accepts up to 128 inputs per request; batch chunks 64-at-a-time to balance throughput vs. failure blast radius. Retry on 429/5xx with exp backoff (mirror labmaus).
- **Run summary.** `articles_fetched, articles_skipped_unchanged, chunks_inserted, chunks_re_embedded, embedding_failures, network_failures`.

### 2.8 Where it sits in the repo

```
src/
  schemas/
    knowledge.ts                              (zod: KnowledgeChunk, ChunkFilter, SearchArgs)
  tools/
    vgcguide/
      SPEC.md                                 (per CLAUDE.md §8)
      client.ts                               (HTTP: throttled, cached, sitemap+article)
      extract-article.ts                      (HTML → article body via readability)
      chunk.ts                                (h2/h3 tree → sliding-window chunks)
      tag-subtype.ts                          (slug → optional 'battle-replay' tag)
    knowledge/
      embed.ts                                (Voyage API client; batching; retries)
      search.ts                               (top-k cosine via sqlite-vec)
  db/
    drizzle-schema.ts                         (extended with knowledge_chunks)
    migrations/
      00XX_knowledge_chunks.sql               (drizzle-kit generated)
    knowledge.ts                              (bespoke repo: list, get, search,
                                               upsertChunks)
scripts/
  data/
    ingest-vgcguide.ts                        (cron entry point)
fixtures/
  vgcguide/
    2026-05-06__intro.html                    (one real captured article per section)
    2026-05-06__teambuilding-typing.html
    2026-05-06__battling-predictions.html
    2026-05-06__synthetic-short.html          (single h2, < 200 tokens — single-chunk path)
tests/
  schemas/
    knowledge.test.ts                         (zod round-trip)
  tools/
    vgcguide/
      extract-article.test.ts                 (HTML body extraction)
      chunk.test.ts                           (h2/h3 boundaries; sliding window; counts)
      tag-subtype.test.ts                     (slug → 'battle-replay' for the 3 known articles, null otherwise)
      client.test.ts                          (throttle, cache, sitemap parse)
    knowledge/
      embed.test.ts                           (mocked Voyage HTTP; batching; retries)
      search.test.ts                          (cosine ranking with seeded vectors)
  db/
    knowledge.test.ts                         (in-memory sqlite + sqlite-vec; upsert,
                                               skip-existing on body_hash, search top-k)
  scripts/
    ingest-vgcguide.test.ts                   (cache-driven offline mode; idempotency)
  contract/
    vgcguide-live.test.ts                     (weekly: fetch one known stable article;
                                               assert HTML structure still matches the
                                               extractor; gated by RUN_CONTRACT_TESTS=1)
```

### 2.9 Test strategy (Stage 4 will write red first)

- **Schema:** zod round-trip on the 5 fixtures.
- **Chunking:** every chunk's text is contained in the source article body; chunks never cross h2/h3 boundaries; chunk count for a known fixture matches a frozen value (regression guard).
- **Subtype tagging:** the 3 `battling-example-*` slugs produce `subtype: "battle-replay"`; every other slug produces `subtype: null`.
- **Reg M-A property test:** the existing labmaus + pokepaste no-tera property tests already enforce no Tera leak in persisted rows; for the knowledge-chunks table, a parallel test asserts no chunk's `chunk_text` contains a tera-shaped substring (today empirically true; defensive against a future article rewrite).
- **Embedding mock:** `embed()` consumes a 64-batch and returns 64 vectors of the right dimension; retry on simulated 429.
- **Search:** in-memory sqlite-vec with seeded 1024-dim vectors returns the expected top-k by cosine. Sanity test: query "what is speed control" returns the speed-control article's top chunks.
- **Skip-existing:** re-ingesting the same body_hash produces zero embedding-API calls (mock-counted) and zero `knowledge_chunks` deltas.
- **Contract test (gated):** fetches one article live; asserts the extractor still finds a non-empty body inside `.sqs-html-content`.

### 2.10 Out of scope for this slice

- **Per-species strategy notes.** Different shape (Insight per CLAUDE.md §6); separate future slice.
- **Other VGC sources** (Smogon strategy dexes, JustinFlynn videos, Aaron Zheng YouTube transcripts) — separate flows.
- **Retrieval re-ranking via cross-link graph** between articles. Possible signal but speculative; defer.
- **User-uploaded notes / personal annotations.** Out of scope; this is read-only ingested content.
- **Format-aware retrieval re-ranking** — moot: zero Tera content in the corpus per the 2026-05-08 body scan.
- **Multi-language.** vgcguide.com is English-only; not addressed.

---

## 3. Data in / out

| Step | Input | Output |
|------|-------|--------|
| ingest pipeline | none (sitemap-driven) | upserted `knowledge_chunks` + `knowledge_chunk_embeddings` rows |
| `chunks.search({query, k})` | natural-language query + k | ranked `KnowledgeChunk[]` with cosine scores |
| `knowledge.search` agent tool | query + k + (optional `exclude_subtypes`) | same as above, optionally excluding `battle-replay` chunks |

---

## 4. Error / empty states

- **HTML body absent / extractor returns empty** → log to run summary `parse_failures[]`, skip article, continue.
- **Body extracted but tokenizes to 0 chunks** (defensive corner) → log + skip.
- **Voyage API 429** → exp backoff per labmaus pattern; abort the article after 3 retries; log to `embedding_failures[]`. Other articles continue.
- **Voyage API auth failure** → fail loud at startup (env var missing or invalid). Don't swallow.
- **sqlite-vec extension not loadable** → fail loud at `open()` time with a clear "install the extension" message. The build pipeline must verify the extension is available before the migration runs.
- **Vector dimension mismatch** (e.g. someone changed embedding models without updating the schema) → fail loud at upsert.
- **Empty corpus search** → return `[]`. Caller (agent) gracefully degrades to "I don't have a tutorial citation for this; here's my best reasoning…" — handled at the agent prompt level, not the tool.
- **Tera-content leak in agent response** → empirically a non-issue for this source (zero Tera mentions in the corpus per the 2026-05-08 scan). If a future article rewrite introduces Tera content, the parallel no-tera property test catches it at ingest time.

---

## 5. Success criteria (this slice)

- [ ] `KnowledgeChunk`, `ChunkFilter`, `SearchArgs` zod schemas; round-trip tests pass on ≥5 fixtures.
- [ ] `vgcguide.client` + `extract-article` + `chunk` + `tag-subtype` modules ship with TSDoc per CLAUDE.md §10.
- [ ] `knowledge_chunks` Drizzle table + migration applied; sqlite-vec virtual table for embeddings.
- [ ] `knowledge.{list, get, search, upsertChunks}` repo green; in-memory sqlite-vec unit tests pass.
- [ ] `knowledge.search` registered as an agent tool in `ROSTER_TOOL_DEFINITIONS` from day one (the lesson from pokepaste's BLOCKER).
- [ ] Skip-existing on `body_hash`: rerunning the ingest produces zero embedding API calls when nothing changed upstream.
- [ ] Cold-start ingest of all 53 articles + ~1000 chunks completes in under 10 min on a laptop with VOYAGE_API_KEY set.
- [ ] **Sanity-check fixture set:** for ≥6 hand-curated queries (e.g. "what is speed control", "when should I switch", "how do I read team preview"), the top-1 retrieval is from the right article.
- [ ] No persisted chunk surfaces verbatim Tera-mechanics advice through `knowledge.search` for a `format_filter: "regm-a-only"` query (validated by a property test).
- [ ] Live contract test in place; gated behind `RUN_CONTRACT_TESTS=1`.
- [ ] Demo: `scripts/vgc-knowledge-demo.ts` answers 4–5 conceptual questions end-to-end against the populated DB.

---

## 6. Open questions for Stage 2 review

1. **Embedding model.** Proposal: `voyage-3-lite` (Anthropic-aligned, $0.008 cold start). Alternative: `text-embedding-3-small` (OpenAI, larger ecosystem). The schema is dimension-agnostic; the env var name + tech plan pins one model. **Reviewer's call.**
Answer: Anthropic's voyage-3-lite it is.

2. **Vector store extension.** sqlite-vec is the proposal per `pokemon-roster-db` §6 Q11. Alternative: switch to LanceDB (separate file) if sqlite-vec turns out to need native compilation we don't want. **Proposal:** sqlite-vec; if Stage 4 hits a build issue, document it and reconsider.
Answer: sqlite-vec works fine with the current build; we'll document any future issues if they arise.

3. **Chunk size and overlap.** Proposal: ~400 token target, 500 max, h2/h3 boundary respect, 50-token paragraph-overlap on splits within long sections. Trade-off: smaller chunks → more retrievals, finer grain, but worse context per chunk. **Reviewer's call.**
Answer: the proposed chunking strategy is a good balance; it respects the article structure while keeping chunks manageable for embedding.

4. **Battle-replay articles.** Three battling articles are full-game write-ups (`/battling-example-alister-…`, `/battling-examples-diana-bros-…`, `/battling-example-will-tansley-…`). They're long, narrative, dominated by player names + turn numbers, and account for **13 of the 18 corpus-wide format-specific references** (the other 5 are scattered single mentions in 4 unrelated articles). They'd likely outrank principle articles on broad queries via embedding similarity to their narrative density. **Proposal:** ingest with `subtype: "battle-replay"` so the agent's tool can pass `exclude_subtypes: ["battle-replay"]` for principle queries, but include them when the agent wants concrete game examples. Hard-coded slug list (3 entries) is the simplest tagger. Reviewer confirms or asks for exclusion entirely.
Answer: tagging the three battle-replay articles with a `subtype` is a smart way to allow the agent to exclude them from principle-focused queries while still having them available for example-focused queries.

5. **Sanity-check query set.** Proposal: 6 queries for the success criterion (one per top-line concept: speed control, switching, predictions, type chart logic, team preview, items). **Reviewer to expand or trim.**
Answer: the proposed sanity-check query set covers a good range of core VGC concepts; it should provide a solid test of the retrieval quality.

6. **Re-ingest cadence.** Proposal: weekly cron, body-hash skip-existing makes most articles free. Aaron Traylor edits articles occasionally; the body_hash check catches it. **Reviewer confirms cadence.**
Answer: a weekly cron for re-ingest with body-hash skip-existing is a reasonable approach; it balances freshness with cost and avoids unnecessary re-embedding.

7. **Run-summary granularity.** Proposal: `articles_fetched, articles_skipped_unchanged, chunks_inserted, chunks_re_embedded, embedding_failures, network_failures, parse_failures`. Mirror pokepaste/pikalytics shapes. **Reviewer confirms.**
Answer: the proposed run-summary metrics provide a comprehensive overview of the ingest process and align well with existing patterns in the repo.

8. **Operator demo script.** Proposal: `scripts/vgc-knowledge-demo.ts` with 4–5 framed conceptual queries (mirroring `scripts/pikalytics-day-to-day.ts`). **Proposal:** ship.
Answer: Ship it.

9. **Tool surface granularity.** Proposal: a single `knowledge.search` tool with optional `exclude_subtypes` and optional `article_section_filter`. Not a per-section tool (`vgcguide.searchIntro`, etc.) — that's premature abstraction. **Reviewer confirms.**
Answer: a single `knowledge.search` tool with flexible filtering options is a good design; it keeps the interface simple while allowing for targeted queries.

10. **Stage 4 test ordering.** Schema → extractor → chunker → subtype tagger → client (mocked HTTP) → embed (mocked Voyage) → repo (in-memory sqlite-vec) → ingest end-to-end on fixtures → idempotency (body-hash skip) → contract (live, gated). Mirrors prior slices.
Answer: the proposed test ordering is logical and builds up from unit tests to integration and contract tests, ensuring robustness at each layer.

---

## 7. Reviewed-by

_Rodrigo Caballero_
