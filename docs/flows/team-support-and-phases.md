# Flow: team-support-and-phases

**Slug:** `team-support-and-phases`
**Status:** Stage 1 — flow draft
**Author:** Claude (Opus 4.7)
**Date:** 2026-05-09

> Combined flow covering two sequenced slices: **Stage A — support
> utility pillar + role tags** and **Stage B — phase-aware planning
> (lead / mid / late)**. Stage A ships first as a self-contained
> change. Stage B builds on Stage A's role tags and reshapes the
> recommendation output. Stage 3 (tech plan) splits this into two plan
> docs (`team-support-pillar.md`, `team-phase-plan.md`) so each ships
> its own red→green→review cycle.

## 1. Why this slice

The current `team-tactical-overview` slice scores teams on four
pillars (offense / defense / speed / synergy) and recommends a single
lead pair per scenario. The pair scorer optimizes raw KO pressure +
speed, which makes "support" Pokémon look weak even when they are the
load-bearing piece of the win condition.

Concrete failure mode (live, observed today on user team **ArchaEye**,
team_id `01KR7TVD21G1Q99BK0NAEARFD8`):

- Team plan as the user describes it:
  *"Sableye + Archaludon lead — Sableye sets screens, Quash, Rain
  Dance; Archaludon Stamina-stacks behind that into Electro Shot.
  Sinistcha mid-game pivots in to Life Dew + Rage Powder.
  Basculegion Choice Scarf cleans up turns 5+."*
- Current overview:
  - Synergy pillar: **22/100 (Weak)**, data_gaps lists every team member.
  - **Sableye is never recommended as a lead** in any of the 10 scenarios
    — Reflect / Light Screen / Quash / Rain Dance score 0 KO pressure.
  - **Sinistcha is rejected to the bench** in 6 of 10 scenarios.
  - The recommendation engine has no concept of "Basculegion is the
    cleaner, not the lead."

The team's actual structure is invisible to the scorer.

This slice fixes that with two coordinated changes:

| | Before | Stage A (this slice) | Stage B (this slice) |
|---|---|---|---|
| Pillars | 4 (off/def/spd/syn) | **5** — adds `support` | 5 (unchanged) |
| Set role | implicit (just stats) | **role tag** per set: setter / cleric / redirect / disruptor / pivot / setup_sweeper / cleaner / wallbreaker | role tags drive phase assignment |
| Synergy detection | hardcoded archetype list (Weather / Redirection / Fake Out) | augmented with **role-coherence** check (does this team have a setter→sweeper→cleaner backbone?) | unchanged |
| Recommendation output | `(leads, back, bench)` triple | unchanged from Stage A | **`(lead_phase, mid_phase, late_phase)` plan** with per-phase rationale and pivot triggers |
| Pair scorer | α·offense + β·speed − γ·defense_loss | adds **support_lift** term when leads enable backline's role | extended into per-phase scoring |
| Lead-pair search | exhaustive 15 pairs | unchanged | **plan search**: leads × mid_pivot × cleaner, with role-tag constraints to prune the search space |

## 2. User flow

The user starts with a **saved** `user_team` (status='saved'); both
stages are read-only over user-teams.

### Stage A path

1. User runs `pnpm data:tactical pillars <team_id>` (or
   `overview <team_id>`). They expect a 5th pillar `support`.
2. System computes pillars; `support` returns 0–100 + tier + evidence.
3. Synergy pillar's evidence now includes role tags per slot and a
   `role_coherence` bool ("does this team have a setter→sweeper→
   cleaner backbone?").
4. Each scenario's `recommended_leads` selection is sensitive to the
   support pillar via the new `support_lift` term: leads that enable
   a back-line set's role (e.g. Sableye → Archaludon Stamina setup)
   score higher than they would on raw KO pressure alone.
5. The output JSON's existing fields (pillars, scenarios) are
   backwards-compatible; new fields added: `pillars.support`,
   `pillars.synergy.evidence.role_tags`, `scenario.support_lift`.

Success for Stage A on ArchaEye:
- Sableye's role tag is `setter` (Reflect + Light Screen + Quash +
  Rain Dance).
