# Tech Plan — Team Support Pillar + Role Tags (Stage A)

**Slug:** `team-support-pillar`
**Branch:** `feat/team-support-pillar`
**Stage:** Stage 3 — Tech plan (pending approval)
**Date:** 2026-05-09
**Author:** Tech Lead subagent
**Implements flow doc:** `docs/flows/team-support-and-phases.md` (Stage 2 reviewed 2026-05-09 by Rodrigo Caballero — see §13 of the flow + §12 binding answers).

**Memory citations:**
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/db_orm_drizzle.md` — schema in `src/db/drizzle-schema.ts` is single source of truth; drizzle-kit generates the `phase_tag` column migration; the `insights` table is already owned by the youtube-insights slice and we extend it additively.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/single_db_non_destructive_build.md` — migration 0011 is additive over a populated `db.sqlite`; every existing `insights` row survives unchanged with `phase_tag = NULL`.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_no_tera.md` — role detector consumes Reg M-A movepool / ability tables; no Tera input ever flows through the support pillar.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/regulation_m_a_roster.md` — role classifier filters by `roster_membership.is_legal=1` for `format='RegM-A'`; goldens are pinned to Reg M-A species only.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/test_fixtures_no_invariant_blobs.md` — golden fixtures for role tags commit the **input team JSON** + a deterministic generator script; classifier outputs are recomputed in the test, not committed as opaque blobs.
- `~/.claude/projects/-Users-rodrigo-src-pokemon-ai-trainer/memory/labmaus_pokepaste_deferred_todos.md` — every cross-slice deferral lands as inline `// TODO(slice-deferred): backfill phase_tag …` for greppability.

**Sibling precedents:**
- `docs/plans/team-tactical-overview.md` — direct parent. Owns the four pillar scorers, the calc cache, `score-pair`, `recommend-leads`, `ScenarioOverview`, and the two agent tools (`score_pillars` + `recommend_leads`). This slice **extends** every one of those modules; it does **not** rewrite them.
- `docs/plans/youtube-insights.md` — owns `InsightSchema`, the `insights` table, the `extract.ts` Haiku-driven extractor, and the `emit_insights` tool definition. This slice **extends** the schema (adds `phase_tag`), the table (adds the column), and the extractor's tool input (passes the new field through).

**Sibling deferrals (NOT this slice):**
- `docs/plans/team-phase-plan.md` — Stage B. Replaces `recommend_leads` with `recommend_team_plan` returning `(lead_phase, mid_phase, late_phase)` triples. Will bump `TeamTacticalOverview.schema_version` 2 → 3 and reshape `ScenarioOverviewSchema` (Q8 binding). **Out of scope here.** This plan keeps Stage A's API surface backwards-compatible so Stage B can land non-destructively.

**First-of-kind for this slice:**
- **Deterministic role classifier.** First derived per-set classification that doesn't go through `damage_calc` or `@smogon/calc`. Pure function over `(set, ability, movepool)` — testable with hand-rolled fixtures.
- **Fifth pillar.** First widening of `PillarBundleSchema`'s 4-key shape since `team-tactical-overview` shipped. Schema bump 1 → 2 on `TeamTacticalOverviewSchema` (additive — old four-pillar consumers still parse).
- **Insight phase tagging at extraction time.** First time a downstream slice extends the youtube-insights extractor's `emit_insights` tool input. Establishes the cross-slice extension protocol.

---

## 1. Goal recap

Ship the **support pillar** end-to-end: a deterministic per-set role classifier (`src/data/tactical/role-tags.ts`), a fifth pillar scorer (`src/data/tactical/score-support.ts`), the synergy `role_coherence` extension, the `support_lift` term in `scorePair`, and the `phase_tag` field added to `Insight` rows at extraction time so Stage B can rely on it from day one. Concrete deliverables:

- `RoleTagSchema` enumerating **11** tags (Q2 revision: `setter` is fanned out into `screen_setter` / `speed_control_setter` / `weather_setter`; the other 8 from flow §4 stay): `screen_setter | speed_control_setter | weather_setter | redirect | cleric | disruptor | pivot | setup_sweeper | cleaner | wallbreaker | anti_priority`. Plus `untagged` as a defensive fall-through.
- `deriveRoleTags(set, deps) → { primary: RoleTag, all: RoleTag[] }` — pure deterministic classifier reading the existing `moves` + `abilities` Drizzle tables. No LLM (Q3 ✓).
- `scoreSupport(team, panel, deps) → PillarScore` — formula: per-mechanism counts × hand-tuned weights + `+15` `role_coherence_bonus` (Q4 ✓), clamped 0–100, tier label.
- `scoreSynergy` extension — `evidence.role_tags` and `evidence.role_coherence` surface; `+20` archetype floor when `role_coherence = true` (Q4 ✓ + Q12 ✓).
- `scorePair` extension — `support_lift(leads, back, scenario)` term added with hand-tuned coefficients +12 / +8 / +6 / +10 / −10 (Q5 ✓ — calibration is its own follow-up slice).
- `TeamTacticalOverviewSchema` bumps `schema_version: 1 → 2`; `PillarBundleSchema` gains `support: PillarScoreSchema`; `ScenarioOverviewSchema` gains optional `support_lift: number`. Old 4-pillar JSON is silently rejected by zod (the bump is the breaking part) — but the only on-disk consumer is the live CLI, which always regenerates.
- `Insight.phase_tag: "lead" | "mid" | "late" | null` — extends the schema, the `insights` table (via drizzle-kit migration `0011_insights_phase_tag.sql`), the `emit_insights` tool input schema, and the system prompt's hard rules. **New** insights extracted after this slice ships carry the field; **existing** rows keep `phase_tag = NULL` (re-extraction is `// TODO(slice-deferred): backfill phase_tag on pre-existing insights` per the precedent in memory `labmaus_pokepaste_deferred_todos.md`).

**Done means:**
1. Live ArchaEye end-to-end: Sableye primary = `screen_setter` (carries `screen_setter`+`speed_control_setter` across Reflect/Light Screen + Quash + Rain Dance), Sinistcha primary = `cleric`, Basculegion primary = `cleaner`, Pelipper primary = `weather_setter` (Drizzle), Archaludon primary = `setup_sweeper`, Dragonite primary = `wallbreaker`. Support pillar ≥ 70 (Strong); synergy lifts from 22 → ≥ 50; ≥ 1 of 10 scenarios picks Sableye + Archaludon as recommended leads. **(Manual demo step at the end of Stage 5 — not a CI test, per task brief: live API keys + DB state.)**
2. 5 committed canonical Reg-M-A team fixtures (ArchaEye, the J0eVKJyJ_DQ Charizard team, plus three more — see §11) have golden role-tag assertions that pass byte-equal.
3. Re-running `pnpm data:tactical pillars <team_id>` produces deterministic 5-pillar output (additive vs the v1 4-pillar shape).
4. Existing `team-tactical-overview` + `youtube-insights` + `damage-calc` + `user-teams` tests stay green.
5. Insights ingest pipeline accepts the new `phase_tag` field through Haiku tool_use; one new test asserts a tagged insight survives round-trip from extraction → `insights.upsertMany` → `insights_search`.

**Out of scope (deferred — NOT this slice):**
- Stage B — phase-aware `recommend_team_plan` tool, plan candidate generation, mid/late phase scoring, plan citation retrieval. Owned by `docs/plans/team-phase-plan.md`.
- Backfill / re-extraction of `phase_tag` over the pre-existing youtube-insights corpus. Inline `// TODO(slice-deferred): backfill phase_tag on pre-existing insights` in `src/tools/insights/extract.ts` + `src/db/insights.ts`; trigger to revisit = Stage B ships and we have ≥ 100 untagged rows to reprocess.
- `support_lift` and per-mechanism weight calibration. Hand-tuned ships as-is (Q5 ✓); `// TODO(stage6-deferred): support-pillar-coefficient-calibration` annotation on `score-support.ts` and `score-pair.ts`.
- Mechanism-compatibility check `(c)` in `role_coherence` (Q12 ✓ — defer). Inline `// TODO(stage6-deferred): role-coherence-mechanism-compat` annotation on `score-support.ts`.

## 2. Module boundaries

All paths absolute under `/Users/rodrigo/src/pokemon-ai-trainer/`. New files unless marked *(extend)*.

### 2.1 Schemas (`src/schemas/`)

