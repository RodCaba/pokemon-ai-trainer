# Tech Plan — Turn-Weighted Phase Scoring (Stage C)

**Slug:** `turn-weighted-phase-scoring`
**Branch:** `feat/turn-weighted-phase-scoring`
**Stage:** Stage 3 — Tech plan (pending approval)
**Date:** 2026-05-09
**Author:** Tech Lead subagent
**Implements flow doc:** `docs/flows/turn-weighted-phase-scoring.md` (Stage 2 reviewed 2026-05-11 by Rodrigo Caballero — §12). Stage-2 binding answers Q1–Q11 in the flow doc apply unmodified, **except Q11 which is revised** (priority abilities derive from the abilities DB, not a hardcoded list).

**Memory citations:**
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/db_orm_drizzle.md` — Drizzle is the single source of truth; the abilities table extension lands in `src/db/drizzle-schema.ts` with a generated migration `0012_*`.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/single_db_non_destructive_build.md` — abilities is a Category-A regenerable table; we upsert the new column at build time, never `DROP COLUMN`.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_no_tera.md` — no Tera field is introduced; field state per phase remains `ScenarioFieldSchema` (already Tera-free).
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_roster.md` — priority-ability backfill is scoped to abilities present in the Reg-M-A roster (Prankster, Gale Wings, Triage — all three appear on at least one legal species).
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/labmaus_pokepaste_deferred_todos.md` — existing `TODO(stage6-deferred):` markers in Stage B remain in place per Q10; new deferrals reuse the same marker form so the grep surface is consistent.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/test_fixtures_no_invariant_blobs.md` — per-phase field expectations in test code as in-line literals, not opaque JSON dumps.

**Sibling precedents:**
- `docs/plans/team-phase-plan.md` (Stage B). Direct predecessor. §18 deviations and §19 deferrals are inherited verbatim. The `weather_provided_via_ability` schema field and the unconditional weather override in `recommend-plan.ts::scorePlan` are the load-bearing pieces Stage C generalizes.
- `docs/plans/team-support-pillar.md` (Stage A). Owns `buildRoleAssignments`, `RoleTagAssignmentSchema`, `deriveRoleTags`, the abilities lookup, and `CalcCache`. Stage C reuses every primitive.
- `docs/plans/pokemon-roster-db.md`. Owns the abilities ingest pipeline (`scripts/data/build-reg-m-a.ts` populates `abilities`); Stage C extends one column.

**First-of-kind for this slice:**
- **Per-phase field derivation.** First time a scenario is scored against three *different* field states. Prior calls used a single `scenario.field`.
- **Weather speed-duel resolution.** First module that consults base-spe of both teams' setters to decide which weather is active.
- **Data-driven priority-ability detection.** First use of a per-ability metadata column (`priority_grants`) for classifier branching — opens the door for future ability flags (Pixilate, Refrigerate, Sheer Force…) without code changes.
- **Schema bump 3 → 4 on an additive change.** First version bump that is technically backwards-compat (optional field) but is still elevated for observability discipline (per Q7).

---

## 1. Goal recap

Today the scorer treats every phase as turn-1: lead-phase calcs, mid-phase calcs, and late-phase calcs all see the same `scenario.field`. Stage C makes each phase resolve at its representative turn window — T1 (lead), T2 (mid), T4 (late) — and derives a per-phase `ScenarioField` from:

1. **Speed-duel-resolved ability weather** (both teams' weather abilities; slower sets last and overwrites — Q2).
2. **Priority-move setters** at lead phase (Sableye + Prankster + Rain Dance, Talonflame + Gale Wings + Tailwind, Comfey + Triage + healing) — promoted from mid-phase to lead-phase via a DB-driven `priority_grants` ability flag (Q11 revised).
3. **Plain move setters** at mid phase only (Rain Dance without Prankster lands turn 2+).
4. **Decay schedules**: weather 5T, TR 5T, Tailwind 4T, screens 5T (Q5). Late phase (T4–T8) sees neutral field by default (Q6) **but** permanent speed modifiers (Choice Scarf, ability boosts) persist (Q7).
5. **Opposing-team setters** detected by synthesizing minimal `RoleTagInput`s from `scenario.opposing_preview` species + their abilities (Q3).

**Deliverables:**
- `src/data/tactical/derive-turn-fields.ts` — the pure derivation function `deriveTurnFieldStates(team, scenario, roleAssignments, candidate, deps) → { lead, mid, late }`.
- `src/data/tactical/opposing-setter.ts` — detect the opposing weather/TR/Tailwind/screen setter from `opposing_preview` by reusing `deriveRoleTags`.
- `RoleTagAssignmentSchema.setter_priority_via_ability` — new optional field describing what kind of priority the ability grants.
- `LeadPhaseSchema.field?` / `MidPhaseSchema.field?` / `LatePhaseSchema.field?` — optional per-phase `ScenarioField`.
- `TeamTacticalOverviewSchema.schema_version: 3 → 4`.
- Drizzle column `abilities.priority_grants_json` (nullable text JSON) + migration `0012_abilities_priority_grants.sql` + Reg-M-A backfill JSON at `data/reg-m-a/abilities-priority.json`.
- `scorePlan` in `recommend-plan.ts` calls `deriveTurnFieldStates` and threads each phase's field into `scorePair` / `scoreMidPhase` / `scoreLatePhase`. The unconditional ability-weather override (Stage B §18.C) is replaced by the speed-duel resolver inside `deriveTurnFieldStates`.
- Sableye + Archaludon reintroduced as a viable lead pair (Q9): the scorer now sees turn-1 rain when Sableye + Prankster + Rain Dance is in the lead.

**Done means:**
1. Live ArchaEye demo (`pnpm data:tactical plan 01KR7TVD21G1Q99BK0NAEARFD8`):
   - Sand scenario lead pair = Pelipper-led (rain wins the duel vs Tyranitar base 61 < Pelipper 65; vs Hippowdon 47 < Pelipper, Pelipper sets second and wins).
   - Sableye + Archaludon appears in ≥ 2 of 10 scenarios (Q9).
   - Every scenario emits per-phase `field`. Late phase `weather: "none"`, `tailwind_*: false`, `trick_room: false`, `light_screen: false`, `reflect: false` — except the explicit forward-compat case the user surfaced in §6 (Floette-Eternal late Tailwind) which is **deferred** to a future slice (Q10).
2. Stage A and Stage B tests all green after the schema_version bump and the override-replacement.
3. Total cache entries ≈ 3× pre-Stage-C (Q8); manual measurement on ArchaEye demo logged in PR description.
4. The abilities table carries `priority_grants_json` for Prankster, Gale Wings, Triage; the classifier emits `setter_priority_via_ability` on lead sets matching the (ability, move) combo.

**Out of scope (deferred):**
- Per-mon HP/boost state, fainted-ally count, Choice-locking, Stamina accumulation — Stage D. `// TODO(stage6-deferred):` markers from Stage B §19 stay.
- Opponent counter-lead 1-ply lookahead — Stage E.
- Stochastic battle sim — Stage F.
- Status effects (burn/paralysis/sleep/freeze) — Stage D.
- Item-based duration extensions (Smooth Rock, Light Clay) — explicit v1 deferral per Q5.
- Dark-vs-Prankster move-block (Gen-7+ rule: Prankster status moves fail vs Dark targets) — `// TODO(stage6-deferred): prankster-dark-block`.
- Quick Draw probabilistic priority — deferred (probabilistic; not a deterministic accelerator).
- Multiple weather changes mid-game (opponent KOs our setter turn 2, theirs re-establishes) — Stage D.
- Re-tagging existing `TODO(stage6-deferred):` markers (Q10).

---

## 2. Module boundaries

All paths absolute under `/Users/rodrigo/src/pokemon-ai-trainer/`. **NEW** unless marked.

### 2.1 Schemas

#### `src/schemas/tactical.ts` *(extend; bump 3 → 4)*
- **Add** `LeadPhaseSchema.field`, `MidPhaseSchema.field`, `LatePhaseSchema.field` — each `ScenarioFieldSchema.optional()`. Additive; Stage B emitters that don't populate them remain parse-valid.
- **Bump** `TeamTacticalOverviewSchema.schema_version: z.literal(3) → z.literal(4)`. Q7: technically additive, but the bump is the contract-change signal for downstream consumers and aligns with Stage A's discipline.
- No removals.

#### `src/schemas/ability.ts` *(extend)*
- **Add** `AbilitySchema.priority_grants` — optional `PriorityGrantsSchema`. See §3 for the exact shape.

#### `src/schemas/tactical.ts` — `RoleTagAssignmentSchema` *(extend)*
- **Add** `setter_priority_via_ability: SetterPriorityGrantSchema.optional()`. Carries the same `PriorityGrants` shape, set when the role classifier detects a (lead-set ability, lead-set move) combo where ability `priority_grants` matches the move's `kind`. See §3 for shape.

No schema removals. Stage A and Stage B schemas remain.

### 2.2 Data layer (`src/data/tactical/`)

| File | Disposition | Responsibility |
|---|---|---|
| `derive-turn-fields.ts` | **NEW** | Pure function `deriveTurnFieldStates(team, scenario, roleAssignments, candidate, opposingSetter) → TurnFieldStates`. Resolves the weather speed-duel, applies priority-ability promotion, decays at the phase boundaries. |
| `opposing-setter.ts` | **NEW** | Pure function `detectOpposingSetters(scenario, deps) → OpposingSetters`. Synthesizes minimal `RoleTagInput` per `scenario.opposing_preview` species (id + ability lifted from species table) and invokes `deriveRoleTags` (Q3 binding) to identify weather/TR/Tailwind/screen setters + their base spe. |
| `recommend-plan.ts` | **EXTEND** | `scorePlan` calls `deriveTurnFieldStates` once per candidate; passes each phase's derived field into the relevant scorer by constructing a phase-scoped `ScenarioSkeleton` (Q1: skeleton-construction over arg-passing — see §11.2). `recommendTeamPlan` echoes the three derived fields into `phases[*].field`. The unconditional `weather_provided_via_ability` override at lines 285–306 is **deleted** — that logic now lives inside `deriveTurnFieldStates`. |
| `role-tags.ts` | **EXTEND** | `deriveRoleTags` reads `AbilitySchema.priority_grants` (DB-resolved by the caller; passed in via deps) and emits `setter_priority_via_ability` when ability + move match. |
| `pillars.ts` | **EXTEND** | `buildRoleAssignments` resolves each set's ability through `abilities.get(db, …)` and forwards its `priority_grants` into `deriveRoleTags`. Same posture for synthetic opposing-preview classification. |
| `score-pair.ts` / `score-mid-phase.ts` / `score-late-phase.ts` | **EXTEND** | Each accepts a `scenario: ScenarioSkeleton` whose `field` is the phase-derived field. **No new arg**; the caller constructs a per-phase skeleton. Q1. |

### 2.3 DB layer

#### `src/db/drizzle-schema.ts` *(extend)*
- Add column `priorityGrantsJson: text("priority_grants_json")` (nullable) to `abilities` table. No index needed (one row per ability; lookups are by id, already covered).

#### `src/db/abilities.ts` *(extend)*
- Row interface gains `priorityGrantsJson: string | null`.
- `rowToEntity` parses the JSON into the `Ability` shape's optional `priority_grants` field. `null` → field absent.
- Keep `createSimpleRepo` shape per memory `db_orm_drizzle.md`; no API surface change.

#### Migration `src/db/migrations/0012_abilities_priority_grants.sql` *(NEW)*
- `ALTER TABLE abilities ADD COLUMN priority_grants_json TEXT;` — non-destructive (memory `single_db_non_destructive_build.md`).
- Generated by `pnpm drizzle-kit generate`; we never hand-edit (memory `db_orm_drizzle.md`).

### 2.4 Ingest

#### `data/reg-m-a/abilities-priority.json` *(NEW)*
- Hand-curated JSON keyed by ability id. Shape per §3. Initial entries: `prankster`, `galewings`, `triage`. Future ability flags are pure data adds — no code change.

#### `scripts/data/build-reg-m-a.ts` *(extend)*
- During the abilities-table populate step, read the priority-grants JSON; emit each row with `priorityGrantsJson` populated (or `NULL`) via the existing upsert.

### 2.5 CLI / agent tool

No tool-contract change. `recommend_team_plan` output gains the per-phase `field` field (additive). The tool description prose is unchanged because the output is documented as the `TeamPlanScenario` shape — the schema is the contract (§4).

### 2.6 Tests

```
tests/schemas/tactical-turn-fields.test.ts                (S1..S5 — pure-data)
tests/schemas/ability-priority-grants.test.ts             (S6..S8 — pure-data)
tests/data/tactical/role-tags-priority.test.ts            (RC1..RC6)
tests/data/tactical/opposing-setter.test.ts               (OS1..OS5)
tests/data/tactical/derive-turn-fields.test.ts            (DT1..DT12)
tests/data/tactical/score-plan-per-phase.test.ts          (SP1..SP5)
tests/data/tactical/recommend-plan-stage-c.test.ts        (RP1..RP8)
tests/db/abilities-priority.test.ts                       (DB1..DB4)
tests/scripts/tactical-cli-stage-c.test.ts                (T1..T3)
```

---

## 3. Data schemas (zod)

Pure-data per CLAUDE.md §3 — schema additions batched in S1..S8.

### 3.1 `PriorityGrantsSchema`

```ts
// src/schemas/ability.ts (or a new src/schemas/priority-grants.ts if the type
// is shared with the role-tags schema — Q2 in §17 leans toward inlining).

export const PriorityGrantsSchema = z
  .object({
    /** What kind of move the ability accelerates. */
    kind: z.enum(["status", "flying", "healing"]),
    /** Priority bonus (1 for Prankster/Gale Wings, 3 for Triage). */
    bonus: z.number().int().min(1).max(5),
    /** Condition gate, when present. v1 only models "full_hp" (Gale Wings).
     *  Absent ⇒ unconditional. */
    condition: z.enum(["full_hp"]).optional(),
  })
  .strict();
export type PriorityGrants = z.infer<typeof PriorityGrantsSchema>;

// AbilitySchema gains:
//   priority_grants: PriorityGrantsSchema.optional()
```

Backfill JSON (`data/reg-m-a/abilities-priority.json`):
```json
{
  "prankster":  { "kind": "status",  "bonus": 1 },
  "galewings":  { "kind": "flying",  "bonus": 1, "condition": "full_hp" },
  "triage":     { "kind": "healing", "bonus": 3 }
}
```

### 3.2 `RoleTagAssignmentSchema.setter_priority_via_ability`

```ts
// src/schemas/tactical.ts — additive in RoleTagAssignmentSchema.

setter_priority_via_ability: PriorityGrantsSchema.extend({
  /** The move id that benefits from the ability. Lets downstream
   *  consumers (derive-turn-fields) distinguish "Sableye + Prankster +
   *  Rain Dance" (rain promoted to lead) from "Sableye + Prankster +
   *  Will-O-Wisp" (no field-state implication). */
  move_id: z.string().min(1),
  /** Which field-state effect this combo grants at lead phase. */
  effect: z.enum([
    "weather_rain", "weather_sun", "weather_sand", "weather_snow",
    "trick_room", "tailwind", "reflect", "light_screen", "aurora_veil",
    "healing",
  ]),
}).optional(),
```

The classifier emits this when:
- ability `priority_grants.kind === "status"` AND the set carries a status move that sets weather / TR / Tailwind / screen / heals → `effect` resolved from the move table.
- ability `priority_grants.kind === "flying"` AND moves include `tailwind` (only Tailwind matters at lead-phase field state) → `effect: "tailwind"`. Condition `full_hp` is assumed-met at lead phase (Q3 binding + flow §4.1 v1 simplification).
- ability `priority_grants.kind === "healing"` AND moves include a healing move → `effect: "healing"`. Late-phase consequence only; doesn't change a `ScenarioField` flag. Recorded for forward-compat.

### 3.3 Per-phase `field`

```ts
// src/schemas/tactical.ts — additive on each *PhaseSchema.

LeadPhaseSchema = … .extend({ field: ScenarioFieldSchema.optional() });
MidPhaseSchema  = … .extend({ field: ScenarioFieldSchema.optional() });
LatePhaseSchema = … .extend({ field: ScenarioFieldSchema.optional() });

TeamTacticalOverviewSchema.schema_version = z.literal(4);  // bump
```

### 3.4 `TurnFieldStates` (internal — not exported via schema)

Internal interface in `derive-turn-fields.ts`; no zod schema needed because it never crosses a trust boundary.

```ts
export interface TurnFieldStates {
  lead: ScenarioField;
  mid:  ScenarioField;
  late: ScenarioField;
}
```

---

## 4. Tool contracts

### 4.1 `recommend_team_plan` *(unchanged signature; output additive)*
- Anthropic SDK tool description text: **no change** — Stage B's description doesn't enumerate per-phase keys.
- Output schema: `TeamPlanScenario` with optional per-phase `field`. The agent loop will see new keys; pre-existing consumers that ignored unknown phase keys remain happy.
- Cache: §12.

### 4.2 `score_pillars` *(no change)*
Pillar bundle is upstream of the per-phase derivation.

### 4.3 No new agent tool.

---

## 5. Drizzle schema additions

Per memory `db_orm_drizzle.md`: edit `src/db/drizzle-schema.ts` and let `drizzle-kit` generate the migration.

```ts
// src/db/drizzle-schema.ts — additive on existing `abilities` table.

export const abilities = sqliteTable(
  "abilities",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    sourceJson: text("source_json").notNull(),
    priorityGrantsJson: text("priority_grants_json"),  // NEW (nullable)
  },
  (t) => [
    index("idx_abilities_display_name_nocase").on(sql`${t.displayName} COLLATE NOCASE`),
  ],
);
```

Migration filename: `src/db/migrations/0012_abilities_priority_grants.sql`. Single statement: `ALTER TABLE abilities ADD COLUMN priority_grants_json TEXT;`. Non-destructive.

---

## 6. Repository design

`src/db/abilities.ts` continues to use `createSimpleRepo` (memory `db_orm_drizzle.md`: mandatory for new ref tables; preserved for the existing one).

Row interface gains the new column; `rowToEntity` parses JSON when present:

```ts
interface Row {
  id: string;
  displayName: string;
  sourceJson: string;
  priorityGrantsJson: string | null;  // NEW
}

const repo = createSimpleRepo<Row, Ability>({
  name: "abilities",
  table: abilitiesTable,
  idColumn: abilitiesTable.id,
  displayNameColumn: abilitiesTable.displayName,
  rowToEntity: (r) =>
    parseOrThrow(
      AbilitySchema,
      {
        schema_version: 1,
        id: r.id,
        display_name: r.displayName,
        source: JSON.parse(r.sourceJson),
        ...(r.priorityGrantsJson
          ? { priority_grants: JSON.parse(r.priorityGrantsJson) }
          : {}),
      },
      "abilities",
      r.id,
    ),
});
```

Public methods (`list` / `get` / `has`) unchanged. The 30-line shape from memory `db_orm_drizzle.md` is preserved — no bespoke lookup added.

---

## 7. Architecture patterns + WHY

### 7.1 `deriveTurnFieldStates` is pure
No DB calls. The opposing-setter detection (which DOES touch the species table for ability lookup) happens upstream in `opposing-setter.ts` and is plumbed in as a `OpposingSetters` argument. This keeps the per-candidate hot path (~50 calls per scenario × 10 scenarios) free of DB I/O and trivially mockable in tests.

### 7.2 Construct a phase-scoped `ScenarioSkeleton`, don't add a `field` arg (Q1 §17)
The three downstream scorers (`scorePair`, `scoreMidPhase`, `scoreLatePhase`) already accept a `ScenarioSkeleton`. Adding a parallel `field` override arg duplicates the contract and risks "which field wins" bugs. Cleaner: clone the skeleton with the derived field. Stage B already does this for ability-weather (`scenarioForCalc = { ...scenario, field: ... }`) — Stage C generalizes the pattern to all three phases.

### 7.3 Synthesize opposing setters via the classifier (Q3 binding)
We don't ship a parallel `WEATHER_ABILITY_BY_SPECIES` lookup. Instead, `detectOpposingSetters` builds a minimal `RoleTagInput` per `opposing_preview` species (species_id + ability + empty moves[] + base_stats from the species table) and runs `deriveRoleTags`. This guarantees the opposing-setter detection logic stays in sync with our-side detection — one rule table, two callers.

### 7.4 Data-driven priority abilities (Q11 revised)
The list of priority-granting abilities lives in the `abilities` table as `priority_grants_json`. The classifier branches on the DB value, not a hardcoded `["prankster", "galewings", "triage"]` array. Adding Pixilate-class abilities in the future requires editing the JSON, no code change.

### 7.5 Cache key extends naturally
`CalcCache` keys already hash the `field` object (`_fieldHash` in `calc-cache.ts`). Per-phase fields are distinct hashes; entries multiply by ≤ 3× (Q8). No cache abstraction change.

### 7.6 Schema bump 3 → 4 (Q7)
Adding an optional field is technically backwards-compat. We bump anyway for two reasons: (a) consumers should *know* the output shape changed so they can opt into using the new field, and (b) the observability discipline established in Stages A and B (every shape change bumps) outweighs the marginal annoyance of a `literal(4)` migration. Stage A bumped 1 → 2 for the support pillar; Stage B bumped 2 → 3 for the plan scenarios; Stage C bumps 3 → 4. Pattern.

---

## 8. Error model

No new error classes.

| Class | Trigger | Severity |
|---|---|---|
| `TacticalOverviewError` (reused) | Same as Stage B — draft team / not-found. | fail-loud |
| `RosterDataError` (reused) | A row in `abilities` has malformed `priority_grants_json`. | fail-loud at DB read — the integrity check catches this in tests. |
| `RosterDbError` (reused) | SQLite I/O on abilities lookup. | propagates up |
| Defensive empty result | `detectOpposingSetters` returns `null` setters (species ability unknown in DB, or no preview species carries weather). | warn-and-continue: scenario falls back to authored `field.weather`. |

Edge cases (flow §8):
- **Both leads bring weather (intra-team).** `deriveTurnFieldStates` runs the duel between our two leads first (slower wins), then runs cross-team duel against the opposing setter.
- **Gale Wings lead with <100% HP at turn 1.** Impossible at lead phase by construction (battle just started). Documented as v1 simplification per flow §4.1.
- **Triage lead with no healing move.** Classifier won't emit `setter_priority_via_ability` because the (ability, move) combo doesn't match. Silent skip.
- **Speed tie on the duel.** Q9 §17 proposes "ours wins" (optimism bias). Documented.

`deriveTurnFieldStates` never throws.

---

## 9. Reuse audit

| Capability | Source | Disposition |
|---|---|---|
| `deriveRoleTags` | `src/data/tactical/role-tags.ts` | EXTENDED (new emit branch); existing rule tables reused as-is |
| `buildRoleAssignments` | `src/data/tactical/pillars.ts` | EXTENDED (threads ability `priority_grants` through to the classifier) |
| `createSimpleRepo` factory | `src/db/simple-repo.ts` | reused on `abilities.ts` (no bespoke repo) |
| `AbilitySchema` | `src/schemas/ability.ts` | EXTENDED with optional `priority_grants` |
| `CalcCache` + `_fieldHash` | `src/data/tactical/calc-cache.ts` | reused; field-keyed entries handle the 3× explosion |
| `scorePair`, `scoreMidPhase`, `scoreLatePhase` | `src/data/tactical/score-*.ts` | reused; callers construct per-phase `ScenarioSkeleton` (no signature change) |
| `recommend_team_plan` tool | `src/agents/tactical-tools.ts` | output gains optional fields; no description rewrite |
| `RoleTagAssignmentSchema` | `src/schemas/tactical.ts` | EXTENDED with `setter_priority_via_ability` |
| Stage B's `weather_provided_via_ability` override | `recommend-plan.ts::scorePlan` lines 285–306 | DELETED — supplanted by `deriveTurnFieldStates` |
| `ScenarioFieldSchema` | `src/schemas/tactical.ts` | reused as the per-phase field shape |

**Net-new modules:** `derive-turn-fields.ts`, `opposing-setter.ts`. Two files.

**No new external dependencies.** No new HTTP / scraper / vector-store usage.

---

## 10. Test strategy + ordering

TDD per CLAUDE.md §3. Write order = numbered order. Per-test red-first; §3 pure-data exemption applies to S1..S8.

**Total: 53 tests** (S×8 + RC×6 + OS×5 + DT×12 + SP×5 + RP×8 + DB×4 + T×3 + manual demo).

### Pure-data exemption batch — schemas (S1..S8)

| # | File | Asserts | Fails because |
|---|---|---|---|
| S1 | `tests/schemas/tactical-turn-fields.test.ts` | `LeadPhaseSchema` round-trips with `field` populated; rejects unknown field key | additive prop missing |
| S2 | same | `MidPhaseSchema.field` optional; absence parses fine | optionality broken |
| S3 | same | `LatePhaseSchema.field` accepts neutral (all defaults) field | not wired |
| S4 | same | `TeamTacticalOverviewSchema` rejects `schema_version: 3`, accepts `4` | bump not applied |
| S5 | same | `RoleTagAssignmentSchema.setter_priority_via_ability` round-trips full object; rejects malformed `effect` enum | enum/literal wrong |
| S6 | `tests/schemas/ability-priority-grants.test.ts` | `AbilitySchema.priority_grants` optional; Prankster sample parses; rejects `bonus: 0` | bound missing |
| S7 | same | `condition: "full_hp"` accepted on Gale Wings; rejected on Prankster only if `kind != "flying"` (validation deferred to consumers; schema accepts) | over-restrictive |
| S8 | same | Triage with `kind: "healing"` + `bonus: 3` parses | enum incomplete |

### Role classifier extension (RC1..RC6 — strict per-test)

| # | File | Asserts | Fails because |
|---|---|---|---|
| RC1 | `tests/data/tactical/role-tags-priority.test.ts` | Sableye (Prankster) + Rain Dance → `setter_priority_via_ability = { kind:"status", bonus:1, move_id:"raindance", effect:"weather_rain" }` | branch missing |
| RC2 | same | Sableye (Prankster) + Will-O-Wisp → field UNDEFINED (status-priority but not a field move) | over-eager match |
| RC3 | same | Talonflame (Gale Wings) + Tailwind → `effect:"tailwind"`, condition `"full_hp"` carried | flying branch |
| RC4 | same | Comfey (Triage) + Floral Healing → `effect:"healing"` | healing branch |
| RC5 | same | Lead set with ability whose `priority_grants` is undefined → field undefined | regression |
| RC6 | same | Sableye + Prankster + Reflect → `effect:"reflect"` (screens variant) | screen mapping missing |

### Opposing-setter detection (OS1..OS5)

| # | File | Asserts | Fails because |
|---|---|---|---|
| OS1 | `tests/data/tactical/opposing-setter.test.ts` | `opposing_preview = ["tyranitar","excadrill"]` → `{ weather: { species:"tyranitar", kind:"sand", base_spe:61, via:"ability" } }` | classifier not invoked |
| OS2 | same | `opposing_preview = ["incineroar"]` → no setters detected (returns `{}`) | false positive |
| OS3 | same | Unknown species ability (DB miss) → silent skip; no throw | crashes |
| OS4 | same | `opposing_preview = ["hippowdon"]` → returns sand with `base_spe:47` | base_spe wrong |
| OS5 | same | Pure function — same inputs → byte-equal output across 100 calls | non-deterministic |

### `deriveTurnFieldStates` (DT1..DT12)

| # | File | Asserts | Fails because |
|---|---|---|---|
| DT1 | `tests/data/tactical/derive-turn-fields.test.ts` | No setters at all → all three phases = scenario.field | baseline wrong |
| DT2 | same | Our ability setter only (Pelipper Drizzle) → lead/mid weather = rain; late = none (decayed) | promotion missing |
| DT3 | same | Our move setter only (Rain Dance, no Prankster) → lead = scenario.field, mid = rain, late = none | mid-only injection missing |
| DT4 | same | Our priority-move setter (Sableye + Prankster + Rain Dance) → lead = rain (promoted) | priority promotion missing |
| DT5 | same | Weather duel: our Pelipper (base 65) vs opp Tyranitar (61) → lead/mid = rain (Pelipper faster, sets first; Tyranitar SLOWER sets second and wins?) **CHECK** — Q2 binding says SLOWER wins. So Tyranitar sets second, sand wins. DT5 asserts sand. | duel reversed |
| DT6 | same | Weather duel: our Pelipper (65) vs opp Hippowdon (47) → Hippowdon slower, sets second, sand wins. lead/mid = sand. | as DT5 |
| DT7 | same | Intra-team duel: our two leads both bring weather (Pelipper + Politoed) → slower of the two wins | intra-team rule missing |
| DT8 | same | Tailwind decay: lead tailwind_ours=true, late tailwind_ours=false | decay missing |
| DT9 | same | TR decay: lead trick_room=true (priority Sableye TR), mid trick_room=true (still T2–T4 ≤ 5), late trick_room=false (T5+) | decay table wrong |
| DT10 | same | Late phase neutral by default — all flags false, weather "none" | not zeroed |
| DT11 | same | Gale Wings + Tailwind → lead tailwind_ours=true; mid still tailwind_ours=true (T2 ≤ 4); late false (T5 > 4) | gating wrong |
| DT12 | same | Triage + healing → lead phase field UNCHANGED (Triage doesn't toggle a field flag, healing is a future Stage-D survival input). Test pins the no-op. | over-applies |

### `scorePlan` integration (SP1..SP5)

| # | File | Asserts | Fails because |
|---|---|---|---|
| SP1 | `tests/data/tactical/score-plan-per-phase.test.ts` | `scorePlan` calls `deriveTurnFieldStates` exactly once per candidate | duplicated call |
| SP2 | same | `scorePair` receives a `ScenarioSkeleton` whose `field` = derived lead-phase field, not raw `scenario.field` | not threaded |
| SP3 | same | `scoreMidPhase` receives a skeleton with mid-phase field | not threaded |
| SP4 | same | `scoreLatePhase` receives a skeleton with late-phase field | not threaded |
| SP5 | same | Stage B's unconditional `weather_provided_via_ability` override is GONE — when our lead is Pelipper vs opposing Hippowdon (weather duel determines sand wins), `scorePair` sees field.weather = "sand", NOT "rain" | override-replacement regressed |

### `recommendTeamPlan` Stage-C integration (RP1..RP8)

| # | File | Asserts | Fails because |
|---|---|---|---|
| RP1 | `tests/data/tactical/recommend-plan-stage-c.test.ts` | Output phases each carry `field` | not echoed |
| RP2 | same | Late-phase `field.weather = "none"` on ArchaEye fixture across all 10 scenarios | decay leaked |
| RP3 | same | Late-phase `tailwind_ours = false`, `tailwind_theirs = false` on ArchaEye | decay table wrong |
| RP4 | same | Sand scenario on ArchaEye: lead pair = Pelipper-bearing pair (Pelipper-vs-opposing-Tyranitar duel → SLOWER Tyranitar wins sand; but flow §9 success says Pelipper line stays winning because Pelipper's pair score holds at the lead phase even in sand). Test pins: `phases[0].active` contains "pelipper". | duel result wrong |
| RP5 | same | TR scenario: `phases[0].field.trick_room = true`, `phases[2].field.trick_room = false` | decay not applied |
| RP6 | same | Tailwind scenario: lead tailwind_ours=true, late tailwind_ours=false | as above |
| RP7 | same | Sableye + Archaludon appears as lead pair in ≥ 2 of 10 scenarios on ArchaEye fixture (Q9 binding) | reintroduction failed |
| RP8 | same | Stage A `support_lift` regression — `phases[0].support_lift` matches Stage A's `computeSupportLift` on the same pair under the derived lead-phase field | regressed |

### Abilities-priority ingest (DB1..DB4)

| # | File | Asserts | Fails because |
|---|---|---|---|
| DB1 | `tests/db/abilities-priority.test.ts` | After `pnpm data:reg-m-a build`, `abilities.get(db, "Prankster", "RegM-A")?.priority_grants` deep-equals `{ kind:"status", bonus:1 }` | backfill not wired |
| DB2 | same | Gale Wings carries `condition: "full_hp"` | condition dropped |
| DB3 | same | Triage carries `kind: "healing", bonus: 3` | enum incomplete |
| DB4 | same | An ability with NO priority entry (e.g., Sand Stream) → `priority_grants` undefined; row parses cleanly | NULL handling broken |

### CLI/output regression (T1..T3)

| # | File | Asserts | Fails because |
|---|---|---|---|
| T1 | `tests/scripts/tactical-cli-stage-c.test.ts` | `pnpm data:tactical plan <team_id>` stdout JSON has `scenarios[*].phases[*].field` on every phase | not emitted |
| T2 | same | `schema_version` in emitted JSON is `4` | bump missed |
| T3 | same | Stage B's regression goldens still pass (lead pair identities match Stage B fixtures on neutral scenarios where Stage C should be a no-op) | broke Stage B |

**Live manual demo (NOT a CI test — per Stage A precedent):** `pnpm data:tactical plan 01KR7TVD21G1Q99BK0NAEARFD8`. Screenshot in PR description. Inspect: Sableye + Archaludon ≥ 2 scenarios; late-phase fields zeroed; Sand scenario lead pair sane.

---

## 11. Architecture patterns + WHY (recap and rationale)

### 11.1 Pure derivation, DB resolution upstream
`deriveTurnFieldStates` takes its inputs (role assignments + opposing setters) pre-resolved. Tests can mock these as pojos; the production caller resolves them once per overview. This mirrors Stage A's `buildRoleAssignments` posture.

### 11.2 Per-phase `ScenarioSkeleton` over `field` override (Q1)
Each scorer continues to consume one parameter that carries the field. Risks of an override arg: (a) the unconditional override at Stage B `scorePlan:300` already showed how easy it is to forget to thread the override to *every* call site, and (b) the cache key already hashes the skeleton — overriding the field outside the skeleton breaks the cache. Construct a fresh skeleton per phase, period.

### 11.3 Speed-duel as a Reg-M-A-only rule
The rule "slower setter wins" is a real VGC mechanic, applied unconditionally — no items, no abilities (Quick Draw deferred) modify it in v1.

### 11.4 Data-driven priority abilities (Q11)
A row of JSON beats a code branch. The `priority_grants` column is a forward-compat seam — Pixilate-class flags, Sheer Force, etc. could ride the same column with new `kind` enum values.

### 11.5 Schema bump as observability gate (Q7)
Documented in §7.6 above.

### 11.6 Stage B's unconditional override is deleted, not generalized
The lines at `recommend-plan.ts:285–306` (Stage B §18.C) are removed in this slice. Stage C's `deriveTurnFieldStates` is the single source of weather truth. SP5 pins this.

---

## 12. Cache + throttle implementation

**No new cache, no new throttle.** Stage B's `CalcCache` is process-scoped, keyed by `(attacker_set, defender_set, field, move)`. Stage C's per-phase fields produce three distinct `field` hashes per candidate where Stage B produced one.

**Worst-case key count per overview:**
- Stage B: ~4400 (per Stage B plan §14).
- Stage C: 3× the per-phase calls → ~13200 worst case if every phase has a distinct field. Realistic estimate: ~10800 because mid and lead often share the field (e.g., Pelipper sets rain at switch-in, mid still rain). Cache memory: ~2 MB (Q8).

No throttle. Pure CPU after `buildOverview`.

---

## 13. Ingest / build orchestration

**Build script extension** (`scripts/data/build-reg-m-a.ts`):
1. Existing step: populate `abilities` from the consensus source.
2. **New** step (post-populate): read `data/reg-m-a/abilities-priority.json`. For each `(id, priorityGrants)` entry, UPDATE `abilities` SET `priority_grants_json = ?` WHERE `id = ?`. Upsert-flavored; non-destructive (memory `single_db_non_destructive_build.md`).
3. Log "Priority abilities backfilled: N" for observability.

Exit codes unchanged. No parallelism needed (≤ 5 priority entries today).

**Migration apply:** Stage 5 runs `pnpm db:migrate` once locally (and tests apply migrations in-memory).

---

## 14. Definition of Done mapping (CLAUDE.md §11)

| DoD item | Satisfied by |
|---|---|
| Flow doc reviewed | `docs/flows/turn-weighted-phase-scoring.md` §12 |
| Tech plan approved | This file (pending) |
| Failing test written first | §10 — all 53 tests are ordered red-first; S1..S8 batch per §3 exemption |
| All tests pass | Stage 5 + Stage 6 gate |
| Types check | Stage 5 + Stage 6 |
| Lint clean | Stage 5 + Stage 6 |
| New external data schema-validated + fixture-backed | `data/reg-m-a/abilities-priority.json` + `AbilitySchema.priority_grants` |
| User-facing claim cited | No user-facing prose change; rationale templates unchanged from Stage B |
| Docs touched | PRD unchanged; this plan doc + flow doc are the discipline artifacts |
| Reviewer subagent ran | Stage 6 |

---

## 15. Rollout / feature-flag

**No feature flag.** Schema bump 3 → 4 is technically additive (consumers ignoring unknown fields still parse), but the version literal change is a one-PR break. Every consumer in this codebase (`overview.ts`, agent tool, CLI, all tests) updates simultaneously.

**No persistence to migrate** — plans are compute-on-demand. The ONLY on-disk artifact is the `abilities.priority_grants_json` column, which is rebuilt by `pnpm data:reg-m-a build` (Category-A regenerable).

**Stage 5 deploy order:**
1. Land schema additions (S1..S8 batch).
2. Land Drizzle column + migration (`pnpm drizzle-kit generate`).
3. Land backfill JSON + build-script extension.
4. Land role-classifier extension (RC1..RC6).
5. Land `opposing-setter.ts` (OS1..OS5).
6. Land `derive-turn-fields.ts` (DT1..DT12).
7. Land `scorePlan` integration (SP1..SP5).
8. Land `recommendTeamPlan` echo + Stage-C regressions (RP1..RP8).
9. Land DB ingest tests (DB1..DB4).
10. Land CLI output tests (T1..T3).
11. Live ArchaEye manual demo.

Stage A / Stage B tests must stay green through every step except 8 (where RP4 pin replaces Stage B's "Pelipper always overrides" assumption — Stage B's tests that pinned the old override are updated as part of step 7).

---

## 16. Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Decay defaults wrong for some scenarios (Tailwind 4T leaks into a 5T+ corner case; user feedback in §6 flagged Floette-Eternal late Tailwind) | Medium | Medium | v1 defaults documented; the "late Tailwind for Floette sweep" case is explicitly deferred — `// TODO(stage6-deferred): late-phase-persistent-tailwind` on `derive-turn-fields.ts`. Calibration follow-up after ≥ 5 saved teams. |
| Speed-duel rule wrong for an edge case (Choice Scarf opposing setter, paralysis turn 1, Quick Draw proc) | Medium | Medium | v1 models only base-spe duel; Scarf-opposing-setter is the meaningful edge — log `// TODO(stage6-deferred): opposing-scarf-weather-duel`. Quick Draw is explicitly deferred (probabilistic). |
| Schema v3 → v4 breaks an agent-tool consumer that pinned `literal(3)` | Low | Medium | Search the codebase for `literal(3)` and `schema_version === 3`; rewrite in this PR. PR description lists touched call sites. |
| `RoleTagAssignmentSchema` accumulates flags; future Stage D adds more, surface gets cluttered | Medium | Low | Inline `// TODO(stage6-deferred): role-tag-assignment-shape-refactor` if flag count exceeds 6 after Stage D lands. Not blocking. |
| Sableye reintroduction surfaces lead pairs the user hasn't validated; live demo might pick weird Sableye-pair combos | Medium | Low | RP7 asserts ≥ 2 of 10, not "all". Manual demo review in PR description. If the pick is bad, role-chain bonus or `scorePair` weights can be tuned in Stage-6 review without touching Stage C semantics. |
| Hand-curated `abilities-priority.json` missed an ability (e.g., a fourth priority ability lands in a Reg-M-A patch) | Low | Low | Pure data add — no code path; backfill is a one-line JSON edit. Document the file's purpose in its header comment. |
| Cache memory growth — 3× entries → ~2 MB. If a future user runs many overviews back-to-back in one process, the cache grows unbounded | Low | Low | Stage B's cache is already process-scoped and per-overview; the 3× factor is bounded per-overview. No GC pressure expected. Watch in Stage 6 review. |

---

## 17. Open questions for plan review

**Q1. Per-phase `ScenarioSkeleton` construction vs `field` override arg on scorers.**
**Proposal:** construct skeleton per phase. Reason: the scorers' contract is already a skeleton — overriding the field outside the contract risks cache-key drift. Stage B already prototyped this (`scenarioForCalc = { ...scenario, field }`). Alternative: add an optional `field?: ScenarioField` arg — less invasive but invites "did the caller remember to thread it?" bugs.
Answer: per-phase skeleton construction wins for safety and cache integrity.

**Q2. Shape of `setter_priority_via_ability` — inline or richer object?**
**Proposal:** rich object with `move_id` + `effect` enum (per §3.2). Reason: downstream consumers (`derive-turn-fields.ts`) need to know *which* effect was promoted — a bare boolean wouldn't tell us whether Sableye + Prankster + TR vs Sableye + Prankster + Tailwind. Alternative: bare boolean, push the move-effect resolution into `derive-turn-fields` — couples two modules tighter than necessary.
Answer: richer object wins for clarity and separation of concerns.

**Q3. Decay turn-window edge cases (Tailwind 4T crossing mid→late at T4 boundary).**
Mid window is T2–T4. Tailwind starts T1, ends end-of-T4. So mid-phase START (T2) sees Tailwind, late-phase START (T4) is the LAST turn of Tailwind. **Proposal:** evaluate at FIRST turn of each window per Q1 binding ⇒ late phase = end-of-T4 = Tailwind STILL UP at T4 start. But Q6 binding says "late phase = neutral by default." Tension. **Resolution proposal:** treat T4 as the inclusive boundary; Tailwind expires AFTER T4 ends, so the late-phase START field at T4 has Tailwind = true; the engine output then shows the cleaner KO-ing in Tailwind. This contradicts Q6 ("all effects expired turn 5+"). **Recommended fix:** keep the rule "field evaluated at first turn ≥ window-start AFTER previous-window's effects decay"; late phase window is [4, 8], and the conservative read is T5 not T4, so Tailwind = false. Pin this in DT11 + RP3.
Answer: I think it would depend, for instance you may want to setup Tailwind in late game since your sweepeer is not as fast as the opponent's. I think letting sets to expire at end of T4 is over simplifying the interaction.

**Q4. Weather duel: which setter wins on tied base speeds?**
**Proposal:** "ours wins" — slight optimism bias. Reason: the scorer is a recommender, not a sim; biasing toward our success rate aligns with the planning intent. Alternative: "theirs wins" — conservative, but penalizes legal team comps for an arbitrary 50/50 coin flip. Stage D's sim will model the actual speed-tie randomness.
Answer: "theirs wins" - We should be ready for worst-case scenarios.

**Q5. Roster abilities-priority backfill scope — ship the three v1 abilities, or scan Smogon's ability table for all priority-grant flags?**
**Proposal:** ship the three (Prankster, Gale Wings, Triage). Smogon's data does include priority hints on some abilities but the mapping to our `effect` enum is bespoke. Adding more abilities is a pure data PR — fast follow-up if needed. Alternative: pull all of them now — broader scope, slower review.
Answer: I think abilities are already in the roster aren't they?

**Q6. Live ArchaEye Sableye reintroduction success bar — ≥ 2 of 10 strict, or any specific scenarios?**
**Proposal:** ≥ 2 of 10 (RP7). Reason: a hard-coded scenario list (e.g., "TR scenario must pick Sableye") would over-pin the scorer. The ≥ 2 threshold validates the reintroduction without dictating which scenarios
Answer: We never want to hardcode specific scenarios.

**Q7. Schema bump 3 → 4 — necessary for an additive change?**
**Proposal:** yes (per §7.6). Stage A and Stage B established the pattern. Alternative: skip the bump, since `field` is optional — but then a future Stage D bump can't tell whether the consumer is reading pre- or post-Stage-C output.
Answer: I think we should bump the schema version to 4, even if it's technically additive, to maintain the discipline and clarity around output shape changes.

**Q8. Triage on Sinistcha? Comfey? Confirm the v1 priority list is correct given the ArchaEye demo (which has Sinistcha, NOT Comfey).**
Sinistcha's abilities are Heatproof / Hospitality, NOT Triage. Comfey carries Triage but isn't on ArchaEye. **Proposal:** ship Triage in the priority list anyway. Reason: data-driven; no code cost; future teams may run Comfey. Stage C doesn't *require* Triage to fire on ArchaEye to ship.
Answer: It would depend on the abilities in the roster.

**Q9. Speed-tie deterministic resolution — "ours wins" or "theirs wins"?**
Duplicate of Q4 above. Listed twice for visibility — kept under Q4 above.

**Q10. Persistent late-phase Tailwind (Floette-Eternal sweep — user surfaced in flow §11 Q6 answer)?**
**Proposal:** defer to a future calibration slice. Reason: requires HP-tracking (is Whimsicott/Floette still alive at T5?) which is Stage D scope. Inline `// TODO(stage6-deferred): late-phase-persistent-tailwind` and call it out in §16.
Answer: Do not defer, it's important to understand which Pokemon and sets you want to keep up for late game.

**Q11. Should `opposing-setter.ts` cache its per-scenario classifier output across the candidate loop?**
**Proposal:** yes — once per scenario, memoize on `opposing_preview` array hash. Cuts ~50 classifier calls per scenario down to 1. Implementation: a `Map<string, OpposingSetters>` in `recommendTeamPlan` scope, keyed by `opposing_preview.join("|")`.
Answer: Caching the opposing setter detection results makes sense for performance, especially since the opposing preview is unlikely to change frequently across candidates. Memoizing on the `opposing_preview` array hash is a straightforward approach.

**Q12. Should `setter_priority_via_ability.effect` enum include both `weather_rain` and `weather` (with a separate `weather_kind`)?**
**Proposal:** keep flat — `weather_rain` / `weather_sun` / `weather_sand` / `weather_snow`. Reason: enum check is simpler; mirrors the explicit enum approach in `ScenarioFieldSchema.weather`. Alternative: structural `{ kind: "weather", weather: WeatherKind }` — more general but more verbose for callers.
Answer: Keeping a flat enum for `effect` is simpler and more straightforward for the current use case. If we find that we need to support more complex priority effects in the future, we can consider refactoring to a more structured format at that time.

**Q13. Flow-doc gap.** Flow §6 says "Per-phase field on `TeamPlanScenario.phases[*]`" but doesn't enumerate which `ScenarioField` flags should be derived per phase vs left at scenario default. The decay table in flow §5 lists weather/TR/Tailwind/screens, but NOT terrain or gravity. **Proposal:** terrain and gravity decay are not modeled in v1 (terrain decays 5T like screens but isn't load-bearing for Reg-M-A meta; gravity is exotic). Inline `// TODO(stage6-deferred): terrain-and-gravity-decay`. Surface here so reviewer can decide.
Answer: Deferring terrain and gravity decay makes sense for v1, especially if they are not currently load-bearing for the meta. We can revisit this in a future stage if we find that modeling these effects is necessary for accurate scoring.

---

**Reviewed-by:** _Rodrigo Caballero_