- Sinistcha is `cleric` (Life Dew + Rage Powder + Hospitality).
- Basculegion is `cleaner` (Choice Scarf + Last Respects + Aqua Jet).
- `support` pillar is ≥ 70/100 (Strong); `synergy.evidence.role_coherence
  = true`; `synergy` pillar lifts from 22 → ≥ 50.
- At least one scenario picks **Sableye + Archaludon** as the
  recommended leads.

### Stage B path

1. User runs `pnpm data:tactical plan <team_id>` (new subcommand).
2. System returns one `TeamPlan` per scenario instead of a single
   pair. Each plan has three phases.
3. Per scenario, the agent tool surface adds a new
   `recommend_team_plan(team_id, scenario_name)` alongside the
   existing `recommend_leads`.
4. UI / CLI prints a 3-line plan card per scenario:
   ```
   Lead   (T1)   Sableye  + Archaludon  — screens up, Quash threat, set Rain
   Mid    (T3-4) Sinistcha + Archaludon — Rage Powder, Life Dew, keep boosts
   Late   (T5+)  Basculegion           — Scarf Last Respects revenge cleanup
   ```

Success for Stage B on ArchaEye:
- Lead phase = `[sableye, archaludon]`.
- Mid phase pivot = `sinistcha` (cleric/redirect role).
- Late phase cleaner = `basculegion`.
- Plan score ≥ existing pair-only score on at least 7 of 10 scenarios
  (phase awareness should help, not hurt).
- Citations include Insights mentioning "lead", "mid game", "late
  game", or "cleanup" when present.

## 3. Tech flow

```
Stage A
─────────────────────────────────────────────────────────────────
user_team ─► userTeams.get ─► UserTeam (saved)
                ▼
        deriveRoleTags(team)             ◄── new (deterministic, no LLM)
                ▼
        ┌────────────────────────────────────────────────────┐
        │ scoreOffense   (existing)                          │
        │ scoreDefense   (existing)                          │
        │ scoreSpeed     (existing)                          │
        │ scoreSupport   ──► S            ◄── new            │
        │ scoreSynergy   (extended: + role_coherence) ──► Y' │
        └────────────────────────────────────────────────────┘
                ▼
        for each scenario:
          for each lead pair:
            scorePair(pair, scenario,
                      support_lift=fn(leads.role, back.role))   ◄── new term
          pick best (existing logic)
                ▼
        TeamTacticalOverview { pillars (5), scenarios }

Stage B
─────────────────────────────────────────────────────────────────
overview ──► for each scenario:
                generatePlanCandidates(team, scenario)         ◄── new
                  // (lead_pair, mid_pivot, cleaner) triples
                  // pruned by role-tag constraints
                  // typically 30–60 candidates per scenario
                for each candidate:
                  scorePlan(candidate, scenario)               ◄── new
                pick best plan
                attach phase rationale + per-phase citations
              ▼
        TeamPlan { phases: [lead, mid, late], scenario_score, ... }
```

Reuse:

- `src/data/tactical/score-offense.ts` / `score-defense.ts` /
  `score-speed.ts` / `score-synergy.ts` — extended, not rewritten.
- `src/data/tactical/score-pair.ts` — extended with `support_lift` arg.
- `src/data/tactical/recommend-leads.ts` — Stage A: untouched (the new
  term flows through `score-pair`). Stage B: extracts a sibling
  `recommend-plan.ts`.
- `src/db/insights.ts` — Stage B citation retrieval filters by phase
  keywords ("lead", "mid", "late") via `claim_type` + text search.
- `src/db/moves.ts` / `src/db/abilities.ts` — role detection reads
  movepool + ability metadata.

New, slice-specific:

**Stage A**
- `src/data/tactical/role-tags.ts` — pure deterministic classifier:
  `(set: TeamSet, abilities, moves) → RoleTag[]` (each set can carry
  multiple tags, ranked by primary).
- `src/data/tactical/score-support.ts` — pillar scorer.
- Edits to `score-synergy.ts` — add `role_coherence` evidence; bump
  archetype detection by ≤ 20 pts when `role_coherence = true`.
- Edits to `score-pair.ts` — add `support_lift` term:
  +X if leads.role ⊇ {setter} and back.role ⊇ {setup_sweeper}
  +Y if leads.role ⊇ {redirect} and any back has a setup move
  +Z if a cleric is in back when leads are fragile setters
  Coefficients hand-tuned, surfaced in §6.