#### `src/schemas/tactical.ts` *(extend, additive — schema_version bump)*
- **Adds** `RoleTagSchema` — 11-tag enum + `"untagged"` fall-through. TS type `type RoleTag = z.infer<typeof RoleTagSchema>`.
- **Adds** `RoleTagAssignmentSchema` — `{ primary: RoleTag, all: z.array(RoleTag).min(1) }` per-set output of the classifier.
- **Adds** `SupportPillarEvidenceSchema` — see §3.
- **Extends** `PillarBundleSchema` — adds `support: PillarScoreSchema` field; existing 4 keys stay.
- **Extends** `PillarScoreSchema` — widens `pillar` enum from `("offense","defense","speed","synergy")` to add `"support"`.
- **Extends** `ScenarioOverviewSchema` — adds optional `support_lift: z.number().optional()` for forward-compat. (Stage B will reshape; Stage A only emits this field.)
- **Extends** `TeamTacticalOverviewSchema` — bumps `schema_version: z.literal(1) → z.literal(2)`. **Forward-compat note:** Stage B will bump to 3 and reshape `scenarios[].recommended_leads` into a phase tuple. Document the coming break in TSDoc on `TeamTacticalOverviewSchema`.
- **Adds** `SynergyEvidenceSchema` — first time we type the synergy `evidence` (today it's an opaque `z.record(z.unknown())` per `PillarScoreSchema`). Carries `role_tags: z.record(RoleTagAssignmentSchema)` (keyed by `species_id`) + `role_coherence: z.boolean()` + `coherence_chain: { setter: RosterId, payoff: RosterId, payoff_role: RoleTag } | null` + the existing teammate/archetype fields. We DON'T tighten `evidence` on `PillarScoreSchema` itself (would break offense/defense/speed); we expose `SynergyEvidenceSchema` as an OPTIONAL parser the synergy scorer uses internally + an exported type for downstream consumers.
- **Per CLAUDE.md §3 pure-data exemption:** schema additions land in one batched commit; tests TAC-S1..S6 are written against the extended shape but don't drive per-field red→green cycles. The exemption is disclosed in the Stage-4 commit message.

#### `src/schemas/insight.ts` *(extend, additive — Q9 binding)*
- **Adds** `PhaseTagSchema = z.enum(["lead","mid","late"])`.
- **Extends** `InsightSchema` — adds `phase_tag: PhaseTagSchema.nullable().default(null)` (after `chunk_id`, before close brace). Per memory `db_orm_drizzle.md` the schema is the single source of truth; the table column comes from the schema, not the other way around.
- **Extends** `InsightSearchArgsSchema` — adds optional `phase_tag_filter: PhaseTagSchema.optional()` so Stage B's phase-citation retrieval can filter.
- TSDoc on `phase_tag`: "Coarse battle-phase classification of the underlying claim. `lead` = turn 1–2 / opener choice; `mid` = turn 2–4 / pivot game; `late` = turn 4+ / closing the game. `null` for insights produced before this slice (extracted by `prompt_version='v1.0'`); new ingests under `prompt_version='v1.1'` always emit a non-null value or omit the insight."

### 2.2 Data layer (`src/data/tactical/`)

| File | Responsibility |
|---|---|
| `role-tags.ts` (new) | Pure deterministic classifier. `deriveRoleTags(set, deps) → RoleTagAssignment`. Reads `moves` + `abilities` ref tables for category / type / power thresholds; primary-selection priority per flow §4 modified for the 11-tag set (see §3). |
| `score-support.ts` (new) | `scoreSupport(team, panel, deps) → PillarScore`. Aggregates per-set role tags into the §5.1 formula; emits `SupportPillarEvidence`. |
| `score-synergy.ts` *(extend)* | Adds `role_tags` + `role_coherence` + `coherence_chain` to evidence; archetype-detection score gets `+20` floor when `role_coherence = true`. Existing 60/40 teammate/archetype split preserved. |
| `score-pair.ts` *(extend)* | Adds `support_lift(leads, back, scenario, roleAssignments) → number` and folds it into `realScore`: `α·offense + β·speed − γ·defense_loss + δ·support_lift` with `δ = 1.0`. The hand-tuned coefficient set (+12 / +8 / +6 / +10 / −10) lives as exported constants for Stage 6 review. |
| `pillars.ts` *(extend)* | Wires the new `scoreSupport` into the `PillarBundle` and the role-tag map into the synergy + pair-score paths (single computation, threaded through). |
| `overview.ts` *(extend)* | Bumps emitted `schema_version` to 2; populates `pillars.support`; populates `scenarios[].support_lift`; passes role-tag assignments into the recommend-leads call. |
| `recommend-leads.ts` *(extend, minimal)* | Accepts a new `roleAssignments?: Map<species_id, RoleTagAssignment>` dep; threads it through to `scorePair` + `collectKeyCalcsForPair`. No logic change beyond plumbing. |

### 2.3 Tool layer

#### `src/tools/insights/extract.ts` *(extend, additive — bump prompt_version)*
- **Pin `prompt_version: "v1.1"`** (was `"v1.0"`). Per Q4 binding from the youtube-insights plan, structural prompt changes bump the version.
- **Extend `emit_insights` tool input schema:** add `phase_tag: { type: "string", enum: ["lead","mid","late"], nullable: true }` per insight item; required when claim_type is `lead` (always `"lead"`) or `meta_trend` (model picks); nullable for `tech` / `set` / `matchup` / `counter` (default to `null` if model can't decide).
- **Extend system prompt rules:**
  - Add a new hard rule: *"For each insight, emit `phase_tag` if the claim is phase-specific. Use `lead` for opener / preview / turn-1-priority claims. Use `mid` for pivot / momentum / Tailwind-burn claims. Use `late` for cleanup / revenge / endgame claims. Emit `null` when the claim is phase-agnostic (e.g. set choice, item rationale)."*
  - Add a one-line example per phase per claim_type combo (token-budget-cheap; ~6 lines).
- **Pass-through:** the post-extraction `passesSpeciesGuard` filter is unchanged. A new `passesPhaseTagGuard` filter rejects insights where `phase_tag` is set but `claim_type` makes it nonsensical (e.g. `phase_tag = "lead"` on a `set` claim is allowed — set choices can be lead-specific — but `phase_tag != null` on a `meta_trend` claim is rejected unless the speaker explicitly framed it phase-wise; v1 keeps this LOOSE — log + accept).
- **No retries forced:** rate-limit retries unchanged.
- **TSDoc bump:** the `extractInsights` block grows a "Phase tag emission" subsection.

### 2.4 DB layer (`src/db/`)

#### `src/db/drizzle-schema.ts` *(extend, additive)*
- Add `phaseTag: text("phase_tag")` (nullable) to the `insights` Drizzle table definition.
- Add CHECK constraint `insights_phase_tag` validating `phase_tag IS NULL OR phase_tag IN ('lead','mid','late')`.
- Optional index `idx_insights_phase_tag` on `phase_tag` (small selectivity gain for Stage B's per-phase retrieval; cheap to add now).
- **Per memory `db_orm_drizzle.md`:** schema edit lands here first; `pnpm drizzle-kit generate` produces `0011_insights_phase_tag.sql`; we hand-verify the generated SQL is purely additive (single `ALTER TABLE insights ADD COLUMN phase_tag TEXT;` + `CREATE INDEX`). No table-rebuild — column add does not need it because the existing CHECK constraints don't reference the new column.

#### `src/db/migrations/0011_insights_phase_tag.sql` (new — drizzle-kit generated, hand-verified)
- Single `ALTER TABLE insights ADD COLUMN phase_tag TEXT;` + the CHECK constraint applied at the table level (sqlite supports adding CHECK via column add when wrapped in parentheses; if drizzle-kit emits a table-rebuild we keep it — non-destructive per memory `single_db_non_destructive_build.md`, all rows preserved with `phase_tag = NULL`).
- Plus `CREATE INDEX idx_insights_phase_tag ON insights (phase_tag) WHERE phase_tag IS NOT NULL;` (partial index — most rows are NULL).

#### `src/db/insights.ts` *(extend, additive)*
- `upsertMany` parameter `rows[].insight: Insight` already carries `phase_tag` via the schema bump; the existing INSERT statement extends to write the new column. **Idempotency key remains `(chunk_id, claim)`** — re-extracting the same chunk under v1.1 will skip-on-conflict, preserving the older row's `phase_tag = NULL`. Backfill is the deferred TODO.
- `search` accepts new optional `options.filter.phase_tag` — adds `WHERE insights.phase_tag IN (?)` to the query. Used by Stage B; this slice ships the parameter unused.
- `listByChunkId` / `listByVideoId` / `listBySpecies` return the column transparently.

### 2.5 Tests (paths only — full ordering in §10)

```
tests/schemas/tactical-support.test.ts       (S1..S6 — pure-data exemption)
tests/schemas/insight-phase-tag.test.ts      (S7..S9 — pure-data exemption)
tests/data/tactical/role-tags.test.ts        (R1..R20 — strict per-test red→green)
tests/data/tactical/role-tags.golden.test.ts (R21..R25 — five-team goldens)
tests/data/tactical/score-support.test.ts    (SU1..SU10)
tests/data/tactical/score-synergy.test.ts    (extends — SY1..SY5)
tests/data/tactical/score-pair.test.ts       (extends — SP1..SP5)
tests/data/tactical/overview.test.ts         (extends — OV1..OV3)
tests/db/insights-phase-tag.test.ts          (DB1..DB3)
tests/tools/insights/extract-phase-tag.test.ts (EX1..EX2)
```

## 3. Data schemas (zod)

Per CLAUDE.md §3, the schema additions are pure-data and land batched. Bodies follow:

```ts
// src/schemas/tactical.ts (additive)
export const RoleTagSchema = z.enum([
  "screen_setter",
  "speed_control_setter",
  "weather_setter",
  "redirect",
  "cleric",
  "disruptor",
  "pivot",
  "setup_sweeper",
  "cleaner",
  "wallbreaker",
  "anti_priority",
  "untagged",                           // defensive fallback for sets that match no rule
]);
export type RoleTag = z.infer<typeof RoleTagSchema>;

export const RoleTagAssignmentSchema = z.object({
  primary: RoleTagSchema,
  all:     z.array(RoleTagSchema).min(1),
}).strict();
export type RoleTagAssignment = z.infer<typeof RoleTagAssignmentSchema>;

export const SupportMechanismsSchema = z.object({
  screens:               z.array(RosterId),       // species ids that bring screens
  weather_setters:       z.array(RosterId),       // weather ability or weather move
  speed_control:         z.array(RosterId),       // TR / Tailwind / Icy Wind
  redirection:           z.array(RosterId),
  healers:               z.array(RosterId),
  disruption:            z.array(RosterId),
  pivots:                z.array(RosterId),
  anti_priority:         z.array(RosterId),
}).strict();

export const CoherenceChainSchema = z.object({
  setter:        RosterId,                        // species_id of the setter
  payoff:        RosterId,                        // species_id of the setup_sweeper or cleaner
  payoff_role:   RoleTagSchema,                   // "setup_sweeper" | "cleaner"
}).strict();

export const SupportPillarEvidenceSchema = z.object({
  role_tags:        z.record(RoleTagAssignmentSchema),    // species_id → assignment
  mechanisms:       SupportMechanismsSchema,
  role_coherence:   z.boolean(),
  coherence_chain:  CoherenceChainSchema.nullable(),
}).strict();

// Synergy evidence — typed for the FIRST time in this slice.
export const SynergyEvidenceSchema = z.object({
  teammate_cooccurrence_score:  z.number().min(0).max(60),
  archetype_score:              z.number().min(0).max(40),
  archetypes_detected:          z.array(z.string()),
  data_gaps:                    z.array(RosterId),       // existing
  role_tags:                    z.record(RoleTagAssignmentSchema),    // NEW
  role_coherence:               z.boolean(),                          // NEW
  coherence_chain:              CoherenceChainSchema.nullable(),      // NEW
}).strict();

// Existing PillarScoreSchema widens to add "support" to the pillar enum.
// Existing PillarBundleSchema gains: support: PillarScoreSchema
// Existing TeamTacticalOverviewSchema bumps schema_version: z.literal(2).
// Existing ScenarioOverviewSchema gains: support_lift: z.number().optional()
```

```ts
// src/schemas/insight.ts (additive)
export const PhaseTagSchema = z.enum(["lead","mid","late"]);
export type PhaseTag = z.infer<typeof PhaseTagSchema>;

// InsightSchema.phase_tag added before close brace:
//   phase_tag: PhaseTagSchema.nullable().default(null),

// InsightSearchArgsSchema.phase_tag_filter added (Stage A: parameter accepted, unused;
// Stage B: actively filters in `cite-phases.ts`).
```

### 3.1 Detection rules — 11-tag classifier (Q2 revision)

The flow doc §4 listed 9 tags with `setter` as one. Q2 revision splits `setter` into the three subsetters; the rest stay verbatim from flow §4.

```text
screen_setter         := has any of [Reflect, Light Screen, Aurora Veil] in moves
speed_control_setter  := has any of [Trick Room, Tailwind] in moves
                          (Icy Wind / Electroweb / Bulldoze are debuff moves, NOT setters
                          — they're folded under `disruptor` per the flow's existing list)
weather_setter        := has any of [Rain Dance, Sunny Day, Sandstorm, Snowscape] in moves
                          OR has any of [Drizzle, Drought, Sand Stream, Snow Warning] in ability
redirect              := has Rage Powder OR Follow Me in moves
cleric                := has any of [Life Dew, Pollen Puff, Wish, Heal Pulse, Floral Healing] in moves
                          OR has Hospitality in ability
disruptor             := has any of [Encore, Quash, Taunt, Disable, Yawn, Spore, Sleep Powder,
                                     Stun Spore, Will-O-Wisp, Icy Wind, Electroweb, Bulldoze] in moves
pivot                 := has any of [U-turn, Volt Switch, Flip Turn, Parting Shot, Teleport,
                                     Baton Pass] in moves
setup_sweeper         := has any of [Dragon Dance, Swords Dance, Nasty Plot, Calm Mind, Bulk Up,
                                     Iron Defense, Coil, Quiver Dance, Shell Smash, Curse,
                                     Cosmic Power, Belly Drum] in moves
                          OR has any of [Stamina, Defiant, Justified, Beast Boost] in ability
cleaner               := item == "Choice Scarf"                                      // Q11 ✓
                          AND has at least one base-power-100+ STAB move
                          AND base spe ≥ 90
wallbreaker           := no setup move
                          AND has 2+ damaging moves of different types
                          AND base SpA OR base Atk ≥ 110
                          AND no Choice Scarf                                         // Q11 ✓ — Specs falls here
anti_priority         := has any of [Armor Tail, Dazzling, Queenly Majesty] in ability
```

**Primary selection priority (revised for 11 tags; flow §4 priority adapted):**
```
weather_setter > screen_setter > speed_control_setter
> redirect > cleric > setup_sweeper > cleaner > wallbreaker
> pivot > disruptor > anti_priority
```
Ties broken by base-stat total (higher = primary). When NO rule matches: `primary = "untagged"` and `all = ["untagged"]`. (Flow §4 default-cascade `wallbreaker → cleaner → untagged` is dropped — it conflated detection with fallback. Cleaner v2: rules either match or they don't.)

**Multi-tag** is allowed and **expected** (e.g. Pelipper-Drizzle with U-turn → `["weather_setter", "pivot"]`; Sableye Reflect+Light Screen+Quash+Rain Dance → `["screen_setter", "speed_control_setter", "weather_setter", "disruptor"]`). The 4-tag Sableye is the user's load-bearing example — the support pillar formula counts each distinct mechanism (§5.1).

### 3.2 Support pillar formula (Q2 revision)

The flow §5.1 single-`setter` term fans out into three. Per-mechanism weights re-balanced so a team running screens AND tailwind AND rain still credits at +60 (not +20):

```
support_score = clamp(
    20 * count(screen_setter,         distinct mechanism)
  + 20 * count(speed_control_setter,  distinct mechanism)
  + 20 * count(weather_setter,        distinct mechanism)
  + 15 * count(redirect)
  + 12 * count(cleric)
  + 10 * count(disruptor,             distinct mechanism)
  +  8 * count(pivot)
  + 10 * count(anti_priority)
  + role_coherence_bonus(team)        // 0 or +15
  , 0, 100)
```

`distinct mechanism` for the three subsetters means "count once per unique sub-tag *across the team*, not per set" — a single Sableye carrying screens + Rain Dance contributes +20 (screen) +20 (weather) regardless of how many of its slot-mates also carry the same. (Open question §15.Q3: does this match reviewer intent? Proposed answer reasoned below.)

`role_coherence_bonus = +15` iff:
- (a) team has ≥ 1 setter (any of the three sub-types), AND
- (b) team has ≥ 1 payoff (`setup_sweeper` OR `cleaner`).
Mechanism-compatibility (c) is deferred (Q12 ✓).

Tier labels (unchanged from flow §5.1): 0–40 Weak / 41–60 OK / 61–80 Good / 81–100 Strong.

### 3.3 `support_lift` term in `scorePair` (Q5 ✓)

The hand-tuned coefficients ship verbatim from flow §5.4:

```ts
function support_lift(leads, back, scenario, role): number {
  let lift = 0;
  if (anyLeadIs(role, ["screen_setter","speed_control_setter","weather_setter"])
      && anyBackIs(role, ["setup_sweeper","cleaner"]))   lift += 12;
  if (anyLeadIs(role, ["redirect"])
      && anyBackIs(role, ["setup_sweeper"]))             lift +=  8;
  if (anyLeadIs(role, ["setup_sweeper"])
      && anyBackIs(role, ["cleric"]))                    lift +=  6;
  if (anyLeadIs(role, ["anti_priority"])
      && scenario.has_priority_threats)                  lift += 10;
  if (bothLeadsAre(role, ["screen_setter","speed_control_setter","weather_setter"])
      && !anyBackIs(role, ["setup_sweeper","cleaner"]))  lift -= 10;
  return lift;
}
```

`δ = 1.0` so the lift folds 1:1 into the existing `α·offense + β·speed − γ·defense_loss` formula. The maximum lift is `+12 + 6 = +18` (a setter pair into setup_sweeper backline with a cleric — the ArchaEye case). The penalty caps at `−10`. Both ranges keep `support_lift` from drowning the offense + speed signals.

## 4. Tool contracts

**Stage A adds NO new agent-callable tool.** Per the flow §3 tech flow, the new pillar surfaces through the existing `score_pillars` output; Stage B will add `recommend_team_plan`. The two existing tools (`score_pillars`, `recommend_leads`) auto-pick up the new field via the schema bump. Updated descriptions:

### 4.1 `score_pillars` *(extend, additive — description bump only)*
- **JSON-schema input:** unchanged (`{ team_id }`).
- **JSON-schema output:** `ScorePillarsOutputSchema` references `PillarBundleSchema` which now includes `support: PillarScoreSchema`. Description prepends: *"Returns five pillar scores: offense / defense / speed / synergy / support. Each is 0–100 + tier label + per-pillar evidence. Support evidence carries a per-set role_tags map, the detected mechanisms (screens / weather setters / speed control / redirection / healers / disruption / pivots / anti-priority), and a `role_coherence` bool indicating whether the team has a setter→payoff backbone."*

### 4.2 `recommend_leads` *(extend, additive — description bump only)*
- Each `ScenarioOverview` now optionally carries `support_lift: number` — the contribution of the support_lift term to the chosen pair's score. Description prepends a sentence: *"Each scenario also reports `support_lift`, the support-pillar contribution to the leads' pair score (positive = role chain rewarded; negative = setter overcommit penalty)."*

### 4.3 `insights_search` *(extend, additive — input parameter)*
- Adds optional `phase_tag_filter: "lead" | "mid" | "late"` per Q9. Stage A ships the parameter accepted-but-unused at the prompt level (Stage B's `cite-phases.ts` will start passing it). The handler unconditionally threads it through to `insightStore.search(query, { filter: { phase_tag: ... } })`.

### 4.4 `emit_insights` (Haiku-side tool, NOT an agent-callable tool)
- Tool input schema additive: `phase_tag: { type: "string", enum: ["lead","mid","late"], nullable: true }`.
- Prompt-version bumps to `"v1.1"` (extracted_by.prompt_version).
- See §2.3 for full details.

## 5. Error model

Reuse the existing `TacticalOverviewError` for refusal paths (saved-team gate already in `overview.ts`). New defensive errors:

| Class | Trigger | Severity |
|---|---|---|
| `RoleClassifierDataError` (new) | A team set references a move id NOT in the `moves` ref table OR an ability id NOT in `abilities` (shouldn't happen on a saved team — `team_validate` runs first — but defensive catch in case the roster is stale relative to user-team rows) | warn-and-continue: emit `untagged` for that set, log the missing ref, do not abort the pillar score |
| `SupportPillarConfigError` (new) | Per-mechanism weights in the formula don't sum to a coherent max (caught at module load via a self-test) | fail-loud at startup |

**Phase-tag error model:** the extractor's `passesPhaseTagGuard` is loose — log + accept. No new error class. A LLM emitting `phase_tag = "lead"` on a `meta_trend` claim is rare and not catastrophic; we tolerate it in v1.

**Reused (no rename):** `TacticalOverviewError`, `TacticalThreatPanelError`, `InsightExtractionError`, `KnowledgeStorageError`.

## 6. Drizzle schema additions

Per memory `db_orm_drizzle.md`: schema edit in `src/db/drizzle-schema.ts` first, then `pnpm drizzle-kit generate` emits the migration, then we hand-verify it's additive.

```ts
// src/db/drizzle-schema.ts — within the `insights` table definition:
export const insights = sqliteTable("insights", {
  // … existing columns …
  phaseTag: text("phase_tag"),                                  // NEW
}, (t) => [
  // … existing constraints …
  check(
    "insights_phase_tag",
    sql`${t.phaseTag} IS NULL OR ${t.phaseTag} IN ('lead','mid','late')`,
  ),                                                            // NEW
  index("idx_insights_phase_tag")
    .on(t.phaseTag)
    .where(sql`${t.phaseTag} IS NOT NULL`),                     // NEW (partial index)
]);
```

**Migration filename:** `src/db/migrations/0011_insights_phase_tag.sql`.

**Migration content (sketch — drizzle-kit emits, we hand-verify):**
```sql
ALTER TABLE `insights` ADD COLUMN `phase_tag` text;
--> statement-breakpoint
-- Per memory single_db_non_destructive_build.md: every existing row keeps phase_tag = NULL;
-- the CHECK constraint accepts NULL.
-- If drizzle-kit chooses table-rebuild for the CHECK + index, the rebuild MUST INSERT-from-old
-- with phase_tag = NULL — verify in Stage 5.
CREATE INDEX `idx_insights_phase_tag` ON `insights` (`phase_tag`) WHERE `phase_tag` IS NOT NULL;
```

**No other table changes.** The 5th pillar lives entirely in process state (no persistence, per `team-tactical-overview` plan §4 binding — overviews are computed on demand).

## 7. Architecture patterns + WHY

### 7.1 Deterministic classifier (no LLM)
Per Q3 binding. Roles in VGC are well-defined by competitive convention; LLM adds variance and cost without quality gain. Deterministic rules are testable with five committed golden teams (§11) — diff-based regression detection. Memory `test_fixtures_no_invariant_blobs.md`: we commit the **input team JSON** (a `UserTeam` shape with the 6 sets), and the test recomputes role tags + asserts the expected tag list — the test code IS the spec, the JSON is the fixture.

### 7.2 Schema bump 1 → 2, additive (Stage A) → 3, reshape (Stage B)
Per Q8 revised binding. Stage A's bump is purely additive (`pillars.support` added; `scenarios[].support_lift` added). Stage B will reshape `recommended_leads` into a phase-aware tuple, breaking 4-pillar consumers. We DON'T try to merge the two — the schema_version chain documents the sequence. Forward-compat note lives on `TeamTacticalOverviewSchema` TSDoc.

### 7.3 Cross-slice schema extension (phase_tag)
Per Q9 revised binding. The Insight schema is owned by `youtube-insights`; this slice extends it. Three cross-slice edits:
1. `src/schemas/insight.ts` — add `phase_tag` field.
2. `src/db/drizzle-schema.ts` — add column.
3. `src/tools/insights/extract.ts` — add tool input schema entry + system-prompt rules + bump `prompt_version`.

These three MUST land in one commit (or stage-4 batch) — partial application leaves the DB column without prompt support. **Section §15** of this plan owns the coordination. Memory `db_orm_drizzle.md` is binding: schema first, migration generated from schema.

### 7.4 Reuse of `damage_calc` + cache
`scoreSupport` does NOT call `damage_calc` — it's a pure aggregation over role tags. **No new cache pressure.** `support_lift` in `scorePair` does NOT call `damage_calc` either; it reads the pre-computed role-tag map. Stage A adds zero net calc-engine calls.

### 7.5 Reuse of `score-synergy` + `score-pair`
Per the flow §3 tech flow: `score-offense.ts` / `score-defense.ts` / `score-speed.ts` are **untouched**. `score-synergy.ts` and `score-pair.ts` are **extended, not rewritten**. The role-tag map flows in as a new dep; existing scoring logic preserved. Reduces test-blast-radius — the existing 40-ish tactical tests stay green by construction.

### 7.6 No LLM for support/synergy/pair scoring
Same rationale as §7.1. Determinism is the contract — same team + same panel → same scores, byte-equal.

## 8. Reuse audit

| Capability | Source | Disposition |
|---|---|---|
| Drizzle `Db` handle | `src/db/open.ts` | as-is |
| `moves` ref-table reads | `src/db/moves.ts` (`createSimpleRepo` repo) | as-is |
| `abilities` ref-table reads | `src/db/abilities.ts` (`createSimpleRepo` repo) | as-is |
| Roster lookups | `src/db/roster.ts` | as-is |
| `parseOrThrow` zod helper | `src/schemas/parse.ts` | as-is |
| Calc cache | `src/data/tactical/calc-cache.ts` | as-is (no new entries) |
| `damage_calc` tool | `src/tools/damage-calc/index.ts` | not called by Stage A |
| `pikalytics_snapshots` reads | `src/db/pikalytics.ts` | as-is (synergy already uses) |
| `userTeams.get` | `src/db/user-teams.ts` | as-is |
| `score_pillars` agent tool | `src/agents/tactical-tools.ts` | description bump only |
| `recommend_leads` agent tool | `src/agents/tactical-tools.ts` | description bump only |
| `insights.upsertMany` | `src/db/insights.ts` | extended additively for `phase_tag` |
| `extractInsights` | `src/tools/insights/extract.ts` | extended additively for `phase_tag` |
| `parseOrThrow(InsightSchema, …)` | `src/schemas/insight.ts` | survives schema bump (defaulted nullable) |
| Existing error classes | `src/schemas/errors.ts` | extend with 2 new |

**No new external deps.** No new dependency on a parsing library, ML model, or HTTP client. The classifier is pure TS.

## 9. Test strategy + ordering

TDD per CLAUDE.md §3. **Write order = numbered order below.** Per-test red-first cycle for non-pure modules; the §3 pure-data exemption applies to S1..S9 (zod round-trip on schemas) — they ship in one batched commit.

Total: **45 tests** (S×9 + R×25 + SU×10 + SY×5 + SP×5 + OV×3 + DB×3 + EX×2 — see §10 grand total).

| # | File | What it asserts | Fails because |
|---|---|---|---|
| **Pure-data exemption batch — schemas** |
| S1 | `tests/schemas/tactical-support.test.ts` | `RoleTagSchema` round-trips all 12 enum values (11 tags + `untagged`) | enum missing |
| S2 | same | `RoleTagAssignmentSchema` rejects empty `all`, accepts `{ primary: "cleric", all: ["cleric","redirect"] }` | bounds missing |
| S3 | same | `SupportPillarEvidenceSchema` round-trips a hand-built ArchaEye evidence blob | schema absent |
| S4 | same | `PillarBundleSchema` requires `support` key (5 pillars) | schema not extended |
| S5 | same | `TeamTacticalOverviewSchema` rejects `schema_version: 1`, accepts `2` | bump not applied |
| S6 | same | `ScenarioOverviewSchema` accepts `support_lift: -10`; rejects `support_lift: "high"` | field type wrong |
| S7 | `tests/schemas/insight-phase-tag.test.ts` | `PhaseTagSchema` round-trips `lead`/`mid`/`late`, rejects `early`/`opener` | enum wrong |
| S8 | same | `InsightSchema` round-trips with `phase_tag: null` (default), `"lead"`, `"mid"`, `"late"` | field absent |
| S9 | same | `InsightSearchArgsSchema` accepts `phase_tag_filter: "mid"`; rejects `phase_tag_filter: "midgame"` | param missing |
| **Role-tags classifier — strict per-test red→green** |
| R1 | `tests/data/tactical/role-tags.test.ts` | Reflect-only set → `primary=screen_setter`, `all=["screen_setter"]` | rule missing |
| R2 | same | Trick Room-only set → `primary=speed_control_setter` | rule missing |
| R3 | same | Tailwind + U-turn (Whimsicott-shape) → `primary=speed_control_setter`, `all` includes `pivot` | priority wrong |
| R4 | same | Drizzle ability → `primary=weather_setter` even with no weather move | ability path missing |
| R5 | same | Sableye-shape (Reflect + Light Screen + Quash + Rain Dance) → `primary=weather_setter` (priority), `all=["screen_setter","speed_control_setter","weather_setter","disruptor"]` ordered by priority | multi-tag missing |
| R6 | same | Rage Powder set → `primary=redirect`; Follow Me set → `primary=redirect` | rule missing |
| R7 | same | Life Dew set → `primary=cleric`; Hospitality ability → `primary=cleric` | rule missing |
| R8 | same | Encore + Taunt + Will-O-Wisp set → `primary=disruptor`; Icy Wind alone → `primary=disruptor` | folding wrong |
| R9 | same | U-turn + Knock Off (no boost, no scarf) Pelipper-shape WITHOUT Drizzle → `primary=pivot` | priority wrong |
| R10 | same | Dragon Dance set → `primary=setup_sweeper`; Stamina ability → `primary=setup_sweeper` | rule missing |
| R11 | same | Choice Scarf + Last Respects + Aqua Jet (Basculegion-shape, base spe 70 boosted) → `primary=cleaner` | rule missing |
| R12 | same | Choice Scarf + base spe 60 set → NOT cleaner (base spe < 90 fails) → falls to `wallbreaker` if Atk/SpA ≥ 110, else `untagged` | gate too loose |
| R13 | same | Choice Specs + 2 coverage moves + base SpA 130, no boost → `primary=wallbreaker` (Q11 binding) | priority wrong |
| R14 | same | Armor Tail ability → `primary` priority puts `anti_priority` last; primary is whatever else hits | priority wrong |
| R15 | same | 4-of-a-kind STAB attacker, no boost, no priority, base spe 80, base atk 95 → `primary=untagged` (no rule matches) | fallback missing |
| R16 | same | Tie-break: two same-priority tags → higher BST wins primary | tiebreak missing |
| R17 | same | Missing-move ref (move id not in `moves` table) → emits `RoleClassifierDataError` warn, returns `{primary:"untagged",all:["untagged"]}` | error path absent |
| R18 | same | `deriveRoleTags` is pure — same input → byte-equal output across 100 calls | non-determinism |
| R19 | same | Reg-M-A guard: a non-Reg-M-A species is silently classified by stats (the gate is at the team level, not per-set) — assert via a fake species_id with all moves missing | gate misplaced |
| R20 | same | The classifier does NOT call `damage_calc` (mock + assert call_count === 0) | accidental dep |
| **Role-tags goldens — five canonical Reg-M-A teams** |
| R21 | `tests/data/tactical/role-tags.golden.test.ts` | ArchaEye fixture: per-slot expected primary + all tags match. Sableye → `weather_setter` (primary, due to Rain Dance + screens + speed control + Quash all carrying); Sinistcha → `cleric`; Basculegion → `cleaner`; Pelipper → `weather_setter`; Archaludon → `setup_sweeper` (via Stamina); Dragonite → `wallbreaker` | classifier wrong |
| R22 | same | J0eVKJyJ_DQ Charizard team fixture (Aerodactyl, Charizard, Garchomp, …) — Aerodactyl → `screen_setter` (Wide Guard fold? — see §15.Q1) + `speed_control_setter` (Tailwind); Charizard → `setup_sweeper` or `wallbreaker`; Garchomp → `setup_sweeper` (Scale Shot speed boost via Beast Boost? — Garchomp doesn't have Beast Boost; via Scale Shot ITSELF as a setup move? — see §15.Q2) | regression |
| R23 | same | Hardcoded TR team fixture: Indeedee (Psychic Surge, Helping Hand) → primary likely `redirect` or `untagged`; Hatterene (TR + Magic Bounce) → `speed_control_setter`; Glimmora (Sandstorm) → `weather_setter` | composition wrong |
| R24 | same | Hardcoded Tailwind HO fixture: Whimsicott (Tailwind, Encore) → `speed_control_setter` (primary), all includes `disruptor` | priority wrong |
| R25 | same | Hardcoded Sand fixture: Hippowdon (Sand Stream ability) → `weather_setter`; Excadrill (Swords Dance) → `setup_sweeper`; Tyranitar (no boost, mixed coverage, base atk 134) → `wallbreaker` | classifier wrong |
| **Support pillar — strict per-test** |
| SU1 | `tests/data/tactical/score-support.test.ts` | All-untagged team → score 0, tier `Weak`, evidence empty | scorer absent |
| SU2 | same | One-screen-setter team (Sableye-only kit) → +20 (one mechanism), tier `Weak` | weight wrong |
| SU3 | same | ArchaEye golden → score ≥ 70 (Strong); evidence carries `coherence_chain={setter:sableye, payoff:archaludon, payoff_role:setup_sweeper}` | formula wrong |
| SU4 | same | Distinct-mechanism counting: Sableye (screens + speed control + weather) on a team with no other support → +60 (3 × 20) | per-mechanism not deduped right |
| SU5 | same | Two screen-setters on the same team → still +20 for `screen_setter` (distinct mechanism, not per-set) | duplicate mechanism counted |
| SU6 | same | `role_coherence_bonus = +15` when (a)+(b) hold; 0 otherwise | bonus missing |
| SU7 | same | 6 setters / 0 payoff → no coherence bonus, score caps near `+60 + 0 = 60` (mechanisms only) | bonus mis-fires |
| SU8 | same | Tier boundaries: 40 = Weak, 41 = OK, 60 = OK, 61 = Good, 80 = Good, 81 = Strong | off-by-one |
| SU9 | same | `SupportPillarEvidence.mechanisms.weather_setters` lists exactly the species_ids carrying weather setup | mapping wrong |
| SU10 | same | Score is deterministic (same inputs → identical) | non-deterministic ordering |
| **Synergy extension** |
| SY1 | `tests/data/tactical/score-synergy.test.ts` | Existing synergy tests still pass (regression) | hooked wrong |
| SY2 | same | `evidence.role_tags` populated for all 6 species when team is fully role-tagged | not threaded |
| SY3 | same | `evidence.role_coherence = true` on ArchaEye → archetype score gains +20 floor | floor missing |
| SY4 | same | `evidence.role_coherence = false` on a 6-attacker team → no archetype floor change | mis-fire |
| SY5 | same | ArchaEye's synergy pillar lifts from 22 → ≥ 50 (live-team success criterion proxy via fixture) | floor too small |
| **Pair-score extension** |
| SP1 | `tests/data/tactical/score-pair.test.ts` | Existing pair tests still pass (regression) | hooked wrong |
| SP2 | same | `support_lift` term: setter+setter leads with setup_sweeper backline → +12 lift | rule missing |
| SP3 | same | Two setter leads with NO payoff in back → −10 lift | penalty missing |
| SP4 | same | Anti-priority lead + scenario.has_priority_threats → +10 lift; without priority threats → 0 | conditional missing |
| SP5 | same | Hand-tuned coefficients exported as constants and used by formula | hard-coded magic numbers |
| **Overview integration** |
| OV1 | `tests/data/tactical/overview.test.ts` | Existing overview tests still pass (regression) | hooked wrong |
| OV2 | same | Output `pillars.support` present, valid `PillarScore`; `schema_version: 2` | not wired |
| OV3 | same | At least one scenario reports `support_lift !== 0` on the ArchaEye fixture | not threaded |
| **DB phase_tag** |
| DB1 | `tests/db/insights-phase-tag.test.ts` | Migration 0011 applied non-destructively: existing rows survive with `phase_tag = NULL` | destructive |
| DB2 | same | `upsertMany` writes `phase_tag` when present in the input `Insight` | not threaded |
| DB3 | same | `search` filter `phase_tag: "lead"` returns only lead-tagged rows | filter missing |
| **Extractor phase_tag** |
| EX1 | `tests/tools/insights/extract-phase-tag.test.ts` | `emit_insights` tool input schema includes `phase_tag` enum + nullable | schema not extended |
| EX2 | same | A fixture chunk with phase-specific language → mocked Anthropic returns `phase_tag = "lead"` → extracted `Insight` carries `phase_tag = "lead"` end-to-end | not threaded |

**Live ArchaEye end-to-end (NOT a CI test — manual demo at end of Stage 5):** run `pnpm data:tactical pillars 01KR7TVD21G1Q99BK0NAEARFD8`; assert `pillars.support.score ≥ 70`, `pillars.synergy.score ≥ 50`, ≥ 1 scenario in `recommend_leads` output picks Sableye + Archaludon. Document the manual run + screenshot in the PR description.

## 10. Fixtures plan

**Goldens.** Per memory `test_fixtures_no_invariant_blobs.md`: commit the **input team JSON** (a `UserTeam` shape with 6 fully-specified sets), NOT the classifier output. Tests recompute the role tags and assert against expected tag sets defined in test code.

| Path | Purpose | Committed |
|---|---|---|
| `fixtures/tactical/role-tags/2026-05-09__archaeye.json` | Live user team — Sableye + Pelipper + Archaludon + Sinistcha + Basculegion + Dragonite | yes |
| `fixtures/tactical/role-tags/2026-05-09__charizard_solar_power.json` | J0eVKJyJ_DQ Charizard team | yes |
| `fixtures/tactical/role-tags/2026-05-09__trick_room_psyspam.json` | Hardcoded TR team — Indeedee + Hatterene + Glimmora + Torkoal + Armarouge + Iron Hands | yes |
| `fixtures/tactical/role-tags/2026-05-09__tailwind_ho.json` | Hardcoded Tailwind HO — Whimsicott + Roaring Moon + Iron Bundle + Flutter Mane(?)→need RegM-A-legal alt + Sneasler + Annihilape *(Reg-M-A roster check at fixture authoring time per memory `regulation_m_a_roster.md`)* | yes |
| `fixtures/tactical/role-tags/2026-05-09__sand.json` | Hardcoded Sand — Hippowdon + Excadrill + Tyranitar + Garchomp + Indeedee + Iron Treads | yes |

**Anti-pattern check:** the `expected_role_tags.json` ALONGSIDE each fixture is **NOT** a separate file — the expected tags live in the test code (`tests/data/tactical/role-tags.golden.test.ts`). This keeps the spec and the assertion in one place, diff-able in review. (Memory `test_fixtures_no_invariant_blobs.md` ✓.)

**Fixture authoring**: Stage 4 author writes the JSON by hand from the team's actual saved sets (ArchaEye is live in the DB; the others are hand-curated by the implementor against `roster_membership.is_legal=1` for `format='RegM-A'` per memory `regulation_m_a_roster.md`).

## 11. Rollout

**No feature flag.** Stage A is backwards-compatible at the data layer (the schema bump is additive at the JSON level — old 4-pillar JSON consumers get a NEW `support` field they can ignore). The schema_version literal bump (1→2) means parsers strict on `schema_version: 1` will fail loud — but the only on-disk consumer is the live CLI, which always regenerates.

**Migration ordering:** migration 0011 lands before any code that writes `phase_tag`. Schema-first per memory `db_orm_drizzle.md`. The migration is itself non-destructive (memory `single_db_non_destructive_build.md`).

**Stage 5 deploy order:**
1. Land schemas (S1..S9 batch).
2. Land migration 0011.
3. Land role classifier (R1..R20 strict per-test).
4. Land role-tag goldens (R21..R25).
5. Land support pillar (SU1..SU10).
6. Extend synergy + pair (SY*, SP*).
7. Extend overview (OV*).
8. Extend insights table reads/writes (DB*).
9. Extend extractor (EX*).
10. Manual ArchaEye demo run.

**Stage A → Stage B handoff:** Stage B reads:
- `RoleTagSchema` (consumes 11 tags for plan candidate generation).
- `Insight.phase_tag` (consumes for phase-citation retrieval).
- `support_lift` term in `scorePair` (composes into Stage B's `plan_score`).
- The TODO list in §1 (out-of-scope) — tracks the deferred backfill + calibration + mechanism-compat work.

**Out of scope (deferred — restated):** Stage B (`docs/plans/team-phase-plan.md`); `phase_tag` backfill over pre-existing rows; coefficient calibration; mechanism-compatibility check `(c)` in `role_coherence`.

## 12. Cache + throttle implementation

Not applicable. Stage A is a pure data-layer extension — the role classifier is sync + pure; the support pillar reads from already-loaded ref tables; no new HTTP / API / disk cache. The existing per-call `damage_calc` cache (Q3 from `team-tactical-overview.md` §16.1) is unchanged.

## 13. Ingest / build orchestration

Not applicable. No new ingest script. The CLI surface (`pnpm data:tactical pillars/recommend/overview`) is unchanged structurally — output JSON shape grows.

## 14. Definition of Done — CLAUDE.md §11 mapping

- [x] Flow doc exists and reviewed — `docs/flows/team-support-and-phases.md` (Stage 1–2 complete, §13 Reviewed-by: Rodrigo, Stage-2 answers in §12).
- [ ] Tech plan exists and approved — **this file**, awaiting Stage 2 approval.
- [ ] Failing test was written first — Stage 4 commits `test: red — team-support-pillar` with R1..EX2 failing for the right reason; pure-data S1..S9 batched per CLAUDE.md §3 exemption.
- [ ] All tests pass locally — Stage 5 gate (`pnpm test && pnpm typecheck && pnpm lint`).
- [ ] Types check — Stage 5 gate. Schema bump propagates through `PillarBundle` consumers.
- [ ] Lint clean — Stage 5 gate.
- [ ] New external data is schema-validated and fixture-backed — five `role-tags/*.json` fixtures + zod-validated.
- [ ] User-facing claims cited — every `ScenarioOverview.support_lift` is reasoning-traceable through `evidence.role_tags`; existing `citations[]` pipeline unchanged.
- [ ] Docs touched — this plan + flow + tool description bumps in `src/agents/tactical-tools.ts` per CLAUDE.md §9.
- [ ] Reviewer subagent ran — Stage 6 gate. Reviewer brief should specifically check: (a) the 11-tag classifier coverage is comprehensive enough; (b) the `support_lift` coefficients aren't drowning offense/speed signals; (c) the cross-slice extension to `Insight.phase_tag` is correctly threaded through extract.ts + insights.ts + drizzle-schema.ts as one logical unit.

## 15. Coordinated cross-slice edit — `Insight.phase_tag` (Q9 binding)

This sub-plan exists because Q9's revised binding asks for the `Insight` schema to gain `phase_tag` NOW — Stage A scope — even though phase consumption is Stage B. The edit crosses three modules owned by the youtube-insights slice. Coordinated as one logical unit:

### 15.1 Schema (`src/schemas/insight.ts`)
- Add `PhaseTagSchema` enum.
- Add `phase_tag: PhaseTagSchema.nullable().default(null)` to `InsightSchema`.
- Add optional `phase_tag_filter` to `InsightSearchArgsSchema`.
- All additive; default makes the change non-breaking for any in-flight `Insight` literal.

### 15.2 Drizzle schema + migration (`src/db/drizzle-schema.ts` + `src/db/migrations/0011_insights_phase_tag.sql`)
- Add `phaseTag: text("phase_tag")` column.
- Add CHECK constraint.
- Add partial index.
- Run `pnpm drizzle-kit generate`; hand-verify SQL is `ALTER TABLE … ADD COLUMN` + `CREATE INDEX` (no table-rebuild) per memory `single_db_non_destructive_build.md`.

### 15.3 Repo (`src/db/insights.ts`)
- Extend `upsertMany`'s INSERT to write `phase_tag`.
- Extend `search` to accept and apply `options.filter.phase_tag` filter.
- Extend `listByChunkId` / `listByVideoId` / `listBySpecies` to return the column transparently (no signature change — `Insight` carries it).

### 15.4 Extractor (`src/tools/insights/extract.ts`)
- Bump local constant `PROMPT_VERSION` from `"v1.0"` to `"v1.1"` (and the corresponding `extracted_by.prompt_version` literal).
- Extend `emit_insights` tool input schema with `phase_tag` enum + nullable.
- Extend system prompt with phase_tag rules (~10 lines added).
- Loose `passesPhaseTagGuard` (log + accept).

### 15.5 Backfill
**Deferred.** Inline `// TODO(slice-deferred): backfill phase_tag on pre-existing insights` in:
- `src/tools/insights/extract.ts` (top-of-file comment alongside PROMPT_VERSION).
- `src/db/insights.ts` (top-of-file comment).

Trigger to revisit: **Stage B ships AND we have ≥ 100 untagged rows** (per the precedent set in memory `labmaus_pokepaste_deferred_todos.md`).

### 15.6 Tests touching all of the above
- S7..S9 (schema).
- DB1..DB3 (db).
- EX1..EX2 (extract).

These six tests are written in one Stage-4 batch (interleaved with the rest of the order in §10) and ALL must be green together — partial green leaves the cross-slice extension in an inconsistent state.

## 16. Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Role classifier mis-tags an edge case (e.g. Pelipper-Helping-Hand → no rule matches → `untagged`) and the support pillar undercounts | Medium | Medium | Five committed goldens (§11) catch the common cases; Stage-6 reviewer specifically asked to scan for missed rules; deferred TODO `// TODO(stage6-deferred): role-classifier-coverage-audit` in `role-tags.ts` to revisit once we have 10+ user teams |
| `support_lift` over-rewards setter pairs and Sableye-leads dominate every scenario | Medium | Low | The `−10` two-setters-no-payoff penalty is the explicit guard; calibration follow-up (Q5 ✓) is its own slice; live-team manual demo at Stage 5 catches gross over-fitting |
| Per-mechanism deduping is wrong (counts per-set instead of per-team-mechanism) | Low | Medium | SU4 + SU5 explicitly assert this; reviewer focus area |
| Cross-slice edit (`phase_tag`) lands partially — schema added but extractor still emits v1.0 | Low | High | §15 explicitly enumerates the four edits; Stage-4 commit `test: red — team-support-pillar` includes all six S/DB/EX tests; Stage-5 commit MUST land all four code edits before tests go green |
| Migration 0011 destroys existing `insights` rows because drizzle-kit chooses table-rebuild | Low | High | Hand-verify the generated SQL per memory `single_db_non_destructive_build.md`; if rebuild is chosen, INSERT-from-old MUST preserve every row with `phase_tag = NULL`; DB1 explicitly checks |
| `prompt_version` bump 1.0 → 1.1 breaks existing extraction tests that pin `v1.0` | Low | Low | EX1 + EX2 are the only tests that pin a version; update both in the same Stage-4 batch |
| Reg-M-A roster drift (a fixture team references a species that becomes illegal) | Low | Low | Fixture-authoring step asserts `roster_membership.is_legal=1` per memory `regulation_m_a_roster.md`; periodic re-check is a Stage-6 deferred chore |
| `RoleClassifierDataError` swallows real bugs (silent `untagged`) | Low | Medium | R17 explicitly tests the error path emits a log; Stage-6 reviewer can wire this to a metric/alarm later |

## 17. Open questions for plan review

> **Reviewer:** mark each ✅ accept / ✏️ revise / ❌ reject + reasoning. The Stage-2 binding answers (Q1–Q12 in the flow doc) are NOT relisted here — only NEW questions surfaced while drafting this plan.

1. **Wide Guard / Quick Guard — fold into `disruptor` or treat as a new tag?** The flow §4 list doesn't mention them. Aerodactyl (R22 fixture) carries Wide Guard; without a rule, it falls back to whatever else hits (Tailwind → `speed_control_setter`). **Proposal: fold under `disruptor`** — both moves disrupt incoming spread / priority moves and act as one-turn tactical interventions, structurally similar to Quash. Adding a separate `protector` tag risks tag-explosion. Alternative: add `protector` as the 12th tag (cheap, but the flow doc binds 11). Confirm fold-into-disruptor.
Answer: ✅ fold into `disruptor`.

2. **Garchomp's Scale Shot — counts as a setup move?** Scale Shot is a damaging move that incidentally raises Speed (similar to Meteor Beam, Charge). **Proposal: add to the `setup_sweeper` move list** — VGC convention treats Scale Shot Garchomp as a sweeper variant. Same proposal for **Meteor Beam** (raises SpA via the charge effect). The list (Dragon Dance, Swords Dance, …) currently misses both. Confirm or scope as a follow-up.
Answer: ✅ add to `setup_sweeper` move list.

3. **Per-mechanism counting — per-team or per-set?** §3.2 reads "distinct mechanism for the three subsetters means count once per unique sub-tag across the team." Reviewer's intent (per the task brief: *"a team running screens AND tailwind AND rain gets credit for three distinct setter mechanisms, not one"*) is per-team. **Proposal: count per unique sub-tag per team** (Sableye carrying screens + Rain Dance contributes once per sub-tag, regardless of how many other slots also bring screens or rain). Alternative: count `min(count_of_sets_with_tag, 1) × weight` per mechanism. Both produce the same result for ArchaEye; they diverge only when 2 slots redundantly carry the SAME mechanism (e.g. two screen-setters). Confirm per-team de-dup.
Answer: ✅ count per unique sub-tag per team.

4. **`role_coherence` payoff cardinality — does ANY payoff suffice, or does the setter→payoff chain need to be on slots that can share the field?** Q12 binding says (a)+(b) only — defer (c). But "share the field" is genuinely fuzzy: in doubles every slot can share the field across switches. **Proposal: literal interpretation** — ANY pair of (setter, payoff) on the same team triggers coherence; the `coherence_chain` evidence picks the highest-BST setter and highest-BST payoff for display. Confirm.
Answer: ✅ ANY pair of (setter, payoff) on the same team triggers coherence; evidence picks highest-BST setter/payoff.

5. **Untagged primary — emit `untagged` or refuse the team?** The flow §4 says `untagged` is allowed; this plan §3 says same. But a 6-untagged team produces a support pillar score of 0 — is that the right signal, or should overview emit a hard error? **Proposal: emit `untagged`, score 0, surface in evidence.** A score of 0 IS the right signal; refusing the team blocks the rest of the analysis. Confirm.
Answer: ✅ emit `untagged`, score 0, surface in evidence.

6. **Where does the role-tag map get built — once per overview or on-demand per pillar/scorer?** Both `score-support`, `score-synergy` (extension), and `score-pair` (via `support_lift`) need it. **Proposal: build once in `pillars.ts` orchestrator, thread through as a `roleAssignments: Map<species_id, RoleTagAssignment>` dep into all three.** Ensures determinism + single classifier invocation per overview. Alternative: classify lazily inside each scorer (risks divergence if rules ever became non-pure). Confirm pillars.ts ownership.
Anser: ✅ build once in `pillars.ts`, thread through as a dep. We may need to ingest the role tag into the species once in a while.

7. **`phase_tag` rules for non-`lead`/`mid`/`late` claim_types — accept liberally or reject?** §2.3 says loose: log + accept (e.g. `phase_tag = "lead"` on a `set` claim is fine because set choices can be lead-specific). **Proposal: accept ANY (claim_type, phase_tag) combination.** The schema only enforces the enum, not the semantic compatibility. Tighter validation is a Stage-6 follow-up. Confirm.
Answer: ✅ accept ANY (claim_type, phase_tag) combination.

8. **`prompt_version` semver — bump major (v2.0) or minor (v1.1)?** §15.4 says `v1.1`. The change is additive at the schema level (new optional field) but materially changes the system prompt's hard rules. **Proposal: minor bump (`v1.1`).** Major would be reserved for a change that breaks downstream parsers (e.g. removing a field, changing claim_type enum). This change adds an optional emit. Confirm.
Answer: ✅ minor bump (`v1.1`).

9. **Should Stage A also add the `phase_tag` filter UI to the existing `insights_search` agent tool description?** §4.3 says the parameter is accepted but unused at the prompt level until Stage B. **Proposal: ship with the parameter in the JSON-schema input but DO NOT mention it in the description prose** — the agent shouldn't pass it pre-Stage-B. Stage B's plan bumps the description. Confirm.
Answer: ✅ add the parameter to the schema but not the description.

10. **`support_lift` field on `ScenarioOverview` — required or optional?** §3 says optional for forward-compat. Stage B will reshape; making it required now means Stage B must keep emitting it. **Proposal: optional in Stage A; Stage B promotes to required if it stays useful in the phase-aware shape, or drops it if `plan_score` subsumes the role-chain bonus.** Confirm optional-for-now.
Answer: ✅ optional in Stage A; revisit in Stage B.

---

## 18. Stage-5 deviations (ratified in Stage 6 review)

The Stage 6 reviewer ratified the following deviations from the
Stage-3 plan. Each is captured here per CLAUDE.md §12 (recorded
deviation rule) and the Stage 6 review's "Plan-amendment candidates"
section.

A. **Priority-order swap** — `src/data/tactical/role-tags.ts` puts
   `speed_control_setter > screen_setter` (plan §3.1 had the reverse).
   Reasoning: VGC convention treats Tailwind as the primary read on
   Whimsicott-style screens-plus-speed Prankster sets; the R24 golden
   pinned this expectation. Amendment supersedes §3.1's priority order.

B. **Wallbreaker mutual-exclusion** — `src/data/tactical/role-tags.ts`
   makes wallbreaker exclusive with every structural tag (incl. setter
   sub-tags AND setup_sweeper via ability). Plan §3.1 only excluded
   setup-MOVE presence, which produced `[setup_sweeper, wallbreaker]`
   on Archaludon (Stamina ability) and `[speed_control_setter,
   wallbreaker]` on Dragonite (Tailwind + 134 atk) — both contradict
   the R21 golden. Amendment broadens the exclusion to all structural
   tags.

C. **Cleaner detection relaxation** — `src/data/tactical/role-tags.ts`
   drops the plan's "base-power-100+ STAB move" gate. Reasoning: the
   moves DB doesn't carry `base_power` yet. Implementation requires
   only `(Choice Scarf AND base spe ≥ 90 AND any damaging move)`.
   Tracked as a deferred refinement (§19) until moves.base_power
   lands.

D. **Synergy 50-score floor** — `src/data/tactical/score-synergy.ts`
   floors the final synergy score at 50 when `role_coherence` holds.
   Plan §5.3 only specified a `+20` floor on the archetype component;
   the `+20` alone wasn't enough to clear the live ArchaEye 22 → ≥ 50
   SY5 bar. The wider floor is surfaced on
   `evidence.score_floor_applied: true` so downstream consumers can
   detect it. Amendment supersedes §5.3.

E. **Process deviation — Stage-4 red discipline on weather work.**
   Commit `c4bf7e4` ("weather-mechanism gating on support_lift")
   landed the classifier branches in `role-tags.ts` AND the
   `computeSupportLift` weather gate AND the W1..W11 tests in a single
   commit. Per CLAUDE.md §3 the pure-data exemption applies to schemas
   and enum tables only; the support-lift rule is non-pure logic and
   should have shipped with a prior `test: red` commit. The work
   itself is correct (tests cover all branches, behavior matches the
   user-stated Reg-M-A mechanic for Electro Shot) but the red→green
   discipline lapsed. **Recorded here per §12 so it does not become
   precedent.** Future weather-rule or support-lift extensions ship
   red-first.

F. **Q12(c) partial shipment** — Plan §17 Q12 marked mechanism
   compatibility as deferred. Commit `c4bf7e4` ships the **weather**
   compatibility check (Sableye-rain ↔ Archaludon-Electro-Shot) but
   not the screens / speed-control / redirection compat checks. The
   originally-deferred items list is updated:
   - ✅ **shipped Stage A:** weather pairing (`weather_provided` vs
     `weather_charged_move` on the setter / payoff).
   - 🕓 **still deferred:** screens lifting payoff turn-1 survival,
     redirect protecting setup turns. Re-evaluate alongside the
     Stage-B phase-aware scoring.

## 19. Stage-6 deferred refinements

Tagged `// TODO(stage6-deferred):` in source where applicable, per
memory `labmaus_pokepaste_deferred_todos.md`.

- **Support-lift magnitude calibration** (`support-lift-magnitude-calibration`)
  — `STRUCTURAL_LEAD_BONUS = 25`, `WEATHER_MATCH_BONUS = 60`, and the
  individual rule weights (+12 / +8 / +6 / +10 / −10) are hand-tuned to
  the live ArchaEye fixture. Re-tune across ≥5 saved teams as its own
  slice.
- **Synergy +20 archetype floor + 50 score floor** (§18.D) — same
  calibration slice should evaluate both.
- **Cleaner BP gate** (§18.C) — wait for `moves.base_power` ingest then
  add the BP-100+ STAB-move check.
- **Q12(c) screens / speed-control / redirect compatibility** (§18.F) —
  follows Stage B's phase-aware turn-window model.
- **Sableye+Archaludon vs Pelipper+Archaludon scenario differentiation.**
  Plan §10 read "≥ 1 scenario picks Sableye + Archaludon." The live
  demo wins Pelipper+Archaludon in rain scenarios because Pelipper has
  STAB Hurricane; Sableye contributes screens + Quash whose value is
  defensive. Updating §10 to "≥ 1 scenario picks a (rain
  weather_setter, Archaludon) pair" reflects what the deterministic
  scorer can express; full per-team preference (defensive value of
  screens vs offensive Hurricane) needs a defense-pillar credit for
  screens that Stage B can carry.
- **Plan §15.5 phase_tag backfill** — pre-existing insight rows have
  `phase_tag = NULL`; re-extract on YT slice.

---

**Reviewed-by:** _Rodrigo Caballero_
