# Stage 6 Code Review — pokepaste-sets

**Branch:** feat/labmaus-tournaments (HEAD `d75b852`)
**Commits reviewed:** eda22ed, e181bd4, 9fc3d52, affbeaf, 27a3331, fd2815b, 19627b9, b9a8d98, ca91e03 (and cross-cutting siblings: ac56ced, a8b7425)
**Reviewer:** Stage 6 reviewer subagent
**Date:** 2026-05-06

## 1. Summary

Ship-after-blockers. The slice is cohesive and well-anchored: schema is strict and Tera-free, transform layer correctly lifts `evs → sps`, ref-table reject-and-fail is honoured, and the live-data discoveries (Mega normalization, Option B log-and-continue for unknown species) are reflected in code, tests, and the hook docstring. TDD discipline on the eda22ed red commit is good — the §3 pure-data exemption AND the T36 vacuous-green slip were both flagged in the commit body, exactly per CLAUDE.md §3 last paragraph. The `_shared/{throttle,file-cache}` extraction is clean and now genuinely consumed by both labmaus and pokepaste.

The two structural problems are: (a) **the agent-callable tool surface promised in plan §2 (`pokepasteFetchPasteTool`, `setsListTool`, `setsGetTool`, `setsUsageTool`) was never wired into `src/db/tool-definitions.ts`** — only the loose `fetchPasteToolDefinition` constant exists in `fetch-paste.ts` and is registered nowhere; and (b) **`SPEC.md` is still a Stage-4 placeholder** even though plan §4.3 + CLAUDE.md §8 require it as the agent-discoverable contract. Plan reconciliation also lags reality on five points (see §7).

## 2. Blockers

