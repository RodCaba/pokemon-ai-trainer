# Stage 6 review — team-support-pillar

## 1. Summary verdict

Ship with the recommended changes below. The slice is solid: TDD discipline
on Stage 4→5 was clean (stubs at e5dc223 are genuine no-op stubs; every
behavior in 4e7ecc7 has a covering red), schemas are well-typed, the
classifier is pure and deterministic, and the live-demo bar is met
(synergy 22→50, support 100, all 10 scenarios pick a setter+sweeper).
Two real concerns block a clean merge: (a) the `c4bf7e4` weather commit
collapsed red+green for non-pure logic, which is a §3 process violation
that needs to be acknowledged in writing; (b) migration `0011` is
inconsistent with `drizzle-schema.ts` (missing CHECK in the migration
SQL), which will bite the next fresh-DB rebuild. Two plan deviations
(priority swap, wallbreaker exclusion) are reasonable and should be
ratified as plan amendments rather than re-litigated.

## 2. Required changes

1. **`src/db/migrations/0011_insights_phase_tag.sql:13`** — the migration
   adds the `phase_tag` column with no CHECK constraint, yet
   `src/db/drizzle-schema.ts:649` declares
   `CHECK (phase_tag IS NULL OR phase_tag IN ('lead','mid','late'))`.
   On any fresh `pnpm drizzle-kit migrate` the schema (truth per memory
   `db_orm_drizzle.md`) and the on-disk DB diverge — bad-value rows can
   land. Fix: extend the migration with the table-rebuild that drizzle-kit
   would normally emit for a column-level CHECK, OR drop the CHECK from
   the drizzle schema and rely on app-layer enum validation. Either is
   fine; drift is not.

2. **`c4bf7e4` (weather commit) — process violation per CLAUDE.md §3.**
   The commit lands the classifier weather-detection branches
   (`src/data/tactical/role-tags.ts:60-82,212-226`) and the new
   support-lift gating (`src/data/tactical/score-pair.ts:135-165`) in a
   single commit with the W1..W11 tests. These are non-pure-data logic
   changes (weather classifier + scoring rule), so the §3 pure-data
   exemption does NOT apply. Required: append a paragraph to
   `docs/plans/team-support-pillar.md` (or the PR description) under a
   new `Deviations` section disclosing the deviation per the §12 rule
   ("Record the deviation in the commit message"). No re-do of the work
   — but the discipline lapse must be on the record so it doesn't
   become precedent.

3. **`src/agents/insights-tools.ts:30 + :60-63`** — Q9 binding says the
   parameter is in the schema but not in the description AND the handler
   does not pass it through. The description is fine, but
   `invokeInsightsSearch` *silently drops* `args.phase_tag_filter`
   instead of threading it into `filter.phase_tag`. Per Q9 "Stage A:
   parameter accepted but unused at the prompt level" this is consistent
   with the binding; HOWEVER the input_schema generated via
   `zodToJsonSchema(InsightSearchArgsSchema)` exposes the field to the
   model. Either (a) strip `phase_tag_filter` from the JSON Schema
   surfaced to Anthropic (e.g. omit from the tool definition, or hide
   behind a flag) or (b) wire it through the handler now. Picking (b)
   is the smaller diff and it's already fully tested at the store layer
   (DB3). Recommend (b).

4. **`src/data/tactical/score-synergy.ts:338-339`** — Stage 5 introduces
   a hard score floor (`scoreFloat = max(scoreFloat, 50)`) when
   `role_coherence` holds. Plan §3.2 / §5.3 only specified a `+20`
   floor on the archetype component. The hard 50-floor is what makes
   SY5 pass on the live ArchaEye fixture but it is wider than the plan.
   Either revise the plan §5.3 wording to "the archetype 0.5 floor AND
   a 50 score floor when role_coherence holds" or remove the score-level
   floor and rely solely on the archetype-component lift. If the score
   floor stays, surface it in the synergy evidence (e.g.
   `evidence.score_floor_applied = true`) so reviewers can spot it
   downstream.

## 3. Recommended changes

5. **`tests/db/insights-phase-tag.test.ts:51` duplicates `seedChunk`
   from `tests/db/insights-repo.test.ts:58`.** Move both to
   `tests/_helpers/seed-chunk.ts`. Two copies today, three the next
   time someone adds an insights test.

6. **`src/data/tactical/pillars.ts:99-104` permissive cast.** The
   `team as unknown as { sets?: ReadonlyArray<Record<string, unknown>> }`
   exists because `overview.ts` synthesises a fake team that doesn't
   match `UserTeamSchema`. Cleaner: define a narrow
   `RoleTagTeamView { sets: ReadonlyArray<{...}> }` interface that
   `buildRoleAssignments` consumes, and have `overview.ts` build that
   view explicitly. Removes the `as unknown as` and makes the synthetic
   path typed.

