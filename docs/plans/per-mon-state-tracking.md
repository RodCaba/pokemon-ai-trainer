# Tech Plan — Per-Mon State Tracking (Stage D)

**Slug:** `per-mon-state-tracking`
**Branch:** `feat/per-mon-state-tracking`
**Stage:** Stage 3 — Tech plan (pending approval)
**Date:** 2026-05-11
**Author:** Tech Lead subagent
**Implements flow doc:** `docs/flows/per-mon-state-tracking.md` (Stage 2 reviewed 2026-05-11 by Rodrigo — §12). Q1–Q10 bindings apply. **Q2 is REVISED**: HP propagation echoes the lead-phase incoming-damage calc result rather than using a fixed 70% heuristic. **Q5 is REVISED conservatively**: status whitelist is Spore / Will-O-Wisp / Thunder Wave only; emitted full-weight only when the opposing set is DB-confirmed; probabilistic blending deferred to Stage E.

**Memory citations:**
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/feature_win_condition_resolution.md` — `MonStateSchema` must stay `.strict()` but composable so a future `win_condition_ref` / `opposing_threats[]` slice can add fields under a `schema_version` bump without reshaping today's output.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_no_tera.md` — boosts/state shape carries no `tera_*` field; `.strict()` rejects extras.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_stat_rules.md` — boosts here are stat-stage modifiers (-6..+6), distinct from SPS/EVs. No SPS or IV references in `MonStateSchema`.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_roster.md` — all `species_id`s in `MonStateSchema` are Reg-M-A `RosterId`s; fixtures use only legal species.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/labmaus_pokepaste_deferred_todos.md` — all Stage-D deferrals land as inline `// TODO(stage6-deferred):` so the existing grep surface stays consistent.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/test_fixtures_no_invariant_blobs.md` — state expectations in test code as in-line literals; no opaque per-state JSON dumps.

**Sibling precedents:**
- `docs/plans/turn-weighted-phase-scoring.md` (Stage C). Direct predecessor. Owns `deriveTurnFieldStates`, `OpposingSetters`, the `setter_priority_via_ability` classifier branch, the per-phase `ScenarioSkeleton` clone pattern, and the `_fieldHash` cache-key extension. Stage D's `deriveTurnStates` is the **sister** to `deriveTurnFieldStates`; same posture (pure, DB-free, called once per candidate per scenario by `scorePlan`).
- `docs/plans/team-phase-plan.md` (Stage B). Owns the optional-per-phase-field additive precedent. Stage D's `state` field on each phase reuses the same backwards-compat pattern that Stage B used for `phases[*].field` and that Stage C generalized.
- `docs/plans/team-support-pillar.md` (Stage A). Owns the role classifier (`deriveRoleTags`), `buildRoleAssignments`, the abilities lookup with `priority_grants_lookup` deps. Stage D piggybacks on `RoleTagAssignment` (Stamina / Defiant detection lives on existing `setup_ability` tags).

**First-of-kind for this slice:**
- **Per-mon state snapshots in plan output.** First time a `TeamPlanScenario` phase carries actor-level state (HP / boosts / status / choice-locked move).
- **Cross-phase echo from a scorer.** `score-pair.ts` must return *both* a numeric score AND the incoming-damage % observed against each lead actor (Q2 revised). This is the first scorer-as-source-of-derived-data pattern; prior scorers were write-once-discard.
- **`damage_calc` move-`bp` override path.** First production caller of the Smogon engine's `Move.bp` override option. Powers Last Respects scaling (Q9) and forward-compat for any conditional-BP move (Punishment, Stored Power) we may track later.
- **DB-gated status application.** First conservative "only act when the opposing set is DB-confirmed" rule in the tactical layer. Stamps a design pattern for Stage E's status-action selection.
- **Schema bump 4 → 5** on an additive change. Same observability discipline established in Stages A/B/C.

---

## 1. Goal recap

Stage C made the FIELD turn-aware; Stage D makes the MONS turn-aware. Every emitted `TeamPlanScenario.phases[i]` gains an optional `state` block carrying, per actor (our 2 lead/mid/late actors + opposing 2 actors), the HP %, accumulated stat-stage boosts, status condition, and choice-locked move. Per-phase state is fed back into the damage-calc inputs so:

1. **Basculegion Last Respects scales.** Late-phase calc uses `bp = 50 + 50 × fallen_allies_ours` instead of the engine's default 50 BP. With `fallen_allies_ours ≥ 1` on ArchaEye, BP ≥ 100.
2. **Archaludon Stamina accumulates.** Mid-phase Archaludon enters with `boosts.def: +1` (one hit landed turn 1) and the incoming-damage calc sees a boosted defender. Survival improves.
3. **HP propagation reflects lead-phase incoming damage** (Q2 revised). `score-pair.ts` surfaces the max-roll incoming-damage % per lead actor; `deriveTurnStates` consumes that echo to set mid-phase HP (`hp_pct = clamp(100 - incoming, 1, 100)`). Same flow mid → late. Sand chip damage (-6%) stacks on top when sand is active and the actor isn't immune.
4. **Choice-locking** pins late-phase Scarf cleaners (Basculegion) to a deterministic max-roll move vs the bulky panel.
5. **Status whitelist** (Q5 revised): Spore / Will-O-Wisp / Thunder Wave applied at full weight ONLY when the opposing set is DB-confirmed (the opposing species has a labmaus/pikalytics-confirmed set carrying the move). No probabilistic blending in v1.

**Deliverables:**
- `src/data/tactical/derive-turn-states.ts` — sister module to `derive-turn-fields.ts`. Pure function `deriveTurnStates(input) → TurnStates` (lead / mid / late `PhaseState`).
- `src/data/tactical/mon-state.ts` — small shared helpers (`clampHpPct`, `applySandChip`, `pickChoiceLockedMove`).
- `src/schemas/tactical.ts` — `MonStateSchema`, `PhaseStateSchema`; optional `state` on `LeadPhaseSchema` / `MidPhaseSchema` / `LatePhaseSchema`; bump `TeamTacticalOverviewSchema.schema_version: 4 → 5`.
- `src/data/tactical/score-pair.ts` — extend the return shape from `number` to `{ score: number; lead_incoming_damage_pct: { ours: [number, number]; theirs: [number, number] } }`. Callers updated.
- `src/data/tactical/score-mid-phase.ts` — extend the return shape symmetrically to surface mid-phase incoming damage for the lead→mid→late echo chain. (Sister change; ensures late-phase HP can derive from mid-phase incoming damage, not the lead-phase echo.)
- `src/tools/damage-calc/` — add an optional `bp` override on `MoveSpecSchema`; `toEngineMove` threads it into the `@smogon/calc` `Move` constructor's third-arg `bp` option.
- `src/data/tactical/recommend-plan.ts` — orchestrates `deriveTurnStates` per candidate per scenario; threads the per-phase `state` into `damage_calc` inputs at the `collectKeyCalcsForPair` step (HP %, boosts, status, choice-lock); emits `state` on each emitted phase; appends `key_calcs[*].notes` line `"Last Respects BP=N from fallen_allies=M"` whenever the cleaner uses Last Respects.