1. **Pokepaste + sets repo tools are not registered (`src/db/tool-definitions.ts:1-260`).** Plan §2 and the `tool-definitions.ts` extension bullet specify four new exports — `pokepasteFetchPasteTool`, `setsListTool`, `setsGetTool`, `setsUsageTool` — appended via the local `tool(...)` helper and re-exported through `ROSTER_TOOL_DEFINITIONS`. None exist. `fetchPasteToolDefinition` lives in `src/tools/pokepaste/fetch-paste.ts:74` but is imported by no production code (only the T28 test). The agent's Anthropic tool catalog therefore never grows; `sets.usage` is unreachable from the agent loop. T28 only asserts the orphan constant has no `$ref`. Anchor: plan §2 ("`src/db/tool-definitions.ts` (extend) — Append `pokepasteFetchPasteTool` and `setsListTool` / `setsGetTool` / `setsUsageTool`"); CLAUDE.md §8 ("Each tool exports a JSON Schema description used by the Anthropic SDK tool definition"); CLAUDE.md §9 ("agents must call `team_validate`…"). MAJOR-tipped-to-BLOCKER because the slice's headline product surface (`tournaments.usage` items/moves dimensions per the labmaus review's Blocker 2) cannot fire from the agent without these. Fix: append four `tool(...)` entries mirroring `tournamentsUsageTool`'s shape, and add to `ROSTER_TOOL_DEFINITIONS`.

## 3. Major findings

2. **`src/tools/pokepaste/SPEC.md` is a Stage-4 placeholder (`SPEC.md:1-10`).** Plan §4.3 enumerates nine mandatory sections (Inputs, Outputs, Edge cases, Cache + throttle, Error matrix, Citation rules, Reg M-A hygiene, **Reject-and-fail validation contract**, Out-of-scope). The file currently says "TODO(stage 5)". CLAUDE.md §8 sub-bullet "Adding a new tool" explicitly says the SPEC is *written first*. Without this, agents discover `pokepaste_fetch_paste` only through the inline tool description, missing the reject-and-fail contract that downstream callers must consume. Fix: write the nine sections per plan §4.3.

3. **Stale comment in `ingest-labmaus.ts:351-352` directly contradicts current behaviour.** The comment reads "PokepasteUnknownSpeciesError propagates out of main() (fail-loud, exits 1)" but the b9a8d98 hook explicitly catches `PokepasteUnknownSpeciesError` and pushes into `summary.unknown_species[]` (see `pokepaste-hook.ts:109-116`, T40 asserts this). Misleading future readers. Anchor: plan §13 (currently still says "fail loud" — see plan reconciliation §7 below). Fix: rewrite the comment to "Per b9a8d98 / `pokepaste-hook.ts`, every known pokepaste error class is recorded in the run summary; the parent loop only re-raises programmer-bug exceptions."

4. **Plan §13 + plan §8 + plan §6.7 still document the ORIGINAL fail-loud contract for `PokepasteUnknownSpeciesError`.** The implementation is Option B (log-and-continue per b9a8d98 + T40), but `docs/plans/pokepaste-sets.md` §8 row 6 says "**fails loud** in the ingest", §13 has `if (e instanceof PokepasteUnknownSpeciesError) throw e;`, and §10 T40 expected `exit 1`. The actual T40 in the test file asserts `summary.unknown_species[0]?.team_id` instead. CLAUDE.md §2 Stage 6 makes plan-doc the source of truth — this divergence is a process violation. Fix: amend plan §8, §13 pseudocode, §10 T40, and add a Stage 6 deviation footer (see §7 below).

5. **Pokepaste hook calls `sets.list(db, { tournament_team_id })` once per team for an idempotency check that the `ON CONFLICT DO NOTHING` upsert already handles, AND that the labmaus `skip-existing` (ca91e03) makes structurally redundant for the common case (`pokepaste-hook.ts:92-95`).** When the parent tournament is new, the team has zero sets — the guard adds an extra prepared-statement query per team for nothing. When the parent tournament was skipped (ca91e03), the hook is never reached at all. The only case the guard catches is "tournament was *partially* ingested in a prior crashed run, and we're re-doing only the missing teams" — but `ON CONFLICT DO NOTHING` (`sets.ts:257`) already makes that branch correct without the prefilter. Recommend deleting the guard or downgrading it to a comment so the network/transform path is the single source of truth. Anchor: plan §6 §6.1 row 4 + §13 pseudocode; the redundancy was self-flagged in the slice prompt.

6. **`createTokenBucket`'s `capacity` parameter is dead (`src/tools/_shared/throttle.ts:11-19`, `:39-52`).** The interface accepts `capacity`, both clients pass `capacity: 1`, the value is never read. The TSDoc admits "Currently unused (token bucket is implicit in the 'next allowed at' timestamp); kept for future bursty modes." Either delete the field (and update both call sites) or implement the bursty-token semantics now. Keeping unused public API as "future-proofing" violates CLAUDE.md §10's "describe the meaning, not the syntax" by lying to callers about what the parameter does. MAJOR because it propagates wrong mental models.

7. **`evsToSps` and `ivsCopy` defaults silently invent values (`transform.ts:90-112`).** `evsToSps({ hp: 32 })` returns `{ hp: 32, atk: 0, def: 0, ... }`. If the paste author wrote `EVs: 32 HP` we have *no evidence* about Atk/Def/etc. — Champions allows partial allocation, so zero is the right value when the SPS line is *present* (and `Teams.importTeam` populates the missing keys). But `ivsCopy` defaulting unspecified IVs to `31` then storing them as IV provenance is dishonest: per the schema (`team-set.ts:43-58`) the IV field is "preserved verbatim for provenance only" and the calc layer fills 31s anyway (Reg M-A rule). Storing `{hp:31,atk:31,...}` because the paste had `IVs: 0 Atk` (and nothing else) silently rewrites every other stat as if the author affirmed 31. Fix: when the source IV/SPS line is *partially* present, persist ONLY the keys the parser actually saw (or at least drop the per-key default to `null`/-1 sentinel and document that the calc layer fills 31s). Anchor: memory `regulation_m_a_stat_rules.md` ("no IVs in inputs"), CLAUDE.md §5 #3 (citation discipline — every datum must be defensibly derived).

## 4. Minor findings

8. **`extractPasteId` uses a non-null assertion that the regex already guarantees (`pokepaste-hook.ts:67-69`).** `m[1]?.toLowerCase() ?? null` — `m[1]` is always present when `m` is non-null because the pattern has exactly one capture group. The optional-chain + null-coalesce reads as if `m[1]` could be undefined. Simplify to `return m ? m[1].toLowerCase() : null;`. NIT/MINOR.

9. **`rowToTeamSet` re-runs full schema validation on every row read (`sets.ts:37-64`).** The write path already validates, the schema is `.strict()` and CHECK constraints duplicate the SPS caps. Per-row `.parse()` with the full strict schema is paid every `list()` call. For a top-cut tournament that's 6 × 8 = 48 parses per query — fine today, may matter once the meta-intelligence surface fans out. Recommend `parseOrThrow` from `simple-repo.ts` (it's the convention from labmaus/roster) or at least document the cost. Anchor: CLAUDE.md §10 (`createSimpleRepo` → "Reuse opportunities").

