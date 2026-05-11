# Stage 6 review — team-phase-plan

## 1. Summary verdict

Ship with the recommended changes below. The slice lands the Stage-3 plan
faithfully on the structural axes: schemas (S1..S6) carry the strict
3-tuple, `recommend-plan.ts` is a clean rewrite per Q4/Q5/Q7,
`ScenarioOverviewSchema` + the legacy lead tool are gone, the agent surface
swaps as specified, and the live ArchaEye demo lands the canonical
Archaludon + Pelipper / Sinistcha / Basculegion plan documented in the fix
commit. Stage 4 is a genuine red (stubs are real no-ops, e.g.
`recommend-plan.ts:114` returned `[]` and the rationale builders returned
`""`). Two real concerns block a clean merge: (a) the `9e8ccb3` fix commit
ships the `weather_provided_via_ability` schema field and the weather-
override branch in `recommend-plan.ts:258-272` with **zero** new red tests
— a §3 process violation that mirrors Stage A's `c4bf7e4` and must be
disclosed; (b) `cite-phases.ts` ships as a permanent empty-array stub with
no `TODO(stage6-deferred):` marker, breaking the
`labmaus_pokepaste_deferred_todos.md` discipline and quietly failing flow
§10's "1+ phase-aware citation on ≥ 5 of 10 scenarios" success criterion.
The two heuristic phase scorers are honestly tagged and tested at the
contract layer; their content is fine for v1.

## 2. Required changes

1. **`9e8ccb3` — §3 process violation, no covering red.**
   The fix commit lands three behavior changes — cleaner-exclusion gate
   (`recommend-plan.ts:135-188`), cleaner spe gate lowered to 70
   (`role-tags.ts`), and **weather-via-ability override**
   (`recommend-plan.ts:258-272` + new `weather_provided_via_ability`
   schema field at `schemas/tactical.ts:141-146`). The first carries an
   adjusted PG3 test in the same commit (still red-and-green collapsed);
   the cleaner spe gate has prior R12 coverage that still passes; the
   weather-override branch has **no covering test at all** — there is no
   assertion that the field replaces opposing weather only when the
   carrier role is ability-based, nor that move-based setters leave the
   field alone. This is non-pure-data logic — §3 exemption does not
   apply. Required: append a Deviations paragraph to
   `docs/plans/team-phase-plan.md` disclosing the lapse (precedent: Stage
   A review §2.2) AND add a red-first regression test
   (`role-tags-weather.test.ts` or `recommend-plan.test.ts`) asserting:
   (a) ability-setter on lead → `scenarioForCalc.field.weather` mutated;
   (b) move-setter on lead → unchanged.

2. **`src/data/tactical/cite-phases.ts:23-29` — `findPhaseCitations`
   permanently returns `[]`.** Per plan §1 "Done means" criterion 3 and
   flow §10's "≥ 5 of 10" success bar, this module is supposed to emit
   per-phase citations with `phase_tag_source`. The Stage 5 commit ships
   the same empty-array stub from Stage 4. PC1..PC5 are vacuously green
   against `[]`. Two unconditional asks: (a) inline
   `// TODO(stage6-deferred): cite-phases-empty-stub` per memory
   `labmaus_pokepaste_deferred_todos.md` discipline so it surfaces under
   grep; (b) acknowledge in the plan §1/§10 success criteria that the
   ≥ 5-of-10 citation bar is unmet at merge and add an explicit
   plan-amendment line. Optionally relax PC1..PC5 to gate the contract
   tighter (e.g. seed an insight in `:memory:`, assert at least one
   citation is returned) so the empty-stub failure becomes load-bearing
   for the follow-up.

3. **`src/schemas/tactical.ts:238-241` — stale removal comment.**
   "Use {@link TeamPlanScenarioSchema}; {@link ScenarioSkeletonSchema}
   carries…" but the prior sentence says `ScenarioSkeletonSchema` was
   *removed*. It wasn't — it's declared three lines later. Fix the
   comment to drop the "was removed" framing; the Q5 binding was to
   remove `ScenarioOverviewSchema`, not the skeleton. Pure docs fix.

