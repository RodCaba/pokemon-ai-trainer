# vgcguide fixtures

Captured 2026-05-06 for the `vgc-knowledge-base` slice (Stage 4 red tests).

| File | Source | Purpose |
|---|---|---|
| `2026-05-06__intro__what-is-pokemon-showdown.html` | https://www.vgcguide.com/what-is-pokemon-showdown | Real intro-section article. Smaller body. Used by extractor / chunker tests. |
| `2026-05-06__teambuilding__typing.html` | https://www.vgcguide.com/typing | Real teambuilding-section article. Mid-length, h2-rich. |
| `2026-05-06__battling__predictions.html` | https://www.vgcguide.com/predictions | Real battling-section article. h3-rich. |
| `2026-05-06__synthetic-short.html` | hand-authored | Single-implicit-section path (no h2/h3) and single-chunk (~100 tokens) path. |
| `2026-05-06__sitemap.xml` | https://www.vgcguide.com/sitemap.xml | Real sitemap snapshot — used to test client.fetchSitemap parser. |
| `2026-05-06__sanity-queries.json` | hand-authored | 6 sanity-check queries with seeded vectors + expected top-1 article slug; drives the deterministic-retrieval test (VGC-T46). |

Captured via `curl -sS -L --max-time 25 -H 'User-Agent: pokemon-ai-trainer-fixture-capture/0.1' <url>`.

Fixtures are immutable; if upstream drifts, capture a new dated fixture and update the test reference rather than mutating the existing file.

## Reg M-A hygiene

Empirical scan of all 53 vgcguide articles (2026-05-06) found zero matches for `/tera/i`, so no positive-Tera fixture is included. The defensive no-tera property test (VGC-T50) scans persisted rows for future regressions.
