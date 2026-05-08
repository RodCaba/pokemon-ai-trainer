# vgcguide tool — SPEC (Stage 4 placeholder)

TODO(stage5): write the full SPEC per `docs/plans/vgc-knowledge-base.md` §4.2.

Intent at-a-glance (will be expanded in Stage 5):

- **Tool registered:** `knowledge_search` only.
- **Endpoint contract:** `https://www.vgcguide.com/sitemap.xml` returns the article URLs; `https://www.vgcguide.com/<slug>` returns Squarespace-rendered HTML; the body lives in `.sqs-html-content`.
- **Inputs / outputs:** `KnowledgeSearchArgsSchema` + `KnowledgeSearchHitSchema` (`src/schemas/knowledge.ts`).
- **Edge cases:** sitemap returning != 53 URLs, article missing `.sqs-html-content`, zero h2/h3, zero chunks, Voyage 429 backoff, vec0 dimension mismatch.
- **Errors:** `VgcGuide*Error` family for HTTP/parse, `Knowledge*Error` family for embed/storage.
- **Reg M-A hygiene:** zero Tera content per the 2026-05-06 corpus scan; defensive no-tera property test (VGC-T50) catches future regressions.
- **Cache + throttle:** 2 RPS on `vgcguide.com`; 7-day TTL on article HTML cache.
- **Out of scope:** per-species strategy notes, transcript ingest, comments, retrieval re-ranking via cross-link graph.