## 3. Recommended changes

4. **`src/agents/tactical-tools.ts:106-125` — TSDoc gaps.**
   `handleRecommendTeamPlan` carries a one-line comment, not a TSDoc
   block. CLAUDE.md §10 requires summary + when-to-use + @param +
   @returns + @throws + @example for non-trivial entry points. Same gap
   on `recommendTeamPlanTool` (description is in the Anthropic SDK
   `description` field, which is fine — but no TSDoc summary block).

5. **`src/data/tactical/recommend-plan.ts:295` — `recommendTeamPlan`
   lacks TSDoc.** Module-level header doc exists; the export itself only
   has a `/** Score a plan candidate per plan §6. */` block above the
   *private* `scorePlan`, no JSDoc on `recommendTeamPlan`. Same for
   `generatePlanCandidates` (the comment that exists at :113-127 is
   actually attached to the unrelated `LEAD_ELIGIBLE_TAGS` constant due
   to the intervening JSDoc + code).

6. **`src/data/tactical/recommend-plan.ts:51-59` — magic constants
   unexported.** `FULL_CHAIN_BONUS = 15`, `PARTIAL_CHAIN_BONUS = 8`,
   `SETTER_ON_BENCH_PENALTY = 20`. Plan §6.3 (PS9) called for these to
   be exported as named constants. Tests assert presence by name in
   PS9 — verify by grep; if PS9 was relaxed during Stage 5, document the
   relaxation. Also add `// TODO(stage6-deferred): role-chain-bonus-
   calibration` and `// TODO(stage6-deferred): setter-on-bench-penalty-
   calibration` near the declarations (precedent: Stage A's
   `STRUCTURAL_LEAD_BONUS` in score-pair.ts:60-67).

7. **`src/data/tactical/recommend-plan.ts:69` and :151 — duplicated
   `(team as unknown as { sets?: Array<{ species_id?... }> })` cast.**
   Same dirty cast Stage A's review #6 already called out for
   `pillars.ts`. Both call sites should consume the typed
   `RoleTagTeamView` interface proposed in Stage A's review (not yet
   landed). Track or land here.

8. **`scripts/data/backfill-phase-tag.ts:19-20` — relative import path
   `../../src/db/open`.** All other `scripts/data/*.ts` modules import
   from `../../src/...`. This is consistent — fine — but per plan §15
   the comment says "real production driver wraps this with a CLI
   entrypoint, retries, and prompt-version pinning — those land in a
   follow-up `chore/backfill-phase-tag-cli`." Add an inline
   `// TODO(stage6-deferred): backfill-phase-tag-cli-driver` so the
   deferral grep-surfaces.

9. **`scripts/data/backfill-phase-tag.ts:71` — `skipped` semantics
   mismatch.** `BackfillSummary.skipped` is set to
   `alreadyTaggedCount` (a precount of rows tagged BEFORE this run), not
   to rows the classifier was asked about and emitted a non-enum value.
   BF3 (the non-enum case) doesn't increment `skipped` — by design per
   the inline comment at :91-92 — but the field name `skipped` suggests
   "skipped by this run." Either rename to `pre_tagged` / `already_done`,
   or count BF3-style misses into `skipped` and add a third counter.

## 4. Plan-amendment candidates

A. **Cleaner role excluded from leads; `setup_sweeper` added.** Plan §5
   had "at least one lead-eligible." Implementation tightened to "both
   leads must be lead-eligible" AND added `setup_sweeper` to the
   eligible set (`recommend-plan.ts:135-139`). Justified by Last
   Respects scaling + the user's explicit team structure. Ratify in
   plan §5.

