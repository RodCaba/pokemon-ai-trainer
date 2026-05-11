# Flow: per-mon-state-tracking

**Slug:** `per-mon-state-tracking` (Stage D of the C → F sequence)
**Status:** Stage 1 — flow draft
**Author:** Claude (Opus 4.7)
**Date:** 2026-05-11

> Stage D builds on Stage C's per-phase field-state abstraction by
> tracking per-mon state across phases. Per the C→F roadmap:
>
> - **Stage C — Turn-weighted phase scoring (shipped).** Per-phase
>   `ScenarioField` snapshots.
> - **Stage D — Per-mon state tracking (THIS SLICE).** HP / boosts /
>   fainted-ally count / Choice-locking surface per phase. Powers Last
>   Respects scaling, Stamina/Defiant accumulation, status effects.
> - **Stage E — 1-ply opponent lookahead.** Enumerate counter-leads.
> - **Stage F — Full battle sim.** `@pkmn/sim` integration.

## 1. Why this slice

Stage C made the FIELD turn-aware but the MONS are still static.
Critical gaps the user-stated framing surfaces:

- **Last Respects scaling.** Basculegion's Last Respects is `50 BP +
  50 × fallen_allies`. Turn 1 with 0 fallen = 50 BP (a non-threat).
  Turn 5+ with 2 fallen = 150 BP. Turn 5+ with 3 fallen = 200 BP +
  Adaptability + Scarf → reliable OHKO across most of the bulky-side
  meta. Stage C scores Basculegion in late phase using base 50 BP for
  Last Respects (or whatever `@smogon/calc` defaults to); the
  reality is far better.
- **Stamina accumulation.** Archaludon's Stamina raises Def +1 every
  time it takes a hit. Turn 1: incoming damage as calc. Turn 2: same
  hit hits a +1 defender. Turn 3: +2. Stage C scores incoming-damage
  for the lead phase against base-Def Archaludon, missing the entire
  setup arc.
- **Choice-locking.** Basculegion + Choice Scarf locks into a single
  move per switch-in. If the cleaner uses Wave Crash turn 5, it can
  only Wave Crash turn 6+ until it switches out. Stage C lets the
  scorer pick "best move" per turn, which over-counts late-phase
  damage for Scarf cleaners.
- **Status effects.** Burn halves Atk (and chips 1/16 HP). Sleep
  freezes a mon for 1–3 turns. Paralysis cuts speed by 75% + 25%
  chance to miss a turn. Stage C calcs assume healthy attackers.
- **Switch-in timing.** When does Basculegion come in? Stage C
  assumes turn 5+. Reality: depends on whether lead pair survives.
  If our lead pair takes a Tyranitar Rock Slide turn 1 and one mon
  faints, the cleaner enters at turn 2 with `fallen_allies = 1`,
  changing Last Respects to 100 BP — earlier and stronger.

This slice adds the smallest abstraction that captures these effects
without going full battle-sim (Stage F): a **per-phase mon state
snapshot** that carries HP %, applied boosts, fallen-ally count,
Choice-locked move, and status condition.

## 2. User flow

Same CLI as today: `pnpm data:tactical plan <team_id>`. The output
JSON's existing `phases[*].field` (Stage C) is joined by a new
`phases[*].state`:

```json
{
  "phases": [
    {
      "phase": "lead",
      "turn_window": [1, 2],
      "field": { /* Stage C */ },
      "state": {
        "ours": [
          { "species_id": "sableye",    "hp_pct": 100, "boosts": {}, "status": "none", "choice_locked": null },
          { "species_id": "archaludon", "hp_pct": 100, "boosts": {}, "status": "none", "choice_locked": null }
        ],
        "theirs": [
          { "species_id": "tyranitar",  "hp_pct": 100, "boosts": {}, "status": "none", "choice_locked": null },
          { "species_id": "excadrill",  "hp_pct": 100, "boosts": {}, "status": "none", "choice_locked": null }
        ],
        "fallen_allies_ours": 0,
        "fallen_allies_theirs": 0
      }
    },
    { "phase": "mid", "state": { /* assumed post-lead-exchange */ } },
    { "phase": "late", "state": { /* assumed late-game position */ } }
  ]
}
```

User-visible deltas on the live ArchaEye demo:

1. **Basculegion's late-phase calcs**. The cleaner's `key_calcs`
   array now shows `Last Respects (150 BP scaled, 2 fallen)` instead
   of the default 50 BP. Damage % on bulky panel members goes up
   accordingly.
2. **Archaludon's mid-phase survival improves.** The mid scorer sees
   `boosts.def: +1` (assumed one hit landed turn 1) and runs the
   incoming-damage calc against the boosted defender. Survival score
   rises.
3. **Status-affected calcs.** Sand chip damage on non-Rock/Ground/
   Steel mons reduces mid-phase HP from 100% → ~88%. Calcs that depend
   on HP (Last Respects via fallen count; HP-based moves like Belly
   Drum / Substitute) propagate.

## 3. Tech flow

```
buildOverview ──► generateScenarios
                       │ ScenarioSkeleton[]
                       ▼
              recommendTeamPlan (per scenario)
                       │
        ┌──────────────┴──────────────┐
        ▼                              ▼
   generatePlanCandidates       deriveTurnFieldStates (Stage C)
        │ PlanCandidate[]              │ TurnFieldStates
        │                              │
        │                  ┌───────────┴─────────┐
        │                  ▼                     ▼
        │           deriveTurnStates (NEW)  detectOpposingSetters
        │                  │ TurnStates
        │                  │  = { lead, mid, late: MonState[] × 2 + fallen_counts }
        │                  ▼
        └─────────► scorePlan(candidate, fields, states, ...)
                       │
              (state flows into per-phase damage_calc inputs:
               adjusted HP %, boosts, status, choice-lock)
