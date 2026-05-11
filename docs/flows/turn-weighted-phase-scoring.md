# Flow: turn-weighted-phase-scoring

**Slug:** `turn-weighted-phase-scoring` (Stage C of the C → F sequence)
**Status:** Stage 1 — flow draft
**Author:** Claude (Opus 4.7)
**Date:** 2026-05-11

> Stage C is the first of four sequential slices that lift the
> single-turn-snapshot scorer into a real turn-aware model. The
> sequence:
>
> - **Stage C — Turn-weighted phase scoring (THIS SLICE).** Each phase
>   resolves at a representative turn window; field state derived per
>   window (weather setter timing, weather duel resolution, screens/
>   Tailwind/TR decay). Plan score becomes a weighted sum of per-phase
>   calcs, not a single-turn snapshot.
> - **Stage D — Per-mon state tracking.** HP, boosts, fainted-ally
>   count, Choice-locking; powers Last Respects scaling, Stamina
>   accumulation, etc.
> - **Stage E — 1-ply opponent lookahead.** Enumerate likely opponent
>   counter-leads; score by expected outcome × counter-likelihood.
> - **Stage F — Full battle sim.** Hook `@pkmn/sim` for stochastic
>   per-plan win-rate.
>
> Stage C ships the per-phase abstraction the next three slices hang
> state and lookahead on. Each subsequent stage gets its own flow doc
> when its turn comes.

## 1. Why this slice

The current scorer is a single-turn snapshot. `damage_calc` runs with
`scenario.field` as the field state for every phase — turn 1 lead
calc and turn 5 cleaner calc see the same weather, the same Tailwind,
the same screens. Real VGC games unfold across 5–8 turns with field
state that changes turn by turn:

- **Weather setter timing.** Pelipper Drizzle activates on switch-in
  (turn 0). Sableye Rain Dance costs turn 1 — rain is up turn 2+. Our
  current model treats them identically (Stage B's
  `weather_provided_via_ability` gates the override but leaves
  move-based setters with no representation at all).
- **Weather duel resolution.** When both sides bring weather
  abilities, the SLOWER setter's weather wins (their ability fires
  last, overwrites). Pelipper (base 65) vs Tyranitar (base 61) →
  Tyranitar's Sand wins. Pelipper vs Hippowdon (47) → Pelipper's
  Rain wins. The current override is unconditional ("our weather
  always wins") — wrong half the time.
- **Field decay.** Screens 5T, Tailwind 4T, Trick Room 5T, weather
  5T (8T with Smooth Rock). Turn 6+ Tailwind is gone — the
  speed-based lead pick that depended on it is now misaligned.
- **Phase-appropriate matchups.** Lead phase = vs opposing leads.
  Late phase = vs whoever survived turns 1–4. The current scorer
  uses the same `opposing_preview` for all three phases.

Stage C addresses **all four of these** in one slice. Per-mon state
effects (Last Respects scaling, Stamina, Choice-locking) are NOT in
scope — they need state-tracking infrastructure that Stage D ships.

## 2. User flow

The user runs `pnpm data:tactical plan <team_id>` or
`pnpm data:tactical overview <team_id>` — same commands as today. The
output **shape** is unchanged (`TeamPlanScenario[]`, 3 phases each).
What changes is which leads / mids / cleaners get picked, and the
calc snippets surfaced in each phase's `key_calcs`.

Concrete user-visible deltas on the live ArchaEye demo:

1. **Sand scenario.** Today's pick is Archaludon + Pelipper (Drizzle
   overrides sand). Post-Stage-C, the scorer asks "would
   Pelipper-Drizzle actually win the weather duel vs the
   sand-stream-er in the scenario's preview?" If the opposing setter
   is Tyranitar (base 61, slower than Pelipper at 65), Pelipper's Rain
   wins the duel. If the setter is Hippowdon (base 47, even slower),
   Pelipper's Rain still wins because Pelipper is faster than
   Hippowdon. **In both cases Stage C confirms what Stage B already
   guessed.** But the test cases now have a justified algorithm.
2. **Trick Room scenario.** Today's pick depends on a calc done in
   TR. Post-Stage-C, the calc uses TR ONLY for turns 1–5; the late
   phase (turn 5+) sees TR expire and runs the calc without TR. If
   our setup_sweeper's win condition was "Archaludon OHKOs in TR,"
   the late calc now correctly shows it's outsped instead.
