# Stage 6 Code Review — `pokemon-roster-db`

**Date:** 2026-05-04
**Reviewer:** general-purpose subagent
**Status:** **Resolved (2026-05-04)** — all 27 findings applied (7 🔴 / 15 🟡 / 5 🟢). See "Resolution log" at the end of this file for the per-finding outcome.
**Sign-off:** **Approved.**

---

## Findings

### 🔴 1. `--help` flag exits 64 instead of 0
**File:** `src/cli/tool-roster.ts` (lines 49–57)
**Issue:** `if (!species || flags.has("--help"))` followed by `exitCode: species ? 0 : 64` means `--help` alone (no species) returns exit 64 (usage error) instead of 0.
**Fix:** Branch the two cases: when `flags.has("--help")` return `{ exitCode: 0, ... }`; only when `!species && !flags.has("--help")` return `{ exitCode: 64, ... }`.

### 🔴 2. `parseChampionsSets` is dead code; `sample_sets` will never populate
**File:** `src/data/parseChampionsSets.ts`; `scripts/data/build-reg-m-a.ts`
**Issue:** `parseChampionsSets` is never imported by the build pipeline, and `data/reg-m-a/raw-sets.smogon.json` doesn't exist. Plan flagged "sample_sets currently empty pending SETDEX ingest slice" as intentional, but the parser sits orphaned.
**Fix:** Confirm with user whether SETDEX ingest is part of this slice. If deferred, move parser behind a `TODO(setdex-ingest)` marker and keep tests; if in-scope, wire into `build-reg-m-a.ts` step (4.5) and add `data:refresh:reg-m-a` script per plan §6.