```

`deriveTurnStates` is the new load-bearing module. Sister to Stage
C's `deriveTurnFieldStates`. Pure function over `(team, scenario,
candidate, roleAssignments, opposingSetters, fields)` returning a
`TurnStates` object: per-phase, our 2 actors + their 2 actors with
HP%, boosts, status, choice-locked move.

The heuristic state-propagation rules (Stage D-v1):

| Effect | Trigger | Resolution |
|---|---|---|
| Last Respects BP scaling | Basculegion in late, `fallen_allies > 0` | calc uses `50 + 50 × fallen_allies` |
| Stamina +1 Def | Archaludon in mid, assumed hit turn 1 | mid calc against Archaludon uses `boosts.def: +1`; late uses `+2` |
| Defiant +2 Atk | Set with Defiant ability, opposing Intimidate detected in opposing_preview | trigger phase incoming, atk boost applies thereafter |
| Burn halve Atk | Set with Will-O-Wisp in opposing leads | physical attacker calcs use `boosts.atk: -50%` ish (engine: burn flag) |
| Paralysis −75% spe | Set with Thunder Wave / Body Slam para from opposing | speed comparisons adjusted |
| Sand chip damage | Stage C field.weather = "sand", set not Rock/Ground/Steel | HP -1/16 per turn elapsed in sand |
| Choice-locked move | Scarf user used a move last phase | mid/late calcs forced to that move |
| Fallen ally count | Lead phase ends: assume 1 ally fell if scenario has high-pressure leads | `fallen_allies_ours = 1` for mid/late |

Stage D ships heuristic propagation — NOT a real battle sim. The
"assumed" rules are conservative defaults (high-pressure scenarios
get fallen=1 by mid; bulky-vs-bulky scenarios get fallen=0). Future
Stage E/F refines.

## 4. Module boundaries

New:
- `src/data/tactical/derive-turn-states.ts` — pure state resolver.
- Possibly `src/data/tactical/mon-state.ts` — shared `MonState`
  interface + helpers (HP, boosts shape, etc.).

Modified:
- `src/schemas/tactical.ts` — add `MonStateSchema`, `TurnStateSchema`,
  optional `state` on Lead/Mid/Late phases. Bump
  `TeamTacticalOverview.schema_version` 4 → 5.
- `src/data/tactical/score-mid-phase.ts` / `score-late-phase.ts` —
  accept `state` alongside scenario; consume HP %, boosts, choice
  lock when wiring `damage_calc`.
- `src/data/tactical/score-pair.ts` — same; lead phase state is
  trivial (everyone at 100%, no boosts) but future tests may inject.
- `src/data/tactical/recommend-plan.ts` — orchestrate
  `deriveTurnStates` per candidate; emit `state` on each emitted phase.

## 5. Heuristic state propagation rules (v1)

### 5.1 Fallen ally count
- Lead phase: `fallen_allies = 0` (both sides start fresh).
- Mid phase: `fallen_allies_ours = 0 OR 1`. Rule: 1 if scenario's
  `opposing_preview` carries a high-offense species (per role tags:
  `wallbreaker` OR `cleaner` OR `setup_sweeper` OR `weather_setter`+
  Tailwind combo). Else 0. Same logic for `_theirs`.
- Late phase: `fallen_allies_ours` from mid + 1 (assume one more
  trade happened mid-phase). `_theirs` likewise. Cap at 2 per side
  (Reg M-A doubles, 4 mons total alive in late phase typically =
  cleaner + back × 1 vs 2 opposing).

### 5.2 HP %
- Lead phase: both sides 100%.
- Mid phase: leads at ~60% if they took a hit turn 1, else 100%. Use
  the lead-phase damage calc result as the proxy: if our lead pair's
  incoming-damage estimate was > 30%, set mid HP to 100 − that.
- Late phase: mid actors at ~40% (took another hit). Late cleaner at
  100% (just switched in).
- Sand chip damage: -6% per phase if sand active AND not immune.

### 5.3 Boost accumulation
- Stamina: +1 Def per hit. Mid = +1, late = +2 (assumes 2 hits taken).
- Defiant / Justified: trigger only when explicit; default +0.
- Beast Boost: triggers on KO. Mid/late = +1 SpA or Atk depending on
  highest stat after EV/SPS.
- Setup moves (Dragon Dance, Swords Dance, etc.): mid phase = +1 if
  the user is in the lead pair AND has a free turn (heuristic: scenario
  has no priority threat → free turn).

### 5.4 Choice-locked move
- Scarf user in late phase: choose the highest-EV move from their
  movepool (per Stage C's late field-state). Lock to it.
- Specs user in lead phase: similar pin.
- Band user: same.
- Mid phase: only locked if the user was an active lead AND used a
  move turn 1 — heuristic: locked to the highest-BP STAB.

### 5.5 Status
- Burn: if opposing leads carry Will-O-Wisp, our lead actors get
  `status: "burn"` in mid phase. Half Atk on physical attackers.
- Para: if opposing carry Thunder Wave / Body Slam, our actors are
  para'd (25% turn skip chance — not modeled per-turn, just speed cut).
- Sleep: high-impact; if opposing carry Spore (Amoonguss),
  `status: "sleep"` on the sleep target in mid phase. Sleep duration
  random 1–3 turns; v1 assumes 2.

## 6. Output shape

`TeamPlanScenario.phases[*].state?: PhaseStateSchema` (optional).
Same backwards-compat pattern as Stage C's `field` addition.

```ts
PhaseStateSchema = z.object({
  ours: z.array(MonStateSchema).max(2),
  theirs: z.array(MonStateSchema).max(2),
  fallen_allies_ours: z.number().int().min(0).max(5),
  fallen_allies_theirs: z.number().int().min(0).max(5),
}).strict();