3. **Tailwind scenarios.** Lead-phase calcs use Tailwind (turns 1–4);
   late-phase calcs don't (Tailwind expired turn 5). A Choice Scarf
   user that "outspeeds in Tailwind" no longer benefits at the late
   phase — the calc engine now sees this honestly.
4. **Sableye lead variants.** Stage B excludes Sableye from being
   picked because its Rain Dance can't override turn-1 weather. Post-
   Stage-C, the scorer evaluates Sableye in lead as: "turn 1 calc in
   opposing weather; turn 2+ calc in rain." This gives the
   Sableye-Archaludon line a fair shot — it may even win in scenarios
   where Pelipper's Hurricane is fragile but Sableye's screens carry
   turns 1–5 of survival.

The CLI's `plan` output JSON gains a new field per phase: `field`
(the derived `ScenarioField` for THAT phase). Lets the agent loop
introspect "what weather did the scorer assume for turn 3?" instead
of guessing from the rationale prose.

## 3. Tech flow

```
buildOverview ──► generateScenarios (unchanged)
                       │ ScenarioSkeleton[]
                       ▼
              recommendTeamPlan (per scenario)
                       │
        ┌──────────────┴──────────────┐
        ▼                              ▼
   generatePlanCandidates       deriveTurnFieldStates  ◄── NEW
        │ PlanCandidate[]              │ TurnFieldStates
        │                              │  = { lead: ScenarioField,
        │                              │      mid:  ScenarioField,
        │                              │      late: ScenarioField }
        ▼                              ▼
              scorePlan(candidate, fields, ...)        ◄── REVISED
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
  scorePair       scoreMidPhase   scoreLatePhase
  (field=lead)    (field=mid)     (field=late)
        │              │              │
        └──────────────┴──────────────┘
                       │
                       ▼
                TeamPlanScenario with per-phase `field`
```

`deriveTurnFieldStates` is the load-bearing new module. Given a
candidate plan + scenario + role assignments, it returns three
`ScenarioField` objects — one per phase — derived from:

- The scenario's base field (weather, terrain, TR/Tailwind flags).
- Our leads' weather setter (ability vs move; speed order vs the
  opposing weather setter if any).
- Our leads' TR/Tailwind/screen setter timing.
- Decay schedules: weather 5T (8T with rock; out of scope for v1 —
  default 5T), Tailwind 4T, TR 5T, screens 5T (8T with Light Clay —
  also out of scope; default 5T).

Reuse:

- `damage_calc` (unchanged)
- `CalcCache` (unchanged — keys now include the derived field, not
  just the scenario field, so each phase's cache entries are distinct)
- `RoleTagAssignment` (Stage A) — reads `weather_provided`,
  `weather_provided_via_ability`
- `scorePair` / `scoreMidPhase` / `scoreLatePhase` — extended to
  accept a `field: ScenarioField` override

New, slice-specific:

- `src/data/tactical/derive-turn-fields.ts` — the per-phase field
  derivation function + weather-duel resolver
- `src/data/tactical/speed-order.ts` (or extend an existing module) —
  the speed-order helper for weather-duel resolution (compares our
  setter's base spe vs the opposing setter's base spe; SLOWER wins)
- Schema additions: `TeamPlanScenario.phases[*].field?:
  ScenarioField` (optional; lets backwards-compat callers ignore)

Cross-cutting:

- The opposing weather setter has to be **detected** from the
  scenario's `opposing_preview`. Stage C reuses Stage A's role
  classifier on a synthetic team built from the preview species: if
  any species in the preview carries a weather ability (Drizzle,
  Drought, Sand Stream, Snow Warning), it's the opposing setter.
  Without per-species ability data, we'd need a tiny lookup table —
  preferable to embed in `role-tags.ts`.

## 4. The turn-window model

| Phase | Turn window | Field state at phase start |
|---|---|---|
| Lead | T1–T2 | Scenario field + our ability-setters' weather (resolved by speed duel) |
| Mid | T2–T4 | Lead-phase field + our move-setters' weather (rain dance from T1 lands T2+) + screens still active |
| Late | T4–T8 | Decayed: Tailwind expired (T5), TR expired (T5), screens expired (T5), weather expired (T5+) unless re-set |

The "resolved by speed duel" rule, more precisely:

```
let ourSetter = leads.find(role.weather_provided_via_ability)
let theirSetter = opposing_preview.find(species.has_weather_ability)
if (ourSetter && theirSetter):
   weather = (ourSetter.base_spe < theirSetter.base_spe)
              ? ourSetter.weather    // SLOWER wins
              : theirSetter.weather
elif (ourSetter):
   weather = ourSetter.weather
elif (theirSetter):
   weather = theirSetter.weather
else:
   weather = scenario.field.weather  // whatever the scenario said
```

Move-based setters (Rain Dance) don't participate in the turn-1 duel
— they fire later. They're injected into the mid-phase field state if
the setter is in the lead pair:

```
let leadMoveSetter = leads.find(role.weather_provided && !role.weather_provided_via_ability)
if (leadMoveSetter):
   mid_field.weather = leadMoveSetter.weather  // assuming the move lands turn 1
```

### 4.1 Priority-setting abilities (the Sableye / Talonflame exception)

A subset of abilities grant **+priority** to the moves a support
setter cares about, so a move-based setter with the right ability
*does* take effect turn 1:

| Ability | Effect | Setters it accelerates |
|---|---|---|
| **Prankster** (Sableye, Whimsicott, Murkrow, …) | +1 priority on all status moves | Rain Dance, Sunny Day, Reflect, Light Screen, Trick Room, Tailwind, Quash, Encore, Will-O-Wisp, etc. |
| **Gale Wings** (Talonflame) | +1 priority on Flying-type moves *at full HP* | Tailwind |
| **Triage** (Comfey) | +3 priority on healing moves | Life Dew, Pollen Puff, Floral Healing |

These are NOT ability-based weather/screens setters in the sense of
Drizzle (which activates on switch-in with no move spent), but they
share the same turn-1 outcome:

- **Sableye + Prankster + Rain Dance** → rain up turn 1 (Sableye
  moves at +1 priority, sets rain before any opposing attack).
- **Talonflame + Gale Wings + Tailwind** → Tailwind up turn 1
  (Gale Wings is conditional on full HP; lead-phase Talonflame is
  typically full HP, so the condition holds at turn 1).
- **Comfey + Triage + Life Dew** → healing fires at +3 priority,
  effectively a free turn of survival.

Stage C extends the classifier with a `setter_priority_via_ability:
bool` flag (or richer enum) emitted alongside `weather_provided`,
`weather_provided_via_ability`, `weather_charged_move`. Field
derivation rule, combined:

```
let abilitySetter = ability-based (Drizzle etc.)
let prioritySetter = move-based AND ability ∈ {Prankster, Gale Wings, Triage}
                     AND scenarioConditionsForPriorityHold  // e.g. Gale Wings full HP
// Both behave as "turn 1 active":
if abilitySetter || prioritySetter:
   apply at lead-phase field
elif moveSetter:
   apply at mid-phase field (turn 2+)
```

This re-enables Sableye + Archaludon as a *turn-1-rain* line — not
just a turn-2-rain line. Stage B excluded Sableye from leads
specifically because Rain Dance was modeled as 2-turn; the priority
override makes it 1-turn, restoring the Sableye–Archaludon pick the
user originally described.

Gale Wings is conditional (full-HP gate). For v1 we assume the
condition holds at turn 1 (leads enter the battle at full HP — true
unless the team comp has prior chip somehow, which doesn't apply
since we score from a fresh-battle perspective). Documented as a
defensible v1 simplification.

**Edge cases the priority-ability rule explicitly handles:**
- Prankster move blocked by Dark-type opponent (Gen 7+ change —
  Prankster status moves fail against Dark targets). Out of scope
  v1; opposing preview species' typing is known from the roster, so
  a future refinement could detect this.
- Gale Wings at <100% HP turn 1 — impossible at lead phase, so
  ignored.
- Triage in lead — niche (Comfey isn't usually a Reg-M-A lead), but
  Life Dew at +3 priority makes the cleric mid-pivot effective even
  on turn 1 if Comfey is *in* the lead pair.

## 5. Decay schedules (v1 defaults)

| Effect | Default duration | Item extension (out of scope v1) |
|---|---|---|
| Weather (Rain/Sun/Sand/Snow) | 5 turns | Smooth Rock / Heat Rock / Damp Rock / Icy Rock → 8 turns |
| Trick Room | 5 turns | — |
| Tailwind | 4 turns | — |
| Reflect / Light Screen / Aurora Veil | 5 turns | Light Clay → 8 turns |

For the v1 model:
- Lead phase (T1–T2) sees all effects active when they're on the field.
- Mid phase (T2–T4) — Tailwind T1–T4 active; weather/screens/TR all
  still active (since they started T1 and last ≥ 5).
- Late phase (T4–T8) — Tailwind expired turn 5; everything else
  expired turn 6+. Late calc runs in neutral field by default.

Out of scope v1: extension items (Smooth Rock etc.). Documented as a
TODO; future slice (or this one if scope allows).

## 6. Output shape

`TeamPlanScenario.phases[*]` gains an optional `field` property:

```ts
phases: [
  { phase: "lead", turn_window: [1,2], field: { weather: "rain", ... }, ... },
  { phase: "mid",  turn_window: [2,4], field: { weather: "rain", ... }, ... },
  { phase: "late", turn_window: [4,8], field: { weather: "none", ... }, ... },  // expired
]
```

The top-level `field` on `TeamPlanScenario` itself stays — it's the
scenario's authored default. The per-phase field is the *derived*
field state for the scoring loop.

## 7. Persistence

No new persistence. Same compute-on-demand model. Cache keys
expand to include the derived per-phase field, which is correct —
e.g. the same `(attacker_set, defender_set, "Sand"-weather)` calc
is separate from `(... "Rain"-weather)` calc.

## 8. Error / empty states

- **No weather data on opposing preview species.** Fall back to the
  scenario's authored `field.weather`. Common case for non-weather
  scenarios.
- **Two of our leads BOTH bring weather (e.g., Pelipper + Tyranitar
  on the same team).** Resolve by intra-team speed order; the slower
  setter wins, exactly like the cross-team rule.
- **No leads carry weather + scenario has weather.** Scenario weather
  stays for all phases up to its decay turn. Late phase = neutral.
- **TR scenario + our team has TR setter.** TR-active flag stays
  true for lead and mid; late phase TR-expired (turn 5+ neutral
  speed comparison).

## 9. Success criteria

- ArchaEye on the live db (`01KR7TVD21G1Q99BK0NAEARFD8`):
  - Lead pair on Sand scenario = Archaludon + Pelipper (Pelipper
    base 65 < Tyranitar base 61 → Pelipper Rain wins the duel).
  - Late phase `field.weather` = "none" on all 10 scenarios (weather
    decayed by turn 5+).
  - Late phase Tailwind flag = false on all scenarios (expired turn 5).
- On a hypothetical Hippowdon-led sand team scenario: lead pair on
  Sand = Pelipper-side leads (Pelipper base 65 > Hippowdon base 47 →
  Pelipper still wins the duel because faster sets first then
  Hippowdon overrides — wait, this is wrong; need to re-verify the
  speed rule). **OPEN: Q2 below.**
- Sableye + Archaludon now appears in ≥ 2 of 10 scenarios as a
  recommended lead (Stage B excluded it; Stage C lets it back in
  because turn 2+ rain compensates the lost turn 1).
- All Stage A and Stage B tests stay green. Per-phase `field`
  introspection covered by new tests.

## 10. Out of scope (deferred)

- **Per-mon state tracking** (HP, boosts, fallen-ally count,
  Choice-locking, Stamina accumulation) — Stage D.
- **Opponent counter-lead lookahead** — Stage E.
- **Stochastic battle sim** — Stage F.
- **Status effects** (burn / paralysis / sleep / freeze) — Stage D
  scope; affects survival in mid/late phases.
- **Item extensions** (Smooth Rock weather extension etc.) — would
  fit in this slice's decay model but adds complexity. Defer.
- **Multiple weather changes mid-game** (e.g., opponent KO's our
  Pelipper turn 2, their Tyranitar's Sand re-establishes) — needs
  state tracking. Stage D.

## 11. Open questions for Stage 2 review

> **Reviewer:** mark each answer ✅ accept / ✏️ revise / ❌ reject + reasoning.

1. **Phase turn-windows.** Lead T1–T2, Mid T2–T4, Late T4–T8. The
   overlap at T2 and T4 was intentional in Stage B (phases are fuzzy).
   For derived field state, do we evaluate the field at the FIRST
   turn of each window (T1, T2, T4) or the MIDPOINT (T1.5, T3, T6)?
   **Proposal: first turn.** Conservative — captures the worst case
   for setters (Tailwind on lead phase = active throughout T1–T2;
   on mid phase = active T2 but expired T5 → still on at T2 start).
   *Answer: We could have scenarios for conservative and where the midpoint, early late is used.*

2. **Weather duel rule.** When both sides have weather abilities,
   the slower one wins (because their ability fires SECOND and
   overwrites). My §4 pseudo-code says `ourSetter.base_spe <
   theirSetter.base_spe` → ours wins. Verify the speed rule: is it
   actually "slower wins"? VGC convention: on switch-in,
   speed-priority abilities resolve fastest-first; weather-setters
   are NOT speed-priority — they resolve in standard speed order.
   The setter that activates LAST wins because its weather overwrites
   the prior one. Standard speed order = fastest goes first. So
   FASTEST sets FIRST, SLOWER sets SECOND, slower's weather wins.
   Confirm the rule.
   *Answer: ✅ accept*

3. **Opposing setter detection.** Stage C needs to know if the
   scenario's `opposing_preview` includes a weather-ability holder.
   The current `roster` / `species` tables carry abilities; the
   classifier can be invoked on a synthetic ScoringSet built from
   preview species. **Proposal: synthesize a minimal RoleTagInput per
   preview species** (species_id + ability from species table; no
   moves needed for weather detection). Alternative: lift a tiny
   `WEATHER_ABILITY_BY_SPECIES` lookup table. Synthesizing reuses
   the classifier; the lookup table risks drift.
   *Answer: ✅ accept*

4. **Per-phase field on `TeamPlanScenario.phases[*]`.** Adds an
   optional `field: ScenarioField` to each phase. Backwards-compat
   (optional); makes the derived state introspectable in the CLI /
   agent loop. Confirm shape.
   *Answer: ✅ accept*

5. **Decay defaults.** Weather 5T, TR 5T, Tailwind 4T, screens 5T.
   No item-based extensions (Smooth Rock etc.) in v1. Confirm
   defaults or revise.
   *Answer: ✅ accept*

6. **Late-phase field by default.** Per §5, late phase (T4–T8) sees
   weather, TR, Tailwind, and screens all expired. Lead-side late
   calcs run in neutral field. **Proposal: yes, default neutral.**
   The user-stated insight (Last Respects late-game) is independent
   of weather — Basculegion's Wave Crash benefits from rain but the
   late phase is when rain has just expired. Realistic.
   *Answer: There may be the scenario where sets persists on the late game, even these scenarios are encouraged. For instance, you want that Tailwind is set for late game Floette Eternal sweep*

7. **Speed-modifier handling in late phase.** Tailwind expired turn
   5. A Choice Scarf cleaner still has its 1.5× Spe in the late
   phase (Scarf doesn't decay). Confirm the scorer differentiates
   "permanent" speed modifiers (Scarf, ability boosts) from
   "temporary" (Tailwind).
   *Answer: ✅ accept*

8. **Cache key reshape.** The existing `CalcCache` key is
   `(attacker_set, defender_set, field)`. Per-phase fields are
   additive, so cache entries multiply by ~3 (one per phase).
   Tolerable? On 10 scenarios × 30–60 candidates × 3 phases × 2
   directions × ~3 moves = ~10800 cache entries worst case. ~2 MB
   memory. Confirm.
   *Answer: ✅ accept*

9. **Sableye lead reintroduction.** Stage B excluded Sableye from
   leads because its Rain Dance can't override turn-1 weather. Stage
   C reintroduces it (turn 2+ rain). The expected ArchaEye demo
   outcome: Sableye + Archaludon wins ≥ 2 scenarios where screens
   are valuable (TR, weather scenarios). Confirm this as a success
   criterion or revise.
   *Answer: ✅ accept*

10. **TODO discipline.** Several per-mon state effects (Last
    Respects scaling, Stamina, Choice-locking) move from "TODO in
    Stage B" to "Stage D scope." Confirm we leave the existing
    `TODO(stage6-deferred):` markers in place (don't re-tag as
    `stage-d-deferred`) so the grep surface stays consistent. The
    plan §19 from Stage B is the single source of truth.
    *Answer: ✅ accept*

11. **Priority-setting abilities (§4.1).** Stage C ships
    Prankster + Gale Wings + Triage as turn-1 setter accelerators.
    The classifier gains a new ability bucket — proposed name
    `setter_priority_via_ability`. Confirm scope (just those three
    abilities for v1, with Quick Draw deferred because it's
    probabilistic). Also confirm the v1 simplification "Gale Wings
    leads are always full HP at turn 1." Dark-type vs Prankster
    interaction (Prankster status moves fail vs Dark targets in
    Gen 7+) is deferred to a future refinement.
    *Answer: Look for these kind of habilities in the roster*

## 12. Reviewed-by

Reviewed-by: _Rodrigo Caballero_
