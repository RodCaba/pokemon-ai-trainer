# Tech Plan — Team Phase Plan (Stage B)

**Slug:** `team-phase-plan`
**Branch:** `feat/team-phase-plan`
**Stage:** Stage 3 — Tech plan (pending approval)
**Date:** 2026-05-09
**Author:** Tech Lead subagent
**Implements flow doc:** `docs/flows/team-support-and-phases.md` (Stage 2 reviewed 2026-05-09 by Rodrigo Caballero — §13). Stage A binding answers Q1–Q12 in the flow doc still apply; the **revised** Q8 (replace, not add) and the **shipped** Q9 (phase_tag in schema) are the load-bearing inputs for this slice.

**Memory citations:**
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/db_orm_drizzle.md` — no schema or migration in Stage B; we only read `insights.phase_tag` (added by Stage A migration 0011).
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_no_tera.md` — plan output must not surface any `tera_*` field on phases or rationale strings.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_roster.md` — phase actors are species_roster_ids; fixtures stay Reg M-A legal.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/test_fixtures_no_invariant_blobs.md` — phase-rationale goldens commit input team JSON + expected phase tuples written in test code, not opaque output blobs.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/labmaus_pokepaste_deferred_todos.md` — every deferred follow-up lands as inline `// TODO(stage6-deferred): …` so it surfaces in grep.

**Sibling precedents:**
- `docs/plans/team-support-pillar.md` — Stage A. Direct predecessor; owns the role classifier, `buildRoleAssignments`, `scoreSupport`, `computeSupportLift`, `STRUCTURAL_LEAD_BONUS`, `WEATHER_MATCH_BONUS`, the `Insight.phase_tag` schema field, and the cross-call calc cache. Stage B **consumes** these unchanged.
- `docs/plans/team-tactical-overview.md` — grandparent. Owns `scorePair`, `collectKeyCalcsForPair`, `findCitations`, `pickConfidence`, the calc cache, the existing `score_pillars` + `recommend_leads` agent tools. Stage B **reshapes** the second tool and **reuses** every other primitive.
- `docs/plans/youtube-insights.md` — owns the `insights` table + `insightStore.search` + the `phase_tag_filter` field on `InsightSearchArgsSchema`. Stage B is the first consumer of `phase_tag_filter`.

**First-of-kind for this slice:**
- **Plan candidate scorer.** First search over `(leads, mid_pivot, cleaner)` triples; first composition of `scorePair` with two new pure phase-scorers.
- **Replacement of an agent-callable tool.** `recommend_leads` is the first agent tool to be **removed** mid-project. Stage B introduces `recommend_team_plan` in its place.
- **Phase-filtered Insight retrieval.** First consumer of `insightStore.search({ filter: { phase_tag } })`. Establishes the fallback contract for the (large, pre-Stage-A) corpus where `phase_tag` is NULL.
- **Schema version 3 with reshape.** First time `TeamTacticalOverviewSchema` carries a non-additive break (`scenarios[]` element shape changes from `ScenarioOverview` to `TeamPlanScenario`).

---

## 1. Goal recap

Ship the **phase-aware plan** end-to-end: for every scenario the overview generates, emit a three-phase `TeamPlan` (`lead` / `mid` / `late`) with per-phase actors, rationale, key calcs, and citations. Concrete deliverables:

- `TeamPlanScenarioSchema` — the new per-scenario object that **replaces** `ScenarioOverviewSchema` inside `TeamTacticalOverview.scenarios[]`. Carries `name`, `type`, `field`, `opposing_preview`, `description?`, `citations`, `confidence`, `plan_score`, and the typed 3-tuple `phases: [LeadPhase, MidPhase, LatePhase]`.
- `LeadPhaseSchema` / `MidPhaseSchema` / `LatePhaseSchema` per flow §6.1, with `turn_window`, role-typed actor fields, `rationale ≤ 300 chars`, `key_calcs ≤ 2`, and per-phase trigger/abandon/win-condition strings.
- `recommendTeamPlan(team, scenario, calcCache, deps) → TeamPlanScenario` — the new orchestrator that replaces `recommendLeads`. Generates plan candidates, scores them, picks the best, builds deterministic phase rationale, attaches phase-aware citations.
- New pure modules `score-mid-phase.ts`, `score-late-phase.ts`, `cite-phases.ts`, `phase-rationale.ts`.
- `recommend_team_plan` agent tool **replaces** `recommend_leads` in `src/agents/tactical-tools.ts` + the registry in `src/db/tool-definitions.ts`. The corresponding `recommend` / `recommend-leads` CLI subcommand in `scripts/data/tactical.ts` is replaced by `plan`.
- `schema_version: 2 → 3` on `TeamTacticalOverviewSchema`.
- Phase-aware retrieval via Stage A's `insightStore.search(query, { filter: { phase_tag: "lead" | "mid" | "late" } })`, with the documented fallback for pre-backfill NULL rows.

**Done means:**
1. Live ArchaEye end-to-end (manual demo, not CI): `pnpm data:tactical plan 01KR7TVD21G1Q99BK0NAEARFD8` returns 10 plans; ≥ 6 carry `phases[0].active ∈ { [sableye, archaludon], [pelipper, archaludon] }`, `phases[1].pivot_in == sinistcha`, `phases[2].cleaner == basculegion`. ≥ 7 of 10 plans show `plan_score ≥ legacy_pair_score` for the SAME leads (per flow §10).
2. The legacy `recommend_leads` tool, handler, and `recommend` CLI subcommand are gone; only `recommend_team_plan` and `plan` remain. Regression tests assert removal.
3. `phase_tag`-filtered citation retrieval emits a per-phase citation on ≥ 5 of 10 scenarios for ArchaEye (per flow §10); fallback to the no-`phase_tag` path is exercised on the remaining scenarios.
4. All Stage-A `team-support-pillar` tests + Stage-A overview tests stay green after the migration to `schema_version: 3`.
5. The 5 golden fixtures from Stage A (ArchaEye, Charizard, TR, Tailwind HO, Sand) produce deterministic plan tuples — committed as expected-phase-shape assertions in test code per memory `test_fixtures_no_invariant_blobs.md`.

**Out of scope (deferred — NOT this slice):**
- Backfilling `phase_tag` on pre-Stage-A `insights` rows. Deferred by Stage-A plan §15.5 (`// TODO(slice-deferred): backfill phase_tag on pre-existing insights`). Stage B handles the absence via fallback (§7) and is the trigger event for that backfill follow-up.
- LLM-generated phase prose (flow §11 deferral). All rationale strings are template-built.
- Simulated turn-3 board state. Mid-phase scoring approximates as 1-vs-1 against the ORIGINAL `opp_leads` (flow §6.3, §11). Deferred follow-up `// TODO(stage6-deferred): mid-phase-true-board-sim`.
- Plan coefficient calibration (mid-weight 0.6, late-weight 0.8, role-chain-bonus +15). Hand-tuned ships as-is. Deferred `// TODO(stage6-deferred): phase-plan-coefficient-calibration`.
- Persistence. Plans are computed on demand (same posture as Stage A and the parent `team-tactical-overview`).

