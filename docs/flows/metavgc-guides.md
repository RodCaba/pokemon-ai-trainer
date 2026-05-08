# Flow: metavgc-guides ingest

**Slug:** `metavgc-guides`
**Status:** Stage 1 — flow draft
**Author:** Claude (Opus 4.7)
**Date:** 2026-05-08

## 1. Why this slice

The `vgc-knowledge-base` slice ingests vgcguide.com tutorials — high-quality but
generic VGC theory, not Champions/Reg M-A specific. The user's actual prep
needs Champions-specific content. metavgc.com publishes 10 long-form guides
authored *for* Pokemon Champions Reg M-A: lead theory, counters for specific
species (Incineroar, Megas), team-building walkthroughs, format breakdowns.

Two goals:

1. **Validate that the existing ingest architecture scales to a second site.**
   If `vgcguide`'s extractor + chunker + scope discovery is the right
   abstraction, swapping in a new `client` + selectors should be the only
   site-specific work.
2. **Wire article content to species relational data** ("synergy"). When the
   agent reasons about Incineroar, it should retrieve both the structured
   roster row *and* the metavgc counter guide — keyed by species, not by
   keyword luck.

## 2. User flow

The user does not interact with this directly — it's an ingest pipeline run on
a cadence (manually for now, scheduled later). The downstream user flow is the
existing knowledge retrieval path:

1. User asks "How do I counter Incineroar in Reg M-A?"
2. Agent embeds the query, searches `knowledge_chunks` via vec0 cosine.
3. Top-K chunks return — chunks tagged with `incineroar` in `species_tags`
   are eligible for an additional retrieval channel: filter-by-species.
4. Agent quotes the chunks with citation back to `metavgc.com/guides/<slug>`.

The synergy: species-tagged chunks let the agent answer **per-species**
strategy questions by joining `species` → `knowledge_chunks WHERE species_tags
contains '<species_id>'`, even when the embedding miss happens (e.g., the
guide's title doesn't mention Incineroar but the body does).

## 3. Tech flow

```
sitemap.xml ──► discoverScope() ──► slugs ──► fetchArticleHtml() per slug
                                                       │
                                              extractArticle(html)
                                                       │
                                       { title, sections, paragraphs }
                                                       │
                                                  chunk(article)
                                                       │
                                       per-chunk: detectSpeciesTags(text, speciesIndex)
                                                       │
                                                  embed(chunkTexts)
                                                       │
                                upsertKnowledgeChunks (skip-existing on body_hash)
```

Reuse from `vgc-knowledge-base`:

- `src/tools/_shared/throttle.ts`, `_shared/file-cache.ts` — disk-cached fetch
- `src/tools/knowledge/chunk.ts` — token-aware chunker
- `src/tools/knowledge/embed.ts` — Voyage 512-dim embed client
- `src/db/knowledge.ts` — `upsertKnowledgeChunks`, vec0 sidecar
- Pipeline shape from `scripts/data/ingest-vgcguide.ts`

New, metavgc-specific:

- `src/tools/metavgc/client.ts` — `fetchSitemap`, `fetchArticleHtml`
- `src/tools/metavgc/extract-article.ts` — cheerio selectors for metavgc DOM
- `src/tools/metavgc/discover-scope.ts` — sitemap-only scope (no nav crawl
  needed; sitemap is well-curated, single section `/guides/<slug>`)
- `src/tools/metavgc/section.ts` — single section `"guides"` (placeholder for
  future expansion if metavgc adds more sections)
- `scripts/data/ingest-metavgc.ts` — entry point

Cross-cutting (touches existing schema + extractor):

- `src/db/migrations/0008_knowledge_multi_site_and_tags.sql` — relax CHECK to
  include `'metavgc'`, widen unique index to `(source_site, article_slug,
  chunk_index)`, add `species_tags TEXT` (JSON array of canonical species ids)
- `src/tools/knowledge/species-tagger.ts` — given chunk text + species
  display-name index, returns `string[]` of canonical species ids mentioned

## 4. Scope discovery

metavgc's sitemap.xml lists every URL with `<priority>` weighting. The
`/guides/` section has 10 articles plus 1 hub (`/guides`). Bilingual mirror
under `/pt/guias/` must be excluded. The hub root must be excluded (it's a
listing page, not an article).

```
scope = {
  url for url in sitemap if url.path.startswith("/guides/")
                          and not url.path.startswith("/pt/")
                          and url.path != "/guides"
}
```

