# `tools/metavgc/` — SPEC

Adapter for `metavgc.com`'s Pokemon Champions / Reg M-A guides. Mirrors
`tools/vgcguide/SPEC.md`. Per CLAUDE.md §8 every external data source is a
tool with a documented contract.

## 1. Tools registered

None new. The metavgc ingest writes into the same `knowledge_chunks` table
(plus the new `knowledge_chunk_species_tags` link table) as
`vgc-knowledge-base`. The agent-facing surface is the existing
`knowledge_search` tool (extended with optional `source_site_filter` and
`species_id_filter` arguments — see `src/db/tool-definitions.ts` Stage 6).

## 2. Endpoint contract

- `https://metavgc.com/sitemap.xml` — canonical scope source. Hand-authored
  by the site owner; mixes English `/guides/<slug>` URLs with the Portuguese
  mirror `/pt/guias/<slug>` and `/pokemon/<slug>` species detail pages.
  Discovery filters to `/guides/<slug>` only.
- `https://metavgc.com/guides/<slug>` — semantic HTML. `<article>` element
  contains the body; `<main>` provides a defensive fallback for rare drift.

## 3. Inputs / outputs

Same shapes as vgcguide; `source_site = 'metavgc'`. See:
- `src/tools/metavgc/sitemap.ts` — `parseMetaVgcSitemap(xml): string[]`
- `src/tools/metavgc/discover-scope.ts` —
  `extractMetaVgcSlugs(xml): Set<string>`,
  `discoverScope(client): Promise<Set<string>>`
- `src/tools/metavgc/extract-article.ts` —
  `extractMetaVgcArticle({ slug, html }): ExtractedMetaVgcArticle`
- `src/tools/metavgc/client.ts` — `createMetaVgcClient(opts): MetaVgcClient`
  (type-aliased to the shared `KnowledgeArticleClient` contract per plan §19.1).
- `src/tools/metavgc/section.ts` — `inferMetaVgcSection(slug): "intro"`
- `src/tools/metavgc/tag-subtype.ts` — `tagSubtype(slug): null`

## 4. Edge cases

- Sitemap contains the `/guides` hub root → excluded by `extractMetaVgcSlugs`.
- Sitemap contains `/pt/guias/*` → excluded by `extractMetaVgcSlugs`.
- Sitemap contains `/pokemon/<slug>` → excluded by `extractMetaVgcSlugs`
  (deferred to a later slice).
- Article HTML missing `<article>` AND `<main>` body container →
  `KnowledgeArticleParseError`; logged into `parse_failures[]` by ingest.
- Article body that extracts but tokenizes to 0 chunks → logged + skipped.
- 404 → `KnowledgeArticleNotFoundError`, not retried, not cached.
- 429 / 5xx → exponential backoff up to `maxRetries=3`; throws
  `KnowledgeArticleNetworkError` after exhaustion.

## 5. Citation rules

Every persisted `KnowledgeChunk`:
- `article_url` — canonical `https://metavgc.com/guides/<slug>`.
- `section_heading` — h2/h3 visible heading text (or article title for the
  implicit single-section fallback).
- `source.site = 'metavgc'`.
- `source.author = null` for v1 (metavgc bylines are organizational —
  "MetaVGC" — not per-author; revisit if individual authors surface).
- `source.fetched_at` — ISO-8601 UTC timestamp from the HTTP client.
- `source.captured_via` — `metavgc-ingest@<git-sha>` stamp.

## 6. Reg M-A hygiene

Champions content; zero Tera expected. Defensive `.strict()` zod gate plus
the existing knowledge no-tera property test apply equally to
`source_site = 'metavgc'`.

## 7. Cache + throttle

- 2 RPS sustained — `_shared/throttle.ts` token bucket; politeness ceiling
  (no published rate limit; robots.txt has no Crawl-delay).
- 7-day TTL disk cache — `_shared/file-cache.ts`. 200 responses cached by
  slug; 404s NOT cached.
- Cache directory: `data/cache/metavgc/` (gitignored).

## 8. Out of scope

- `/pokemon/<slug>` species detail pages — deferred.
- Featured teams page (`/featured`) — deferred.
- Portuguese mirror (`/pt/guias/`) — deferred.
- Insight extraction (CLAUDE.md §6) — deferred (Haiku-driven slice).
- Article-section enum extension to `"guides"` — deferred (plan §19 Q4
  pinned `article_section` to `"intro"`).

## 9. Errors

| Class | Trigger | Severity | Where caught |
| --- | --- | --- | --- |
| `KnowledgeArticleNotFoundError` | HTTP 404 | data | ingest `not_found[]` |
| `KnowledgeArticleNetworkError` | non-2xx after retries | infra | ingest `network_failures[]` |
| `KnowledgeArticleParseError` | extractor returned no body container | data | ingest `parse_failures[]` |
| `KnowledgeEmbeddingError` | Voyage retry exhaustion | infra | ingest `embedding_failures[]` |
| `KnowledgeAuthError` | Voyage 401/403 / missing key | **fail loud** | propagates |
| `KnowledgeStorageError` | sqlite-vec dim mismatch | **fail loud** | propagates |
| `SpeciesTaggerError` | empty species index at ingest start | **fail loud** | propagates (ingest also has a stderr-warn fallback for fresh DBs) |