---

## 2. Module boundaries

All paths absolute under `/Users/rodrigo/src/pokemon-ai-trainer/`. **NEW** unless marked.

### 2.1 Schemas

#### `src/schemas/tactical.ts` *(extend; bump 2 → 3; reshape)*
- **Add** `LeadPhaseSchema`, `MidPhaseSchema`, `LatePhaseSchema`, `PhaseSchema` (discriminated union for tests/internal use only — the production shape uses the typed tuple).
- **Add** `TeamPlanScenarioSchema` — the new per-scenario object (see §3).
- **Replace** `TeamTacticalOverviewSchema.scenarios` array element type: was `ScenarioOverviewSchema`, becomes `TeamPlanScenarioSchema`.
- **Bump** `TeamTacticalOverviewSchema.schema_version: z.literal(2) → z.literal(3)`.
- **Remove** `RecommendLeadsInputSchema`, `RecommendLeadsOutputSchema` from the public export surface (tests asserting removal — see §10).
- **Add** `RecommendTeamPlanInputSchema = z.object({ team_id, scenario_name? }).strict()`.
- **Add** `RecommendTeamPlanOutputSchema = z.object({ team_id, scenarios: z.array(TeamPlanScenarioSchema).min(1) }).strict()`.
- **Keep** `ScenarioOverviewSchema` exported as `@deprecated` for ONE transition period — only because Stage A's tests reference it for the `support_lift` regression checks. **Q5 decision proposal (§17.Q5):** keep, marked deprecated; remove in the Stage-6 review pass when no consumer remains. Alternative: remove now, rewrite Stage A tests — bigger blast radius, not worth it.
- Pure-data CLAUDE.md §3 exemption applies to the schema additions; S1..S6 batched in one Stage-4 commit.

#### `src/schemas/insight.ts` *(no change)*
- `phase_tag` field landed in Stage A. Stage B is the first consumer. No edits.

### 2.2 Data layer (`src/data/tactical/`)

| File | Disposition | Responsibility |
|---|---|---|
| `recommend-plan.ts` | **NEW** | Replaces `recommend-leads.ts`. `recommendTeamPlan(team, scenario, calcCache, deps) → TeamPlanScenario`. Builds plan candidates, scores, picks best, attaches phase rationale + key calcs. |
| `score-mid-phase.ts` | **NEW** | Pure scorer for the mid-phase actor against `scenario.opposing_preview` (incoming-damage survival + 0.5 × outgoing-damage). |
| `score-late-phase.ts` | **NEW** | Pure scorer for the cleaner against the panel's 2 most-bulky members weighted by usage. |
| `cite-phases.ts` | **NEW** | Per-phase citation retrieval. Wraps `insightStore.search` with the phase filter + species filter; falls back when `phase_tag` returns empty. |
| `phase-rationale.ts` | **NEW** | Deterministic template builders for the three phase rationale strings; reproduces the prose style of `buildReasoning` in `recommend-leads.ts:199–227`. |
| `recommend-leads.ts` | **DELETED** | Q4 binding: full rewrite, not extension. The output object shape is different and the scoring formula composes scorers `recommend-leads` doesn't know about. Extending would tangle two regimes. |
| `overview.ts` | **EXTEND** | Calls `recommendTeamPlan` per scenario in place of `recommendLeads`. Bumps emitted `schema_version: 2 → 3`. Maps the result into the new `scenarios[]` shape. |
| `cite.ts` | **REUSED** | `findCitations` is called by `cite-phases.ts` as the post-phase fallback for the legacy (non-phase-filtered) species lookup. |

### 2.3 Tool layer

#### `src/agents/tactical-tools.ts` *(extend; replace)*
- **Remove** `recommendLeadsTool`, `handleRecommendLeads`, `RecommendLeadsInput`/`Output` imports.
- **Add** `recommendTeamPlanTool: Tool` — Anthropic SDK tool definition with the new description (§4).
- **Add** `handleRecommendTeamPlan(input, deps) → RecommendTeamPlanOutput`.
- **Update** `TACTICAL_TOOL_DEFINITIONS` from `[scorePillarsTool, recommendLeadsTool]` to `[scorePillarsTool, recommendTeamPlanTool]`.

#### `src/db/tool-definitions.ts` *(extend if it indexes tactical tools by name)*
- Grep audit at the start of Stage 4 confirms whether this file references `recommend_leads` by string. If yes, swap to `recommend_team_plan`. If not, no edit. (Stage-A plan §17 made the parallel call for `score_pillars` — same dispatch table.)

### 2.4 CLI

#### `scripts/data/tactical.ts` *(extend; replace)*
- **Remove** the `case "recommend":` and `case "recommend-leads":` branches.
- **Add** `case "plan":` invoking `handleRecommendTeamPlan({ team_id, scenario_name? }, deps)`.
- Update the file's top-of-file argv comment.

### 2.5 DB layer

No edits. `phase_tag` column + `phase_tag_filter` argument both landed in Stage A.

### 2.6 Tests (paths only — full ordering in §10)

```
tests/schemas/tactical-team-plan.test.ts                  (S1..S6 — pure-data exemption)
tests/data/tactical/plan-candidates.test.ts               (PG1..PG6)
tests/data/tactical/score-mid-phase.test.ts               (PS1..PS4)
tests/data/tactical/score-late-phase.test.ts              (PS5..PS8)
tests/data/tactical/plan-scoring.test.ts                  (PS9..PS12 — composition + chain bonus)
tests/data/tactical/phase-rationale.test.ts               (PR1..PR5)
tests/data/tactical/cite-phases.test.ts                   (PC1..PC5)
tests/data/tactical/recommend-plan.test.ts                (RP1..RP6)
tests/data/tactical/overview-phase.test.ts                (OV1..OV4)
tests/agents/tactical-tools-plan.test.ts                  (T1..T5 — including removal regression)
tests/scripts/tactical-cli-plan.test.ts                   (CLI1..CLI3)
tests/data/tactical/recommend-leads-removed.test.ts       (RM1..RM3 — module + tool + CLI subcommand all gone)
```

---

## 3. Data schemas (zod)

Pure-data per CLAUDE.md §3 — schema additions land in one batched commit; S1..S6 lock the contract.

