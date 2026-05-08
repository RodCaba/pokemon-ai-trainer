# vgcguide Tool Spec

**Status:** Stage 5 shipped. Stage 6 reviewed.

One agent-callable tool wraps a vector-search index built from
[vgcguide.com](https://www.vgcguide.com) — Aaron Zheng's longform VGC
strategy articles. The tool is `knowledge_search`. The vgcguide HTTP
client + extractor + chunker are private to the ingest pipeline; the
agent never calls them directly.

## Tools

- `knowledge_search` — semantic search over the persisted chunk corpus.
  Inputs: `KnowledgeSearchArgs` (zod). Outputs: `KnowledgeSearchHit[]`.
  See `src/schemas/knowledge.ts` for the schemas.

## Inputs (zod schemas)

- `KnowledgeSearchArgsSchema` — `{ query: string(3..500), k?:
  int(1..20), exclude_subtypes?: ("battle-replay")[], article_section_filter?:
  ("intro"|"teambuilding"|"battling")[] }`. `format: "RegM-A"` literal
  is deliberately omitted — the vgcguide corpus is format-agnostic
  principle content (every article is general VGC theory; nothing is
  pinned to a regulation set). See plan §17 / `KnowledgeSearchToolInput`
  TODO note for the multi-format seam if it ever lands.

## Outputs (zod schemas)

- `KnowledgeSearchHitSchema` — `{ id, article_slug, article_title,
  article_url, article_section, section_heading, subtype, chunk_text,
  cosine_score }`. Hits are ordered by `cosine_score DESC`. The string
  `cosine_score = clamp(1 - vec0_distance, -1, 1)` only makes sense
  when the underlying vec0 module is created with
  `distance_metric=cosine` — see `0007_knowledge_vec0.sql`.

## Endpoint contract

- `https://www.vgcguide.com/sitemap.xml` — XML sitemap; ~53 article
  URLs as of 2026-05-06. Parsed by `parseVgcGuideSitemap` (regex on
  `<loc>...</loc>`). Article URLs are flat under root
  (`https://www.vgcguide.com/<slug>`); the sitemap does NOT prefix by
  section. Section is therefore inferred from slug keywords via
  `inferSectionFromSlug` (see `src/tools/vgcguide/section.ts`).
- `https://www.vgcguide.com/<slug>` — Squarespace-rendered HTML. The
  load-bearing extractor invariant is the body container class:
  **`.sqs-html-content`**. The extractor selects the **first** node
  matching this selector and walks its children; missing the container
  is a `VgcGuideParseError`. Container-class drift is the highest-risk
  upstream change — VGC-T63 (live contract test, gated by
  `RUN_CONTRACT_TESTS=1`) re-asserts non-empty extraction weekly.

## Edge cases

- Sitemap returning ≠ 53 URLs — accepted; ingest processes whatever it
  returns. A delta is visible in the run summary.
- Article missing `.sqs-html-content` — `VgcGuideParseError`; logged
  per-article, ingest continues.
- Article with zero h2/h3 — extractor produces a single implicit
  section (heading = `article_title`).
- Article with sections-but-no-paragraphs — section is dropped at
  chunking, recorded in `raw_warnings`.
- Voyage 429 — exponential backoff (`backoffBaseMs * 2^attempt`), max
  3 retries, then `KnowledgeEmbeddingError`. Per-article boundary catches
  the error and continues.
- Voyage 401/403 — `KnowledgeAuthError`; ingest fails loud (exit 1).
- vec0 dimension mismatch (model returns ≠ 1024) — `KnowledgeStorageError`
  before the transaction opens; ingest fails loud.
- Body unchanged across runs — `body_hash` match short-circuits;
  zero embedding API calls, zero row writes. Verified by VGC-T61/T62.

## Errors

| Class | When |
|---|---|
| `VgcGuideNetworkError` | HTTP retry exhaustion / network failure |
| `VgcGuideNotFoundError` | 404 on article HTML |
| `VgcGuideParseError` | Missing `.sqs-html-content` container |
| `KnowledgeAuthError` | Voyage 401/403 or empty `VOYAGE_API_KEY` |
| `KnowledgeEmbeddingError` | Voyage retry exhaustion (429/5xx) |
| `KnowledgeStorageError` | sqlite-vec load failure / vec0 dim mismatch |

Per-article failures (`network`, `not_found`, `parse`, `embedding`) are
recorded in the run summary and the ingest exits 0. `KnowledgeAuthError`
and `KnowledgeStorageError` propagate (exit 1).

## Reg M-A hygiene

The vgcguide corpus contains zero Tera content as of the 2026-05-06
baseline scan (per flow §2 + plan §16). VGC-T50 is a regression-guard
property test that greps every persisted string column for `/tera/i`
and asserts no matches. If Aaron ever publishes a Tera-aware article
the test fails loud and the operator decides whether to ingest it
(Regulation M-A specifically disallows Tera, so the answer is most
likely "exclude"; for now the simple property is sufficient).

## Cache + throttle

- Disk cache under `data/cache/vgcguide/<sha1-of-key>.{html,xml}`
  (path overridable via `VGCGUIDE_CACHE_DIR` env var). Backed by the
  shared `_shared/file-cache` primitive with a **7-day TTL** (article
  bodies aren't content-addressed; we re-validate weekly).
- Token-bucket throttle at **2 rps**. Implemented via the shared
  `_shared/throttle.ts` `createTokenBucket` (separate bucket instance
  per client; no cross-tool shared state).
- Retry on `429` / `5xx` with exponential backoff
  (`backoffBaseMs * 2^attempt`), max 3 attempts. `4xx` other than 429
  maps directly: 404 → `VgcGuideNotFoundError` (not retryable, not
  cached negatively); other 4xx → `VgcGuideNetworkError`.

## Out of scope

- Per-species strategy notes — vgcguide articles are theory-first; we
  don't try to extract species-specific facts in this slice.
- Transcript ingest (YouTube) — a separate slice; the shared embed
  client is reusable when that lands.
- Article comments — vgcguide doesn't host comments; nothing to ingest.
- Retrieval re-ranking via cross-link graph — single-pass cosine top-k
  is sufficient at corpus scale ~1000 chunks.
- Real-time refresh — ingest is cron-driven (weekly).