- Edits to `overview.ts` to wire the new pillar.
- Schema additions to `src/schemas/tactical.ts`: `RoleTagSchema`,
  `SupportPillarEvidenceSchema`, extended `SynergyEvidenceSchema`.

**Stage B**
- `src/data/tactical/recommend-plan.ts` — generate + score plan
  candidates.
- `src/data/tactical/cite-phases.ts` — phase-aware citation retrieval
  (search Insights for "lead" / "mid" / "late" claim language per
  phase).
- New schema `TeamPlanSchema` in `src/schemas/tactical.ts`.
- New CLI subcommand `plan <team-id>` in `scripts/data/tactical.ts`.
- New agent tool `recommend_team_plan` in
  `src/agents/tactical-tools.ts` (alongside the existing
  `recommend_leads`).

Cross-cutting:
- The cross-call calc cache (existing) is unchanged — Stage B's plan
  search reuses the same `damage_calc` calls, so most of the new
  candidate scoring hits warm cache.
- Fixture pack: golden `RoleTagsByTeam` for 5+ canonical Reg-M-A teams
  (ArchaEye, the Charizard team from the J0eVKJyJ_DQ video, a
  hardcoded Trick Room team, a Tailwind HO team, a Sand archetype).

## 4. Role tags — the new primitive

A `RoleTag` is a deterministic classification of one set's contribution
to the team's plan. Multi-tag is allowed; one is marked `primary`.

```ts
type RoleTag =
  | "setter"          // puts up weather / screens / TR / tailwind / rain dance
  | "redirect"        // rage powder / follow me
  | "cleric"          // life dew / pollen puff / hospitality / wish / heal pulse
  | "disruptor"       // encore / quash / taunt / yawn / spore / lures
  | "pivot"           // u-turn / volt switch / flip turn / parting shot / teleport
  | "setup_sweeper"   // boosting move (DD, NP, SD, CM, Bulk Up, Iron Defense, Coil)
  | "cleaner"         // (Choice Scarf OR priority move) AND high BP STAB
  | "wallbreaker"     // high SpA/Atk AND mixed coverage AND no boosting move
  | "anti_priority"   // Armor Tail / Dazzling / Queenly Majesty
```

### Detection rules (deterministic)

```
setter         := has any of [Reflect, Light Screen, Aurora Veil,
                              Trick Room, Tailwind, Rain Dance, Sunny Day,
                              Sandstorm, Snowscape] in moves
                  OR has any of [Drizzle, Drought, Sand Stream, Snow Warning] in ability
redirect       := has Rage Powder OR Follow Me in moves
cleric         := has any of [Life Dew, Pollen Puff, Wish, Heal Pulse, Floral Healing] in moves
                  OR has Hospitality in ability
disruptor      := has any of [Encore, Quash, Taunt, Disable, Yawn, Spore, Sleep Powder, Stun Spore, Will-O-Wisp] in moves
pivot          := has any of [U-turn, Volt Switch, Flip Turn, Parting Shot, Teleport, Baton Pass] in moves
setup_sweeper  := has any of [Dragon Dance, Swords Dance, Nasty Plot, Calm Mind,
                              Bulk Up, Iron Defense, Coil, Quiver Dance, Shell Smash,
                              Curse, Cosmic Power, Belly Drum] in moves
                  OR has any of [Stamina, Defiant, Justified, Beast Boost] in ability
cleaner        := (item == "Choice Scarf" OR has any priority move)
                  AND has at least one base-power-100+ STAB move
                  AND base spe ≥ 90
wallbreaker    := no setup move
                  AND has 2+ damaging moves of different types
                  AND base SpA OR base Atk ≥ 110
                  AND no Choice Scarf
anti_priority  := has any of [Armor Tail, Dazzling, Queenly Majesty] in ability
```

`primary` selection priority (first match wins): setter > redirect >
cleric > setup_sweeper > cleaner > wallbreaker > pivot > disruptor >
anti_priority. Ties broken by base-stat total (higher = primary).

### Edge cases
- A set can hit multiple tags (e.g. Pelipper: setter via Drizzle +
  pivot via U-turn). All tags emitted; primary picked by priority.
