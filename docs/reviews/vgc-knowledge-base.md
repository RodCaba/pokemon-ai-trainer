# Stage 6 Code Review — vgc-knowledge-base

**Branch:** feat/vgc-knowledge-base
**Commits reviewed:** 42fcbe4 (docs), de0e8b1 (test: red — VGC-T1–T64), 01ff59a (feat: green)
**Reviewer:** Stage 6 reviewer subagent
**Date:** 2026-05-08

## 1. Summary

Ship-after-blockers. The slice is the first activation of the vector tier and lands cleanly in most respects: `knowledgeSearchTool` is registered in `ROSTER_TOOL_DEFINITIONS` from day one (preempts the pokepaste BLOCKER), the relational + vec0 sidecar is wired through `open()` with a clear `SKIP_SQLITE_VEC=1` escape hatch, the embed-client retry/backoff/auth matrix matches the labmaus precedent, the bespoke knowledge repo correctly cascade-deletes vec0 + relational rows on `body_hash` mismatch in a single transaction, and reuse of `_shared/{throttle,file-cache}` is genuine (fourth consumer). TSDoc discipline is strong on every export.

The structural problems are: (a) **`SPEC.md` is still a Stage-4 placeholder** despite plan §4.2 + CLAUDE.md §8 mandating it as written-first; (b) **module-level mutable state in `scripts/data/ingest-vgcguide.ts`** (`ingestHashCache` + `lastMainUpserted`) is a smell that papers over a real test-design defect, not a production need; (c) **`distance_metric=cosine` was retroactively added to `0007_knowledge_vec0.sql` at green** — the red migration shipped with the L2 default, which is a Stage 4 oversight that VGC-T46 only happened to catch because the seeded vectors were normalized for cosine; and (d) plan §19 has no Stage 6 deviations footer recording the cheerio/cosine/process-cache decisions.

## 2. Blockers

1. **`src/tools/vgcguide/SPEC.md:1-15` is a Stage-4 placeholder.** Plan §4.2 enumerates seven mandatory sections (Inputs/outputs, Endpoint contract, Edge cases, Errors, Reg M-A hygiene, Cache+throttle, Out-of-scope) plus a verbatim container-class contract (`.sqs-html-content`) that is the load-bearing extractor invariant. The current file says `TODO(stage5)` followed by 10 placeholder bullets. CLAUDE.md §8 ("Adding a new tool — Open a `tools/<source>/SPEC.md` first") makes this a process violation; it is the same MAJOR-finding pattern that the pokepaste review already raised. Anchor: plan §4.2; CLAUDE.md §8 sub-bullet; risk-mitigation §16 row 2 explicitly says "SPEC.md documents the container-class contract verbatim" — needed for the live contract test (VGC-T63) to be auditable. Fix: write the seven sections per plan §4.2.

## 3. Major findings