### 🔴 3. `parseChampionsSets` `.strict() + .superRefine` ordering means SPS terminology message never fires
**File:** `src/data/parseChampionsSets.ts` (lines 11–32)
**Issue:** `RawChampionsSetSchema` chains `.strict()` then `.superRefine(...)`. Strict mode rejects unknown keys at the object stage, so the superRefine never runs on a payload with `evs` — user sees the generic "Unrecognized key(s)". The Champions terminology message is the whole point of the guard.
**Fix:** Drop `.strict()` and let superRefine drive rejection (matches `SampleSetSchema`'s `.passthrough() + superRefine` pattern). Tighten the test to require the SPS-message branch (no fallback regex).

### 🔴 4. `InsightStore.search` return type drift between plan and impl
**File:** `src/db/insights.ts` (line 50)
**Issue:** Plan §8 specifies `search(query, opts) → InsightSearchHit[]` (each hit carries a similarity score). Implementation returns `Promise<Insight[]>` — scores are dropped. Locking the wrong v1 shape defeats the "prevent v2 churn" rationale.
**Fix:** Restore `InsightSearchHit { insight: Insight; score: number }` per plan and have `search` return `Promise<InsightSearchHit[]>`. Rename `InsightSearchFilter` back to `InsightSearchOptions` with `limit?: number` per plan.

### 🔴 5. Item category documentation gap
**File:** `src/schemas/item.ts` (line 11)
**Issue:** `ItemCategorySchema`'s `"choice"` enum value covers only Choice Scarf in Reg M-A — Choice Band/Specs do not exist in this format. No TSDoc note.
**Fix:** Add a one-line TSDoc on the schema clarifying single-membership for `"choice"` in Reg M-A.

### 🔴 6. Missing TSDoc on bare schema enum exports
**Files:** `src/schemas/insight.ts` (`ClaimTypeSchema`, `ConfidenceSchema`, `StanceSchema`); `src/schemas/move.ts` (`MoveCategorySchema`); `src/schemas/pokemon.ts` (`TypeSchema`)
**Issue:** CLAUDE.md §10 requires TSDoc on every export. These are bare `z.enum(...)` exports.
**Fix:** Add a one-line TSDoc to each.

### 🔴 7. `sample_sets` schema has no per-stat ≤32 CHECK
**File:** `src/db/drizzle-schema.ts` (lines 109–115)
**Issue:** Schema has CHECK for `sps_total <= 66` but none for the per-stat `<= 32` cap. Integrity test (case 11) re-asserts at read time, but a row violating it could be inserted today.
**Fix:** Add `check("sample_sets_sps_per_stat_le_32", sql\`json_extract(...,'$.hp') <= 32 AND ...\`)` covering all six stats.

---

### 🟡 8. CLI direct-invocation guard precedence is broken
**File:** `src/cli/tool-roster.ts` (lines 110–122)
**Issue:** Mixed `||`/`&&` without parens; lacks unhandled-rejection handling.
**Fix:** `const me = fileURLToPath(import.meta.url); if (process.argv[1] === me) { main(...).then(...).catch(e => { console.error(e); process.exit(1); }); }`.

### 🟡 9. `build-reg-m-a.ts` item-category derivation has fragile heuristics
**File:** `scripts/data/build-reg-m-a.ts` (lines 289–302)
**Issue:** Suffix-string matching ("Plate", "Memory", weather rocks enumerated by literal name, `endsWith("ite") && name !== "Light"`). No test asserts category correctness.
**Fix:** Add a unit test for ~10 known items (Garchompite → mega-stone, Sitrus Berry → berry, Choice Scarf → choice, Heat Rock → weather-rock, etc.). Tighten by using `dexItem.megaStone` truthy first; the `ite` literal-name fallback is unreachable.

### 🟡 10. BFS movepool walker — name and behavior subtly drift
**File:** `scripts/data/build-reg-m-a.ts` (lines 144–180)
**Issue:** `learnsetCache` is a per-species result map, not reused across species; name misleads. Also no coverage test that alternate forms (Mega/Aegislash/Castform/Rotom) inherit non-empty movepools.
**Fix:** Rename to `movepoolBySpecies`. Add coverage assertion for ~5 known alternate forms.

### 🟡 11. Closed-handle behavior weakly tested for items/abilities/moves
**File:** `tests/data/{items,abilities,moves}.test.ts` (case 5 each)
**Issue:** Each only tests `list()` after close. `get()` and `has()` paths in `createSimpleRepo` also wrap errors but no test exercises them after close.
**Fix:** Extend each case 5 to also assert `get(...)` and `has(...)` throw `RosterDbError` after close.

### 🟡 12. `roster.search` verbatim-tiebreaker only partially tested
**File:** `tests/data/roster.test.ts` (case 16)
**Issue:** Verifies `matched_on` for one query per source — but no tied-score scenario where verbatim is the deciding factor.
**Fix:** Add three sub-cases: tied id-vs-display_name, tied id-vs-alias, tied display_name-vs-alias.

### 🟡 13. `parseChampionsSets` test coverage is thin
**File:** `tests/data/sps-evs-translation.test.ts`
**Issue:** Only 3 cases. Missing: sps total >66 ZodError, per-stat >32 ZodError, empty inner-set object, deterministic output ordering.
**Fix:** Add four cases per the gaps.

### 🟡 14. `coverage.test.ts` 7b lacks a tracking marker
**File:** `tests/data/coverage.test.ts` (lines 111–115)
**Issue:** "sample_sets is currently empty" assertion will silently keep passing after SETDEX ingest lands.
**Fix:** Add a `// TODO(setdex-ingest):` comment grep marker, or gate behind `RUN_AFTER_SETDEX_INGEST` env var.

### 🟡 15. `roster.search` whitespace-only / single-char queries untested
**File:** `tests/data/roster.test.ts` (cases 13–16)
**Issue:** No assertion for `search(db, "  ", "RegM-A")` or `search(db, "g", "RegM-A")`.
**Fix:** Add two cases.

### 🟡 16. `tool-roster.test.ts` doesn't test `--help` or empty-DB
**File:** `tests/cli/tool-roster.test.ts`
**Issue:** No coverage for `--help` (would have caught 🔴 #1) or empty-DB scenario.
**Fix:** Add `it("prints usage and exits 0 on --help", ...)` and optionally an empty-DB case.

### 🟡 17. Build pipeline always seeds `aliases: "[]"`
**File:** `scripts/data/build-reg-m-a.ts` (line 195)
**Issue:** Real DB has empty aliases for every species. The whole alias-resolution path is untestable against the real `db.sqlite` — only fixture tests cover it. Plan §3 says aliases are hand-curated but no curation file exists.
**Fix:** Either (a) add `data/reg-m-a/aliases.json` with ≥5 popular nicknames (chomp → garchomp, ttar → tyranitar, etc.), or (b) document explicitly in build script that aliases are deliberately empty in v1 and resolution is fixture-tested only.

### 🟡 18. `SampleSetSchema` missing `schema_version`
**Files:** `src/schemas/sampleSet.ts`
**Issue:** `Item`, `Ability`, `Move`, `Pokemon`, `Insight` all carry `schema_version: literal(1)`. `SampleSet` doesn't. CLAUDE.md §5 requires every persisted record to carry one.
**Fix:** Add `schema_version: z.literal(1)` to `SampleSetSchema` and update fixtures + build pipeline.

### 🟡 19. `roster.has` calls `.all()` but discards array
**File:** `src/db/roster.ts` (line 267)
**Issue:** Materializes full result array for an existence check. Use `.get()` for consistency + tiny perf win.
**Fix:** `if (p.speciesByDisplayName.get({ name: trimmed, format })) return true;`

### 🟡 20. Duplicated 3-step lookup BFS in `roster.get` and `roster.sets`
**File:** `src/db/roster.ts` (lines 218–228 and 429–439)
**Issue:** id → display_name → alias lookup inlined verbatim in both functions. Future tweak applies twice.
**Fix:** Extract a private `findSpeciesRow(db, name, format): SpeciesRow | undefined` helper.

### 🟡 21. Repeated `if (db.$client.open) db.$client.close()` teardown
**Files:** `tests/data/{roster,items,abilities,moves,coverage,integrity,determinism}.test.ts`
**Issue:** Same teardown logic in 7 places.
**Fix:** Add `closeIfOpen(db: Db): void` to `tests/data/fixtures.ts` and import everywhere.

### 🟡 22. `applyMigrations` uses `INSERT OR IGNORE`
**File:** `src/db/open.ts` (lines 80–82)
**Issue:** Silently swallows duplicate-version conflicts. If two migrations share a version (numeric prefix collision), the second is silently skipped without error.
**Fix:** Use plain `INSERT` — duplicates indicate a build bug worth surfacing.

---

### 🟢 23. Migration filename doesn't match plan
**File:** `src/db/migrations/0000_greedy_sugar_man.sql`
**Issue:** Plan calls for `0001_initial.sql`; drizzle-kit auto-generated `0000_greedy_sugar_man.sql`.
**Fix:** Optionally rename to `0000_initial.sql`; or document drizzle-kit convention in plan §19.

### 🟢 24. `ENGINE_SHA` / `FETCHED_AT` are top-level magic strings
**File:** `scripts/data/build-reg-m-a.ts` (lines 32–33)
**Issue:** Hard-coded SHA may drift from `package.json` pin.
**Fix:** Add `// TODO(engine-sha-source): read from lockfile` marker for v2.

### 🟢 25. CLI pretty output drifts slightly from plan §13
**File:** `src/cli/tool-roster.ts` (lines 87–108)
**Issue:** Plan shows `Dex: #445`; impl omits (consistent with dropped `dex_no` field). Surfaced for awareness.
**Fix:** Record deviation in plan §19/§20 if not already.

### 🟢 26. `tool-definitions.ts` magic counts in descriptions
**File:** `src/db/tool-definitions.ts` (lines 105, 134, 163)
**Issue:** "~117 items" / "~211 abilities" will drift after refresh.
**Fix:** Drop counts or replace with "all".

### 🟢 27. `parseChampionsSets` Levenshtein not used; sort claim is fine
**File:** `src/data/parseChampionsSets.ts` (line 101)
**Issue:** TSDoc says "stable iteration order: sorted by `species_id`, then by `set_name`" — `.sort()` defaults to lexicographic order, fine for ASCII.
**Fix:** None.

---

## Summary

| Severity | Count |
|---|---|
| 🔴 Blocker | 7 |
| 🟡 Refactor | 15 |
| 🟢 Nit | 5 |

**Sign-off:** **block — fix all 🔴 first.** Two of the seven (#2 parseChampionsSets dead code, #4 InsightStore.search return type) deserve immediate clarification with the user — the parser may simply be deferred work to remove from this slice, and the search return type is a plan-vs-impl drift that should be reconciled before locking the v1 stub. The other five are small, mechanical fixes.

## Strengths worth keeping

- **`createSimpleRepo` factory** is exactly the right level of abstraction — three repos (items/abilities/moves) became ~25-line files with full TSDoc, the `WeakMap` cache and `parseOrThrow` boundary are reused, and bespoke logic (roster's id+name+alias resolution, sets' assembly) was correctly left out of the factory.
- **Split-per-entity schema layout** makes grep-driven maintenance trivial.
- **Error class hierarchy** mirrors `damage-calc` cleanly (`RosterError` → `RosterNotFoundError`/`RosterDataError`/`RosterDbError`).
- **Tests against the real built `db.sqlite`** (coverage + integrity + determinism) are an excellent defense-in-depth pattern beyond the in-memory fixture tests.
- **Determinism test is meaningfully strict** (byte-equal SHA-256, not just row counts).
- **Build pipeline's BFS** through both `@smogon/calc` and `@pkmn/dex` baseSpecies chains is a thoughtful solution to the alternate-form learnset problem.
- **SPS-vs-EVs terminology gating** is enforced at three layers (zod schema, parser, mapping test) — exactly the redundancy CLAUDE.md §4 wants.

---

## Resolution log (2026-05-04)

All 27 findings applied. Final test state: ~180 functional tests green, 2 contract tests skipped (run via `pnpm test:contract`), 6 unchanged failing tests in `tests/tools/damage-calc/golden.test.ts` are pre-existing UNVERIFIED fixture placeholders from the damage-calc tool's slice 8 (NOT part of this feature). `pnpm typecheck` clean.

**🔴 Blockers — all fixed:**
1. CLI `--help` exits 0; usage on stderr only when no positional & no `--help`.
2. `parseChampionsSets` wired into `build-reg-m-a.ts`; SETDEX fetcher added at `scripts/data/fetchers/smogon-champions-sets.ts`; snapshot at `data/reg-m-a/raw-sets.smogon.json`; `pnpm data:refresh:reg-m-a` script. **634 sample sets ingested** (645 upstream − 11 malformed Ditto entries).
3. Parser uses `.passthrough() + superRefine`; legacy-key check moved before zod parse so the SPS terminology message fires.
4. `InsightStore.search → InsightSearchHit[]` per plan; `InsightSearchOptions { filter, limit }` restored.
5. `ItemCategorySchema` TSDoc notes `"choice"` is single-membership in Reg M-A.
6. TSDoc added to `ClaimTypeSchema`/`ConfidenceSchema`/`StanceSchema`/`MoveCategorySchema`/`TypeSchema`.
7. Per-stat ≤32 CHECK added to `sample_sets`; migration regenerated.

**🟡 Refactors — all applied:**
8. CLI direct-invocation guard rewritten with proper precedence + catch.
9. `integrity.test.ts` 12b: 8 known-item category assertions (Mega Stones, berries, Choice Scarf, Leftovers, Light Ball).
10. `learnsetCache → movepoolBySpecies`; `coverage.test.ts` 4b asserts 5 alternate forms (Mega/Aegislash/Castform/Rotom) inherit non-empty movepools.
11. items/abilities/moves test 5 covers `get` + `has` after close.
12. `roster.test.ts` 16b: 3-way verbatim-tiebreaker assertions.
13. parser tests grew 3 → 7 (added: total > 66, per-stat > 32, empty inner, deterministic ordering).
14. `coverage.test.ts` 7b updated to `sample_sets > 500` (real ingest landed).
15. `roster.test.ts` 14b/15b: single-char + whitespace-only queries.
16. `tool-roster.test.ts` 6/7/8: `--help`, no-positional, empty-DB.
17. `data/reg-m-a/aliases.json` with 7 hand-curated nicknames; build pipeline merges them into `species.aliases`.
18. `SampleSetSchema` carries `schema_version: literal(1)`; assembler/parser inject it.
19. `roster.has` uses `.get()` (not `.all()`).
20. `findSpeciesRow` private helper extracted; used by `get` and `sets`.
21. `closeIfOpen(db)` helper in `fixtures.ts`; 7 test files migrated.
22. `applyMigrations` uses plain `INSERT` (not OR IGNORE).

**🟢 Nits — all applied (or deliberately retained with rationale):**
23. Migration filename — left as drizzle-kit's auto-generated `0000_square_meltdown.sql` (the convention; renaming would fight the tool).
24. `ENGINE_SHA` TODO marker added — read from lockfile in v2.
25. CLI pretty-output drift — already aligned with the `dex_no` removal decision.
26. Magic counts dropped from `items_list` / `abilities_list` / `moves_list` descriptions.
27. `parseChampionsSets` sort claim verified — no change needed.

**Sign-off:** Approved by Rodrigo Caballero, 2026-05-04.