```ts
// src/schemas/tactical.ts (additive + reshape)

// Stable RosterId regex already exists in-file.

const TurnWindowSchema = z.tuple([z.number().int().min(1), z.number().int().min(1)])
  .refine(([a, b]) => a <= b, "turn_window start must be ≤ end");

export const LeadPhaseSchema = z.object({
  phase: z.literal("lead"),
  turn_window: TurnWindowSchema,                       // [1, 2]
  active: z.tuple([RosterId, RosterId]),               // two species_roster_ids
  rationale: z.string().max(300),
  key_calcs: z.array(CalcResultRefSchema).min(0).max(2),
  abandon_if: z.string().max(200),
  /** Q9: preserve Stage A's introspection signal. */
  support_lift: z.number().optional(),
}).strict();

export const MidPhaseSchema = z.object({
  phase: z.literal("mid"),
  turn_window: TurnWindowSchema,                       // [2, 4]
  pivot_in: RosterId,
  pivot_out: RosterId.nullable(),
  rationale: z.string().max(300),
  key_calcs: z.array(CalcResultRefSchema).min(0).max(2),
  trigger: z.string().max(200),
}).strict();

export const LatePhaseSchema = z.object({
  phase: z.literal("late"),
  turn_window: TurnWindowSchema,                       // [4, 8]
  cleaner: RosterId,
  rationale: z.string().max(300),
  key_calcs: z.array(CalcResultRefSchema).min(0).max(2),
  win_condition: z.string().max(200),
}).strict();

/** Discriminated union — exported for type guards but production uses the
 *  strongly-typed 3-tuple (Q5 §17). */
export const PhaseSchema = z.discriminatedUnion("phase", [
  LeadPhaseSchema, MidPhaseSchema, LatePhaseSchema,
]);

/** Per-scenario plan that REPLACES ScenarioOverview inside TeamTacticalOverview. */
export const TeamPlanScenarioSchema = z.object({
  name: z.string().min(1),
  type: ScenarioTypeSchema,                            // unchanged enum from Stage A
  field: ScenarioFieldSchema,
  opposing_preview: z.array(RosterId).min(1).max(6),
  description: z.string().max(800).optional(),
  phases: z.tuple([LeadPhaseSchema, MidPhaseSchema, LatePhaseSchema]),
  plan_score: z.number(),
  citations: z.array(TacticalCitationSchema).min(0).max(3),
  confidence: z.enum(["low","medium","high"]).optional(),
}).strict();

// TeamTacticalOverviewSchema reshape:
//   schema_version: z.literal(3)            (was 2)
//   scenarios: z.array(TeamPlanScenarioSchema).min(5).max(10)   (was ScenarioOverviewSchema[])

// Agent-tool I/O
export const RecommendTeamPlanInputSchema = z.object({
  team_id: z.string(),
  scenario_name: z.string().optional(),
}).strict();
export const RecommendTeamPlanOutputSchema = z.object({
  team_id: z.string(),
  scenarios: z.array(TeamPlanScenarioSchema).min(1),
}).strict();
```

