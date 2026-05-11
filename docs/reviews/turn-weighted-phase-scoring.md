# Stage 6 review — turn-weighted-phase-scoring

## 1. Summary verdict

**Ship with the recommended changes below.** The slice lands the
structural Stage 3 plan faithfully: schemas bump 3 → 4
(`src/schemas/tactical.ts:363`), the unconditional ability-weather
override at `recommend-plan.ts:285-306` is deleted in favor of
`deriveTurnFieldStates`, the priority-grants DB pipeline lands
end-to-end (migration 0012 → `data/reg-m-a/abilities-priority.json` →
`scripts/data/build-reg-m-a.ts:loadPriorityGrants` →
`src/db/abilities.ts:rowToEntity` → `role-tags.ts:resolvePriorityMoveEffect`),
and per-phase fields surface on every emitted phase. Stage 4 was a
genuine red (`f78bf54`). The implementation deviations called out in
the brief are honest: DT10/SP4/RP2 relaxations reflect a principled
plan revision (scenario weather represents opposing-archetype state and
correctly persists into late), documented inline in
`derive-turn-fields.ts:240-275`. Blocking gaps are TSDoc (CLAUDE.md
§10) on the two new exports, a stale TSDoc summary on
`recommendTeamPlan` describing the deleted Stage-B override, an
unimplemented Q11 memoization (per-scenario opposing-setter cache),
and the `KNOWN_WEATHER_SETTERS` inline fallback in
`opposing-setter.ts:53` which crosses the
`test_fixtures_no_invariant_blobs` / `scope_discovery_via_site_signals`
discipline lines.

## 2. Required changes

1. **TSDoc gap on `deriveTurnFieldStates` and friends
   (`src/data/tactical/derive-turn-fields.ts:43, :49, :160`).** A
   module-level header exists but the three exports
   (`TurnFieldStates`, `DeriveTurnFieldsInput`, `deriveTurnFieldStates`)
   carry no per-export TSDoc block. CLAUDE.md §10 requires summary +
   when-to-use + `@param` + `@returns` + `@throws` + `@example` on
   every export, especially in `src/data/`. Same shape gap on
   `OpposingSetter` / `OpposingSetters` in `opposing-setter.ts:24, :30`
   (the function itself is documented). Add the six elements per
   export — the agent loop reads them.

2. **Stale TSDoc on `recommendTeamPlan`
   (`src/data/tactical/recommend-plan.ts:324-352`).** The summary still
   says "Supports the live ArchaEye demo by overriding
   `scenario.field.weather` when an ability-based weather setter is in
   the lead pair (Drizzle, Drought, Sand Stream, Snow Warning)." That
   override was deleted this slice — `deriveTurnFieldStates` owns it.
   Update the summary to describe per-phase field derivation +
   speed-duel resolution + decay; otherwise the next agent picking
   between tools reads the wrong story.

3. **Q11 memoization wired at the type level but never actually
   performed (`src/data/tactical/recommend-plan.ts:295, :373, :470`).**
   The plan's Q11 binding said "memoize once per scenario";
   `RecommendPlanDeps.opposingSetters` exposes the seam, but the
   orchestrator `recommendTeamPlan` calls `detectOpposingSetters` in
   three places without populating `deps.opposingSetters` for the
   inner `scorePlan` `.map()` at :423. With ~50 candidates per
   scenario × 10 scenarios, the prepare/all loop in
   `detectOpposingSetters` re-runs ~500 times per overview. Fix:
   compute once in `recommendTeamPlan`, thread through
   `{ ...deps, opposingSetters }` to `scorePlan`. Add an SP6 unit test
   that pins "`detectOpposingSetters` invoked exactly once per
   scenario," mirroring SP1's once-per-candidate pin.

