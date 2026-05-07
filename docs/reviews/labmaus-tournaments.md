# Stage 6 Code Review — labmaus-tournaments

**Branch:** feat/labmaus-tournaments
**Commits reviewed:** f0a5ca9, b03a41e, 6876d3a
**Reviewer:** Stage 6 reviewer subagent
**Date:** 2026-05-04

## 1. Summary

Ship-after-blockers. The slice is large but cohesive: schemas, tools, repo, ingest, and ~40 tests all land in three commits. Reg M-A hygiene is well-anchored (two-layer Tera strip + property test + grep-clean), TSDoc discipline is generally good, and the Drizzle schema is on-pattern. **However, T20 was modified after the green commit to introduce a test-only `nextAllowedAt()` member on the production `LabmausClient` interface — a TDD-discipline violation that pollutes the agent-facing tool surface.** Several plan deviations also live only in commit messages (`team_names` CSV, `UsageArgsSchema.kind` added, `tournaments.detail` shipped) and need to be reflected in `docs/plans/labmaus-tournaments.md`. Plan §17-Q1 promised four `usage` dimensions on day one; only `species` and `core` actually run, and `item`/`move` silently return `[]` — the plan must either be amended or the implementation completed.

## 2. Blockers

1. **`LabmausClient.nextAllowedAt()` is test-only state on a production-agent interface (`src/tools/labmaus/client.ts:75-85`).** The 6876d3a commit message itself describes it as "test-only introspection." The interface is used as the *agent-facing* abstraction (`labmaus.listTournaments` / `labmaus.getTournament` take it as `deps`), and the JSDoc admits "production callers must not branch on this." That is a smell that the test was wrong, not the production surface. Either (a) move the introspection to a private symbol on the implementation that the test casts to (and keep `LabmausClient` clean), or (b) make T20 measure observable behaviour — assert that `setTimeout` was called with ≥ ~1000ms across three calls (use `vi.useFakeTimers()` instead of injecting `clock`). Anchor: CLAUDE.md §8 ("pure function signature; no hidden globals") + §10 (export surface should describe domain semantics, not test plumbing). MAJOR-tipped-to-BLOCKER because every downstream stub (`get-tournament.test.ts:34`, `list-tournaments.test.ts:27`) now has a vestigial `nextAllowedAt: () => 0` line forever.

2. **`tournaments.usage(kind: "item"|"move")` silently returns `[]` (`src/db/tournaments.ts:275-279`).** Plan §17-Q1 was explicitly **resolved** to ship all four dimensions on day one because pokepaste-sets is parallel; flow §1.1 cites items+moves as the meta-intelligence headline. T34a/T34b assert `Array.isArray(rows)` and pass vacuously on `[]`. This is twin to the T35 vacuous-green slip but undocumented in the change report. Either restore the dependency (read `team_sets` lazily — null-safe if the table is absent) or commit a plan-amendment that re-defers items/moves with reviewer sign-off. Anchor: plan §6, §10 T34a/b, §17-Q1; CLAUDE.md §3 last paragraph (vacuous-green disclosure).

## 3. Major findings

3. **TDD ordering violation in red commit (`f0a5ca9`).** The "red" commit ships substantial production code disguised as stubs: `tournaments.ts` 131 lines of TSDoc'd signatures, `client.ts` 78-line factory, `species-map.ts` 78-line interface graph, schema file `tournament.ts` 279 lines, drizzle schema additions 88 lines, migration `0001_*.sql`. CLAUDE.md §3 allows "scaffold the module signature" but explicitly forbids using stubs to ship behaviour. The schema file in particular is mostly final and should have been the first per-test commit (it qualifies for §3's pure-data exemption, but only with a flagged disclosure — none was written). Recommend the plan/process doc record this as a one-shot batch under the §3 pragmatic exemption and call it out in the change report. Anchor: CLAUDE.md §3 ("failing for the right reason").