B. **Cleaner spe gate 90 → 70.** Stage A plan §3.1 set base ≥ 90.
   Lowered in fix commit to capture Basculegion (base 78). R12 still
   asserts "base 60 → not cleaner." Ratify in Stage A plan §3.1 AND in
   this slice's §5 cleaner-gate rule.

C. **`weather_provided_via_ability` schema field.** Net-new field on
   `RoleTagAssignmentSchema` carrying ability-only weather sources.
   Ratify in plan §3 as a Stage-B schema addition (currently lives only
   in fix-commit message).

D. **Citation retrieval deferred whole-hog.** Plan §1/§10/§8 promised
   phase-aware citations. Empty-array stub ships. Either remove the
   ≥ 5-of-10 success criterion from plan §1, OR amend "Done means"
   item 3 to a follow-up slice trigger.

## 5. Optional / nice-to-haves

- `phase-rationale.ts:50` — `calcSnippet` hard-codes "OHKOs" prose even
  when `max_roll_pct < 100`. Edge case; deterministic templates accept
  rough prose for v1.
- `recommend-plan.ts:354-359` — deterministic tiebreak by tuple order
  is good; consider exporting the comparator so PG/PS tests can pin it.
- `score-mid-phase.ts` weighting: `slotWeight = 60 - midSlot * 8`
  rewards low-slot pivots, which is a proxy for "user put their pivot
  in slot 4." Reasonable v1 heuristic, but commit message should
  explicitly flag that PS2 ("bulky cleric beats fragile attacker") only
  holds because the roleAssignments are passed through `CalcDeps`.

## 6. Deferred-to-Stage-C-and-beyond calibration

1. **Mid-phase true board sim** (`score-mid-phase.ts:15`) — replace the
   role-weighted heuristic with a real `damage_calc`-driven turn-3
   survival + outgoing-damage loop against the actual opp leads with
   accumulated damage.
2. **Late-phase engine integration** (`score-late-phase.ts:17`) — wire
   the bulky-survivor `damage_calc` loop across the top-2 panel
   members; today the score is `slotScore + panelDepth * 2`, ignoring
   the cleaner's actual movepool.
3. **Cite-phases implementation** (Required-change #2) — phase_tag
   filtered retrieval + species filter + fallback.
4. **Move-based weather turn-2 rescore**
   (`recommend-plan.ts:257`) — when a lead carries Rain Dance / Sunny
   Day, turn 1 calc runs in opposing weather, turn ≥ 2 in our weather.
   Requires multi-turn scoring.
5. **Weather-duel speed-order vs opposing weather setters** — when both
   sides bring weather abilities, the slower setter's weather wins;
   speed control + Mental Herb interact. Not modeled.
6. **Last Respects BP-per-fallen-ally scaling** — cleaner-late KO
   calcs currently use base BP; real scaling is +50 BP per fallen ally.
7. **Stamina accumulation, Choice-locking, screens decay, Tailwind
   decay, status effects** — all per-turn state changes the current
   1-vs-1 approximation ignores. These are the load-bearing turn-
   weighted scoring concerns motivating the Stage C → F sequence.
8. **Pelipper vs Sableye lead selection on ArchaEye** — deterministic
   scorer correctly picks the higher-EV Pelipper (better offensive
   throughput + Drizzle-via-ability override). The rain-Sableye variant
   needs the move-based weather turn-2 rescore (#4) plus an
   archetype-mirror calibration before it surfaces in a scenario.
9. **Plan / phase coefficient calibration** — `MID_PHASE_WEIGHT=0.6`,
   `LATE_PHASE_WEIGHT=0.8`, chain bonus +15/+8, setter-on-bench-penalty
   +20. Hand-tuned to ArchaEye. Re-tune across ≥ 5 saved teams.
10. **TSDoc lint gate** — Required-change #4/#5 surface coverage gaps;
    consider lifting the §10 review gate to an ESLint rule
    (`eslint-plugin-tsdoc` + `jsdoc/require-jsdoc`) before this volume
    of new exports compounds further.