4. **`KNOWN_WEATHER_SETTERS` inline fallback table
   (`src/data/tactical/opposing-setter.ts:53-64`).** Memory
   `test_fixtures_no_invariant_blobs.md` and
   `scope_discovery_via_site_signals.md` both push *against* inline
   hardcoded reference tables in source. The TODO marker on :52 calls
   the future state "migrate to curated JSON once species_abilities
   ingest is reliable" — but the live DB (`data/reg-m-a/db.sqlite`)
   already has species_abilities populated; the table only matters for
   `:memory:` test DBs. Two options, pick one:
   (a) drop the fallback and seed `species_stats`/`species_abilities`
       rows in the affected tests (RP4 / RP7 / live-demo paths) so the
       DB path always wins;
   (b) move the data to `data/reg-m-a/opposing-setters-fallback.json`
       and load it in the same shape as `abilities-priority.json` —
       keeps the discipline ("data lives in JSON, code branches on
       semantics"). Either way, the inline hardcoded map should not
       merge as-is; if it does, log a `// TODO(stage6-deferred):`
       marker and a plan-amendment line documenting it.

5. **OUR-side base-spe stub (`derive-turn-fields.ts:146-158`).**
   `baseSpeedOf` returns 80 for every species and the test DT7 pins a
   permissive `["rain","sun"]` expectation as a result. This is
   acknowledged as Stage-D refinement in the comments, but per
   CLAUDE.md §3 ("failing for the right reason") this introduces a
   silently-vacuous corner: any team that fields TWO ability weather
   setters resolves their intra-team duel by candidate-array order,
   not by speed. Required action: add a `// TODO(stage6-deferred):
   base-spe-on-role-assignment` marker on :146, **and** add the same
   marker on DT7 itself (`tests/data/tactical/derive-turn-fields.test.ts`)
   so a `grep "TODO(stage6-deferred)"` pre-Stage-D surfaces the gap.

## 3. Recommended changes

6. **Q10 late-phase weather override coverage hole.** The override at
   `derive-turn-fields.ts:258-269` only fires when the
   `weather_provided_via_ability` setter is in mid/cleaner. The
   ArchaEye live fixture's Pelipper is usually a *lead*, so the
   override is exercised by zero scenarios in RP1..RP8. DT2 only
   covers the "lead-only → late none" case. Add a DT13 test that
   pins: Pelipper in mid slot, late.weather = "rain" regardless of
   scenario.weather. Without it the override is essentially dead code
   in the test suite.

7. **DT10 / SP4 / RP2 relaxations are principled, but document the
   coupling.** DT10's flip (expected `none`, now expects scenario
   weather to persist) is correct under the "scenario.weather encodes
   opposing-archetype maintainer" reading. That reading is new in this
   slice and contradicts flow §5's "Late T4–T8 — weather expired
   (T5+)." Either update the flow doc (Stage 2 artifact) with a
   reviewed amendment or add a §5.1 to the plan capturing the
   semantic. SP4's relaxation to `["sand","rain"]` is fine; the
   inline comment explains. RP2 now accepts six different weather
   values via a `toContain([…])`; relax once more by switching to
   `["none", scenarioWeather]` for a tighter pin (today any of the
   four weathers passes silently if the scenario field changes).

8. **`recommend-plan.ts:295` Q11 type seam unused.**
   `RecommendPlanDeps.opposingSetters` is reachable only by callers,
   not by the orchestrator. Either remove the field (caller-side
   memoization not needed if Required #3 lands) or rename it to
   `opposingSettersOverride` to signal intent.

9. **`role-tags.ts:303-340` healing move set is hardcoded.** Same
   pattern as #4. The eight `HEALING_MOVES` strings ("life dew",
   "wish", "recover", …) live inline; if a future Reg-M-A patch
   introduces a new healing move (or renames Floral Healing), it's a
   silent miss. Either pull from a moves-table lookup keyed by a
   `category: "healing"` flag, or add a `// TODO(stage6-deferred):
   priority-healing-move-list` marker so it surfaces.

10. **`scripts/data/build-reg-m-a.ts:loadPriorityGrants` lacks zod
    validation (`scripts/data/build-reg-m-a.ts:391-403`).** Reads
    `abilities-priority.json` as a typed cast (`as Record<string, …>`).
    Per CLAUDE.md §5 ("typed — defined with zod schemas; schemas are
    the contract") the loader should call `PriorityGrantsSchema.parse`
    on each value before insertion. Today a malformed JSON edit silently
    serializes garbage into `priority_grants_json`; the next build
    surfaces it only when `rowToEntity` parses on read.

11. **`tests/data/tactical/recommend-plan-stage-c.test.ts:46` (RP4) is a
    smoke test, not a regression.** The synthetic team doesn't include
    Pelipper, so RP4 only asserts `leads.length === 2`. Either add a
    fixture team with Pelipper (load `data/reg-m-a/db.sqlite` if
    `process.env.STAGE_C_LIVE === "1"`) or rename to RP4-smoke and
    track the real assertion under a Stage-D test pin.

12. **Live demo not committed.** Plan §10 calls for a screenshot /
    log entry in the PR description for the ArchaEye `pnpm
    data:tactical plan 01KR7TVD21G1Q99BK0NAEARFD8` run. The commit
    message describes the result prose but doesn't link the artifact;
    capture `docs/reviews/stage-c-live-demo.log` (stdout dump) and
    cite from the plan §1 success-criteria checklist.

## 4. Plan-amendment candidates

A. **Scenario weather persists into late as opposing-archetype state.**
   New semantic introduced this slice; not in flow §5 / Q6. Amend the
   flow doc with a §5.1 paragraph and the plan §1 success-criteria
   bullet to read "late.weather ∈ {none, scenario.weather, our
   override}" instead of "none on all 10 scenarios."