4. **`tournaments.list` has dead code and inconsistent SQL composition (`src/db/tournaments.ts:119-153`).** Builds a `clauses` array with `eq()` / `sql` Drizzle expressions and immediately `void clauses` it, then composes raw SQL via string concatenation with `?` placeholders. Either use Drizzle's query builder (`.select().from(tournaments).where(and(...clauses))`) — which is the convention everywhere else in this file (`upsertTournament` uses `db.insert(...).onConflictDoUpdate(...)`) — or delete the unused `clauses` array. The current shape is also a minor SQL-injection risk vector for future contributors who might add a non-parameterised filter. Anchor: memory `db_orm_drizzle.md` ("`db.$client` is the raw escape hatch" — should be exception, not rule); plan §6.1 specifies "Drizzle's `and(...optional)`".

5. **`tournaments.ts` repo grew to 478 lines and mixes Drizzle + raw `db.$client.prepare`.** Some queries use `db.insert(...)` (upsert), others use `db.$client.prepare(raw SQL)` (list/get/detail/teams_with/usage/recompute). Per `db_orm_drizzle.md`, `db.$client` is the escape hatch — not the default. Justify per-query why each escapes (likely: `BETWEEN`, `json_each`, `IS NULL` ordering in SQLite). Add a one-line comment at each raw-SQL site or unify on Drizzle. MAJOR because future maintainers can't tell which mode is canonical. Anchor: memory `db_orm_drizzle.md`.

6. **Plan deviations not reflected in `docs/plans/labmaus-tournaments.md` (CLAUDE.md §2 "plan is the source of truth"):**
   - `team_names` in `LabmausRawTeamSchema` is a CSV string, not the planned `z.array(...).length(6)` (schema lines 35-46). Commented in `fixtures/labmaus/README.md` and `SPEC.md` but plan §3 still says array.
   - `UsageArgsSchema.kind` field added (`src/schemas/tournament.ts:218`); plan §3 sketch omits it. Without `kind`, `usage()` cannot disambiguate dimensions; this is a real plan gap.
   - `tournaments.detail()` shipped (resolves §17-Q3) but plan §6.1 table not updated.
   - `LabmausClient.nextAllowedAt()` (per finding 1) — not in plan §4.
   - `idColumn === displayNameColumn` documented inline at `species-alias-labmaus.ts:33` but plan §6.2 needs a sentence acknowledging the dead-branch trade-off survived review.
   Anchor: CLAUDE.md §2 Stage 6 ("plan is the source of truth").

7. **`labmausIdToRosterId` ignores `displayName` despite being a documented heuristic seam (`src/tools/labmaus/species-map.ts:55`).** The function takes `displayName: string | null` and immediately `void displayName`s it. Per plan §2.4 the literal `"Basculegion ♂"` was the canonical use case for this parameter. T13 passes only because dex id `902` is in the alias seed, not because the display-name path works. Either (a) drop the parameter (and update plan §2.4 + transform.ts), or (b) implement the documented fallback when id-lookup misses. Anchor: CLAUDE.md §10 ("describe the meaning, not the syntax" — the doc currently lies).

8. **`scripts/data/ingest-labmaus.ts:124-127` — `void aliasRepo; void speciesTable; void sql;` orphans.** Three imports kept alive by `void` only. They're unused. Delete the imports and the `void` lines. MAJOR because reviewer-checklist explicitly mentions "dead code" and these are unambiguous. Anchor: CLAUDE.md §10.

9. **`--no-network` mode silently swallows `getTournament` failures (`scripts/data/ingest-labmaus.ts:198-201`).** `if (parsed.noNetwork) continue;` means an unknown-species error inside transform during a fixture replay is silently dropped, defeating the "fails loud on unknown species" contract from flow §4. Tests T36/T37 currently pass because the fake `fakeFetchEmpty` returns `[]` — there are no real fixture-driven loops. Recommend (a) propagate `LabmausUnknownSpeciesError`/`LabmausSchemaError` even in offline mode, only swallow `LabmausNetworkError`-cache-miss; or (b) add a `--strict-offline` test that materializes a fixture into the cache and runs through the full loop. Plan §13 promised exit-1 on unknown species. Anchor: flow §4 + plan §13 (exit-code matrix).