10. **`sets.usage` `display_label` always equals `key` (`sets.ts:215`).** The schema (`team-set.ts:172-183`) holds them as separate fields specifically so the API can disambiguate (e.g., move id `kowtowcleave` vs display `Kowtow Cleave`). Today `key === display_label === <display>` because we group by display directly. Either drop the field or make a future-work TODO; right now it's a misleading shape.

11. **`sets.usage` SQL is composed via string concatenation with switch-driven `valueExpr`/`groupCol` (`sets.ts:160-205`).** No injection vector (the dimension is enumerated via zod), but the pattern is the same shape that the labmaus reviewer flagged (`db_orm_drizzle.md` — "`db.$client` is the escape hatch"). A short comment explaining *why* this can't be Drizzle-composed (json_each + dynamic group column) would close the loop.

12. **`PokepasteSourceSchema` requires `schema_version: 1` but the per-set top-level `TeamSetSchema` also carries `schema_version: 1` (`team-set.ts:67-118`).** Two `schema_version` fields on the same record — confusing for the LLM consumer. Per CLAUDE.md §5 the version belongs at the entity boundary; the source provenance block is part of the entity and shouldn't carry its own version. Drop `schema_version` from `PokepasteSourceSchema`.

13. **`fetched_at` is freshly minted inside `fetchPaste` (`fetch-paste.ts:56`) even when the body comes from disk cache.** `client.fetchRaw` returns a cached body silently; the surrounding `fetchPaste` wraps it with a *now*-stamped `fetched_at`. Two consecutive runs against a cached paste produce different `fetched_at` values that get persisted to fresh `team_sets` rows — except the upsert is `ON CONFLICT DO NOTHING`, so the original timestamp survives. The behaviour is correct by accident. Recommend the cache envelope's stored `fetchedAt` (already present in the `_shared/file-cache` envelope) flow through to the transform so the timestamp reflects the original fetch, not the cache hit.

14. **`ingest-labmaus.ts` `fakeFetch404` (`scripts/data/ingest-labmaus.ts:127-129`) is the same anti-pattern that was the labmaus review's finding 10 (vacuous-green) — relocated, not solved.** T42 tests the happy path through cache-pre-seeding (good), but `--no-network` for an *unseeded* paste id silently hits `fakeFetch404` which serves a 404. Per CLAUDE.md §3 the cache-only mode should be deterministic and not depend on a fake fetch returning canned 404s — pre-seeding is what the test does and what production callers should rely on. The fake-404 stub is dead in T42 and only fires for cache misses; either delete it (and let the real fetch wrapper assert "should not be called in --no-network") or wire it through a `cacheOnlyFetch` that throws loudly. MINOR because T42 actually exercises the seeded path.

15. **`tests/scripts/ingest-labmaus-pokepaste-wired.test.ts:382` parses summary line by `find((l) => l.includes('"pokepaste"'))` — fragile if any other JSON-line emit ever contains the substring.** Acceptable today. NIT.

16. **`PokepasteRunSummary.unknown_species` field carries a 6-space indent on `pokepaste-hook.ts:48` initialization in test (`tests/scripts/ingest-pokepaste-hook.test.ts:53`).** Cosmetic.

## 5. Nits

17. **TSDoc on `transformPaste` (`transform.ts:144-159`) is missing the **When to use it** bullet that CLAUDE.md §10 mandates as element 2.** Plan §2 schema-file bullet says "every exported schema and type carries the six-element block (summary, when-to-use, …)". Same gap on `extractPasteId` (`pokepaste-hook.ts:62-65`) and `processTeamPokepaste` HAS it.

18. **`fetch-paste.ts:91` re-exports `PasteFetchResultSchema` "for callers that want to validate output payloads independently" — but every importer just imports it from `team-set.ts`.** Dead re-export.