This is simpler than vgcguide's nav∩sitemap intersection — metavgc's sitemap
is canonical and doesn't include junk. Per the
`scope_discovery_via_site_signals` rule: still signal-driven (sitemap is the
site author's enumeration), no hand-curated allowlist.

## 5. Article extraction

Per the live probe, articles use semantic HTML: `<h1>` title, `<h2>`/`<h3>`
section headings, `<hr>` dividers, `<ul>` lists, `<p>` paragraphs. No
SquareSpace `.sqs-html-content` wrapper to fight with. Selector strategy:

- Title: `h1` (first one in `<main>` / `<article>`)
- Body container: `<article>` if present, else the longest `<main>`
  descendant by text length (defensive fallback, mirrors the vgcguide
  longest-container fix)
- Walk: `h2`, `h3`, `h4`, `p`, `li`, `blockquote` — same set as vgcguide
- Skip: `<aside>`, `.toc` (table of contents sidebar), `<nav>`, `<footer>`

Author: `"MetaVGC"` (literal), captured-via: `"site"`.

## 6. Species tagging

Per CLAUDE.md §6, the canonical primitive for "what is this chunk about" is
`subjects.pokemon` on `Insight`. We're not building Insights here (that's a
separate extraction pipeline) — we're tagging *chunks* with a lightweight
index for filter-based retrieval.

Algorithm:

1. Build a case-insensitive map of `display_name` → `species.id` from the
   species table at ingest time (filter by `roster_membership` to Reg M-A
   legal species — irrelevant tags pollute retrieval).
2. For each chunk text, find all display-name matches as whole words
   (regex `\b<name>\b`, case-insensitive). Multi-word names (e.g.,
   `Garchomp-Mega` → `Garchomp Mega`?) need explicit handling: metavgc
   writes `"Mega Garchomp"` in prose, so the matcher must accept both
   `display_name` and a small set of common written forms (mega prefix,
   form-name suffix). Start with display_name + the `species.aliases` JSON
   column populated by the existing roster build.
3. Emit `species_tags: string[]` of canonical ids. Persist as JSON.

Edge cases:

- "Tauros" (base) vs "Tauros-Paldea-Aqua" — match the most specific form
  mentioned. If only "Tauros" appears, tag base only.
- Common nouns that overlap species names ("Mr. Mime" — none in our roster
  short of literal collision; not a Reg M-A concern). Word-boundary regex
  handles most.
- Performance: 286 species × 286 chunks (typical batch) = 80k regex matches,
  acceptable. Pre-compile regexes once per ingest run.

## 7. Data in/out per stage

| Stage | Input | Output |
|---|---|---|
| `discoverScope` | sitemap.xml | `Set<string>` of slugs (10) |
| `fetchArticleHtml` | slug | `{slug, html, article_url, fetched_at}` |
| `extractArticle` | html | `{title, sections: [{heading, paragraphs}]}` |
| `chunk` | extracted article | `Chunk[]` — body-hashed |
| `detectSpeciesTags` | chunk text + species index | `string[]` species ids |
| `embed` | `string[]` chunk texts | `Float32Array[]` 512-dim |
| `upsertKnowledgeChunks` | chunks + vectors + tags | rows persisted |

## 8. Error / empty states

- **404 article** → record in `not_found`, continue.
- **HTML doesn't parse / no body container found** → `parse_failures`,
  continue.
- **Voyage embedding failure (per article)** → `embedding_failures`,
  continue. Auth/storage errors propagate.
- **Empty species index** (DB hasn't been built) → fail loud at ingest start;
  species-tagging is a contract, not a nice-to-have.
- **Skip-existing on body_hash** → second run on unchanged article = zero
  embedding API calls (mirrors VGC-T61).

## 9. Success criteria

- 10 articles ingested end-to-end on cached fixtures with zero network
  failures.
- `pnpm data:ingest:metavgc -- --no-network` is idempotent (second run
  produces zero deltas).
- At least 80% of articles produce ≥1 species_tag (sanity check that the
  tagger is doing something).
- Live retrieval demo: query "how to counter incineroar" returns the
  metavgc Incineroar guide with cosine ≥ 0.5.
- Vector search filtered by `species_id_filter=["incineroar"]` (compiled
  to `JSON_EACH(species_tags) EXISTS …` in the repo) returns the
  Incineroar guide chunks first.
- Existing vgcguide knowledge_chunks remain readable (CHECK + index
  migration is non-destructive to existing rows).

## 10. Out of scope (deferred)

- **Species detail pages** (`/pokemon/<slug>`, 96 of them). They duplicate
  data we already have from labmaus + pikalytics + smogon-calc. Reconsider
  once we've measured retrieval quality from guides alone. Tracked as
  Stage 6 deferred TODO.
- **Insight extraction** (per CLAUDE.md §6). The chunks are the substrate
  Insights will be extracted from later by a Haiku-driven pass.
- **Portuguese mirror** (`/pt/guias/`). User is English-first.
- **Featured teams pages** (`/teams/featured/*`). Structured team data,
  better ingested via labmaus/pokepaste pattern if at all.

## 11. Reviewed-by

Reviewed-by: Rodrigo Caballero