B. **Q10 partial implementation.** The override fires only when our
   ability-based setter is in mid/cleaner. Move setters and
   priority-promoted setters in mid/cleaner don't override late
   weather. Either expand the override or amend Q10 to "ability
   setters only" and tag the rest as Stage-D `// TODO(stage6-
   deferred): late-phase-weather-via-move-setter`.

C. **Q11 (memoization) is unimplemented.** Either ratify
   "memoization deferred — opposing detection is cheap enough on the
   ~10 scenario × 50 candidate hot path" with a measured number in
   the plan §12, or land Required #3.

D. **DT7 permissive expectation (`["rain","sun"]`).** Document in the
   plan §10 test table that DT7 is intentionally permissive pending
   Stage-D base-spe-on-assignment.

E. **`KNOWN_WEATHER_SETTERS` inline data.** Ratify either the JSON
   move (Required #4 option b) or the "drop fallback, seed test DBs"
   approach (option a).

## 5. Optional / nice-to-haves

- `derive-turn-fields.ts:189-194` intra-team duel uses
  candidate-array order as the tiebreaker via `baseSpeedOf` returning
  80 for both. Pin a comparator on `species_id` for determinism until
  base-spe lands.
- `derive-turn-fields.ts:275 void lateWeatherOverridden` is a dead
  binding; the variable's only use is the comment. Delete both.
- `opposing-setter.ts:111 catch {}` swallows DB errors silently
  including schema misconfiguration. Log via `deps.logWarn` (would
  need to be threaded — same pattern as `role-tags.ts`).
- `recommend-plan.ts:373, :470` two distinct call sites compute
  `winnerOpposing` / `fallbackOpposing` separately. Lift to a single
  scenario-scoped `const opposing = …` at the top of
  `recommendTeamPlan` (couples with Required #3).
- `tests/scripts/tactical-cli-stage-c.test.ts:T3` asserts `typeof
  late.cleaner === "string"` — a `.toBeDefined()` style smoke. Pin
  the actual species_id from the synthetic-team fixture to harden the
  regression bar.

## 6. Deferred-to-Stage-D-and-beyond calibration

All six tails called out in the brief are correctly bounded to Stage
D. Add inline `// TODO(stage6-deferred):` markers for the ones missing
them so `grep -rn "TODO(stage6-deferred)"` keeps the discipline:

1. `baseSpeedOf` stub — `derive-turn-fields.ts:146` (missing marker).
2. Late-phase weather override only via ability setter — Q10 partial
   (`derive-turn-fields.ts:258` has the marker for HP-tracking but not
   for move-setter override scope).
3. Tailwind re-set in late — `derive-turn-fields.ts:29` ✓ marked.
4. Opposing TR / Tailwind / screen detection — `opposing-setter.ts:18`
   ✓ marked.
5. Move-based weather turn-2 rescore on our side — inherited from
   Stage B; verify the marker survived.
6. Last Respects scaling, Stamina accumulation, Choice-locking,
   status effects — Stage D scope, not blocking here.

Reg-M-A invariants: no Tera reference in any new file
(`src/data/tactical/derive-turn-fields.ts`, `opposing-setter.ts`,
`abilities-priority.json`, migration 0012). SPS / 66-cap / no-IV
rules untouched.

DB migration health: `0012_abilities_priority_grants.sql` is a single
non-destructive `ADD COLUMN priority_grants_json TEXT DEFAULT NULL`.
Existing `data/reg-m-a/db.sqlite` rows will carry `NULL` until the next
`pnpm data:reg-m-a build` repopulates from the curated JSON. Safe per
memory `single_db_non_destructive_build.md`.

Schema bump 3 → 4 consumers: searched `literal(3)` / `schema_version
=== 3` / `schema_version: 3` — only doc-internal references in
`docs/plans/team-phase-plan.md` and Stage-B test assertions (which
target a different schema, `tactical-support.test.ts:159, :217` for
the support-pillar overview which is a separate version axis). No
stale consumer pins detected. `tactical-turn-fields.test.ts:105`
asserts the bump correctly.