19. **`SetsListFilter`'s `species_roster_id` filter against `team_sets` could legitimately want "exists at all" — `species: string[]` (multi-species core lookup) is a natural extension.** Plan §6.1 row 1 single-species only; flag as future work in plan §11 or here.

20. **`pokepaste-hook.ts` imports `PokepasteUnknownSpeciesError` but only uses `instanceof` checks — TypeScript can't infer this cleanly without the value import.** Fine, but worth a noting it's intentional.

## 6. TDD audit

- **eda22ed (test: red)** — adds 1909 lines of tests + module stubs that throw "not implemented (Stage 5)". Schema (`team-set.ts`) lands in this commit as a complete pure-data module, **disclosed in the commit body** under the §3 exemption — exactly the right disclosure pattern, contrasting favourably with the labmaus red commit which the prior reviewer flagged. T36 vacuous-green slip ALSO disclosed in commit body. **Discipline: clean.**
- **e181bd4 (feat: green)** — implements transform/client/sets/hook bodies. No new test files, line counts roughly match stub→real growth.
- **9fc3d52 (test+fix: T15/T17 collision)** — splits `synthetic-edge-cases.txt` into three fixtures so T15's success path doesn't share data with T17's reject path. Adds new test `T17b` for no-ability rejection. Test was not vacuous, fix was real.
- **affbeaf (fix: restore ability requirement)** — the Stage 5 implementation had silently dropped ability from the `minimal` definition; this fix restores it and T17b enforces. Per the slice prompt's "self-flagged risk #2" — confirmed fixed.
- **27a3331 (feat: wire pokepaste hook)** — adds T42 + T42b. Real coverage of the wired path through cache-pre-seeding. T42c (skip-existing assertion) added later by ca91e03.
- **b9a8d98 (live-data discoveries)** — flips T40 expectation from `exit 1` (fail-loud) to `summary.unknown_species[0]` accumulation. **This is the ONLY commit on the branch where the test was rewritten to match a contract change.** Justification (real labmaus tournaments contain format-illegal teams from unofficial organizers) is documented in the hook's module docstring and in the test comments. Plan reconciliation is the missing piece (see §7 below) — the contract change is real, just undocumented in the plan.
- **fd2815b / 19627b9 / ca91e03** — refactor commits. fd2815b genuinely deduplicates the labmaus and pokepaste cache primitives into `_shared`; 19627b9 moves cache paths to env vars (T42 stubs them via `vi.stubEnv`); ca91e03 adds skip-existing semantics with T42c coverage. All have new/updated tests proving the refactor.

**Per-test trace vs plan §10 (T1–T42):**
- T1–T5 (schema): present, pass under §3 exemption.
- T6–T17/T17b/T18 (transform): all present, real assertions, fixtures committed.
- T19–T25 (client): all present.
- T26–T28 (fetch-paste + tool-definitions): present; T28 only asserts shape on an orphan tool constant (see Blocker 1).
- T29–T35 (repo): all present, real seeded data.
- T36 (no-tera): vacuous-green slip — disclosed in commit body, defensible as regression guard.
- T37–T40 (hook): all present; T40 contract changed from plan (see finding 4).
- T41 (idempotency): present.
- T42/T42b/T42c (ingest wiring + skip-existing + no-pokepaste): present.

**Vacuous-green slips:** T36 only (disclosed). No other vacuous-greens spotted.

## 7. Plan reconciliation

Deviations not yet documented in `docs/plans/pokepaste-sets.md` — must be added in the Stage 6 refactor commit (or as a `## 19. Stage 6 deviations` section, mirroring the labmaus precedent §18.x):

