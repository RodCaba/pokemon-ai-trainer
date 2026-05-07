# Stage 6 Code Review — pikalytics

**Branch:** feat/pikalytics
**Commits reviewed:** d132599, 001c642, be6b016, 561d64b
**Reviewer:** Stage 6 reviewer subagent
**Date:** 2026-05-06

## 1. Summary

Ship-after-fixes. The slice is the most disciplined of the three meta-intelligence sources to date: tool registration was preempted on day one (closing the pokepaste BLOCKER), `_shared/{throttle,file-cache}` are genuinely consumed as a third client, the parser is pure and isolated, the tera-strip lives at three layers (parser ignores, transform `findTeraKey`, `.strict()` schema), and both Stage 5 self-flagged risks (GLOB bug, slug derivation) were caught and fixed with explicit regression guards. TDD discipline on the red commit was clean, with both the §3 pure-data exemption and the PIKA-T43 vacuous-green slip disclosed in the commit body — the disclosure pattern has now stabilized across three slices. The two structural problems are: (a) **`_tera_leak_marker_` is a sentinel roster id wired into production `ingest-pikalytics.ts` to make a test pass — same anti-pattern the labmaus review flagged on `LabmausClient.nextAllowedAt()`** (PIKA-T48 should mock the transform, not the script's input); and (b) **`SPEC.md` covers ~5 of the plan §4.4's nine mandatory sections** (Inputs / Outputs / Edge cases / Citation rules / Error matrix / Out-of-scope are missing or stubbed). Plan reconciliation also lags reality on three points (usage_percent nullable, as_of source row, slug derivation correction).

## 2. Blockers

None. (Compare pokepaste's tool-registration BLOCKER — explicitly preempted here; verified all three tools land in `ROSTER_TOOL_DEFINITIONS` at `src/db/tool-definitions.ts:444-446` with `$ref`-free schemas and proper TSDoc.)

## 3. Major findings

1. **Test-only sentinel `"_tera_leak_marker_"` polluting the production ingest script (`scripts/data/ingest-pikalytics.ts:211-219`).** The script branches on a magic-string roster id to throw `PikalyticsTeraLeakError` so PIKA-T48 can assert fail-loud propagation. This is the same pattern flaw the labmaus review's BLOCKER 1 (`LabmausClient.nextAllowedAt`) called out: changing the production surface to make a test pass, instead of injecting the dependency. The right shape is to take `transform` (or `fetchSpecies`) as an injected dep on `main` (or extract `processSpecies` and let the test wrap it with a transform mock that throws). Today every cron run includes a dead conditional that would silently misroute any user who happens to type `_tera_leak_marker_` as `--species`. Anchor: CLAUDE.md §8 ("pure function signature; no hidden globals") + §3 (TDD: change the test, not the contract). MAJOR.

2. **`SPEC.md` is partially populated — six of nine plan §4.4 sections missing/stubbed (`src/tools/pikalytics/SPEC.md:1-43`).** Present: Tools registered, Endpoint, Parser contract, Reg M-A hygiene, Cache + throttle. Missing: (1) Inputs (zod verbatim or paraphrased), (2) Outputs, (3) Edge cases enumeration (404, html-instead-of-md, mega/regional forms, apostrophe species, as_of regression), (4) Error matrix (which exception when), (5) Citation rules (`source_url` vs `ai_url`), (6) Out-of-scope. Plan §4.4 is explicit about all nine. Pokepaste's review made the same finding a MAJOR (its own SPEC was a placeholder); pikalytics is further along but still incomplete. Anchor: plan §4.4; CLAUDE.md §8 ("Adding a new tool: open a `tools/<source>/SPEC.md` first"). MAJOR.

3. **Plan reconciliation: three accepted-deviations not yet documented in `docs/plans/pikalytics.md` (CLAUDE.md §2 Stage 6 — plan is the source of truth).** All three are real and disclosed in commit bodies (001c642, be6b016, 561d64b), but the plan itself still describes the original contract:
   - Plan §3 sketches `usage_percent: Percent` (required); implementation is `Percent.nullable()` (`src/schemas/pikalytics.ts:88`). Live AI-markdown lacks a `## Usage` section — verified 2026-05-07.
   - Plan §2.2/§2.3 says `as_of` comes from a top-of-page `> Data as of YYYY-MM-DD` blockquote; implementation parses the Quick-Info table row `| **Data Date** | YYYY-MM |` and appends `-01` (`parse-markdown.ts:45-46, 98`).
   - Plan §2.5 says slug derivation goes through `display_name`, but plan §4.1 / §4.4 implicitly conflated slug with `species_roster_id`. The 561d64b fix made the display-name path explicit; needs a `## 19 Stage 6 deviations` section mirroring the labmaus + pokepaste pattern. Anchor: CLAUDE.md §2 Stage 6. MAJOR.

4. **`isWithinCurrentIngestWeek` is referenced in the plan §13 sketch but the implementation uses a different (and weaker) heuristic (`scripts/data/ingest-pikalytics.ts:103-112`).** The script queries `WHERE species_roster_id = ? AND fetched_at >= ?` against `weekStart`. This skips on **our fetch time**, not the upstream `as_of`. Two consequences: (a) re-ingesting on a Monday fresh after a Sunday run will skip every species fetched the prior Sunday even if upstream's `as_of` advanced (bounded miss — at worst 6 days late), but (b) the `latest.as_of` peek the plan §13 sketch mentions is gone, so an upstream republish *with the same as_of value* on Tuesday after a Monday miss-fetch will still skip. Acceptable trade today (matches plan §17 Q2 answer "calendar week is fine"), but the divergence from the sketch should be a one-line comment + plan reconciliation entry. Anchor: plan §13, plan §17 Q2. MAJOR — borderline MINOR.

5. **`fetchSpecies` ignores the `as_of_hint` cache-key extension that the client supports (`src/tools/pikalytics/client.ts:64-67, 102-110` + `src/tools/pikalytics/fetch-species.ts:87`).** The client signature `fetchSpeciesMarkdown(species_slug, as_of_hint?)` and the `cacheKey = as_of_hint ? \`${slug}__${as_of_hint}\` : slug` branch are dead code today — `fetchSpecies` calls `client.fetchSpeciesMarkdown(slug)` with no hint, so the cache key is always `<slug>`. Plan §4.1 calls out the `<species_slug>__<as_of>` shape as the cache key; today's implementation is "key = slug" only. Either delete the parameter (and clear the plan), or wire it: ingest can pass `pikalytics.get(db).as_of` as the hint to short-circuit the network on already-current snapshots. The dead-code interpretation matches the labmaus review's "describe meaning, not syntax" finding 6. MAJOR — could become a real tool when the calendar-week heuristic is replaced by a true `as_of` skip-check. Anchor: plan §4.1, plan §12.2.

6. **`PikalyticsInputError` raised mid-loop double-routes through unrelated paths (`scripts/data/ingest-pikalytics.ts:149-156, 227-231`).** When `processSpecies` catches an `InputError` it re-raises (`throw e;`); the outer loop catches and pushes the species id to `summary.species_404s` — semantically wrong (it's not a 404, it's a programmer error or a roster gap). The comment on line 151-153 admits the misrouting is intentional to make PIKA-T48's `_tera_leak_marker_` test pass without an "input error" bucket. Either add `summary.input_errors[]` or merge with `parse_failures[]`; the current code corrupts the run summary's contract. Anchor: plan §13 run-summary fields, flow §6 Q8. MAJOR.

7. **`usage(dimension="species")` returns ALL species rows (one per `as_of`), not "latest snapshot per species" (`src/db/pikalytics.ts:138-159`).** Plan §6.1 row 3 explicitly specifies `WHERE (species, as_of) = latest-per-species ORDER BY usage_percent DESC`. Today's SQL is `WHERE usage_percent IS NOT NULL ORDER BY usage_percent DESC LIMIT ?` — once two `as_of` rows accumulate per species, the same species shows up twice. Currently masked because `usage_percent` is null for live data and the test seeds only one `as_of` per species. PIKA-T39 passes vacuously. Plan-vs-impl mismatch + a real bug at first historical accumulation. Recommend `WITH latest AS (SELECT species_roster_id, MAX(as_of) AS as_of FROM pikalytics_snapshots GROUP BY species_roster_id) SELECT p.* FROM pikalytics_snapshots p JOIN latest l ON ...`. Anchor: plan §6.1. MAJOR.

## 4. Minor findings

8. **`PikalyticsInputError` constructor `cause` is wrapped in an extra `{ cause }` object that is never read (`fetch-species.ts:60-64`).** The base `PikalyticsError` constructor already accepts `{ cause }`. Today: `throw new PikalyticsInputError("…", { cause: parsed.error })` — fine. But on line 71-75 the second `PikalyticsInputError` carries `{ species_roster_id }` but no `cause`; the parsed error's `error.issues` is therefore lost when the input is structurally valid but the roster id is unknown. Add the parsed.error chain.

9. **`labmaus-fixtures.ts` is now seeding for **three** unrelated test suites (labmaus, pokepaste, pikalytics) — naming is stale.** be6b016 added `charizardmegay`, `floettemega`, `basculegion` rows specifically for pikalytics's transform-roster-resolution suite. Either rename to `shared-test-fixtures.ts` or extract a `seedPikalyticsRosterDb()` that composes with the labmaus seed. Today, a future test that wants different roster contents has to fight the labmaus assumption.

10. **`fakeFetch404` is the same anti-pattern flagged on labmaus (review finding 10) and pokepaste (review minor 14) — relocated, not solved (`scripts/data/ingest-pikalytics.ts:89-91, 193`).** In `--no-network` mode the fake returns 404 for cache misses. PIKA-T44/T46/T47/T49 all hit `--no-network` against a `:memory:` DB with no pre-seeded cache; everything except T45 silently 404s and exits 0 because that's the empty-roster contract. PIKA-T44's intent (per plan §10) was "3 species fixture replay" — today it just confirms `0 === 0`. PIKA-T46/T47 are entirely vacuous. Same disclosure pattern the labmaus reviewer asked for; recommend either pre-seeding the cache (mirror pokepaste T42 / labmaus ca91e03) or asserting actual summary fields. MINOR — the fail-loud test (T48) and idempotency (T50) carry real signal.

11. **`PIKA-T44` exits 0 because the `:memory:` DB has no `species` rows, so `roster.list(db, "RegM-A")` returns `[]` after the `--species` argv override pre-empts it; but with `--species garchomp` and an unseeded roster, `fetchSpecies`'s `roster.get` returns null and throws `PikalyticsInputError`, which the outer loop pushes to `species_404s`.** The test asserts only `exit === 0`, so the misrouted-summary bug from finding 6 is masked. This is a vacuous-green slip that was NOT disclosed in the green commit body (compare 001c642's PIKA-T43 disclosure). Anchor: CLAUDE.md §3 last paragraph.

12. **`teammates(db, ...)` re-runs full `PikalyticsSnapshotSchema.parse` via `get` even though the caller (the `pikalytics_teammates` agent tool) only consumes the `teammates[]` array (`src/db/pikalytics.ts:108-118`).** Same finding as pokepaste's `rowToTeamSet` (review minor 9). For a 50-row teammates snapshot the validate cost is paid every agent call; once the agent loop fans out across 30+ species, this is the kind of paper-cut that compounds. Recommend a separate code path that loads `teammates_json` directly (or use `parseOrThrow` from `simple-repo.ts` to standardize the shape).

13. **`usage(dim, species)` re-loads the full snapshot via `get(db, ...)` for every dimension, including `dimension='item'` which only needs `items_json` (`src/db/pikalytics.ts:170-171`).** Same shape as finding 12; defer alongside it.

14. **`as_of` regex on `parse-markdown.ts:45` matches the FIRST occurrence anywhere in the document.** A hostile fixture or upstream restructure could put a `**Data Date**` row inside a comments / FAQ section and it would still match. Probably fine, but a multiline anchored search after `## Quick Info` would be tighter.

15. **`PikalyticsSourceBlockSchema.fetched_at` uses `z.string().datetime({ offset: true })` (`src/schemas/pikalytics.ts:15`) but the transform writes `new Date().toISOString()` which produces `Z` suffix — that's UTC offset zero, accepted, but the ingest's idempotency depends on `fetched_at` *not* changing on a re-run.** Per the labmaus review (similar finding) and pokepaste's minor 13 (cache-envelope `fetchedAt` flow-through), the source-of-truth fetch time is the cache envelope's, not "now". Today the upsert is `ON CONFLICT DO NOTHING`, so the divergence is invisible — but PIKA-T50's idempotency claim "zero deltas" is satisfied by row count, not by a row hash. MINOR.

16. **Cross-source consistency: the `pikalyticsSnapshots.species_roster_id` FK soft-links to `species.id` but the **teammate** roster ids stored inside `teammates_json` carry no FK enforcement (`drizzle-schema.ts:339-341`).** Plan §5 explicitly accepts this trade ("the transform validates each id through `roster.has` before it lands"), but the trade is now load-bearing for cross-source joins (e.g., a future `meta-merger` slice that aggregates Pikalytics teammates with labmaus tournament cores). Worth a note.

## 5. Nits

17. **TSDoc summary on `RawSnapshot` (`parse-markdown.ts:25-43`) starts "Intermediate raw shape produced by..."** — present-tense active voice per CLAUDE.md §10.1 would be "Holds the structured intermediate produced by..." NIT.

18. **`scripts/pikalytics-demo.ts` reads `--limit` with no error on non-numeric input (`Number.parseInt("abc", 10)` returns `NaN`, which then quietly limits to 0)** — same NIT family as labmaus's "argv validation for malformed dates."

19. **`pikalyticsFetchSpeciesToolDefinition` is exported from `fetch-species.ts:101-115` AND duplicated as `pikalyticsFetchSpeciesTool` in `tool-definitions.ts:378-388`.** Two parallel sources of truth for the same tool description (the strings differ slightly: "Use this when you need to see a single species's…" vs "Use this when you need to see one species's…"). Per pokepaste's review minor 18 (dead re-export), drop the orphan in `fetch-species.ts`.

20. **`parsePikalyticsMarkdown` regex `USAGE_RE` (`parse-markdown.ts:46`) is dead in production** — the live endpoint never emits `## Usage` per fixtures README; PIKA-T9 (which expected throw on missing usage) was rewritten implicitly via the `Percent.nullable()` schema change. A comment "kept for forward-compat with potential upstream restoration" would close the loop.

21. **`SECTION_HEADERS` map (`parse-markdown.ts:51-56`) silently iterates `Object.entries`, but `extractSection` runs the body regex with `\\Z` (Perl-style end-of-string) which JavaScript's `RegExp` does NOT support — the regex falls through to "match until next ##" only.** Today `## Common Moves` happens to be the LAST section in every fixture, so the bug is masked; if a future fixture has bullets after the last `## Common <X>` (e.g., a `## FAQ` section follows), it'll be sucked in. NIT — fix to `(?=^##\\s|$)` with the `m` flag.

## 6. TDD audit

- **d132599 (docs Stage 1-3)** — flow + plan land first. No code. Clean.
- **001c642 (test: red — pikalytics)** — adds 35 files, ~4116 lines (~3500 fixture content). Module stubs throw "not implemented" so tests fail at assertion time, satisfying "failing for the right reason." Tool-definitions test PIKA-T31 lands red against three NEW tool entries (preempting pokepaste's BLOCKER). The schema file qualifies for §3 pure-data exemption AND PIKA-T43 is flagged as a vacuous-green slip — both **explicitly disclosed in the commit body**, exactly per CLAUDE.md §3 last paragraph. The disclosure pattern has now stabilized across three slices (labmaus failed, pokepaste did it, pikalytics did it). Discipline: clean.
- **be6b016 (feat: green — pikalytics)** — implements parser, transform, client, fetch-species, repo, ingest, demo. Diff line counts (~841 lines) match stub-to-real growth. Commit body discloses two real Stage 5 corrections: (1) GLOB bug (`____-__-__` LIKE wildcards → `????-??-??` GLOB wildcards) — verified the fix landed in `drizzle-schema.ts:362`, the migration `0005_short_stryfe.sql:18`, AND the snapshot meta — coherent across all three; (2) `usage_percent` nullable migration corollary in the CHECK constraint (`IS NULL OR (… BETWEEN 0 AND 100)`). Both are real. Three accepted upstream-shape deviations (usage_percent nullable; as_of source row; FAQ Tera-Type-not-applicable noise) are disclosed in the body but **NOT mirrored into the plan** — see finding 3.
- **561d64b (test+fix: PIKA-T29b)** — slug derivation correction. The test is REAL: it asserts `seenSlugs == ["charizard-mega-y"]` (not just "no throw"), which would have caught the bug pre-fix. The fix routes through `rosterEntry.display_name.toLowerCase()` — durable for all Mega/regional forms, not patched-only-for-test. Verified: `floettemega → floette-mega`, `ninetalesalola → ninetales-alola` work the same way (display_name is the source of truth). Discipline: clean.

**Per-test trace:** PIKA-T1–PIKA-T51 all present. Vacuous-green slips:
- PIKA-T43 (no-tera property test) — disclosed in commit body.
- PIKA-T44/T46/T47/T49 (ingest no-network paths) — see finding 10/11; **not disclosed**.
- PIKA-T39 (usage species ranking) — vacuous because of finding 7; not disclosed.
- PIKA-T15 (synthetic-tera-leak parses cleanly) — real, parser correctly ignores Tera headers.

## 7. Plan reconciliation

| # | Deviation | Where it lives now | Action |
|---|---|---|---|
| a | `usage_percent` is nullable | `src/schemas/pikalytics.ts:88`, `parse-markdown.ts:101-122`, fixtures README | Patch plan §3, §4.1 post-conditions, §10 PIKA-T9 description. |
| b | `as_of` parsed from Quick-Info `**Data Date**` row, normalized `YYYY-MM` → `YYYY-MM-01` | `parse-markdown.ts:45-98` | Patch plan §2.2, §2.3 (the verbatim markdown sample is wrong), and the SPEC.md "Endpoint" section. |
| c | Slug derivation from `display_name` (not `species_roster_id`) | `fetch-species.ts:78-85`, transform deps' `rosterRepo.get` return type | Patch plan §2.5 to make the display-name path explicit and add a one-line note on PIKA-T29b's regression-guard role. |
| d | GLOB bug fix in CHECK constraint (`????-??-??`) | `drizzle-schema.ts:363`, migration `0005_short_stryfe.sql:18` | Note in `## 19 Stage 6 deviations` — Stage 5 caught and fixed. |
| e | Calendar-week skip-existing uses `fetched_at` not `latest.as_of` | `ingest-pikalytics.ts:103-112` | Patch plan §13 pseudocode, with a note on the trade. |
| f | `_tera_leak_marker_` sentinel-string branch (finding 1) | `ingest-pikalytics.ts:211-219` | Either remove (preferred) or document as test-only-private. |
| g | `as_of_hint` cache-key parameter is dead (finding 5) | `client.ts:64-67, 106` | Remove or wire. |
| h | `usage(dimension="species")` doesn't latest-per-species (finding 7) | `pikalytics.ts:138-159` | Implement per plan §6.1 row 3. |
| i | SPEC.md missing six of nine plan §4.4 sections (finding 2) | `src/tools/pikalytics/SPEC.md` | Write the missing sections. |
| j | Run-summary `species_404s` accumulates `PikalyticsInputError` (finding 6) | `ingest-pikalytics.ts:149-156, 227-231` | Add `input_errors[]` or route through `parse_failures[]`. |
| k | PIKA-T44/T46/T47/T49/T39 vacuous-green slips not disclosed | tests | Mirror the disclosure into plan §10 footer (mirror pokepaste's footer). |

## 8. Suggested refactor batch (for the parent agent's `refactor: apply review` commit)

Ordered by impact-to-effort:

1. **Remove the `"_tera_leak_marker_"` sentinel branch** (`scripts/data/ingest-pikalytics.ts:211-219`); rewrite PIKA-T48 to inject a `transform` mock that throws `PikalyticsTeraLeakError`, asserting propagation. **Finding 1 / Plan rec f.**
2. **Fix `usage(dimension="species")` to return latest-per-species** (`src/db/pikalytics.ts:138-159`); strengthen PIKA-T39 by seeding two `as_of` rows for the same species. **Finding 7 / Plan rec h.**
3. **Stop re-routing `PikalyticsInputError` to `species_404s`** (`scripts/data/ingest-pikalytics.ts:149-156, 227-231`); add `summary.input_errors[]`. **Finding 6 / Plan rec j.**
4. **Either wire `as_of_hint` end-to-end (replace the calendar-week heuristic with `pikalytics.get(db).as_of`-keyed lookup) or delete it from the client signature.** **Finding 5 / Plan rec g.**
5. **Patch `docs/plans/pikalytics.md`** for deviations a–k in §7 above. Add `## 19. Stage 6 deviations` section, mirroring labmaus + pokepaste pattern. **Finding 3 / multiple plan recs.**
6. **Write SPEC.md sections (Inputs, Outputs, Edge cases, Citation rules, Error matrix, Out-of-scope)** per plan §4.4. **Finding 2 / Plan rec i.**
7. **Drop the orphan `pikalyticsFetchSpeciesToolDefinition` export in `fetch-species.ts:101-115`**; the canonical version lives in `tool-definitions.ts`. **Nit 19.**
8. **Tighten `extractSection` regex to use `(?=^##\\s|$)` with the `m` flag** (`src/tools/pikalytics/parse-markdown.ts:63`). **Nit 21.**
9. **Pass parsed.error to the second `PikalyticsInputError` site** (`src/tools/pikalytics/fetch-species.ts:71-76`). **Minor 8.**
10. **Add a fail-loud assertion in `--no-network` mode**: if `fakeFetch404` would be invoked but there's no cache hit, throw a script-level error rather than serve silent 404s. Mirrors the labmaus reviewer's preferred shape. **Minor 10.**

## 9. Items to defer

- **Cache envelope `fetchedAt` flow-through** (Minor 15) — same defer as pokepaste; belongs in a `_shared/file-cache.ts` hardening slice when the next consumer arrives.
- **`teammates`/`usage` schema-validate-on-read overhead** (Minor 12, 13) — defer to when the agent loop's hot path actually exercises this; revisit alongside pokepaste's `rowToTeamSet` finding.
- **Real fixture-driven `--no-network` integration test** (Minor 10) — defer to the cross-cutting `ingest-fixture-replay` slice the labmaus + pokepaste reviewers also asked for.
- **`labmaus-fixtures.ts` rename / extraction** (Minor 9) — wait for a fourth consumer or a test-fixture-hygiene slice.
- **FK enforcement on `teammates_json[*].roster_id`** (Minor 16) — belongs in the `meta-merger` slice when the cross-source join becomes load-bearing.
- **Munchstats / Reg M-B / other formats** — explicit out-of-scope per flow §2.10.