2. **Stage 4 migration shipped without `distance_metric=cosine` (`src/db/migrations/0007_knowledge_vec0.sql` at de0e8b1 → 01ff59a).** The red commit declared `vec0(embedding float[1024])` (L2 default); the green commit silently added `distance_metric=cosine`. VGC-T46 happened to pass *for both* because the seeded vectors are unit-normalized (cosine ≈ L2 on unit vectors after monotonic transform), but the production cosine_score path in `src/db/knowledge.ts:255-257` (`cosine_score = clamp(1 - distance, -1, 1)`) is only correct when the metric is cosine — under L2 default, `distance` is squared-Euclidean and `1 - distance` is mathematically meaningless. Two consequences: (a) the red commit was vacuously green at the migration level — Stage 4 should have either pinned cosine OR shipped a test that asserted L2 distance semantics; (b) plan §5.2 / §17 nowhere specifies the metric, so the green-time fix has no plan anchor. CLAUDE.md §3 last paragraph + plan §10 footer must record this. Anchor: plan §5.2 (migration body), §10 (test list), §19 (deviations — currently absent). Fix: (i) add to plan §5.2 "vec0 metric: `distance_metric=cosine` — required for the `1 - distance` cosine_score mapping in `knowledge.ts::search`"; (ii) add plan §19 deviation entry; (iii) optionally land an explicit test that asserts cosine-metric semantics directly (not via a fixture that's coincidentally compatible with L2).

3. **Process-level shared state in `scripts/data/ingest-vgcguide.ts:63-64, 200-210, 301-305`.** `ingestHashCache: Map<dbPath, Map<slug, hash>>` + `lastMainUpserted: boolean` are module-level mutables that exist solely to bridge VGC-T61's contract (skip-existing on `:memory:` across two `main()` calls) with VGC-T59/T60's contract (a fresh DB per call must surface `KnowledgeAuthError` / `KnowledgeStorageError` regardless of cache). The cache is invalidated when "the previous run did not upsert" — but `:memory:` DB handles are per-call, so the cache and the persisted `articleBodyHash(db, slug)` are reading two different stores. The hack works in tests but in production it is dead code (every cron invocation is a separate process; `ingestHashCache` is always empty), and worse, it would mask a legitimate bug if a future invariant ever ran two `main()` calls in one process against a real file DB and the persisted hash diverged from the in-process cache. Root cause: VGC-T61 conflates "skip-existing on body_hash" (a DB invariant) with "two-`main()`-calls share `:memory:`" (an artificial test scaffold; `:memory:` is per-handle). Anchor: CLAUDE.md §3 ("If you are about to write production code without a red test, stop"); the production code here serves no production caller. Fix options, in order of cleanliness: (i) rewrite VGC-T61 to share a *file* DB across two `main()` calls (already what VGC-T62 does correctly — see `tests/scripts/ingest-vgcguide-idempotency.test.ts:59-83`), then delete the module-level cache entirely; (ii) inject a callable hash-cache via `MainDeps` so production stays cache-free and the test scaffolding is explicit. Recommend (i); it's strictly less code and makes the cron's actual behavior the path under test.

4. **VGC-T55–T58 assert only `expect(exit).toBe(0)` without inspecting the run-summary contents (`tests/scripts/ingest-vgcguide.test.ts:86-126`).** T56 ("logs not_found"), T57 ("logs parse_failures"), T58 ("logs embedding_failures") all share the same body — set up the failure mode, run, assert exit 0. None reads `summary.not_found`, `summary.parse_failures`, or `summary.embedding_failures`. The contract is "logs ___" but nothing is asserted about the log. The current implementation populates the arrays correctly; the tests would pass equally if the script silently swallowed the errors. Anchor: CLAUDE.md §3 ("test fails because the *behavior* is missing"); plan §10 T56/T57/T58 description. Fix: capture stdout, parse the JSON-line summary, assert the failure arrays contain the expected slug.

5. **`src/tools/vgcguide/extract-article.ts:127-156` walks an unbounded recursive tree but only flushes h2/h3 partitions at the top level of the recursion.** The walker descends into wrapper `div`s and recurses into their children — but if an h2 lives inside a wrapper div (`<div><h2>…</h2><p>…</p></div>`), the walk will *enter* the wrapper, see the h2, flush, and start a new section — correct. However, the next sibling `<p>` outside that wrapper but back at the top level would belong to the new section only if `current` is preserved across the recursion, which it is (closure variable). So the algorithm is correct for the common case. The risk is the `as unknown as never` type cast on cheerio elements (`:133, :139`) — this defeats type checking entirely on the cheerio call, which is the single most fragile line in the extractor. CLAUDE.md §10 requires `any` justification comments; `as unknown as never` deserves the same. Anchor: CLAUDE.md §10 ("No `any` without an inline justification comment"). Fix: type the closures via cheerio's `Element` import (`type Element = cheerio.Element`) or document the cast.

6. **`src/db/migrations/0006_knowledge_chunks.sql` lacks a CHECK constraint binding `id` to `vgcguide:<slug>:<index>`.** The zod schema enforces it (`KnowledgeChunkSchema.id` regex), but the DB layer trusts the application. The labmaus / pokepaste / pikalytics precedents enforce id format at the DB CHECK level (`CONSTRAINT … GLOB 'labmaus:*'`). With sqlite-vec rowids and `embedding_ref = "knowledge_chunk_embeddings:<rowid>"` becoming load-bearing for cascade deletes, an out-of-band `INSERT` with a malformed `embedding_ref` would silently leak vec0 rows. Plan §5.1 sketches the schema but doesn't specify the CHECK; the migration as shipped doesn't have one. MAJOR because vec0 leaks are silent. Fix: add `CONSTRAINT "knowledge_id_format" CHECK("id" GLOB 'vgcguide:*')` and `CONSTRAINT "knowledge_embedding_ref_format" CHECK("embedding_ref" GLOB 'knowledge_chunk_embeddings:*')`.

7. **`scripts/data/ingest-vgcguide.ts:127-134` re-derives `article_section` from the slug via `BATTLING_HINTS` / `TEAMBUILDING_HINTS` keyword lists, duplicated in `src/tools/vgcguide/extract-article.ts:37-65`.** Two copies of the same heuristic with the same magic-string constants. They drift independently. Plan §2.2 says `article_section` discrimination is "by URL prefix (sitemap groups `/intro/*` vs `/teambuilding/*` vs `/battling/*`)" — the actual sitemap (committed at `fixtures/vgcguide/2026-05-06__sitemap.xml`) does NOT prefix article URLs by section; everything is at root (`https://www.vgcguide.com/<slug>`). So the slug-keyword heuristic is the only signal we have; the plan is wrong about URL prefixes. Either way the duplication is real. Fix: extract `inferSectionFromSlug` into a single shared module (e.g. `src/tools/vgcguide/section.ts`) and import in both call sites.

## 4. Minor findings

8. **`scripts/vgc-knowledge-demo.ts:38` opens the DB read-only but `open()` still runs `applyMigrations` for non-readonly mode only — and the demo is read-only, so migrations are skipped. Good. But the demo doesn't validate that `knowledge_chunks` is non-empty before issuing five Voyage embed calls (`:48-67`). On a fresh DB the demo silently spends 5 query embeddings to print "(no hits)" five times.** Fix: short-circuit when `knowledge.list(db, { limit: 1 }).length === 0` with a clear "DB is empty — run `pnpm data:ingest:vgcguide` first" message.

9. **`src/db/knowledge.ts:225-237` over-fetches `Math.max(args.k * 4, args.k + 16)` to compensate for post-vec filtering — but the lower bound `args.k + 16` can exceed `count.c` and is silently capped at `count.c`. Reasonable. However, when both `exclude_subtypes` and `article_section_filter` are aggressive (e.g. exclude battle-replay AND restrict to `intro` only), 4× over-fetch may not be enough at corpus scale (~1000 chunks).** Today's corpus has only 3 battle-replay chunks (a few % of total) so 4× is fine; flag for the day the corpus grows. Anchor: plan §6 §6.3 ("over-fetches a bounded multiple of `k`"). Fix: document the assumption in the function TSDoc; add a comment when battle-replay corpus density grows past ~25%.

10. **`src/tools/knowledge/embed.ts:125-127` returns `KnowledgeEmbeddingError(\`Voyage embed failed: HTTP ${lastStatus}\`)` on the non-retryable 4xx-other-than-429/auth path WITHOUT including the response body.** Voyage 4xx responses include `{"detail":"…"}` describing why (validation error, model-not-found, etc.). Operator debugging is harder without the body. Fix: `await res.text()` on the error branch and embed in the error message (truncated to 200 chars).

11. **`src/db/knowledge.ts:106-113`'s `vectorToBuffer` assumes `Float32Array` byteOffset alignment; if a caller passes a sliced view from a larger buffer (e.g. `allFloats.slice(...)` in `tests/db/knowledge.test.ts:57`), the `Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)` reads from the underlying buffer at the right offset, but the test seeded fixture's slices already work because `slice` copies. Worth a TSDoc note that the function takes ownership of the byte range.** NIT-tipped-MINOR.

12. **`src/tools/vgcguide/chunk.ts:117-119` re-encodes every emitted chunk to compute `chunk_token_count` (already known from the splitter's slice length).** Wasted work on every article; not perf-critical at 53 articles but redundant. Pass token-count through alongside the decoded text. NIT.

13. **`src/db/sqlite-vec.ts:13` imports `* as sqliteVec from "sqlite-vec"`. The package's `load(db)` function is the only call site, but the namespace import drags whatever else the package exports.** Cosmetic; `import { load } from "sqlite-vec"` is cleaner. NIT/MINOR.

14. **`src/tools/vgcguide/sitemap.ts:6` regex `<loc>\s*([^<\s][^<]*?)\s*<\/loc>` is permissive enough to match `<loc>` inside CDATA or comments.** The real vgcguide sitemap is well-formed; defensive comment would help. NIT.

15. **`scripts/data/ingest-vgcguide.ts:300` writes the run summary via `process.stdout.write(JSON.stringify(summary) + "\n")` but per-article progress is documented (plan §13.5) to go to stderr — there is no per-article log emitted today.** Minor observability gap; the cron operator only sees the final summary. Fix: add a stderr line per article (`[ingest-vgcguide] ${slug} ${result_kind}`).

16. **`src/tools/vgcguide/tag-subtype.ts:11-15`'s hardcoded slug list — verified against the sitemap fixture (`fixtures/vgcguide/2026-05-06__sitemap.xml`): exactly three slugs match `/^battling-example/`. Match.** No finding; just confirmation.

## 5. Nits

17. **`src/db/knowledge.ts:194-206` TSDoc says "exclude_subtypes and article_section_filter are applied post-vec" — should also note that at high subtype-density this can leave hits.length < k.** Minor wording.

18. **`scripts/data/ingest-vgcguide.ts:303-309` `try/catch` rethrows everything but the `KnowledgeAuthError`/`KnowledgeStorageError` branches just `throw e` directly — the conditional is dead.** Cosmetic; collapse to a single `throw e`.

19. **`src/schemas/knowledge.ts:114` TSDoc says "Reg M-A literal not required because the vgcguide corpus is format-agnostic principle content"** — but every other tool in `tool-definitions.ts` requires `format: "RegM-A"` as a forward-compat seam. Inconsistency worth a short justification comment in `KnowledgeSearchToolInput` itself, not just the schema.

20. **`tests/db/knowledge-no-tera.test.ts:54` greps for `/tera/i` against every string column — but the corpus has zero Tera content (per flow §2 baseline), so the test is vacuous (positive case never exercised). Disclosed in commit body — confirmed defensible per CLAUDE.md §3 last paragraph as a regression guard.** Recorded for §6.

## 6. TDD audit

- **42fcbe4 (docs)** — Stages 1/2/3 artifacts. Clean.
- **de0e8b1 (test: red — VGC-T1–T64)** — adds 64 failing tests + module stubs. §3 pure-data exemption disclosed in commit body for `src/schemas/knowledge.ts`; VGC-T36/T37 deviation also disclosed (sqlite-vec must wire in `open()` for the 364 pre-existing tests). VGC-T50 vacuous-green slip disclosed. Discipline: clean disclosure pattern, mirrors the labmaus/pokepaste precedents.
- **01ff59a (feat: green)** — implements bodies. **One undisclosed Stage 4 deviation (Major 2 above):** `0007_knowledge_vec0.sql` shipped at red without `distance_metric=cosine` and was retroactively patched at green. This is a test-time silent fix; should have been a separate `test+fix:` commit that demonstrates VGC-T46 fails under L2 metric to make the regression explicit. CLAUDE.md §3 ("fails for the right reason") was not honored at the migration level — the test passed coincidentally because seeded vectors are unit-normalized.

**Per-test trace (VGC-T1–T64) vs plan §10:**
- VGC-T1–T5 (schema): pass under §3 exemption.
- VGC-T6–T11 (extractor): present, real fixture-based assertions.
- VGC-T12–T17 (chunker): present.
- VGC-T18–T19 (subtype): present.
- VGC-T20–T29 (client + sitemap): present.
- VGC-T30–T35 (embed): present, real status-code branches asserted.
- VGC-T36–T37 (sqlite-vec bootstrap): present; T36 disclosed as Stage 4 green.
- VGC-T38–T49 (repo + search): present; VGC-T46 is real-but-coincident on metric (Major 2).
- VGC-T50 (no-tera): vacuous-green; disclosed.
- VGC-T51–T52 (tool registration): present.
- VGC-T53–T54 (tool/search wrapper): present.
- VGC-T55–T58 (ingest happy + failure modes): **weak — only assert exit 0** (Major 4).
- VGC-T59–T60 (auth/storage fail-loud): present.
- VGC-T61–T62 (skip-existing): present; VGC-T61 forces the process-state hack (Major 3).
- VGC-T63–T64 (live contract): present, gated.

**Vacuous-green slips:** VGC-T50 (disclosed), VGC-T36 (disclosed), VGC-T46 partial (Major 2 — undisclosed), VGC-T56–T58 (Major 4 — undisclosed).

## 7. Plan reconciliation

Deviations not yet documented in `docs/plans/vgc-knowledge-base.md`. Add as `## 19. Stage 6 deviations`:

| # | Deviation | Where it lives now | Action |
|---|---|---|---|
| a | `distance_metric=cosine` on the vec0 virtual table — added at green, plan §5.2 silent | `src/db/migrations/0007_knowledge_vec0.sql:7` | Patch plan §5.2 to specify cosine; add Stage 4 oversight note. |
| b | Process-level `ingestHashCache` + `lastMainUpserted` to bridge VGC-T61 vs VGC-T59/T60 | `scripts/data/ingest-vgcguide.ts:63-64, 200-210, 301-305` | Either delete (Major 3 fix) and rewrite VGC-T61 against a file DB, or amend plan §13 to document the hack with rationale. Recommend delete. |
| c | `article_section` is inferred from slug keywords, not URL prefix as plan §2.2 claims | `src/tools/vgcguide/extract-article.ts:37-65` + `scripts/data/ingest-vgcguide.ts:108-134` | Patch plan §2.2 to drop the URL-prefix claim; document the keyword heuristic; consolidate to a single helper. |
| d | DB-level CHECK constraints on `id` and `embedding_ref` formats not specified in plan §5.1; not in migration either | `src/db/migrations/0006_knowledge_chunks.sql` | Either ship the CHECKs (Major 6) and patch §5.1, or amend §5.1 to defer to zod-only. Recommend ship. |
| e | VGC-T50 vacuous-green disclosure | already in de0e8b1 commit body | Mirror into plan §10 footer for permanence. |
| f | VGC-T46 metric coincidence | not disclosed | Add to plan §10 footer + §19. |
| g | VGC-T55–T58 weak assertions | tests assert `exit === 0` only | Either strengthen tests (Major 4) and patch §10 T56–T58 expectations, or document the limitation. Recommend strengthen. |
| h | SPEC.md placeholder | `src/tools/vgcguide/SPEC.md` | Write the seven sections per plan §4.2. |
| i | Demo script does not pre-check non-empty corpus | `scripts/vgc-knowledge-demo.ts` | Document or fix (Minor 8). |

## 8. Suggested refactor batch

Ordered by impact-to-effort:

1. **Write `src/tools/vgcguide/SPEC.md`** per plan §4.2. **Blocker 1.**
2. **Strengthen VGC-T55–T58** to assert run-summary contents (capture stdout, parse JSON, assert failure arrays). **Major 4.**
3. **Add CHECK constraints** on `id` + `embedding_ref` formats in `0006_knowledge_chunks.sql` (or as a `0008_*.sql` patch migration to keep `0006` immutable). **Major 6.**
4. **Delete the process-level `ingestHashCache`** and rewrite VGC-T61 to share a file-DB across two `main()` calls (mirror VGC-T62's pattern). **Major 3.** ~30 lines net deletion.
5. **Patch plan §19** — add Stage 6 deviations table covering rows a–i. **Plan reconciliation.**
6. **Consolidate slug-keyword `article_section` inference** into a single `src/tools/vgcguide/section.ts` helper consumed by both `extract-article.ts` and `ingest-vgcguide.ts`. **Major 7.**
7. **Type the cheerio walker closures** (replace `as unknown as never` with proper cheerio types). **Major 5.**
8. **Demo empty-DB short-circuit** to avoid wasting Voyage queries. **Minor 8.**
9. **Embed-error response body** captured in `KnowledgeEmbeddingError` message. **Minor 10.**
10. **Per-article stderr progress logging** in `ingest-vgcguide.ts`. **Minor 15.**
11. **Patch flow doc** to record the `embedding_ref` linkage decision (flow §6 last open question called this out — verify the flow's resolution paragraph landed).

## 9. Items to defer

- **Larger over-fetch multiplier as corpus grows** (Minor 9) — premature; revisit when corpus > 5K chunks.
- **`Buffer.from` byteOffset TSDoc note** (Minor 11) — cosmetic.
- **`chunk.ts` token-count re-encode optimization** (Minor 12) — perf, not correctness; defer.
- **`sqlite-vec` named import** (Minor 13) — cosmetic.
- **Sitemap regex CDATA hardening** (Minor 14) — defer; vgcguide's sitemap is stable.
- **Reg M-A `format` literal in `knowledgeSearch` input** (Minor 19) — flow §6 deliberately omitted it; revisit if multi-format ever lands.