**Done means:**
1. Live ArchaEye demo (`pnpm data:tactical plan 01KR7TVD21G1Q99BK0NAEARFD8`) — **BOTH gates** (Q8 binding):
   - Mid phase Archaludon `state.ours[*].boosts.def === 1` in at least the scenarios where Archaludon is the lead-phase actor that absorbed a turn-1 hit.
   - Late phase Basculegion `key_calcs[*]` shows `move_id === "lastrespects"` with `bp >= 100` (BP scaled by `fallen_allies_ours ≥ 1`) and a `notes` line citing the scaling.
2. All Stage A/B/C tests stay green (regression — `schema_version` consumers updated, scorer return-shape callers updated).
3. `schema_version` bumps 4 → 5. Schemas reject `4` in Stage-D output.

**Out of scope (deferred — NOT this slice):**
- Setup-move boosts (Dragon Dance, Swords Dance) — Q3 binding defers to Stage E (requires action selection). `// TODO(stage6-deferred): setup-move-boosts`.
- Probabilistic status blending (50% weight, etc.) — Stage E. `// TODO(stage6-deferred): probabilistic-status-blending`.
- Win-condition resolution (`win_condition_ref`, `opposing_threats[]` on `PhaseStateSchema`) — future dedicated slice per memory `feature_win_condition_resolution.md`. `MonStateSchema` is `.strict()` so future fields land under a fresh `schema_version` bump. `// TODO(stage6-deferred): win-condition-resolution`.
- Multi-turn status duration (sleep counter 1–3) — assumed-fixed 2 turns. `// TODO(stage6-deferred): multi-turn-status-duration`.
- Item activation (Sitrus Berry, Air Balloon pop, Weakness Policy) — Stage E. `// TODO(stage6-deferred): item-activation`.
- Hazards (Stealth Rock, Spikes) — requires switch tracking (Stage E). `// TODO(stage6-deferred): hazards`.
- True battle sim with action selection — Stage F.

---

## 2. Module boundaries

All paths absolute under `/Users/rodrigo/src/pokemon-ai-trainer/`. **NEW** unless marked.

### 2.1 Schemas

#### `src/schemas/tactical.ts` *(extend; bump 4 → 5)*
- **Add** `MonStateSchema` — see §3.1. `.strict()` + composable; new fields land in a future bump.
- **Add** `PhaseStateSchema` — see §3.2. `.strict()`.
- **Add** optional `state: PhaseStateSchema.optional()` on `LeadPhaseSchema`, `MidPhaseSchema`, `LatePhaseSchema`.
- **Bump** `TeamTacticalOverviewSchema.schema_version: z.literal(4) → z.literal(5)`. Stage-D output that emits `schema_version: 4` is **rejected**.
- No removals.
- Pure-data CLAUDE.md §3 exemption applies; the schema additions land as a batched commit (S1..S6).

#### `src/schemas/calc.ts` *(extend)*
- **Add** optional `bp: z.number().int().min(1).max(250).optional()` on `MoveSpecSchema`. Defaults to undefined ⇒ engine's stored BP for that move. Set explicitly when a caller (Stage D's recommend-plan) wants to override (Last Respects, future Punishment).
- `forbidIllegalKeys`-wrapped schema continues to reject Tera Blast, ivs, evs etc.

### 2.2 Data layer (`src/data/tactical/`)

| File | Disposition | Responsibility |
|---|---|---|
| `derive-turn-states.ts` | **NEW** | Pure function `deriveTurnStates(input) → TurnStates`. Sister of `derive-turn-fields.ts`. Resolves fallen-ally count, HP propagation (Q2 echo), Stamina/Defiant boost accumulation, choice-lock pick, status whitelist application. |
| `mon-state.ts` | **NEW** | Small shared helpers: `clampHpPct(n)`, `applySandChip(state, field)`, `pickChoiceLockedMove(spec, opposingPanel)`, `isSandImmune(species)`. |
| `score-pair.ts` | **EXTEND** | `scorePair` return shape extended from `number` to `ScorePairResult` (see §3.3). Computes max-roll incoming-damage % per lead actor as a byproduct of the existing `defense_loss` loop; surfaces it. `realScore`'s internal `theirBestMax` per-ours accumulator gets surfaced. **All call sites updated.** |
| `score-mid-phase.ts` | **EXTEND** | Same posture: return shape extends to `{ score: number; mid_incoming_damage_pct: { ours: [number, number] } }` so late-phase HP can derive from mid-phase incoming damage. (Mid scorer today is deterministic-stub; Stage D adds a defensive max-roll calc against the opposing leads when `scoring_team`/`scoring_panel` are present.) |
| `recommend-plan.ts` | **EXTEND** | Inside `scorePlan`: call `deriveTurnFieldStates` (existing), then `deriveTurnStates` (new) — the latter takes the *result* of `scorePair`'s incoming-damage echo so the mid-phase state's HP carries the real damage taken. In `recommendTeamPlan`: emit `state` on each phase, override `damage_calc` move BP for Last Respects in the cleaner's `key_calcs` step, append `key_calcs[*].notes`. |
| `score-pair.ts` and `score-late-phase.ts` callers in `collectKeyCalcsForPair` | **EXTEND** | When constructing the `PokemonSpec` for `damage_calc`, merge in the phase's `MonState` (`statBoosts`, `status`, `hpPercent`). When the move is Last Respects, override `move.bp = 50 + 50 × fallen_allies_ours`. |

### 2.3 Tool layer

#### `src/tools/damage-calc/mapping.ts` *(extend)*
- `toEngineMove(spec: MoveSpec): Move` — thread `spec.bp` (when defined) into the engine's `Move` opts as the `bp` field. No other change.

#### `src/tools/damage-calc/SPEC.md` *(extend)*
- Note the new `bp` field on the input contract with one paragraph: "Override the move's base power. Used for conditional-BP moves like Last Respects (50 + 50 × fallen_allies) where the caller knows the situational BP value the engine can't infer."

### 2.4 DB layer

**Not applicable.** Stage D introduces no new tables, columns, migrations, or repos. Status detection reads existing `team_sets` / `labmaus_consensus` tables via the existing `scoring_panel.entries[*].set.moves` plumbing (see §3.6 for the "DB-confirmed" check).

### 2.5 CLI / agent tool

No tool-contract signature change. `recommend_team_plan` output gains the per-phase `state` field (additive). The tool description prose is **unchanged** because the output is documented by the `TeamPlanScenario` schema — the schema is the contract (CLAUDE.md §9).

### 2.6 Tests