- A set with **no tags** is rare but possible (e.g. a vanilla offensive
  set with no boosting and no priority and base spe < 90). In that
  case primary defaults to `wallbreaker` if the SpA/Atk threshold is
  met, else `cleaner`, else "untagged". `untagged` is allowed and
  surfaces in evidence — it's a signal that the team has a slot
  contributing only raw stats.

## 5. Support pillar (Stage A)

### 5.1 Score formula

For a 6-mon team, sum the contributions of detected support
mechanisms, then normalize.

```
support_score = clamp(
    20 * count(setter, distinct mechanism)        # weather, screens, TR, tailwind etc.
  + 15 * count(redirect)
  + 12 * count(cleric)
  + 10 * count(disruptor distinct mechanism)
  +  8 * count(pivot)
  + 10 * count(anti_priority)
  + role_coherence_bonus(team)                    # 0 or +15
  , 0, 100)
```

`role_coherence_bonus = +15` if **(team has ≥ 1 setter) AND (team has
≥ 1 setup_sweeper OR cleaner) AND (the setter shares the field with
the setup_sweeper based on role compatibility)**. Else 0.

Tier labels: 0–40 Weak / 41–60 OK / 61–80 Good / 81–100 Strong.

### 5.2 Evidence shape

```ts
SupportPillarEvidence {
  role_tags: { species_id: { primary: RoleTag, all: RoleTag[] } }[]
  mechanisms: {
    screens: string[]            // species_ids that bring screens
    weather_setters: string[]
    speed_control: string[]      // TR, Tailwind, Icy Wind etc.
    redirection: string[]
    healers: string[]
    disruption: string[]
    pivots: string[]
  }
  role_coherence: boolean
  coherence_chain: { setter: species_id, payoff: species_id, payoff_role: RoleTag } | null
}
```

### 5.3 Synergy pillar update

Synergy's existing 60/40 split (teammate co-occurrence + archetype
detection) is preserved. Two additions:

1. `evidence.role_tags` — surfaces the per-slot tags so the user can
   sanity-check the classifier.
2. `evidence.role_coherence` — bool. When true, archetype detection
   gets a +20 floor (i.e. teams with strong role chains aren't
   penalized just because pikalytics teammate data is sparse). This
   directly fixes ArchaEye's data_gap penalty.

### 5.4 `support_lift` in pair scoring

```
support_lift(leads, back, scenario) =
    +12  if any(leads.role) == "setter" AND any(back.primary_role) in {setup_sweeper, cleaner}
    + 8  if any(leads.role) == "redirect" AND any(back.role) == "setup_sweeper"
    + 6  if any(back.role) == "cleric" AND any(leads.role) == "setup_sweeper"
    +10  if any(leads.role) == "anti_priority" AND scenario.has_priority_threats
    -10  if both leads are setters AND no back-line role is setup_sweeper or cleaner
         (penalize "all setup, no payoff")
```

The pair score becomes `α·offense + β·speed − γ·defense_loss + δ·support_lift`.
Defaults `α=1.0, β=0.5, γ=0.7, δ=1.0`. Hand-tuned; surfaced in §10.

## 6. Phase-aware plan (Stage B)

### 6.1 Plan shape

```ts
TeamPlan {
  schema_version: 1,
  team_id: string,
  scenario_name: string,
  phases: [LeadPhase, MidPhase, LatePhase],
  plan_score: number,
  confidence: "low" | "medium" | "high",
  citations: KnowledgeCitation[],
}

LeadPhase {
  phase: "lead",
  turn_window: [1, 2],
  active: [species_id, species_id],
  rationale: string,                      // ≤ 300 chars
  key_calcs: CalcResultRef[],             // 0–2
  abandon_if: string,                     // when to bail
}

MidPhase {
  phase: "mid",
  turn_window: [2, 4],
  pivot_in: species_id,                   // the mon coming in
  pivot_out: species_id | null,           // who's leaving (null if a lead falls)
  rationale: string,
  key_calcs: CalcResultRef[],
  trigger: string,                        // event that opens the mid phase
}

LatePhase {
  phase: "late",
  turn_window: [4, 8],
  cleaner: species_id,
  rationale: string,
  key_calcs: CalcResultRef[],             // KO calcs vs likely surviving threats
  win_condition: string,
}
```