**Deprecated but preserved (one transition window):**
- `ScenarioOverviewSchema` and its inferred type stay exported with a `@deprecated — Stage B replaced this with TeamPlanScenarioSchema; kept only so Stage A regression tests still import it. Remove in the Stage-6 review pass when no consumer remains.` TSDoc block.
- `RecommendLeadsInputSchema` / `RecommendLeadsOutputSchema` — **removed outright** (the tool is gone; Stage A doesn't depend on these for non-tool purposes).

---

## 4. Tool contracts

### 4.1 `recommend_team_plan` *(NEW; replaces `recommend_leads`)*
- **Anthropic SDK Tool definition** (in `src/agents/tactical-tools.ts`):
  ```
  name: "recommend_team_plan"
  description: "Generate a 3-phase plan (lead / mid / late) for a saved user
    team against a scenario. Returns one TeamPlanScenario when `scenario_name`
    is set, all scenarios otherwise. Each phase carries actors, a short
    rationale, ≤ 2 supporting calcs, and a turn window. Use AFTER
    score_pillars — pillar scores tell you which scenario the user's question
    maps to. Replaces the legacy `recommend_leads` tool: phases[0] carries the
    same lead pair plus the now-load-bearing mid-pivot and cleaner. **CONFIDENCE
    PROTOCOL** unchanged from recommend_leads: on `confidence='low'`, chain a
    web_search before quoting. Do NOT use to compare two teams (out of scope)."
  input_schema: { team_id: string, scenario_name?: string }
  ```
- **Handler signature:**
  ```ts
  export function handleRecommendTeamPlan(
    input: RecommendTeamPlanInput,
    deps: TacticalToolDeps,
  ): RecommendTeamPlanOutput
  ```
- **Pre/post:** team must be saved + validation-clean (same gates as `recommendLeads`); on draft/invalid throws `TacticalOverviewError`. Output validated via `RecommendTeamPlanOutputSchema.parse` before return.
- **Cache:** reuses Stage A's calc cache; no new keys.
- **Throttle:** none — pure CPU path after `buildOverview`.

### 4.2 `recommend_leads` *(DELETED)*
- Tool removed from `TACTICAL_TOOL_DEFINITIONS`.
- Handler removed.
- Schema types removed.
- All references in `scripts/data/tactical.ts`, `tests/agents/tactical-tools.test.ts`, `tests/data/tactical/recommend-leads.test.ts` are deleted or rewritten in this PR.

### 4.3 `score_pillars` *(no change to inputs/outputs)*
- Description prose unchanged. The scenarios it surfaces inside the bundled `buildOverview` JSON now carry plans, not lead triples — but `score_pillars` only emits the pillar bundle, not the scenarios, so its contract is untouched.

### 4.4 `insights_search` *(no change)*
- Already accepts `phase_tag_filter` from Stage A. Stage B's `cite-phases.ts` passes it through.

---

## 5. Plan candidate generation (flow §6.2)

Module: `src/data/tactical/recommend-plan.ts`. Pure function `generatePlanCandidates(team, scenario, roleAssignments) → PlanCandidate[]`.

`PlanCandidate` shape:
```ts
interface PlanCandidate {
  leads:   [number, number];          // slot indices
  mid:     number;                    // slot index
  cleaner: number;                    // slot index
}
```

Algorithm:
1. Enumerate `(leads, mid, cleaner)` triples over slot indices [0..5] subject to disjointness `|{leads[0], leads[1], mid, cleaner}| = 4`.
2. **Hard role pruning (Q4 in flow §6.2):**
   - **Leads gate:** at least one of `leads` carries a role tag in `{screen_setter, speed_control_setter, weather_setter, redirect, disruptor, wallbreaker}`. Otherwise candidate dropped.
   - **Setter-on-bench penalty:** if the team has any setter (sub-tag of `setter`) AND none of `leads` carries a setter sub-tag, candidate stays in the search but `plan_score -= 20`.
   - **Cleaner gate:** the `cleaner` slot's set MUST satisfy `(base_spe ≥ 90) OR (item == "Choice Scarf") OR has_priority_move`. Otherwise candidate dropped. `has_priority_move` reuses Stage A's role-tag derivation — a set carrying `primary == "cleaner"` already passed this gate during classification; for slots that don't carry `cleaner` we recheck via the move table.
   - **Mid gate:** the `mid` slot's role tags include any of `{cleric, redirect, pivot, wallbreaker, setup_sweeper, disruptor}` (broader than flow §6.2 to cover the Archaludon-as-mid case in scenarios where the leads are Sableye + something-else). Pure-cleaner mids are dropped — cleaners belong in the late phase.
3. **Worst case** for a 6-team: 15 lead pairs × 4 mid candidates × 3 cleaner candidates = 180; after role pruning typically 30–60. With 10 scenarios × ~50 candidates × ~3 calcs per candidate ≈ 1500 `damage_calc` calls. **Cache budget:** Stage A's lead-pair search already issued the 15-pair × 2-opponent × 4-move loop per scenario; mid-phase + late-phase calls add ~600 new keys per scenario but reuse the same `(attacker_set, defender_set, field, move)` hash so most hit warm after the first scenario.

---

## 6. Plan scoring (flow §6.3)

`scorePlan(candidate, scenario, scoringTeam, scoringPanel, calcCache, deps) → number`:

```
plan_score =
    1.0 * pair_score(candidate.leads,   scenario)        // scorePair, unchanged
  + 0.6 * mid_phase_score(candidate.mid, scenario)
  + 0.8 * late_phase_score(candidate.cleaner, scenario)
  + role_chain_bonus(candidate)
  - setter_on_bench_penalty(candidate)                   // 20 if applicable, else 0
```

### 6.1 `mid_phase_score(mid_slot, scenario)`
Pure module `score-mid-phase.ts`. Reuses `damage_calc` via `CalcCache`. Approximates the turn-3 board as a 1-vs-1 between `mid` and each of `scenario.opposing_preview` (typically 2 species).

```
mid_phase_score =
    survival_score(mid vs opp_leads)
  + 0.5 * outgoing_damage_score(mid vs opp_leads)
```

- `survival_score` = `100 - clamp(avg_max_roll_pct(opp_leads attacking mid), 0, 100)`. Higher = mid lives longer.
- `outgoing_damage_score` = `avg(best_max_roll_pct(mid's 4 moves vs each opp_lead))`.

`mid_phase_score` range: 0..150 (survival 0–100 + outgoing 0–50 weighted at ×0.5). Folded at `0.6` into `plan_score` → max contribution +90.

### 6.2 `late_phase_score(cleaner_slot, scenario, panel)`
Pure module `score-late-phase.ts`. Computes the cleaner's best max-roll % against the **2 most-bulky** panel members (sort by `spec.sps.hp + spec.sps.def + spec.sps.spd` desc, take top 2) **weighted by usage** (`panel.entries[].weight`).

```
late_phase_score =
    Σ weight_i * best_max_roll_pct(cleaner vs bulky_i)
```

Range 0..100. Folded at `0.8` → max contribution +80.

Rationale: cleaners are judged on revenge-kill capability against survivors, not raw lead-game KO pressure. Picking the 2 bulkiest panel members is a proxy for "who's likely still alive at turn 5" — accurate enough for v1 without a real attrition sim (the proper sim is the `// TODO(stage6-deferred): mid-phase-true-board-sim` follow-up).

### 6.3 `role_chain_bonus(candidate)`
```
let chain_setter   = any leads carry a setter sub-tag
let chain_cleric   = mid carries `cleric` OR `redirect`
let chain_cleaner  = cleaner carries `cleaner` OR `setup_sweeper`
hits = chain_setter + chain_cleric + chain_cleaner       // 0..3
bonus = hits >= 3 ? +15 : hits >= 2 ? +8 : 0
```

Magnitudes hand-tuned (Q3 in §17 proposes +15 / +8 / 0). The bonus rewards the canonical setter → cleric → cleaner backbone the user described for ArchaEye, without overpaying when only two parts of the chain are present.

---

## 7. Phase rationale (flow §6.4)

Module `phase-rationale.ts`. Deterministic templates only — Q8 in §17 confirms ≤ 300 chars with the deferred lever to widen to 400. Reproduces the prose voice of `recommend-leads.ts:199–227` (capitalized species names, top-calc snippet, terse "Pair score X.X." tail).

```ts
buildLeadRationale(input) → string                 // ≤ 300
buildMidRationale(input) → string                  // ≤ 300
buildLateRationale(input) → string                 // ≤ 300
buildAbandonIf(lead_phase, scenario) → string      // ≤ 200
buildMidTrigger(mid_phase, scenario) → string      // ≤ 200
buildWinCondition(late_phase, scenario) → string   // ≤ 200
```

Each builder takes the actor ids, the role-tag assignments, the top `CalcResultRef` for that phase, and the scenario field; emits a single string. Truncates on the last word before 300 chars and appends `…` (mirroring `recommend-leads.ts:224`).

Example output for ArchaEye vs Sand (flow §6.4):
```
Lead   T1–T2  Sableye (screen_setter) + Archaludon (setup_sweeper) — screens up, Rain Dance to chip Sand. Archaludon's Electro Shot OHKOs Hippowdon (102% max). Pair score 88.4.
Mid    T2–T4  Sinistcha (cleric) — Rage Powder redirects Excadrill's Earthquake; Life Dew restores 50%. Trigger: Sableye falls or screens expire.
Late   T4–T8  Basculegion (cleaner) — Choice Scarf Last Respects revenge KOs Tyranitar (118% max). Win condition: Archaludon clears a slot; Basculegion clicks Last Respects.
```

---

## 8. Phase-aware citation retrieval (flow §6.5)

Module `cite-phases.ts`. Per phase, query Stage A's `insightStore.search(query, { filter, limit })`:

| Phase | `claim_type` filter | `phase_tag` filter | Species filter |
|---|---|---|---|
| lead | `["lead", "tech"]` | `"lead"` | `phases[0].active` (both) |
| mid  | `["tech", "matchup"]` | `"mid"` | `[phases[1].pivot_in]` |
| late | `["tech", "counter", "matchup"]` | `"late"` | `[phases[2].cleaner]` |

`limit = 1` per phase; total ≤ 3 per plan.

**Fallback (binding from Q9-shipped + flow §15):** when the `phase_tag` filter returns zero hits, re-issue the same query WITHOUT the `phase_tag` filter (so a pre-Stage-A NULL-tagged Insight can still match by species + claim_type). The returned citation carries a `phase_tag_source: "phase_specific" | "fallback"` field (Q6 in §17). Implementation: extend `TacticalCitationSchema` with `phase_tag_source: z.enum(["phase_specific", "fallback"]).optional()`.

When BOTH paths return empty: omit the citation for that phase. Top-level `citations[]` on `TeamPlanScenario` aggregates the per-phase wins in order; zero is acceptable (mirrors Stage A's no-citation case).

---

## 9. Error model

Reuse existing classes; no new error classes needed.

| Class | Trigger | Severity |
|---|---|---|
| `TacticalOverviewError` (reused) | Team draft / validation_errors / not found | fail-loud (200 → caller surfaces) |
| `TacticalOverviewError` (reused) | Zero plan candidates after pruning — theoretically impossible on a legal 6-mon team but defensive: log warning, **fall back to a degenerate plan** that picks the highest-pair_score leads + arbitrary mid (highest BST remaining) + arbitrary cleaner (highest base_spe remaining), and emit `confidence: "low"`. Does NOT throw. | warn-and-continue |
| `KnowledgeStorageError` (reused) | `insightStore.search` fails (rare — DB-level error) | propagates; the orchestrator catches and emits zero citations for that phase |

**Plan-output validation:** `recommendTeamPlan` parses its result through `TeamPlanScenarioSchema.parse` before return. Validation failure is a programming error and throws (uncaught path — Stage 6 reviewer flags).

---

## 10. Test strategy + ordering

TDD per CLAUDE.md §3. Write order = numbered order below. Per-test red-first cycle for non-pure modules; §3 pure-data exemption applies to S1..S6 (single batched commit).

**Total: 51 tests** (S×6 + PG×6 + PS×12 + PR×5 + PC×5 + RP×6 + OV×4 + T×5 + CLI×3 + RM×3 — see grand-total tally below).

### Pure-data exemption batch — schemas (S1..S6)
| # | File | Asserts | Fails because |
|---|---|---|---|
| S1 | `tests/schemas/tactical-team-plan.test.ts` | `LeadPhaseSchema` round-trips a fully-populated lead phase; rejects `phase: "opener"` | enum/literal wrong |
| S2 | same | `MidPhaseSchema` accepts `pivot_out: null`; rejects `pivot_out: undefined` | nullable vs optional |
| S3 | same | `LatePhaseSchema.key_calcs` max 2; rejects 3 | bound missing |
| S4 | same | `TeamPlanScenarioSchema.phases` is a strict 3-tuple in [lead, mid, late] order; permutation rejected | tuple order |
| S5 | same | `TeamTacticalOverviewSchema` rejects `schema_version: 2`, accepts `3` | bump not applied |
| S6 | same | `RecommendTeamPlanInputSchema.scenario_name` optional; `RecommendTeamPlanOutputSchema.scenarios` ≥ 1 | param wrong |

### Plan candidate generation (PG1..PG6 — strict per-test)
| # | File | Asserts | Fails because |
|---|---|---|---|
| PG1 | `tests/data/tactical/plan-candidates.test.ts` | ArchaEye + neutral scenario → ≥ 1 candidate where `leads = [sableye_slot, archaludon_slot]`, `mid = sinistcha_slot`, `cleaner = basculegion_slot` | enumerator broken |
| PG2 | same | A team with zero setters → leads-gate drops candidates lacking a wallbreaker/disruptor too → 0 candidates (or fallback emits degenerate) | gate too tight |
| PG3 | same | Cleaner gate: candidate with `cleaner` slot carrying base_spe 60, no Scarf, no priority → dropped | gate wrong |
| PG4 | same | Setter-on-bench: setter slot NOT in `leads` → that candidate carries `-20` penalty marker | penalty missing |
| PG5 | same | Candidate count for ArchaEye ≥ 30 and ≤ 60 (Q7 binding) | enumerator broken |
| PG6 | same | Slot disjointness — `leads ∪ {mid, cleaner}` always 4 distinct slots | overlap leaks |

### Mid-phase scorer (PS1..PS4)
| # | File | Asserts | Fails because |
|---|---|---|---|
| PS1 | `tests/data/tactical/score-mid-phase.test.ts` | Mid that survives opp_leads at full HP → `survival_score = 100`; one shot dead → 0 | clamp wrong |
| PS2 | same | Outgoing-damage component weighted 0.5 (mid hitting 60% on opp_leads contributes +30, not +60) | weight wrong |
| PS3 | same | Empty `opp_leads` → returns 0 (defensive) | crash |
| PS4 | same | Pure function — same inputs → byte-equal output across 100 calls | non-deterministic |

### Late-phase scorer (PS5..PS8)
| # | File | Asserts | Fails because |
|---|---|---|---|
| PS5 | `tests/data/tactical/score-late-phase.test.ts` | Cleaner with `Last Respects` 130 BP vs the 2 bulkiest panel mons weighted by usage → score ≥ 70 | scorer wrong |
| PS6 | same | Bulky-pick: panel sorted by `hp + def + spd` desc, top 2 used | sort wrong |
| PS7 | same | Usage weighting: cleaner hitting a 0.4-weight target at 100% beats hitting a 0.1-weight target at 100% | weight ignored |
| PS8 | same | Empty panel → returns 0 | crash |

### Composition + chain bonus (PS9..PS12)
| # | File | Asserts | Fails because |
|---|---|---|---|
| PS9  | `tests/data/tactical/plan-scoring.test.ts` | `scorePlan` formula coefficients exported as constants (`MID_PHASE_WEIGHT=0.6`, `LATE_PHASE_WEIGHT=0.8`, `ROLE_CHAIN_FULL_BONUS=15`, `ROLE_CHAIN_PARTIAL_BONUS=8`) | magic numbers |
| PS10 | same | Full chain (setter lead → cleric mid → cleaner late) → `role_chain_bonus = 15` | bonus missing |
| PS11 | same | 2-of-3 partial chain → +8; 1-of-3 → 0 | partial wrong |
| PS12 | same | `setter_on_bench_penalty` applies once, not per-bench-setter | over-counts |

### Phase rationale (PR1..PR5)
| # | File | Asserts | Fails because |
|---|---|---|---|
| PR1 | `tests/data/tactical/phase-rationale.test.ts` | All three builders return strings ≤ 300 chars on the ArchaEye fixture | budget broken |
| PR2 | same | Lead rationale mentions both lead names + top calc % when present | template wrong |
| PR3 | same | Mid `trigger` mentions "screens expire" when lead phase included screens; falls back to generic "leads fall" otherwise | branch missing |
| PR4 | same | Late `win_condition` mentions the cleaner's signature damaging move | template wrong |
| PR5 | same | Determinism — same input → identical string (no random / Date.now leaks) | non-deterministic |

### Cite-phases (PC1..PC5)
| # | File | Asserts | Fails because |
|---|---|---|---|
| PC1 | `tests/data/tactical/cite-phases.test.ts` | Lead phase: `insightStore.search` called with `filter: { pokemon: [sableye, archaludon], phase_tag: "lead", claim_type: ["lead","tech"] }`, `limit: 1` | wrong call shape |
| PC2 | same | Phase-specific hit → citation carries `phase_tag_source: "phase_specific"` | tag missing |
| PC3 | same | Phase-specific empty → fallback issued without `phase_tag`; result carries `phase_tag_source: "fallback"` | fallback missing |
| PC4 | same | Both paths empty → no citation emitted for that phase | crash |
| PC5 | same | Top-level `citations[]` ≤ 3 even when all 3 phases produce one | aggregation wrong |

### `recommendTeamPlan` integration (RP1..RP6)
| # | File | Asserts | Fails because |
|---|---|---|---|
| RP1 | `tests/data/tactical/recommend-plan.test.ts` | Returns a parsed `TeamPlanScenario`; throws `TacticalOverviewError` on draft team | gate missing |
| RP2 | same | `phases[0].active` matches Stage A's `recommend_leads` choice on the SAME scenario for at least 7 of 10 ArchaEye scenarios (per flow §10) | scoring drift |
| RP3 | same | `phases[1].pivot_in == sinistcha` on ArchaEye in ≥ 6 of 10 scenarios | mid pick wrong |
| RP4 | same | `phases[2].cleaner == basculegion` on ArchaEye in ≥ 6 of 10 scenarios | late pick wrong |
| RP5 | same | Zero-candidate fallback emits `confidence: "low"` + degenerate plan (defensive) | fallback missing |
| RP6 | same | `phases[0].support_lift` matches Stage A's computeSupportLift output for the same lead pair (regression invariant) | regressed |

### Overview wire-up (OV1..OV4)
| # | File | Asserts | Fails because |
|---|---|---|---|
| OV1 | `tests/data/tactical/overview-phase.test.ts` | `buildOverview` emits `schema_version: 3` | bump missing |
| OV2 | same | `overview.scenarios[]` elements parse as `TeamPlanScenarioSchema`; do NOT parse as `ScenarioOverviewSchema` | wire-up wrong |
| OV3 | same | Pillar bundle unchanged from Stage A (5 pillars, support evidence present) — regression | pillars regressed |
| OV4 | same | One `buildOverview` call per team — calc cache hit-rate ≥ 60% after first scenario (proxy for shared cache) | cache not shared |

### Agent tool + removal regression (T1..T5)
| # | File | Asserts | Fails because |
|---|---|---|---|
| T1 | `tests/agents/tactical-tools-plan.test.ts` | `TACTICAL_TOOL_DEFINITIONS` contains `recommend_team_plan` and does NOT contain `recommend_leads` | not swapped |
| T2 | same | `handleRecommendTeamPlan({team_id, scenario_name})` returns one scenario when name set | filter broken |
| T3 | same | `handleRecommendTeamPlan({team_id})` returns all scenarios | default broken |
| T4 | same | Tool description mentions "3-phase plan" + "replaces recommend_leads" — agent-loop discoverability | desc missing |
| T5 | same | Importing `handleRecommendLeads` from `src/agents/tactical-tools` throws at static-analysis time (compile/grep) — symbol removed | symbol left behind |

### CLI replacement (CLI1..CLI3)
| # | File | Asserts | Fails because |
|---|---|---|---|
| CLI1 | `tests/scripts/tactical-cli-plan.test.ts` | `pnpm data:tactical plan <team_id>` exits 0, stdout parses as `RecommendTeamPlanOutput` | CLI not wired |
| CLI2 | same | `pnpm data:tactical recommend <team_id>` → exit 1 with "Unknown command" | subcommand left behind |
| CLI3 | same | `pnpm data:tactical recommend-leads <team_id>` → exit 1 with "Unknown command" | alias left behind |

### Removal regression (RM1..RM3)
| # | File | Asserts | Fails because |
|---|---|---|---|
| RM1 | `tests/data/tactical/recommend-leads-removed.test.ts` | Module file `src/data/tactical/recommend-leads.ts` does NOT exist (filesystem assertion) | file left behind |
| RM2 | same | `import { recommendLeads } from "../../../src/data/tactical/recommend-plan"` is `undefined` (symbol gone, not re-exported) | shim left behind |
| RM3 | same | `tactical.ts` script's argv list (read via `fs.readFileSync` and regex) contains `plan` and does NOT contain `recommend-leads` | branch left behind |

**Live ArchaEye manual demo (NOT a CI test — per Stage A precedent §9):** `pnpm data:tactical plan 01KR7TVD21G1Q99BK0NAEARFD8`. Assert the 6-of-10 / 5-of-10 / 7-of-10 thresholds from §1 (3) by visual inspection + screenshot in the PR description.

**Grand total: S6 + PG6 + PS12 + PR5 + PC5 + RP6 + OV4 + T5 + CLI3 + RM3 = 55.**

---

## 11. Architecture patterns + WHY

### 11.1 Reuse Stage A's pair scorer verbatim for the lead phase
Per flow §6.3. The lead phase's contribution to `plan_score` is exactly `scorePair`. No reimplementation, no fork. This guarantees the regression invariant in test RP6 — the support_lift introspection that Stage A surfaced on `ScenarioOverview.support_lift` re-emerges as `phases[0].support_lift`.

### 11.2 Mid-phase = 1-vs-1 approximation, not turn-3 sim
Per flow §6.3 + §11. Building a real attrition simulator (track HP across switches, KOs, status) is a research slice. The 1-vs-1 against `opp_leads` is a defensible proxy: in Reg M-A doubles the mid-phase pivot most often comes in to absorb pressure from the original opening lineup before the opponent can pivot themselves. Documented as `// TODO(stage6-deferred): mid-phase-true-board-sim` in `score-mid-phase.ts`.

### 11.3 Zero new calc infrastructure
The `CalcCache` from Stage A absorbs ~1500 calls per overview. Lead-phase calls are cache-warm by construction (Stage A already issued them); mid + late phase add new `(attacker, defender, field, move)` hashes but each fires once and is shared across the 30–60 candidates per scenario AND across the 10 scenarios. Worst-case cold: ~15s; warm-cache rerun: < 1s.

### 11.4 Deterministic phase rationale (no LLM)
Per flow §11 deferral. Rationale strings are template-built. Pros: deterministic golden tests; zero token cost; predictable length budget. Cons: prose reads robotic. The LLM-polish follow-up is gated on this slice's deterministic baseline shipping cleanly.

### 11.5 Full rewrite of `recommend-leads.ts` → `recommend-plan.ts` (Q4 in §17)
Extending the existing file would tangle two scoring regimes (legacy pair-only vs new 3-phase composite), and the output object types are different enough that the function signature has to change anyway. Cleaner: delete the file, write a new one, port `pickConfidence` to a shared helper module (`src/data/tactical/confidence.ts` — or keep it inline in `recommend-plan.ts` since only one caller remains).

### 11.6 Schema bump 2 → 3 as a non-additive break
Per Stage-A plan §7.2 forward-compat note: the bump was foreseen. No persistence today, so no on-disk migration. The break is contained to one PR: every consumer of `ScenarioOverview` updates simultaneously in §2.

---

## 12. Reuse audit

| Capability | Source | Disposition |
|---|---|---|
| `scorePair` + `α/β/γ` + `δ` | `src/data/tactical/score-pair.ts` | as-is (lead phase) |
| `computeSupportLift` + `STRUCTURAL_LEAD_BONUS` + `WEATHER_MATCH_BONUS` + `SUPPORT_LIFT_DELTA` | `src/data/tactical/score-pair.ts` | as-is (lead phase + `phases[0].support_lift` introspection) |
| `collectKeyCalcsForPair` | `src/data/tactical/score-pair.ts` | called for lead phase `key_calcs` |
| `buildRoleAssignments` | `src/data/tactical/pillars.ts` | as-is (one classification pass per overview, threaded to plan search) |
| `damage_calc` engine | `src/tools/damage-calc/index.ts` | as-is, via `CalcCache` |
| `CalcCache` + `calcWithCache` + `_hashSet` + `_fieldHash` | `src/data/tactical/calc-cache.ts` + `score-offense.ts` | as-is for mid + late phase calcs |
| `scoreOffense` / `scoreDefense` / `scoreSpeed` / `scoreSupport` / `scoreSynergy` | `src/data/tactical/*.ts` | untouched — pillar bundle pre-Stage-B remains the same |
| `findCitations` | `src/data/tactical/cite.ts` | called as `cite-phases.ts` fallback path |
| `pickConfidence` | `src/data/tactical/recommend-leads.ts` (DELETED) → relocated into `recommend-plan.ts` | port verbatim; mid/late `key_calcs` count rolls into `keyCalcCount` aggregate |
| `insightStore.search({ filter: { phase_tag } })` | `src/db/insights.ts` | as-is — first consumer of the Stage-A-shipped filter |
| `userTeams.get` + `roster.get` + `userTeamToScoringTeam` + `buildThreatPanel` + `generateScenarios` | various | as-is |
| Error classes (`TacticalOverviewError`, `KnowledgeStorageError`) | `src/schemas/errors.ts` | as-is |
| Pure-data `parseOrThrow` | `src/schemas/parse.ts` | as-is — used to validate `TeamPlanScenario` before return |

**No new external dependencies.** No new HTTP / scraper / vector-store usage. No new throttle.

---

## 13. Rollout

**No feature flag.** The breaking schema_version bump (2 → 3) is contained to one PR (`feat/team-phase-plan`). Every consumer of `ScenarioOverview` is in this codebase and updates simultaneously:

1. `src/data/tactical/overview.ts` — emits 3.
2. `src/agents/tactical-tools.ts` — `handleRecommendTeamPlan` returns `TeamPlanScenario[]`.
3. `scripts/data/tactical.ts` — `plan` subcommand parses & prints `TeamPlanScenario`.
4. All test files under `tests/data/tactical/*` updated.

**No persistence:** plans are computed on demand (Stage A plan §11 confirmed). No on-disk migration.

**Stage 5 deploy order:**
1. Land schema additions (S1..S6 batch).
2. Land plan-candidate generator + scoring modules (PG, PS×).
3. Land phase rationale + cite-phases (PR, PC).
4. Land `recommendTeamPlan` integration (RP).
5. Wire into `overview.ts` (OV).
6. Swap agent tool + CLI (T, CLI).
7. **Delete** `src/data/tactical/recommend-leads.ts` + dependent tests; commit `refactor: remove recommend_leads`.
8. Removal-regression tests (RM) — these need step 7 to be green.
9. Manual ArchaEye plan demo.

---

## 14. Cache + throttle

Stage B introduces **no new cache** and **no new throttle**. Reuses Stage A's `CalcCache` (process-scoped, per-overview, keyed by `(attacker_set_hash, defender_set_hash, field_hash, move_id)`).

**Cost budget per overview:**
- Stage A pair-search alone: 15 pairs × 2 opp × 4 moves × 2 directions = 240 calls/scenario × 10 = 2400 (mostly cache-warm cross-scenario).
- Stage B adds: mid-phase per candidate ≈ 4 moves × 2 opp × 2 directions = 16 calls; late-phase per candidate ≈ 4 moves × 2 bulky panel = 8 calls. With ~50 candidates per scenario, ~1200 calls/scenario, but each scenario's (attacker_set, defender_set, field, move) tuple is shared across most candidates (only mid/cleaner slot changes), so unique-key count is more like ~200 new keys/scenario.
- Total unique calls per overview: ~2400 (Stage A) + ~2000 (Stage B) ≈ 4400. At ~3ms/call cold, ~15s cold; sub-second after warm.

**Citation retrieval:** ≤ 3 `insightStore.search` calls per scenario × 10 = 30 calls per overview. SQLite-local; no throttle needed.

---

## 15. Coordinated cross-slice work

**None.** `phase_tag` already shipped in Stage A. Backfill of pre-existing rows is the deferred `// TODO(slice-deferred): backfill phase_tag on pre-existing insights` (Stage-A plan §15.5). Stage B does NOT trigger re-extraction; it tolerates the absence via the §8 fallback. The trigger event for the backfill follow-up is "Stage B ships AND we have ≥ 100 untagged rows" (Stage-A plan §15.5).

---

## 16. Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Candidate-count explosion if role pruning is too lax | Medium | Medium | PG5 asserts 30 ≤ count ≤ 60 on ArchaEye; if a future user team blows past 100 candidates, the cache budget in §14 still holds, but the loop visibly slows — add a `// TODO(stage6-deferred): candidate-count-monitoring` log when count > 80 |
| Mid + late scoring magnitudes (0.6 / 0.8) hand-tuned to a single demo team | High | Medium | Inline `// TODO(stage6-deferred): phase-plan-coefficient-calibration` on `recommend-plan.ts`; follow-up calibration slice (parallel to Stage A's Q5 follow-up) once we have 10+ saved teams |
| Cleaner candidate set is small or empty (Sableye-style 6-support team) → search degenerates | Medium | Low | Defensive fallback in `recommend-plan.ts` per §9 — emit a degenerate plan with `confidence: "low"`. Q1 in §17 asks whether to relax the cleaner role to `setup_sweeper` / `wallbreaker` / highest-BST — proposed answer below. RP5 tests the degenerate path |
| Phase rationale templates read robotic | Medium | Low | Flow §11 already lists LLM polish as a deferred follow-up; deterministic prose is the explicit Stage B contract |
| `phase_tag` filter recall is poor on the pre-Stage-A corpus (every row is NULL) | High initially | Medium | §8 fallback restores recall to the legacy species-only search; degrades to Stage A's citation quality, never worse. Trigger to revisit: ≥ 100 backfilled rows |
| `recommend_leads` consumers we missed in this codebase | Low | Medium | RM1..RM3 + the grep audit in §2.3 catch this at PR time; Stage-6 reviewer asked to re-grep |
| Schema reshape breaks an external consumer (Slack bot? README example?) | Low | Low | No external consumer today; the only on-disk output is the CLI's JSON, regenerated on demand |

---

## 17. Open questions for plan review

> **Reviewer:** mark each ✅ accept / ✏️ revise / ❌ reject + reasoning. The Stage-2 binding answers (Q1–Q12 in the flow doc) and Stage-A's plan §17 questions are NOT relisted — only NEW questions surfaced while drafting this plan.

**Q1. Cleaner-slot fallback when ZERO cleaners exist on the team (Sableye-style support team)?**
The cleaner gate (base_spe ≥ 90 OR Scarf OR priority) drops every candidate when the team has e.g. six support mons. **Proposal:** relax in order — first try slots whose role tags include `setup_sweeper`; if still empty, `wallbreaker`; if still empty, the slot with the highest BST among the four remaining (after leads + mid are committed). Emit `confidence: "low"` on the resulting plan to signal the late phase is a hack. Alternative: refuse the team. Refusing breaks the support-team analysis the user explicitly wants.
*Answer: ✅ accept*

**Q2. Mid-phase actor cardinality — exactly 1, or allow 0?**
A 6-team has 4 slots left after `leads ∪ {cleaner}` is committed; one is the mid-pivot, three are unused. **Proposal:** exactly 1. The mid phase is the load-bearing pivot in VGC doubles; a plan without one fails to model the turn-3 board. Allowing 0 collapses the slice to a 2-phase plan and breaks the strongly-typed tuple in §3. Alternative: allow 0 with a `mid: null` discriminator — much more complex.
*Answer: ✅ accept*

**Q3. Role-chain bonus magnitudes (full +15, 2-of-3 partial +8)?**
Hand-tuned. The full chain rewards setter → cleric/redirect → cleaner exactly; partial chains catch teams that have two of three (e.g. setter + cleaner but no cleric). **Proposal:** +15 / +8 / 0 ships as-is, with `// TODO(stage6-deferred): role-chain-bonus-calibration`. Alternative: tie the bonus to `support_pillar.score` (e.g. `+15 * (support_score / 100)`). Tighter coupling, less interpretable.
*Answer: ✅ accept*

**Q4. Rewrite `recommend-leads.ts` or extend?**
**Proposal:** full rewrite as `recommend-plan.ts`; delete the old file. Identical control-flow shape (enumerate → score → pick), different output object, different scoring formula. Extending would require dynamic branching on "emit legacy ScenarioOverview vs new TeamPlanScenario" — confusing forever.
*Answer: ✅ accept*

**Q5. Keep `ScenarioOverviewSchema` exported as `@deprecated`, or remove outright?**
**Proposal:** keep, marked `@deprecated`, for ONE transition window. Reason: Stage A's regression tests import the type (`ScenarioOverview.support_lift`); rewriting those tests in this PR doubles the diff for marginal benefit. Remove in the Stage-6 review pass. Alternative: remove now; rewrite Stage A tests as part of this PR.
*Answer: Remove now*

**Q6. `phase_tag_source` on citations — emit or hide the fallback signal?**
**Proposal:** add `phase_tag_source: "phase_specific" | "fallback"` to `TacticalCitationSchema` (optional, defaults to `phase_specific` when present). Lets the agent loop downgrade confidence when ALL citations are fallbacks. Alternative: hide entirely — the agent never knows. Slightly more LOC, large interpretability win.
*Answer: ✅ accept*

**Q7. Land `recommend_leads` removal in this PR or follow-up?**
**Proposal:** this PR. Two surfaces returning different objects under similar names is more confusing than the breaking change. Q8 binding from flow §12 (`REPLACE`) was explicit. Alternative: leave `recommend_leads` as a thin shim that calls `recommend_team_plan` and downcasts — extra complexity for no win.
*Answer: ✅ accept*

**Q8. Phase rationale length budget — 300 or 400 chars?**
Flow §6.1 says ≤ 300. **Proposal:** keep 300; if truncation routinely drops key calc info, widen to 400 in the Stage-6 review with `// TODO(stage6-deferred): phase-rationale-length-calibration`. Alternative: start at 400 — risks truncating less aggressively but consumes more screen space in the CLI card.
*Answer: ✅ accept*

**Q9. Preserve `support_lift` on the lead phase?**
**Proposal:** yes, as `LeadPhaseSchema.support_lift?: number`. Preserves the Stage A introspection surface (PR6 regression test). The mid + late phases don't carry a lift since `computeSupportLift` only takes `(leads, back, scenario)` and Stage B's `back` concept fragments across mid + late. Alternative: drop entirely — loses parity with Stage A telemetry.
*Answer: ✅ accept*

**Q10. Live ArchaEye plan success criterion — codify as a CI test or a manual gate?**
Flow §10 success criterion: ≥ 6 of 10 scenarios produce the user's expected 3-phase plan. **Proposal:** keep as a manual gate (per Stage A's manual-demo posture) for the live team, BUT codify a tighter version on fixture teams in `tests/data/tactical/recommend-plan.test.ts` (tests RP2/RP3/RP4): on the ArchaEye **fixture** team (Stage A committed `fixtures/tactical/role-tags/2026-05-09__archaeye.json`), assert the same 6-of-10 / 6-of-10 / 6-of-10 thresholds. Lets CI catch regressions without depending on the live DB state.
*Answer: ✅ accept*

**Q11. Plan + pillar output coexist or split into two endpoints?**
Today `buildOverview` returns one bundled JSON with pillars + scenarios. Post-Stage-B, the scenarios array carries plans, not lead triples. **Proposal:** keep the bundle. The agent loop calls `score_pillars` (cheap) first, then `recommend_team_plan` (expensive) for the relevant scenario. The CLI's `overview` subcommand surfaces the bundle. Alternative: split — extra duplication of orchestration code.
*Answer: ✅ accept*

**Q12. `phase_tag` ingest backfill — kick off in this PR or strictly defer?**
Stage A plan §15.5 trigger: "Stage B ships AND ≥ 100 untagged rows." That trigger now fires post-merge of this PR. **Proposal:** strictly defer to a follow-up `chore/backfill-phase-tag` PR — keeps this PR scoped to phase consumption + plan output. Alternative: include backfill — couples two slices, slower review.
*Answer: Include backfillt*