```
tests/schemas/tactical-mon-state.test.ts                  (S1..S6 — pure-data)
tests/schemas/calc-move-bp-override.test.ts               (S7..S8 — pure-data)
tests/data/tactical/derive-turn-states.test.ts            (DS1..DS14)
tests/data/tactical/score-pair-incoming-echo.test.ts      (SE1..SE5)
tests/data/tactical/score-mid-phase-incoming-echo.test.ts (SE6..SE8)
tests/data/tactical/recommend-plan-stage-d.test.ts        (RP1..RP10)
tests/tools/damage-calc-bp-override.test.ts               (BP1..BP3)
tests/scripts/tactical-cli-stage-d.test.ts                (T1..T3)
```

---

## 3. Data schemas (zod)

Pure-data per CLAUDE.md §3 — schema additions batched in S1..S8.

### 3.1 `MonStateSchema`

```ts
// src/schemas/tactical.ts

/** Stat-stage boosts (-6..+6) accumulated on a single actor in a phase.
 *  Distinct from SPS/EVs (memory regulation_m_a_stat_rules.md). */
const MonStateBoostsSchema = z
  .object({
    atk: z.number().int().min(-6).max(6).default(0),
    def: z.number().int().min(-6).max(6).default(0),
    spa: z.number().int().min(-6).max(6).default(0),
    spd: z.number().int().min(-6).max(6).default(0),
    spe: z.number().int().min(-6).max(6).default(0),
    acc: z.number().int().min(-6).max(6).default(0),
    eva: z.number().int().min(-6).max(6).default(0),
  })
  .strict();

/** Per-actor state snapshot at the start of a phase. */
export const MonStateSchema = z
  .object({
    species_id: RosterId,
    /** Clamped to [1, 100]. 0 is reserved for a future fainted state
     *  (Stage E will use the actor's absence in the array instead). */
    hp_pct: z.number().int().min(1).max(100),
    boosts: MonStateBoostsSchema,
    status: z.enum(["none", "burn", "paralysis", "sleep", "poison", "toxic"]).default("none"),
    /** Move id locked by a Choice item, or `null` if not locked. */
    choice_locked_move: z.string().min(1).nullable().default(null),
  })
  .strict();
export type MonState = z.infer<typeof MonStateSchema>;
```