MonStateSchema = z.object({
  species_id: RosterId,
  hp_pct: z.number().int().min(0).max(100),
  boosts: z.object({
    atk: z.number().int().min(-6).max(6).default(0),
    def: z.number().int().min(-6).max(6).default(0),
    spa: z.number().int().min(-6).max(6).default(0),
    spd: z.number().int().min(-6).max(6).default(0),
    spe: z.number().int().min(-6).max(6).default(0),
    acc: z.number().int().min(-6).max(6).default(0),
    eva: z.number().int().min(-6).max(6).default(0),
  }).partial(),
  status: z.enum(["none", "burn", "paralysis", "sleep", "freeze", "poison", "toxic"]).default("none"),
  choice_locked_move: z.string().nullable().default(null),
}).strict();
```

## 7. Persistence

None. Compute on demand, same model as Stages A/B/C.

## 8. Error / empty states

- Lead phase always emits state with full HP / no status — no propagation needed.
- Scenarios without an opposing_preview match for trigger abilities (no
  Will-O-Wisp / Spore detected) → no status applied.
- Cleaner detected by Stage A but not actually a Scarf user (rare) →
  no choice-lock applied.
- Mid/late HP heuristic that produces negative (huge incoming damage)
  → clamp to 1% (1 HP), not 0, so the actor isn't auto-KO'd.

## 9. Success criteria

- ArchaEye live demo (`pnpm data:tactical plan
  01KR7TVD21G1Q99BK0NAEARFD8`):
  - Late phase Basculegion's `key_calcs` shows Last Respects damage
    using BP ≥ 100 (i.e., scaled by `fallen_allies_ours ≥ 1`).
  - Mid phase Archaludon's `state.ours[*].boosts.def` = 1 in
    setup-friendly scenarios.
  - Choice-locked Basculegion's late `state` carries
    `choice_locked_move: "wavecrash"` (or "lastrespects").
- All Stage A/B/C tests stay green.
- `schema_version` bumps to 5.

## 10. Out of scope (deferred)

- Real probabilistic turn-by-turn simulation (Stage F).
- Opponent action selection (Stage E).
- Item activation (Sitrus Berry, Air Balloon pop, etc.) — too
  context-dependent without action selection.
- Multi-turn status duration (sleep counter) — assumed fixed.
- Hazards (Stealth Rock, Spikes) — Reg-M-A has them but tracking
  switches needs Stage E.

## 11. Open questions for Stage 2 review

> **Reviewer:** mark each ✅ accept / ✏️ revise / ❌ reject.

1. **Heuristic fallen-ally rule.** Mid = 1 if opposing has
   wallbreaker/cleaner/setup_sweeper, else 0. Late = mid + 1, capped
   at 2. Tightenable. **Proposal: ship as-is, calibrate in Stage E.**
   *Answer: ✅ accept*

2. **HP propagation rule.** Use the lead-phase incoming-damage calc
   result to set mid HP. Sounds circular — Stage C's lead calc
   doesn't currently store damage taken; only outgoing. Either add
   an incoming-damage echo on the lead phase or use a fixed heuristic
   (e.g., 70%). **Proposal: fixed 70% for mid leads; defer the
   echo-from-lead-calc refinement.**
   *Answer: Add the incoming-damage echo on the lead phase.*

3. **Stamina detection.** Only ability-based stat-up
   accumulators (Stamina, Defiant, Justified, Beast Boost) trigger.
   Setup moves (Dragon Dance, Swords Dance) require action-selection
   modeling — deferred to Stage E. **Confirm.**
   *Answer: ✅ accept*

4. **Choice-lock pick.** Late phase Scarf cleaner: pick highest
   max-roll % move from the user's 4-move set vs the bulky panel
   members. Lock to that. **Proposal: yes, deterministic pick.**
   *Answer: ✅ accept*

5. **Status detection from opposing_preview moves.** If preview
   species' movepool includes Will-O-Wisp / Thunder Wave / Spore, we
   apply it to our actors. But we don't know if the opposing AI
   would actually USE those moves vs attacking. **Proposal:
   probabilistic — apply status with 50% weight (half the score
   delta). Conservative without going full sim.** Alternative: never
   apply, only emit status when the user-facing field carries the
   opposing TR / weather setter (which is already detected).
   *Answer: ✅ accept*

6. **Schema bump 4 → 5.** Same discipline as Stage A/B/C. Confirm.
   *Answer: ✅ accept*

7. **`state` per phase is OPTIONAL.** Pre-Stage-D callers that ignore
   `state` keep working. Confirm.
   *Answer: ✅ accept*

8. **Live ArchaEye success bar.** Mid Archaludon boosts.def = 1 OR
   late Last Respects calc uses BP ≥ 100. Both, or either, as the
   gate? **Proposal: both must hold.**
   *Answer: Both must hold*

9. **Last Respects BP scaling integration.** `damage_calc` already
   models the move — does our wrapper need to pass `fallen_allies`
   somehow? Smogon's API takes a `move.basePowerCallback` for
   conditional BP. We'd need to set BP explicitly per phase. Confirm
   path: override the move's `bp` at call time.
   *Answer: ✅ accept — override `bp` at call time via the existing
   `damage_calc` move-override path. Add `key_calcs[*].notes` citing
   `"Last Respects BP=N from fallen_allies=M"` for traceability.*

10. **Reg-M-A invariants.** No new Tera reference. No new EV/IV
    schemas (we track BOOSTS which are stat-stage modifiers — different
    concept). Confirm.
    *Answer: ✅ accept — boosts are stat-stage modifiers, distinct
    from EVs/SPS; no Tera; no IV inputs.*

## 11.1 Future feature noted (out of scope for Stage D)

**Win-condition resolution per matchup** (see memory
`feature_win_condition_resolution.md`). When the dedicated
win-condition slice ships, it adds `win_condition_ref` pointing at
one of `state.ours[*].species_id` plus `opposing_threats[]` pointing
at `state.theirs[*].species_id`. Stage D's `MonStateSchema` must
stay `.strict()` but composable — additions land in a future
`schema_version` bump.

## 12. Reviewed-by

Reviewed-by: Rodrigo, 2026-05-11 (Q1–Q8 + Q2 revised to echo lead-phase
incoming-damage rather than fixed 70%); Q9–Q10 self-applied with
conservative proposals (Claude, auto mode) — flag at Stage 3 if
revision desired.