7. **`weather_provided` / `weather_dependency` naming.**
   `weather_dependency` is read by humans as "this set depends on
   weather" but actually means "this set has a weather-charged move."
   `weather_charged_move` (or `weather_required_move`) is clearer.
   Trivial rename in `src/schemas/tactical.ts:140` +
   `src/data/tactical/role-tags.ts` + `score-pair.ts`.

8. **`pureSetterLead` (score-pair.ts:135).** The local name reads
   ambiguously — "pure" as in "the only role" vs "unalloyed setter."
   Rename to `dedicatedSetterLeadId`. Same diff size.

9. **`+25` and `+60` magnitudes (score-pair.ts:154,162).** Hand-tuned to
   one team's demo. Recommend: extract them as named constants near
   `SUPPORT_LIFT_DELTA` (`STRUCTURAL_LEAD_BONUS = 25`,
   `WEATHER_MATCH_BONUS = 60`) so the calibration follow-up has one
   place to edit. Also add a `// TODO(stage6-deferred):
   support-lift-magnitude-calibration` comment near them per the memory
   `labmaus_pokepaste_deferred_todos.md` precedent.

10. **`tests/tools/insights/extract.test.ts:197`** still asserts
    `prompt_version: "v1.0"` (not in the diff but it's now technically
    a "v1.0 happens to be accepted via DI" artifact). Audit whether
    that test is still meaningful after Q8 — keep as-is but add a
    one-line comment noting v1.0 is exercised here only as a DI
    parameter, not as the production default.

## 4. Plan-amendment candidates

A. **Priority order swap** —
   `src/data/tactical/role-tags.ts:97-109` puts
   `speed_control_setter > screen_setter` (plan §3.1 had the reverse).
   Justified by the Whimsicott golden + VGC convention; ratify in plan
   §3.1.

B. **Wallbreaker mutual-exclusion** —
   `src/data/tactical/role-tags.ts:191-199` makes wallbreaker exclusive
   with every structural tag (incl. setter sub-tags + setup_sweeper via
   ability). Plan §3.1 listed it as conditional on no setup-MOVE only,
   which produced `[setup_sweeper, wallbreaker]` on Archaludon (Stamina)
   — a contradiction. Ratify the broader exclusion in plan §3.1.

C. **Cleaner detection relaxation** — plan required "BP-100+ STAB move +
   base spe ≥ 90 + Choice Scarf." Implementation drops the BP gate
   because the moves DB doesn't carry `base_power` yet. Ratify in plan
   §3.1 + add to deferred refinements (note J3 below).

D. **Synergy 50-score floor (if Required-change #4 leaves it in).**

## 5. Optional / nice-to-haves

- The `RoleTagInput` interface adds friction for
  `buildRoleAssignments` and arguably for Stage B too. Worth
  considering whether `RoleTagInput` could become a derived type from
  `TeamSet` (e.g. `Pick<TeamSet, ...> & { species_id, base_stats }`)
  so callers stop manually flattening.
- Consider exporting `TAG_PRIORITY` from `role-tags.ts` so Stage B can
  consume the same canonical ordering instead of redefining it.
- `untagged` is in the `RoleTag` enum but Stage B's plan-candidate
  generator may want to treat it as "no role." A type alias
  `ConcreteRoleTag = Exclude<RoleTag, "untagged">` would help readers.

## 6. Deferred-to-Q5-calibration

- Plan §10 success criterion "≥1 scenario picks Sableye+Archaludon" is
  not met (Pelipper+Archaludon wins instead, per c4bf7e4 demo log).
  Acceptable for Stage A — both are the rain core; the plan should be
  updated to read "≥1 scenario picks a (rain weather_setter, Archaludon)
  pair." Track in the calibration follow-up.
- The `+12 / +25 / +60` magnitudes are hand-tuned to one team. The
  calibration slice should retune across ≥5 saved teams.
- The `+15` `role_coherence_bonus` is tuned to clear the 22→50 SY5 bar
  on one team; revisit alongside the magnitudes.
- `cleaner` BP gate (recommendation 9 + amendment C) deferred until the
  moves DB exposes `base_power`.
- `phase_tag` backfill on pre-existing insight rows (already inline-TODO'd
  per plan §15.5).
- Mechanism-compat (c) is now PARTIALLY shipped (weather only) via
  c4bf7e4. The plan §1 deferral note should be updated: weather pairing
  is in; screens/speed-control compat is still deferred.
- TSDoc audit: every new export carries the six-element block (summary,
  when-to-use, @param, @returns, @throws, @example for non-trivial). One
  weak spot — `WeatherKindSchema` (schemas/tactical.ts:123) has only a
  doc-line; that's fine for a pure enum schema. No required fixes.