Notes:
- Memory `feature_win_condition_resolution.md`: this schema must stay `.strict()` but composable. A future win-condition slice will add `win_condition_ref` on `PhaseStateSchema` (not `MonStateSchema`) and reference `MonStateSchema.species_id` for the actors — no field additions to `MonStateSchema` are anticipated. If they happen, they land under `schema_version: 6+`.
- `status` drops `freeze` from the flow doc's enum: Reg-M-A's effective freeze rate is ~0 (Frostbite would be the closest mechanic and it's not modeled). Documented as `// TODO(stage6-deferred): freeze-state-modeling`. *(Q1 in §17 for review.)*

### 3.2 `PhaseStateSchema`

```ts
// src/schemas/tactical.ts

export const PhaseStateSchema = z
  .object({
    ours: z.array(MonStateSchema).min(1).max(2),
    theirs: z.array(MonStateSchema).min(1).max(2),
    fallen_allies_ours: z.number().int().min(0).max(5),
    fallen_allies_theirs: z.number().int().min(0).max(5),
  })
  .strict();
export type PhaseState = z.infer<typeof PhaseStateSchema>;
```

### 3.3 Per-phase `state` (additive)

```ts
LeadPhaseSchema = … .extend({ state: PhaseStateSchema.optional() });
MidPhaseSchema  = … .extend({ state: PhaseStateSchema.optional() });
LatePhaseSchema = … .extend({ state: PhaseStateSchema.optional() });

TeamTacticalOverviewSchema.schema_version = z.literal(5);
```

### 3.4 `ScorePairResult` (internal — no zod)

```ts
// src/data/tactical/score-pair.ts

export interface ScorePairResult {
  score: number;
  /** Max-roll % the OPPOSING leads deal to each of our leads, per actor.
   *  Tuple aligned to `leads: [number, number]`: `ours[0]` is the
   *  max-roll % vs the actor at `leads[0]`, `ours[1]` vs `leads[1]`.
   *  Symmetric `theirs[i]` is the max-roll we deal to opposing[i]. */
  lead_incoming_damage_pct: {
    ours: [number, number];
    theirs: [number, number];
  };
}
```

Same shape for `ScoreMidPhaseResult` (with `mid_incoming_damage_pct: { ours: [number, number] }` — single actor).

### 3.5 `TurnStates` (internal — no zod)

```ts
// src/data/tactical/derive-turn-states.ts

export interface TurnStates {
  lead: PhaseState;
  mid: PhaseState;
  late: PhaseState;
}

export interface DeriveTurnStatesInput {
  team: UserTeam;
  scenario: ScenarioSkeleton;
  candidate: PlanCandidate;
  roleAssignments: ReadonlyMap<string, RoleTagAssignment>;
  opposingSetters: OpposingSetters;
  fields: TurnFieldStates;
  /** Q2 echo: from `scorePair` — the max-roll incoming-damage % per lead actor.
   *  Drives mid-phase HP propagation: `mid.hp_pct = clamp(100 - incoming, 1, 100)`. */
  leadIncomingDamagePct: { ours: [number, number]; theirs: [number, number] };
  /** Symmetric mid → late echo. From `scoreMidPhase`. */
  midIncomingDamagePct: { ours: [number, number] };
  /** Required dependency for the DB-gated status whitelist (Q5 revised):
   *  the panel + labmaus-consensus row store the moves we trust as
   *  "actually on the set." Same shape `scorePair`'s opposing resolution
   *  already consumes. */
  scoring_panel?: ScoringPanel;
  db?: Db;
}
```

### 3.6 DB-confirmed opposing move lookup (Q5 revised)

The status whitelist (Spore / Will-O-Wisp / Thunder Wave) is applied **only** when at least one opposing-preview species' DB-confirmed set carries the move. "DB-confirmed" means: the panel entry's `set.moves` (sourced via `labmaus_consensus` or `pikalytics`) literally includes the move. No probabilistic blending in v1.

`mon-state.ts::isDbConfirmedMove(opposingSpeciesId, moveId, panel, db) → boolean` — pure helper. Returns `false` when DB lookups miss; never throws.

---

## 4. Tool contracts

### 4.1 `recommend_team_plan` *(unchanged signature; output additive)*
- Anthropic SDK tool description text: **no change** — Stage B/C descriptions don't enumerate per-phase keys.
- Output schema: `TeamPlanScenario` with optional per-phase `state`. Consumers ignoring unknown phase keys remain happy.
- Cache: §12.

### 4.2 `damage_calc` *(input shape additive: `move.bp` optional)*
- New optional field `bp` on `MoveSpec`. When set, replaces the engine's stored base power for the calc. When unset (the overwhelming default), behavior is identical to today.
- Tool description (`src/tools/damage-calc/SPEC.md`): add one paragraph documenting the override path and citing Last Respects as the canonical use case.
- Error model: no new errors. The schema bound (`min(1).max(250)`) rejects nonsensical overrides via the existing `CalcInputError`.

### 4.3 No new agent tool.

---

## 5. Drizzle schema additions

**Not applicable.** Stage D introduces no DB tables, columns, or migrations. All upstream tables (`team_sets`, `labmaus_consensus`, `pikalytics`, `species`) are reused as-is for the status whitelist DB-confirmation step.

---

## 6. Repository design

**Not applicable.** No new repos. The existing panel-resolution code path in `scoring-team.ts` (`labmausConsensusToScoringThreat`) already surfaces the opposing set's `moves` array used by §3.6's `isDbConfirmedMove`. No bespoke lookup. No `createSimpleRepo` factory needed because no new ref table is introduced.

---

## 7. Architecture patterns + WHY

### 7.1 Pure-function resolver + dependency injection (matches Stage C)
`deriveTurnStates` is pure: every input resolved upstream and passed in. No DB calls inside, no `damage_calc` calls inside. Tests mock inputs as POJOs. Mirrors `deriveTurnFieldStates`'s posture from Stage C plan §7.1.

### 7.2 Scorer-as-source-of-derived-data (Q2 echo)
The flow doc's revised Q2 forces the lead-phase scorer to surface incoming-damage taken in addition to its score. Three alternatives considered:
1. **Recompute incoming damage inside `deriveTurnStates`.** Duplicates `scorePair`'s opposing-resolution + max-roll loop, blowing the calc cache by 2× and risking cache-key drift between the two implementations.
2. **Pass the cache + opposing into `deriveTurnStates` and let it run its own calc loop.** Same cost as (1) plus more inputs; harder to test.
3. **(Chosen)** Have `scorePair` return both `score` and `lead_incoming_damage_pct` as a tuple-shaped object. Stage 5 caller updates all call sites; the calc loop runs exactly once per phase per candidate. Cache integrity preserved.

The mid-phase scorer mirrors the same pattern for the mid → late HP echo. This stamps a reusable design pattern for Stage E/F: scorers compose, and they can publish derived state for downstream consumers.

### 7.3 Phase-scoped MonState fed into `damage_calc`
The `PokemonSpec` schema (calc.ts §79) already has `statBoosts`, `status`, `hpPercent`. Stage D doesn't reshape `PokemonSpec`; it just *populates* those fields at calc-construction time inside `collectKeyCalcsForPair` (and the lead/mid/late scorer loops, where applicable). This means Stage D is fully additive: every existing call site that constructs a `PokemonSpec` without `statBoosts` etc. continues to work because those fields have schema defaults.

### 7.4 `bp` override on `MoveSpec` — minimal seam
Adding a single optional `bp` field on `MoveSpec` (and threading it through `toEngineMove`) is the smallest possible change that unblocks Last Respects scaling. Considered alternatives:
- A separate `MoveOverrideSchema` next to `MoveSpec` — more general, but adds a second schema for a one-field need.
- A `fallen_allies` hint on `CalcInput` and let `damage_calc` compute the BP — couples the tool to one specific move; not extensible to Punishment / Stored Power.
- Per-move callback (Smogon's `basePowerCallback`) wired through the engine — invasive; the engine's typescript types don't cleanly expose it.

The flat `bp` override is the right shape: explicit, single-purpose, extensible by composition (caller computes the right number for the move and passes it).

### 7.5 Conservative status whitelist (Q5 revised)
Apply Spore / Will-O-Wisp / Thunder Wave at FULL weight ONLY when the opposing species has a DB-confirmed set carrying the move. This is the conservative-and-correct path: it avoids false positives (penalizing our team for a status the opponent demonstrably doesn't bring) while keeping Stage D's calc deterministic (no probabilistic blending). Stage E adds the probabilistic layer once action-selection modeling lands. The whitelist is intentionally tiny: Spore (sleep is decisive), Will-O-Wisp (halves physical Atk — alters the lead-incoming-damage echo materially), Thunder Wave (paralysis is a speed cut — alters speed comparisons in mid-phase scoring). Burn-via-Body-Slam, Toxic, Yawn are excluded as too situational for v1.

### 7.6 Schema bump 4 → 5 (Q6 binding ✅)
Additive (optional `state` field) but bumped for observability. Pattern preserved from Stages A/B/C.

### 7.7 `MonStateSchema` is `.strict()` but composable (memory `feature_win_condition_resolution.md`)
Strict-rejection of unknown keys guards against silent drift. The win-condition slice will add `win_condition_ref` on `PhaseStateSchema` (the phase-level field) rather than `MonStateSchema` (the per-actor field). When that happens, `schema_version` bumps again. No data is "lost" between bumps — the additive optional-field pattern is the established migration path.

---

## 8. Error model

No new error classes. All resolvers are no-throw by design.

| Class | Trigger | Severity |
|---|---|---|
| `TacticalOverviewError` (reused) | Same as Stages B/C — draft team / not-found. | fail-loud |
| `CalcInputError` (reused) | `MoveSpec.bp` out of bounds (`< 1` or `> 250`). | fail-loud at calc input validation |
| Defensive empty / undefined | `deriveTurnStates` receives `leadIncomingDamagePct === undefined` (no scoring_team plumbed in, test path). | warn-and-continue: HP defaults to 100% for mid; state still emitted. |
| Defensive | `isDbConfirmedMove` returns false (no labmaus consensus / panel miss). | warn-and-continue: status stays `"none"`. |
| Defensive | Choice-locked move pick returns no candidate (no moves resolve, no panel members). | warn-and-continue: `choice_locked_move = null`. |

Edge cases (flow §8):
- **Lead phase always emits state.** All actors at 100% HP, status `"none"`, boosts zeroed. No propagation needed.
- **No opposing setters detected.** `OpposingSetters` empty → status whitelist application is unaffected (it consults the panel/labmaus directly, not opposing-setter output).
- **HP propagation that produces ≤ 0.** Clamped to 1 (per flow §8) so the actor isn't auto-KO'd.
- **Cleaner that isn't a Scarf user.** Stage D detects Scarf via the existing `spec.item` regex (already in `score-pair.ts::computeSpeedFromSpec` — `/choice scarf/i`). When the cleaner doesn't carry Scarf, `choice_locked_move = null`.
- **Both leads bring the same status-causing opposing move.** Whitelist applies the status only to the canonical target (slot 0). Documented as a v1 simplification.

`deriveTurnStates` never throws.

---

## 9. Reuse audit

| Capability | Source | Disposition |
|---|---|---|
| `deriveTurnFieldStates` | `src/data/tactical/derive-turn-fields.ts` | **SISTER PATTERN** — `deriveTurnStates` mirrors its posture (pure, DB-free, called per candidate per scenario). |
| `OpposingSetters` + `detectOpposingSetters` | `src/data/tactical/opposing-setter.ts` | Reused as-is — Stage D status whitelist consumes panel `set.moves`, not opposing-setter output (these are different roles: opposing-setter is for field state, status whitelist is for move presence). |
| `RoleTagAssignment` (`SETUP_ABILITIES` already classifies `stamina`/`defiant`/`justified`/`beast_boost`) | `src/data/tactical/role-tags.ts` | Reused. Stamina detection = `roleAssignment.all.includes("setup_sweeper")` AND species ability == Stamina (resolved via the existing `RoleTagInput.ability` carried into role-tags). |
| `damage_calc` | `src/tools/damage-calc/` | **EXTENDED** via the `MoveSpec.bp` override path. Existing engine + mapping reused. |
| `PokemonSpec` (`statBoosts` / `status` / `hpPercent`) | `src/schemas/calc.ts` | Reused — fields exist with defaults; Stage D populates them when constructing inputs. |
| `CalcCache` + `_fieldHash` / `_hashSet` | `src/data/tactical/calc-cache.ts` | Reused. Note: `_hashSet` already hashes `statBoosts` / `status` / `hpPercent` (they're part of `PokemonSpec`), so the cache key naturally segments state-dependent entries. **No cache key abstraction change.** |
| `scorePair` / `scoreMidPhase` / `scoreLatePhase` | `src/data/tactical/score-*.ts` | **EXTENDED** return shapes (echo). Internals untouched except for surfacing the per-actor `theirBestMax` that the existing loop already computes. |
| `collectKeyCalcsForPair` | `src/data/tactical/score-pair.ts` | **EXTENDED** to consume `MonState` (statBoosts, status, hpPercent) when building `PokemonSpec`s. For Last Respects, overrides `move.bp`. Appends `notes` line. |
| `scoring-team.ts` (`labmausConsensusToScoringThreat`) | reused | Provides `panel.entries[i].set.moves` — the source-of-truth for `isDbConfirmedMove` (§3.6). |
| `buildRoleAssignments` | `src/data/tactical/pillars.ts` | Reused — role classifier already detects Stamina (`setup_ability`); Stage D consumes the existing assignment. |

**Net-new modules:** `derive-turn-states.ts`, `mon-state.ts`. Two files (mirrors Stage C's count).

**No new external dependencies.** No new HTTP / scraper / vector-store / database tables.

**Not duplicated:** the opposing-set move list lookup uses the existing panel.entries plumbing — no parallel "moves-by-species" cache.

---

## 10. Test strategy + ordering

TDD per CLAUDE.md §3. Write order = numbered order. Per-test red-first; §3 pure-data exemption applies to S1..S8.

**Total: 50 tests** (S×8 + DS×14 + SE×8 + RP×10 + BP×3 + T×3 + manual demo).

### Pure-data exemption batch — schemas (S1..S8)

| # | File | Asserts | Fails because |
|---|---|---|---|
| S1 | `tests/schemas/tactical-mon-state.test.ts` | `MonStateSchema` round-trips a healthy actor; rejects unknown key | `.strict()` not applied |
| S2 | same | `MonStateSchema` rejects `hp_pct: 0` and `hp_pct: 101`; accepts `hp_pct: 1` and `100` | clamp bounds wrong |
| S3 | same | `MonStateSchema.boosts.def` accepts `-6..6`; rejects `7` | bounds wrong |
| S4 | same | `PhaseStateSchema` round-trips full object; `.strict()` rejects unknown key | shape missing |
| S5 | same | `LeadPhaseSchema.state` is optional (absence parses); `MidPhaseSchema.state` likewise; `LatePhaseSchema.state` likewise | optionality broken |
| S6 | same | `TeamTacticalOverviewSchema` rejects `schema_version: 4`, accepts `5` | bump not applied |
| S7 | `tests/schemas/calc-move-bp-override.test.ts` | `MoveSpecSchema` accepts `bp: 100`; rejects `bp: 0` and `bp: 251` | bounds wrong |
| S8 | same | `MoveSpecSchema` parses without `bp` (undefined) — backwards compat | regression |

### `deriveTurnStates` unit tests (DS1..DS14 — strict per-test)

| # | File | Asserts | Fails because |
|---|---|---|---|
| DS1 | `tests/data/tactical/derive-turn-states.test.ts` | Lead-phase state always 100% HP, no boosts, status `"none"`, choice_locked `null` for all 4 actors | wrong default |
| DS2 | same | `fallen_allies_ours: 0` and `fallen_allies_theirs: 0` at lead phase | wrong default |
| DS3 | same | **Fallen-ally rule (mid):** opposing preview contains `wallbreaker/cleaner/setup_sweeper` species → `fallen_allies_ours: 1`; else `0`. Symmetric for `theirs` | rule missing |
| DS4 | same | **Fallen-ally rule (late):** late = mid + 1 (cap 2) — when mid was 1, late = 2 | not chained |
| DS5 | same | **HP propagation via Q2 echo:** when `leadIncomingDamagePct.ours = [55, 22]`, mid `state.ours[0].hp_pct === 45` (100 − 55) and `state.ours[1].hp_pct === 78` | echo not consumed |
| DS6 | same | **HP propagation late:** `midIncomingDamagePct.ours = [40]` → late `state.ours[0].hp_pct === 60` (100 − 40, the mid pivot's residual). Late cleaner = 100 (just switched in) | wrong target |
| DS7 | same | **HP clamp to 1:** echo `incoming = 200` → `mid.state.ours[i].hp_pct === 1` (not 0) | clamp missing |
| DS8 | same | **Sand chip damage:** when mid `fields.weather === "sand"` and actor isn't sand-immune (Rock/Ground/Steel), `mid.state.ours[i].hp_pct -= 6` on top of the echo-derived HP. Sand-immune actor unchanged | chip not applied |
| DS9 | same | **Stamina +1 Def in mid:** when Archaludon (`ability: "Stamina"`) is in lead AND `leadIncomingDamagePct.ours[i] > 0` (it took a hit), `mid.state.ours[i].boosts.def === 1`. Late = `2` (took another hit) | accumulator missing |
| DS10 | same | **Defiant +2 Atk:** Defiant set + opposing-preview species with Intimidate ability → `mid.state.ours[i].boosts.atk === 2`. No Intimidate in preview → no boost | rule wrong |
| DS11 | same | **Choice-lock pick:** Scarf cleaner with moves `["wavecrash","lastrespects","aquajet","liquidation"]` against bulky panel → `late.state.ours[1].choice_locked_move === "lastrespects"` (max-roll vs bulky panel) — deterministic Q4 pick. Non-Scarf cleaner → `null` | pick wrong |
| DS12 | same | **Status whitelist — Will-O-Wisp:** opposing preview has Sableye and its DB-confirmed `set.moves` includes `"willowisp"` → `mid.state.ours[i].status === "burn"` on the lead physical attacker. If `set.moves` lacks WoW → status `"none"` (DB-gated, Q5 revised) | whitelist wrong |
| DS13 | same | **Status whitelist — Spore:** Amoonguss in preview with DB-confirmed Spore → `mid.state.ours[0].status === "sleep"`. **Not on the team's own actor (no friendly Spore).** | wrong target |
| DS14 | same | **Status whitelist — Thunder Wave:** DB-confirmed T-Wave → `mid.state.ours[i].status === "paralysis"`. **Excluded moves (Burn-via-Body-Slam, Toxic) NEVER apply** in v1 | over-eager whitelist |

### `score-pair.ts` extension (SE1..SE5)

| # | File | Asserts | Fails because |
|---|---|---|---|
| SE1 | `tests/data/tactical/score-pair-incoming-echo.test.ts` | `scorePair` return shape is `{ score, lead_incoming_damage_pct: { ours, theirs } }`, not a bare `number` | shape not extended |
| SE2 | same | `lead_incoming_damage_pct.ours[i]` equals the max-roll % the opposing leads deal to our `leads[i]` — re-derive manually and compare | accumulator not surfaced |
| SE3 | same | `lead_incoming_damage_pct.theirs[i]` equals the max-roll % WE deal to opposing[i] | symmetric direction wrong |
| SE4 | same | Stub-path (no scoring_team) returns `{ score, lead_incoming_damage_pct: { ours: [0,0], theirs: [0,0] } }` — defensive defaults | path forgotten |
| SE5 | same | Call sites in `recommend-plan.ts::scorePlan` consume `.score` (not the raw result), so the existing plan-score ordering is preserved | caller not updated |

### `score-mid-phase.ts` extension (SE6..SE8)

| # | File | Asserts | Fails because |
|---|---|---|---|
| SE6 | `tests/data/tactical/score-mid-phase-incoming-echo.test.ts` | `scoreMidPhase` return shape extended to `{ score, mid_incoming_damage_pct: { ours: [number, number] } }` | shape not extended |
| SE7 | same | Stub-path returns `mid_incoming_damage_pct: { ours: [0, 0] }` | path forgotten |
| SE8 | same | When `scoring_team` plumbed in, `mid_incoming_damage_pct.ours[0]` reflects the actual max-roll the opposing leads deal to the mid pivot under the mid-phase field | accumulator missing |

### `damage_calc` BP override (BP1..BP3)

| # | File | Asserts | Fails because |
|---|---|---|---|
| BP1 | `tests/tools/damage-calc-bp-override.test.ts` | `damage_calc` with `move: { name: "Last Respects", bp: 150 }` produces strictly higher max damage than `move: { name: "Last Respects" }` (default 50 BP) — same attacker/defender/field | override not threaded |
| BP2 | same | `damage_calc` with `move: { name: "Earthquake", bp: 100 }` (equal to engine default) produces the same rolls as without `bp` | inadvertent multiplier applied |
| BP3 | same | `MoveSpec` schema rejects `bp: 0` and `bp: 251` with `CalcInputError`; accepts `bp: 1` and `bp: 250` | bounds enforcement |

### `recommend-plan.ts` integration (RP1..RP10)

| # | File | Asserts | Fails because |
|---|---|---|---|
| RP1 | `tests/data/tactical/recommend-plan-stage-d.test.ts` | Output phases each carry `state` (PhaseState present, not undefined) | state not emitted |
| RP2 | same | Lead-phase `state.ours[*].hp_pct === 100` and boosts zeroed for all actors | wrong default |
| RP3 | same | Mid-phase `state.ours[i].hp_pct` reflects Q2 echo (incoming damage from lead-phase calc) — within ±1 of the manually-computed expected % | echo not threaded |
| RP4 | same | When `field.weather === "sand"` on mid phase, sand-vulnerable actors lose an extra 6% HP | chip not applied |
| RP5 | same | Archaludon (`ability: Stamina`) mid `state.ours[i].boosts.def >= 1` when it was in the lead pair on a scenario where the opposing leads landed a hit | Stamina accumulator missing |
| RP6 | same | Basculegion Scarf cleaner late `state.ours[1].choice_locked_move === "lastrespects"` OR `"wavecrash"` (per Q4 deterministic max-roll pick) | choice-lock pick missing |
| RP7 | same | When the cleaner uses Last Respects, its `key_calcs[*].notes` contains the substring `"Last Respects BP="` and an integer ≥ 100 | notes line missing |
| RP8 | same | When the cleaner uses Last Respects, the calc `move.bp` passed to `damage_calc` equals `50 + 50 × fallen_allies_ours` (introspect via injected mock calc) | BP override path broken |
| RP9 | same | Stage A `support_lift` regression — `phases[0].support_lift` matches Stage A's `computeSupportLift` on the same pair (no change in lift due to Stage D) | regression |
| RP10 | same | End-to-end on a synthetic ArchaEye-shaped team: BOTH gates pass simultaneously — mid Archaludon `boosts.def === 1` AND late Basculegion `key_calcs[0].move_id === "lastrespects"` and the calc's input `bp >= 100` | one or both gates miss |

### CLI/output regression (T1..T3)

| # | File | Asserts | Fails because |
|---|---|---|---|
| T1 | `tests/scripts/tactical-cli-stage-d.test.ts` | `pnpm data:tactical plan <team_id>` stdout JSON has `scenarios[*].phases[*].state` populated on every phase | not emitted |
| T2 | same | `schema_version` in emitted JSON is `5` | bump missed |
| T3 | same | Stage B/C regression goldens still pass (lead pair identities + per-phase `field` shapes match prior fixtures on neutral scenarios where Stage D should be a state-only addition) | broke Stage B/C |

**Live manual demo (NOT a CI test — per Stage A/C precedent):** `pnpm data:tactical plan 01KR7TVD21G1Q99BK0NAEARFD8`. Screenshot in PR description. Inspect:
- Mid Archaludon `state.ours[*].boosts.def === 1` in scenarios where Archaludon is the lead-pair actor.
- Late Basculegion `key_calcs[0].move_id === "lastrespects"` with `bp >= 100` reported via the `notes` line.
- BOTH gates must pass (Q8 ✅).

---

## 11. Fixtures plan

No on-disk fixtures committed beyond what tests inline. Per memory `test_fixtures_no_invariant_blobs.md`, expected state snapshots are written as in-line literals in test code. The ArchaEye demo team (`01KR7TVD21G1Q99BK0NAEARFD8`) is the load-bearing manual-demo fixture — already committed.

One synthetic test team is constructed inline in `tests/data/tactical/recommend-plan-stage-d.test.ts` carrying:
- Slot 0: Sableye (Prankster) — lead-eligible setter.
- Slot 1: Archaludon (Stamina, Electro Shot) — lead-eligible setup_sweeper.
- Slot 2: Sinistcha (Hospitality) — mid cleric.
- Slot 3: Basculegion (Choice Scarf, Last Respects + Wave Crash) — cleaner.
- Slots 4–5: filler that doesn't perturb the role-tag pruning.

This synthetic team is the in-test stand-in for ArchaEye (so RP10 doesn't depend on a live DB).

---

## 12. Cache + throttle implementation

**No new cache, no new throttle.** Stage B/C's `CalcCache` is process-scoped, keyed by `(attacker_set_hash, defender_set_hash, field_hash, move_id)`. `_hashSet` already hashes `statBoosts`, `status`, `hpPercent` (they're part of `PokemonSpec`) — so state-dependent variants get distinct cache keys automatically.

`move_id` does NOT include `bp` today. When `recommend-plan.ts` overrides `move.bp` for Last Respects, two distinct BP values would otherwise collide on the same cache key. **Fix:** extend `_hashSet` callers' key construction at the `key.move_id` site to suffix `bp` when present: `move_id: bp !== undefined ? \`${moveName}@bp=${bp}\` : moveName`. This is a one-line change inside `score-pair.ts` / `collectKeyCalcsForPair` at the key construction sites. No cache abstraction reshape.

**Worst-case key count per overview:** Stage C estimate was ~13200. Stage D adds at most one variant per cleaner per scenario (Last Respects at one BP). Negligible growth (≤ 5% over Stage C).

No throttle. Pure CPU after `buildOverview`.

---

## 13. Ingest / build orchestration

**Not applicable.** No build script extension, no migrations, no data files. Stage D is pure code + schema additions.

---

## 14. Definition of Done mapping (CLAUDE.md §11)

| DoD item | Satisfied by |
|---|---|
| Flow doc reviewed | `docs/flows/per-mon-state-tracking.md` §12 |
| Tech plan approved | This file (pending) |
| Failing test written first | §10 — all 50 tests are ordered red-first; S1..S8 batch per §3 exemption |
| All tests pass | Stage 5 + Stage 6 gate |
| Types check | Stage 5 + Stage 6 |
| Lint clean | Stage 5 + Stage 6 |
| New external data schema-validated + fixture-backed | N/A — no external data introduced |
| User-facing claim cited | `key_calcs[*].notes` carries the Last Respects scaling derivation (`"Last Respects BP=N from fallen_allies=M"`); citations from Stage B unchanged |
| Docs touched | This plan doc + flow doc + `src/tools/damage-calc/SPEC.md` (one paragraph on `bp` override) |
| Reviewer subagent ran | Stage 6 |

---

## 15. Rollout / feature-flag

**No feature flag.** Schema bump 4 → 5 is technically additive (consumers ignoring unknown fields still parse), but the version literal change is a one-PR break. Every consumer in this codebase (`overview.ts`, agent tool, CLI, all tests) updates simultaneously. The breaking surface is the scorer return-shape extension (`scorePair` returning an object instead of a number) — all call sites are in `recommend-plan.ts` and a handful of tests.

**No persistence to migrate** — plans are compute-on-demand. No DB column added (per §5). The `damage_calc` `bp` override is fully optional.

**Stage 5 deploy order:**
1. Land schema additions (S1..S6 batch — `MonStateSchema`, `PhaseStateSchema`, per-phase `state`, bump 4→5).
2. Land calc-schema additions (S7..S8 — `MoveSpec.bp`).
3. Land `damage_calc` BP override (BP1..BP3) — `toEngineMove` threads `bp`.
4. Land `score-pair.ts` echo (SE1..SE5) — extend return shape; update `recommend-plan.ts` call sites.
5. Land `score-mid-phase.ts` echo (SE6..SE8).
6. Land `derive-turn-states.ts` (DS1..DS14) in dependency order: defaults → fallen-ally → HP echo → sand chip → Stamina/Defiant → choice-lock → status whitelist.
7. Land `recommend-plan.ts` integration (RP1..RP10) — emit `state` on each phase; thread state into `PokemonSpec` at `collectKeyCalcsForPair`; override BP for Last Respects; append `notes`.
8. Land CLI output tests (T1..T3).
9. Live ArchaEye manual demo.

Stage A / Stage B / Stage C tests must stay green through every step. Step 4 touches Stage B/C test fixtures that assert `scorePair` returns a number — those tests update to read `.score` from the result object (mechanical change).

---

## 16. Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Q2 echo introduces a subtle dependency: mid-state HP depends on lead-phase calc result, which depends on field, which depends on candidate. If `deriveTurnStates` is called with a stale `leadIncomingDamagePct`, mid HP is wrong | Medium | Medium | `scorePlan` computes `scorePair` and `deriveTurnStates` in a strict order inside the same closure (no caching of the echo across candidates). RP3 pins the value end-to-end. |
| `scorePair` return-shape change breaks Stage B tests that pin the literal number | Low | Low | Mechanical update; identified during planning. Apply in step 4 above. |
| Status whitelist is too conservative (Q5 revised) — opponent runs Will-O-Wisp on a non-DB-confirmed set → we miss the burn and mid-phase Atk halving | Medium | Low | Documented v1 limitation. Probabilistic blending arrives in Stage E. `// TODO(stage6-deferred): probabilistic-status-blending`. |
| Cache-key collision when `move.bp` override differs across two calls for the same `move_id` | Low | High (silent corruption) | §12 fix: suffix `bp` to `move_id` in the cache-key string. BP1..BP3 pin the override path; RP8 introspects the override in an integration setting. |
| Stamina detection is heuristic — assumes Archaludon "took a hit" in lead phase. False positive on a scenario where Archaludon was in the back | Medium | Low | Rule gated on `Stamina` ability AND species in `candidate.leads` AND `leadIncomingDamagePct.ours[i] > 0`. DS9 pins it. False positive impossible given the gate. |
| `MonStateSchema.strict()` blocks a future win-condition slice without a schema bump | Low | Low | Intentional. Memory `feature_win_condition_resolution.md` says the win-condition fields land on `PhaseStateSchema`, not `MonStateSchema`. `// TODO(stage6-deferred): win-condition-resolution` flagged for review surface. |
| Choice-lock pick (Q4) deterministic on max-roll, but max-roll depends on field (rain boosts water moves). Different scenarios → different locks for the same cleaner. This is correct but potentially surprising | Low | Low | Documented in `derive-turn-states.ts` TSDoc. DS11 pins per-scenario determinism. |

---

## 17. Open questions for plan review

**Q1. `MonStateSchema.status` enum — keep `freeze` from the flow doc, or drop?**
Flow §6 listed `["none","burn","paralysis","sleep","freeze","poison","toxic"]`. Proposal: drop `freeze` because Reg-M-A's effective freeze rate is ~0 (Frostbite mechanic isn't modeled). Status whitelist (Spore/WoW/T-Wave) doesn't include any freeze-inducing move. Inline `// TODO(stage6-deferred): freeze-state-modeling`. Alternative: keep `freeze` for future-compat at the cost of one unused enum value.
*Proposed answer: drop, with deferred TODO.*
Answer: Drop

**Q2. Mid-phase HP echo source — `scorePair`'s `lead_incoming_damage_pct.ours` or the per-actor MAX of (lead-incoming, sand-chip)?**
Proposal: ADD (chip stacks on top of echo damage). Reason: sand chip is real residual damage that should compound with the calc-derived hit. DS5 + DS8 together pin both effects in isolation; the integration ordering (echo first, chip second) is documented in `derive-turn-states.ts`.
*Proposed answer: ADD — echo first, sand chip on top.*
Answer: Add, echo first then chip.

**Q3. Should `derive-turn-states.ts` take a `Db` handle?**
The status whitelist's DB-confirmed check needs to read panel `set.moves`. Two options:
(a) Pass `db?: Db` + `scoring_panel?: ScoringPanel` into `DeriveTurnStatesInput` (chosen — see §3.5). `isDbConfirmedMove` does the lookup.
(b) Pre-resolve the "DB-confirmed moves per opposing species" upstream and pass a `Map<string, Set<string>>` in.
Proposal: (a) for simplicity; the lookup is O(panel-size) per status check. Stage D doesn't hit the cost concern Stage C's opposing-setter memoization addressed (that was per-candidate; this is per-scenario).
*Proposed answer: (a) — pass db + scoring_panel into the resolver.*
Answer: (a)

**Q4. Late-phase cleaner HP — 100% (just switched in) or echoed from mid?**
Flow §5.2 says "Late cleaner at 100% (just switched in)". Proposal: 100%. The cleaner DIDN'T take damage in mid (it was on the bench). DS6 pins this for `ours[1]` (the cleaner slot in late) while `ours[0]` (the mid pivot that survived into late) carries mid → late echo.
*Proposed answer: ✅ — cleaner late HP = 100; mid pivot late HP = echo from mid.*
Answer: Cleaner late HP = 100%; mid pivot late HP = echo from mid.

**Q5. `bp` override on `MoveSpec` — should it also surface in the `CalcResultRef.notes` automatically, or do we hand-roll the notes string in `recommend-plan.ts`?**
Proposal: hand-roll in `recommend-plan.ts`. Reason: the `notes` string is human-prose for a specific scaling story (Last Respects). Future BP-override use cases (Punishment vs. boost count) will want different prose. Auto-generating a generic `"BP override: 150"` is less useful. `CalcResultRefSchema` already lacks a `notes` field — we'd need to add it.
*Proposed answer: hand-roll in `recommend-plan.ts`; ADD `notes: z.string().max(200).optional()` to `CalcResultRefSchema` in this same plan (S9 — additive on `CalcResultRefSchema`). Flagging it here so the reviewer can confirm the small schema add.*
Answer: Hand-roll in recommend-plan.ts; add optional notes field to CalcResultRefSchema.

**Q6. Fallen-ally rule sharper than flow §5.1?**
Flow §5.1 gates `fallen_allies_ours: 1` on opposing preview containing `wallbreaker/cleaner/setup_sweeper/weather_setter+Tailwind`. Proposal: implement verbatim. Note: this rule is symmetric (also gates `_theirs`). DS3 pins both directions. Calibration deferred to Stage E.
*Proposed answer: ship verbatim.*
Answer: Ship verbatim.

**Q7. Defiant detection — `roleAssignment.all.includes("setup_sweeper")` AND species ability matches "Defiant"?**
The role classifier already lists `defiant` in `SETUP_ABILITIES` which maps to `setup_sweeper`. But "is this set Defiant specifically?" requires resolving the species's ability, which the classifier holds in `RoleTagInput.ability` but doesn't surface on `RoleTagAssignment`. Two options:
(a) Add an optional `setup_ability?: "stamina"|"defiant"|"justified"|"beast_boost"` field on `RoleTagAssignmentSchema`.
(b) Re-resolve from the team-set itself inside `deriveTurnStates` (pass `team` in — already done).
Proposal: (b) — read `team.sets[slot].ability` directly. Avoids a schema change in this slice. (a) is a fast-follow refactor if Stage E needs the same signal.
*Proposed answer: (b).*
Answer: Read directly from team set in deriveTurnStates; no schema change to RoleTagAssignmentSchema.

**Q8. Synthetic test team for RP10 — assemble inline, or factor out into a `tests/fixtures/teams/archaeye-shaped.ts` helper?**
Proposal: inline. Reason: one test consumer. Memory `test_fixtures_no_invariant_blobs.md` says no committed fixture blobs unless reused; a single-test team is best as a literal inside the test. If Stage E reuses, factor out then.
*Proposed answer: inline.*
Answer: Inline.

**Q9. Flow-doc gap.** Flow §5.5 says burn applies `-50% Atk` "ish (engine: burn flag)" — but the engine's burn flag (via `status: "Burned"` on `PokemonSpec`) already applies the Atk halving in `@smogon/calc`. Setting `MonState.status = "burn"` + threading it into the `PokemonSpec` `status` field is enough. No boost-arithmetic needed in our code. **Confirm:** this is what Stage D ships (`MonState.status === "burn"` → `PokemonSpec.status = "Burned"` at calc-input construction time). The flow's "ish" disappears.
*Proposed answer: ship the clean engine-flag path; no manual Atk halving.*
Answer: Ship the clean engine-flag path; no manual Atk halving.

**Q10. Sand chip immunity list — Rock/Ground/Steel only, or also abilities like Magic Guard / Overcoat / Sand Force / Sand Rush / Sand Veil?**
Proposal: types (Rock/Ground/Steel) + ability gate (Magic Guard, Overcoat, Sand Force, Sand Rush, Sand Veil). `mon-state.ts::isSandImmune(species, ability)` consults the species type list + the ability whitelist. Implemented via the existing roster lookup (we have type info per species in the species table; abilities via `team.sets[*].ability`).
*Proposed answer: types + the 5-ability whitelist above.*
Answer: Types (Rock/Ground/Steel) + abilities (Magic Guard, Overcoat, Sand Force, Sand Rush, Sand Veil).

**Q11. Q5 revised — should the status whitelist also check ability-based status (Static / Flame Body / Effect Spore) on opposing leads?**
Proposal: NO in v1. Static/Flame Body/Effect Spore are *reactive* (require an opposing physical contact move) — modeling them needs action selection. Deferred. `// TODO(stage6-deferred): reactive-status-abilities`. The DB-confirmed move whitelist (Spore/WoW/T-Wave) is the bright-line v1 scope.
*Proposed answer: NO — defer.*
Answer: NO — defer.

---

**Reviewed-by:** _Rodrigo Caballero_