10. **`fakeFetchEmpty` is faking the network layer instead of seeding the cache (`scripts/data/ingest-labmaus.ts:129-131`).** This is the Stage-5 self-flagged risk #4 — explicitly called out as a smell. The intent of `--no-network` per plan §13 is "replays cache only." The current implementation makes T36/T37 vacuous: they assert `exit === 0` against a script that returns 0 because the listing is empty. Recommend pre-seeding `data/cache/labmaus/` with a fixture-derived listing + tournament cache and exercising the actual replay path — that's the difference between proving idempotency and asserting `0 === 0`. Anchor: plan §13, plan §10 T36/T37, CLAUDE.md §3 (no vacuous-green).

11. **`createSimpleRepo` use is correct but `displayNameColumn: table.id` is a workaround, not a feature (`src/db/species-alias-labmaus.ts:30-33`).** The factory hardcodes a dual-lookup contract; this slice doesn't need it. Better: extend `createSimpleRepo` to accept `displayNameColumn?: ColumnDef` (optional) and skip the second prepared statement when omitted. Defer this if it bloats `simple-repo.ts`, but the comment "harmless dead code on miss" is glossing over a real cost: the factory prepares an extra statement per Db. MINOR-bordering-MAJOR because §10 mandates the factory and the workaround invites future copy-paste. Anchor: CLAUDE.md §10 ("createSimpleRepo factory is the single source of truth"). MINOR if deferred with a tracked TODO.

## 4. Minor findings