### 6.2 Plan candidate generation

Inputs: team (with role tags), scenario.

1. Enumerate `(leads, mid, cleaner)` triples where:
   - `leads ⊂ team`, |leads| = 2.
   - `mid ∈ team \ leads`, role allows mid-phase pivot
     (cleric / redirect / pivot / wallbreaker — *not* cleaner).
   - `cleaner ∈ team \ leads \ {mid}`, role tag includes `cleaner`,
     `setup_sweeper`, or `wallbreaker`.
2. Hard role constraint pruning:
   - At least one of `leads` must be `setter`, `redirect`,
     `disruptor`, or `wallbreaker` (somebody has to set the tone
     turn 1).
   - If team has a `setter` not in `leads`, downscore by 20 (you're
     wasting the setter on the bench).
   - `cleaner` must have base spe ≥ 90 OR Choice Scarf OR a priority
     move.
3. Worst case for a 6-team: 15 lead pairs × 4 mid candidates × 3
   cleaner candidates = 180 plans per scenario. After role pruning,
   typically 30–60.

### 6.3 Plan scoring

```
plan_score(candidate, scenario) =
    1.0  * pair_score(candidate.leads, scenario)              # reuse existing pair scorer (now with support_lift)
  + 0.6  * mid_phase_score(candidate.mid, scenario)
  + 0.8  * late_phase_score(candidate.cleaner, scenario)
  + role_chain_bonus(candidate)                               # +15 if leads.setter → mid.cleric → late.cleaner
```