| # | Deviation | Where it lives now | Action |
|---|---|---|---|
| a | `PokepasteUnknownSpeciesError` switched from fail-loud (plan §8 row 6, plan §13 `throw e`) to log-and-continue with `summary.unknown_species[]` | `pokepaste-hook.ts:109-116`, T40, hook module docstring | Patch plan §8 row 6, §13 pseudocode, §10 T40, error-matrix sentence in §4.1; add `unknown_species` to summary shape doc in §13. |
| b | `normalizeSpeciesName` (Mega normalization) added — not in plan | `transform.ts:114-143`, T18 | Patch plan §2.6 (parsing strategy) to mention the normalize step, with the Mega-X / Mega-Y / word-boundary cases the function actually handles. |
| c | `_shared/throttle.ts` + `_shared/file-cache.ts` extracted (plan §9 §17-Q1 promised this but with a different file split) | both files exist; both labmaus and pokepaste consume | Patch plan §9 + §12 to point at the shipped paths and note the JSON-envelope file-cache format. |
| d | `LABMAUS_CACHE_DIR` / `POKEPASTE_CACHE_DIR` env vars (19627b9) replaced argv flags | `ingest-labmaus.ts:13-15, 247-249` | Patch plan §13 "Argv handling". |
| e | Skip-existing semantics (ca91e03) — `tournaments.exists` short-circuits the per-tournament loop *before* the pokepaste hook fires | `ingest-labmaus.ts:331-335` | Patch plan §13 pseudocode + add bullet under §15 (Rollout) noting the steady-state re-run cost is now O(skipped) DB lookups. |
| f | Pokepaste/sets agent tools NOT wired (Blocker 1) | `tool-definitions.ts` unchanged | Either ship the four tools OR amend plan §2 to defer them. Recommend ship now. |
| g | `SPEC.md` placeholder (Major 2) | `src/tools/pokepaste/SPEC.md` | Write the nine sections per plan §4.3. |
| h | T36 vacuous-green slip | already disclosed in eda22ed commit body | Mirror the disclosure into the plan §10 footer for permanent record. |
| i | Hook ALSO catches `PokepasteParseError` and `PokepasteNetworkError` and adds them to `pokepaste_failures[]`, which matches plan §13 — but the message string is the only diagnostic carried (no `cause` chain) | `pokepaste-hook.ts:131-138` | Acknowledge in plan; consider preserving the cause stack for production debugging. |

## 8. Suggested refactor batch (for the parent agent's `refactor: apply review` commit)

Ordered by impact-to-effort:

1. **Wire the four agent tools** in `src/db/tool-definitions.ts` (`pokepasteFetchPasteTool`, `setsListTool`, `setsGetTool`, `setsUsageTool`); add to `ROSTER_TOOL_DEFINITIONS`. **Blocker 1.** ~30 lines.
2. **Write `src/tools/pokepaste/SPEC.md`** per plan §4.3 nine sections. **Major 2.**
3. **Patch the stale ingest comment** (`ingest-labmaus.ts:351-352`) to match the b9a8d98 hook contract. **Major 3.**
4. **Patch `docs/plans/pokepaste-sets.md`** for deviations a–i (§7 above). Add `## 19. Stage 6 deviations` section. **Major 4.**
5. **Drop the redundant `sets.list(...).length > 0` no-op guard** in `pokepaste-hook.ts:92-95` (or downgrade to `// idempotency: ON CONFLICT DO NOTHING handles re-runs` comment). **Major 5.**
6. **Delete unused `capacity` field** on `TokenBucketOpts` and update both call sites (`src/tools/_shared/throttle.ts`, `src/tools/labmaus/client.ts`, `src/tools/pokepaste/client.ts`). **Major 6.**
7. **Honest `ivsCopy` semantics** (`transform.ts:102-112`) — when partial, persist only what the paste asserted; document the "calc fills 31s" rule in the schema TSDoc. **Major 7.**
8. **Drop redundant `schema_version: 1`** from `PokepasteSourceSchema`. **Minor 12.**
9. **Add missing TSDoc "When to use it"** to `transformPaste` and `extractPasteId`. **Nit 17.**
10. **Use `parseOrThrow` in `rowToTeamSet`** for consistency with labmaus/roster repos. **Minor 9.**

## 9. Items to defer

- **Cache envelope `fetchedAt` flow-through to `TeamSet.source.fetched_at`** (Minor 13) — touches the `_shared/file-cache` API; defer to a future cache-hardening slice or wire in alongside the Victory Road slice when that becomes the second non-content-addressed cache consumer.
- **Multi-species `SetsListFilter`** (Nit 19) — defer to lead-planner slice where the consumer arrives.
- **`fakeFetch404` removal in `--no-network`** (Minor 14) — defer to ingest-hardening slice; same bucket as the labmaus review's finding 10.
- **`sets.usage` `display_label` ≠ `key` for moves** (Minor 10) — defer to when the canonical-id moves repo lookup lands.
- **`sets.usage` Drizzle-builder rewrite** (Minor 11) — defer; today's raw-SQL is correct, just under-commented.