12. **`src/schemas/tournament.ts:81` `transform` return type is `typeof raw` but actually mutates keys.** Type cast `as typeof raw` lies — output may not have `tera_types`. Functionally correct (raw schema doesn't declare it) but worth a one-liner type comment.

13. **`tournaments.list` ordering is not deterministic for ties on `date` because `id` sort is lexical on `"labmaus:N"` (string compare).** `"labmaus:9"` > `"labmaus:10"` lexically. Either use `ORDER BY date DESC, external_id ASC` or document. T31 doesn't test ties, so it passes.

14. **`tournaments.usage(kind="core")` returns 2-mon cores only.** Flow §1.1 says "2/3/4-mon cores". Plan §6 also restricts to 2-mon. Inconsistency between flow and plan; plan wins (per §2 Stage 6) but worth a future-work note in the plan.

15. **`fixtures/labmaus/README.md` exists (per stat output) but isn't shown** — confirm it documents the `team_names` CSV deviation and the four fixture filenames.

16. **`tournaments.recomputeAggregatesForTournament` `citations: [tournamentId]` (`tournaments.ts:467`)** is a single tournament id wrapped in an array; semantically fine, but the `usage()` species/core paths return `citations: []` (lines 312, 336). Inconsistent. Either populate citations in `usage()` from the underlying `tournaments` rows or document the asymmetry.

17. **Drizzle CHECK constraint mismatch with plan §5.** `tournaments_format_regma` pins `format = 'RegM-A'`, but the `format` column type is `text`, no length. Fine; harmless. Note for future Reg M-B: this CHECK will reject the next regulation. Plan §5 sketched the same; consistent. NIT.

18. **`LabmausClient` `getTournament` accepts `language?: "en"` but no test exercises any other value, and the live API supports more.** Plan §4.2 says `args.id` only. Trim or document.

19. **`SpeciesAliasRepo` interface in `species-map.ts` is structurally identical to the actual `species-alias-labmaus` module's exported functions (`list`/`get`/`has`).** The "minimal entity shape... defined locally to avoid a circular import" comment is accurate, but the duplicated `SpeciesAlias` type means a schema change in one place silently desynchronises the other. A `// keep in sync with src/db/species-alias-labmaus.ts SpeciesAliasSchema` line would catch it.

## 5. Nits

20. **TSDoc summary lines occasionally start with `Same as ...` (`species-map.ts:60`)** rather than present-tense active voice ("Translate ... and throw on miss."). Per CLAUDE.md §10 §1.

21. **`src/db/tool-definitions.ts:236`** description says "the future tournaments_detail" — but `tournaments.detail()` already exists. Rephrase or expose as a fifth tool.

22. **`scripts/data/ingest-labmaus.ts` lacks `--strict-offline` / argv validation for malformed dates** — passes silently to `chunkDateRange` which produces NaN dates.

23. **`recomputeAggregatesForTournament` is called by no test or production code** in this slice; T38/T39 assert it via direct call. Wire into ingest cross-check pass per plan §13 pseudocode (`compareWithinTolerance(...)`) or remove. Currently the cross-check is a `void` placeholder — flow §2.6 promises the warning channel. (See finding 9 too.)

24. **`tests/contract/labmaus-live.test.ts:30`** throws on schema drift but `expect(parsed.success).toBe(true)` would yield a clearer failure message and let `parsed.error.issues` be auto-printed by vitest. NIT.

## 6. TDD audit

- **f0a5ca9 ("test: red")** — adds 39 files, 105k lines, with both tests AND substantial production stubs. The stubs throw `not implemented (Stage 5)` so tests fail at assertion time, satisfying the letter of "failing for the right reason" — but the schema file (`tournament.ts`, 279 lines) is essentially final, the drizzle schema additions (88 lines) are final, the migration is final, and the species-map interface graph is final. Per CLAUDE.md §3 the schema file qualifies for the pure-data exemption; the rest stretches the rule. Should have been disclosed in the commit message per §3 last paragraph. **Finding 3.**
- **b03a41e ("feat: green")** — implements the bodies. Diff line counts roughly match the stubs growing into real code. No new test files. Acceptable.
- **6876d3a ("test+fix: T20")** — modifies a test that the green commit had failed against, AND adds a new public method `nextAllowedAt()` to a production interface. **Finding 1: this is changing the contract to make the test pass, which is the inverse of the TDD loop.** The right fix was to change the test to observe behaviour (a real `setTimeout` delay, or a real wall-clock check), not to publish test scaffolding as a tool-layer interface member.
- **Test coverage vs plan §10:** all T1–T40 present. T34a/T34b/T35/T36/T37/T38/T39 are vacuously green to varying degrees:
  - T35 (no-tera property) — disclosed as vacuous in test docstring; OK.
  - T34a/T34b — vacuously green because `usage()` returns `[]`; **not disclosed**. See finding 2.
  - T36/T37 — vacuously green because `fakeFetchEmpty` short-circuits to `summaries=[]`. See finding 10.
  - T38/T39 — partially green: shape only, no tolerance assertion. Plan §10 said "top-N match within ±0.05 absolute or ±1% relative" — not implemented. See finding 23.

## 7. Plan reconciliation

Deviations not yet documented in `docs/plans/labmaus-tournaments.md` — must be added in this slice's Stage 6 refactor commit (or as a `## 18. Stage 6 deviations` section):

| # | Deviation | Where it lives now | Action |
|---|---|---|---|
| a | `team_names` is CSV string | fixtures README + SPEC.md + schema comment | Patch plan §3 LabmausRawTeamSchema. |
| b | `UsageArgsSchema.kind` added | schema | Patch plan §3 + §6 mention `kind`. |
| c | `tournaments.detail()` exists | repo | Patch plan §6 table; close §17-Q3. |
| d | `LabmausClient.nextAllowedAt()` | client + interface | Remove (per finding 1) or document as test-only-private. |
| e | `usage(kind in {item, move})` returns `[]` | repo | Either implement or amend §17-Q1. |
| f | `recomputeAggregatesForTournament` not wired into ingest cross-check | ingest script | Wire it (per plan §13) or move to "deferred". |
| g | TSDoc cross-link `tournaments_detail` says "future" but it exists | tool-definitions | Update doc string. |
| h | T34a/T34b/T36/T37/T38/T39 vacuous-green slips | tests | Add disclosure block to plan §10 footer. |

## 8. Suggested refactor batch (for the parent agent's `refactor: apply review` commit)

Ordered by impact-to-effort:

1. **Remove `LabmausClient.nextAllowedAt()` from the public interface; rewrite T20 to assert observable throttle delay** (`src/tools/labmaus/client.ts:75-85,238-240`; `tests/tools/labmaus/client.test.ts:44-64`; mock-client stubs in `get-tournament.test.ts:34`, `list-tournaments.test.ts:27`). Use `vi.useFakeTimers()` + `setSystemTime` and assert `setTimeout` was scheduled with the expected delay. **Blocker 1.**
2. **Either implement `usage(kind="item"|"move")` against `team_sets` (graceful-empty if table absent) or amend plan §17-Q1 to re-defer with explicit reviewer sign-off** (`src/db/tournaments.ts:275-279`). **Blocker 2.**
3. **Patch `docs/plans/labmaus-tournaments.md`** to record deviations a–h in §7 above. Add Stage 6 footer summarising review outcome. **Finding 6.**
4. **Delete dead `clauses` array in `tournaments.list`; either use Drizzle query builder or document why raw SQL is required** (`src/db/tournaments.ts:121-147`). **Finding 4.**
5. **Delete `void aliasRepo; void speciesTable; void sql` orphans + their imports** (`scripts/data/ingest-labmaus.ts:124-127, 24-29`). **Finding 8.**
6. **Make `--no-network` propagate non-network errors** (`scripts/data/ingest-labmaus.ts:175-181, 198-201`). **Finding 9.**
7. **Wire `recomputeAggregatesForTournament` + `compareWithinTolerance` into the ingest loop per plan §13.** Add a `total.warnings++` on out-of-tolerance and a JSON-line warning. **Finding 23.**
8. **Add a one-liner cross-sync comment to `SpeciesAlias` type and `SpeciesAliasSchema`** (`src/tools/labmaus/species-map.ts:9-12` + `src/db/species-alias-labmaus.ts:17-23`). **Finding 19.**
9. **Either implement `displayName` fallback in `labmausIdToRosterId` or remove the parameter** (`src/tools/labmaus/species-map.ts:50-58`; `transform.ts:96`). **Finding 7.**
10. **Update `tournamentsGetTool` description** to drop "future" wording (`src/db/tool-definitions.ts:236`). **Nit 21.**

## 9. Items to defer

- **`createSimpleRepo` extension to support optional `displayNameColumn`** — belongs in a `simple-repo` refactor slice with the next ref-table consumer (natures? types?). Track a TODO. **Finding 11.**
- **Real fixture-driven `--no-network` integration test (cache pre-seeded with fixture)** — belongs in a follow-up `ingest-fixture-replay` slice or merged with the pokepaste-sets slice's ingest tests, where the cross-cut becomes more useful. **Finding 10** stays MAJOR for now; defer the heavier rewrite.
- **3-mon and 4-mon cores** — flow §1.1 promised, plan §6 restricted to 2-mon. New flow doc.
- **`--strict-offline` argv mode + date validation** — Nit 22, defer to ingest-hardening slice.
- **Live contract test polish** (Nit 24) — accept-or-defer.

---

## 10. User decision (2026-05-04)

**Apply all 10 items** in §8. Annotate the deferred items in §9 (in the plan + as inline TODOs in code where appropriate).

Decline-with-reason: none.