`mid_phase_score` = mid candidate's expected damage (or healing) vs
the scenario's likely turn-3 board state. Approximated as: incoming
damage from `opp_leads` against `mid` (defense component) + outgoing
damage from `mid`'s best move against `opp_leads` weighted at 0.5
(mid-phase mons aren't expected to KO; survival > damage).

`late_phase_score` = cleaner's best-roll % against the scenario's
2 most-bulky panel members weighted by their usage. Cleaners are
judged on revenge / sweep capability against survivors, not initial
trade.

### 6.4 Phase rationale generation

For each phase, build a string from the contributing calcs and role
tags. Format is **deterministic** in v1 — no LLM.

```
LeadPhase rationale:
  "{lead_a} (role={role_a}) + {lead_b} (role={role_b}) — {top_action}.
   {primary_calc}."

MidPhase rationale:
  "{pivot_in} (role={role_mid}) — {top_action}. {primary_calc}."

LatePhase rationale:
  "{cleaner} (role={role_late}) — {win_condition}. {primary_calc}."
```

Example for ArchaEye vs Sand:
```
Lead   (T1)   sableye (setter) + archaludon (setup_sweeper) — Reflect + Light Screen,
              Rain Dance to chip Sand. Archaludon Stamina pre-stacks.
Mid    (T3)  sinistcha (cleric/redirect) — Rage Powder protects Archaludon,
              Life Dew restores 50% HP per use.
Late   (T5+) basculegion (cleaner) — Scarf Last Respects KOs survivors;
              Aqua Jet finishes priority threats.
```

### 6.5 Citation retrieval

Per phase, query insights via:
- Lead phase: `claim_type ∈ {lead, tech}` + species filter on the
  active pair.
- Mid phase: `claim_type ∈ {tech, matchup}` + species filter on
  `pivot_in`.
- Late phase: `claim_type ∈ {tech, counter, matchup}` + species filter
  on `cleaner`. Free-text post-filter for "late", "clean", "revenge",
  "endgame".

Limit 1 citation per phase; total ≤ 3 per plan. Insights without a
phase-keyword match are still allowed (better some citation than none).

## 7. Output shape

`TeamTacticalOverview` (Stage A — backwards compatible):

```ts
{
  schema_version: 2,           // bumped from 1
  team_id, generated_at, threat_panel_as_of,
  pillars: {
    offense, defense, speed,
    support: { score, tier, evidence: SupportPillarEvidence },  // NEW
    synergy: { ..., evidence: { ..., role_tags, role_coherence } },  // EXTENDED
  },
  scenarios: ScenarioOverview[],   // unchanged shape; each includes new support_lift field
}
```

`TeamPlan` (Stage B — new shape, separate output):

```ts
{
  schema_version: 1,
  team_id, generated_at,
  scenarios: { [name: string]: TeamPlan }   // one plan per scenario
}
```

Stage B does **not** replace `ScenarioOverview` — both endpoints
coexist. The agent loop decides which to call based on the user's
question (one-line lead recommendation vs full play-by-play).

## 8. Persistence

Compute on demand for both stages, same as `team-tactical-overview`.
The cross-call calc cache (Q3 binding from the original tactical slice)
covers most of the cost — Stage B's expanded search is dominated by
calls that reuse cached `damage_calc` results.

## 9. Error / empty states

- Team has no detectable role tags (all `untagged`): support pillar
  scores 0 (Weak); synergy unaffected.
- Team has 6 setters and 0 payoff: `role_coherence = false`,
  support pillar caps at ~50 (the count contributions still apply but
  no coherence bonus).
- Stage B: scenario has no insights matching phase keywords →
  emit phases without per-phase citations; keep top-level citations
  from the existing `recommend-leads` path.
- Stage B: plan generation produces 0 candidates after role pruning
  (impossible on a legal 6-mon team but defensive code) → fall back to
  the Stage A `recommend-leads` output, log the anomaly.

## 10. Success criteria

### Stage A
- Live ArchaEye:
  - Sableye primary role = `setter`, all_roles ⊇ {setter, disruptor}.
  - Sinistcha primary role = `cleric`, all_roles ⊇ {cleric, redirect}.
  - Basculegion primary role = `cleaner`.
  - Pelipper primary role = `setter` (Drizzle), all_roles ⊇ {setter, pivot}.
  - Archaludon primary role = `setup_sweeper` (Stamina + bulk + Electro Shot).
  - Dragonite primary role = `wallbreaker` (no boosting move, mixed coverage).
  - `support` pillar ≥ 70 (Strong).
  - `synergy` pillar lifts from 22 → ≥ 50.
  - At least 1 of 10 scenarios picks Sableye + Archaludon as leads;
    at least 1 picks Pelipper + Archaludon (rain alternative).
- Goldens: 5+ canonical Reg-M-A teams have committed `RoleTagsByTeam`
  fixtures locked in.
- Re-running on the J0eVKJyJ_DQ Charizard team:
  - Aerodactyl primary role = `setter` (Wide Guard, Tailwind).
  - Charizard primary role = `setup_sweeper` or `wallbreaker`.
  - Garchomp primary role = `setup_sweeper` (Scale Shot speed boost).
- All existing tactical / user-teams / metavgc tests stay green.

### Stage B
- Live ArchaEye plan output matches the user's stated structure on at
  least 6 of 10 scenarios:
  - lead = `[sableye, archaludon]` OR `[pelipper, archaludon]`
  - mid_pivot = `sinistcha`
  - cleaner = `basculegion`
- Plan score ≥ Stage-A pair-score on the same scenario at least 7 of
  10 times (phase awareness should help, not hurt).
- Each plan surfaces 1+ phase-aware citations on at least 5 of 10
  scenarios.
- New tool `recommend_team_plan` is registered and contract-tested.
- All Stage A tests still green.

## 11. Out of scope (deferred)

- **Per-phase damage scoring vs simulated turn-3 board states.** Stage
  B approximates the mid-phase by treating it like a 1-vs-1 against
  the original opp leads. A real turn-3 sim (where one side has
  already taken/dealt damage, possibly switched) is its own slice.
- **Coefficient tuning UI.** α/β/γ/δ + the role-detection thresholds
  are hand-coded constants. Future slice could expose them via a
  config file or per-user preference.
- **Plan visualization.** The CLI prints text only. A web UI surfacing
  the 3-phase plan as a timeline is its own slice.
- **Replay-grounded validation.** Comparing our plan recommendations
  against actual Showdown replay outcomes is a research slice.
- **Multi-format role detection.** Reg-M-A only. If we expand to other
  formats, the role detection lists need re-curating per format.
- **LLM-generated rationale prose.** Phase rationales are
  template-built deterministically. A polished LLM prose pass is a
  follow-up.

## 12. Open questions for Stage 2 review

> **Reviewer:** mark each answer ✅ accept / ✏️ revise / ❌ reject + reasoning.

1. **Should `support` be a 5th pillar, or fold into Synergy?**
   Proposal: standalone 5th pillar. Reasoning: the failure mode is
   that Synergy's score (rule-based archetype tags) doesn't capture
   role-based contribution; folding would conflate. A separate score
   makes the regression visible as a metric.
   Alternative: keep Synergy as the only structural pillar but expand
   its definition to include role coherence — fewer pillars to reason
   about, but loses the ability to surface "good roles, bad teammate
   data" vs "good teammate data, no role plan."
   *Answer: Standalone 5th pillar*

2. **Role-tag scope.** 9 tags as proposed. Add or remove?
   Candidates considered and dropped:
   - `lead_dancer` (Fake Out users) — folded into `disruptor` since
     Fake Out is functionally a one-turn taunt.
   - `screen_setter` (sub-tag of `setter`) — too fine-grained for v1.
   *Answer: Maybe we should subset setters, screens, speed (tailwind, TR), weather*

3. **Role-tag detection — deterministic or LLM-classified?**
   Proposal: deterministic move/ability lookups (§4). Reasoning: roles
   are well-defined by VGC convention; LLM adds variance and cost
   without obvious quality gain. Deterministic also makes the goldens
   testable.
   *Answer: Deterministic*

4. **`role_coherence_bonus` magnitude (+15 to support, +20 to synergy
   archetype floor).** Hand-tuned. Confirm or propose alternates.
   *Answer: Confirm*

5. **`support_lift` coefficients.** +12 / +8 / +6 / +10 / -10 (§5.4).
   Hand-tuned. Risk: if the lift is too generous, all scenarios prefer
   support leads even when raw KO would be fine; too stingy and we're
   back where we started. Recommend a follow-up calibration slice
   after we have 10+ saved teams to evaluate.
   *Answer: Follow-up calibration slice recommended*

6. **Plan turn windows.** Lead T1–T2, Mid T2–T4, Late T4–T8. The
   overlap at T2 and T4 is intentional — phases are fuzzy. Confirm.
   *Answer: Confirm*

7. **Plan search size.** ~30–60 candidates per scenario. With 10
   scenarios × ~50 candidates × ~3 calcs each = ~1500 calc calls per
   team (mostly cache-warm after Stage A's pair search). Tolerable?
   *Answer: Tolerable*

8. **Should Stage B replace `recommend-leads` or add alongside?**
   Proposal: alongside. The existing tool returns leads-only output
   in <1s; the new tool returns the full plan. Different agent
   surfaces, both useful.
   Alternative: replace, return a richer object that always includes
   phases (lead-only callers ignore the mid/late fields).
   *Answer: Replace*

9. **Phase-citation strategy.** Free-text post-filter on phase
   keywords (`lead`, `mid`, `late`, `clean`, `revenge`, `endgame`)
   risks low recall if the speaker uses different vocabulary. Better
   alternative: extend the `Insight` schema to add a `phase_tag`
   classification at extraction time. That's a Slice-4-revisit
   (re-extract). Defer to a follow-up slice; use the post-filter for
   v1.
   *Answer: Extend the schema now*

10. **Stage A and Stage B in one PR or two?** Proposal: two PRs.
    Stage A is a backwards-compatible pillar add; Stage B is a new
    output shape. Two separate Stage 4–6 cycles keeps each diff
    focused.
    *Answer: Two PRs*

11. **Cleaner detection edge case.** Choice Specs Basculegion in
    pikalytics's most-common variant? Specs technically isn't
    Choice Scarf; should `cleaner` require Scarf specifically, or
    any Choice item? Proposal: Choice Scarf only — Specs is a
    wallbreaker. Confirm.
    *Answer: Choice Scarf only. Choice Specs is a wallbreaker.*

12. **`role_coherence` definition rigor.** Proposal: requires (a)
    ≥ 1 setter, (b) ≥ 1 payoff (setup_sweeper or cleaner), and (c) the
    setter's mechanism (screens / weather / TR / etc.) is exploitable
    by the payoff. (c) is fuzzy — e.g. screens benefit any payoff,
    weather only matches abilities. Acceptable to start with (a)+(b)
    and add (c) as a follow-up?
    *Answer: Start with (a)+(b) and add (c) as a follow-up.*

## 13. Reviewed-by

Reviewed-by: _Rodrigo_
